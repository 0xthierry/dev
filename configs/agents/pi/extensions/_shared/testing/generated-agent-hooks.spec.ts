import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePi } from "./fake-pi";

type JsonObject = Record<string, unknown>;

type SocketCapture = {
  messages: JsonObject[];
  waitFor: (predicate: (message: JsonObject) => boolean) => Promise<JsonObject>;
  close: () => Promise<void>;
};

const envKeys = [
  "HERDR_ENV",
  "HERDR_SOCKET_PATH",
  "HERDR_PANE_ID",
  "HERDR_SESSION",
  "HERDR_WORKSPACE_ID",
  "HERDR_TAB_ID",
  "MOSHI_SOCKET_PATH",
] as const;

const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
let tempDir: string | undefined;
let capture: SocketCapture | undefined;

afterEach(async () => {
  await capture?.close();
  capture = undefined;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;

  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("vendor-generated Pi agent hooks E2E", () => {
  test("reports Pi lifecycle and session identity to Herdr", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "herdr-pi-hook-e2e-"));
    const socketPath = join(tempDir, "herdr.sock");
    const herdrCapture = await startSocketCapture(socketPath, true);
    capture = herdrCapture;
    process.env.HERDR_ENV = "1";
    process.env.HERDR_SOCKET_PATH = socketPath;
    process.env.HERDR_PANE_ID = "w1:p2";
    const register = await importGeneratedHook("../../herdr-agent-state.ts");
    const fakePi = createFakePi();

    // Act
    register(fakePi.pi);
    await fakePi.emit("session_start", { reason: "startup" }, { mode: "tui", isIdle: () => true });
    await herdrCapture.waitFor((message) => message.method === "pane.report_agent_session");
    await herdrCapture.waitFor((message) => stateFromHerdrMessage(message) === "idle");
    await fakePi.emit("agent_start", {}, { mode: "tui", isIdle: () => false });
    const working = await herdrCapture.waitFor((message) => stateFromHerdrMessage(message) === "working");
    const idleCountBeforeSettlement = herdrCapture.messages.filter(
      (message) => stateFromHerdrMessage(message) === "idle",
    ).length;
    await fakePi.emit("agent_settled", {}, { mode: "tui", isIdle: () => true });
    const idle = await herdrCapture.waitFor(
      (message) =>
        stateFromHerdrMessage(message) === "idle" &&
        herdrCapture.messages.filter((candidate) => stateFromHerdrMessage(candidate) === "idle").length >
          idleCountBeforeSettlement,
    );

    // Assert
    expect(paramsFrom(working)).toMatchObject({ pane_id: "w1:p2", agent: "pi", state: "working" });
    expect(paramsFrom(idle)).toMatchObject({ pane_id: "w1:p2", agent: "pi", state: "idle" });
    expect(herdrCapture.messages.some((message) => paramsFrom(message).agent_session_id === "fake-session-id")).toBe(
      true,
    );
  });

  test("sends Pi session and completion envelopes to Moshi", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "moshi-pi-hook-e2e-"));
    const socketPath = join(tempDir, "moshi.sock");
    const moshiCapture = await startSocketCapture(socketPath, false);
    capture = moshiCapture;
    process.env.MOSHI_SOCKET_PATH = socketPath;
    process.env.HERDR_ENV = "1";
    process.env.HERDR_SESSION = "dev";
    process.env.HERDR_PANE_ID = "w1:p2";
    process.env.HERDR_WORKSPACE_ID = "w1";
    process.env.HERDR_TAB_ID = "w1:t1";
    const register = await importGeneratedHook("../../moshi-hooks.ts");
    const fakePi = createFakePi({ cwd: tempDir });

    // Act
    register(fakePi.pi);
    await fakePi.emit("session_start", { reason: "startup" });
    await fakePi.emit("before_agent_start", { prompt: "upgrade the tools" });
    await fakePi.emit("agent_start", {});
    await fakePi.emit("agent_end", { messages: [{ role: "assistant", content: "upgrade complete" }] });
    await fakePi.emit("agent_settled", {});
    const completed = await moshiCapture.waitFor((message) => message.category === "task_complete");

    // Assert
    expect(moshiCapture.messages.some((message) => message.eventName === "SessionStart")).toBe(true);
    expect(moshiCapture.messages.some((message) => message.category === "session_started")).toBe(true);
    expect(completed).toMatchObject({
      source: "pi",
      sessionId: "fake-session-id",
      herdrSession: "dev",
      herdrPane: "w1:p2",
      category: "task_complete",
      title: "upgrade complete",
    });
  });
});

async function importGeneratedHook(relativePath: string) {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set("e2e", `${Date.now()}-${Math.random()}`);
  const module = (await import(url.href)) as { default: (pi: ReturnType<typeof createFakePi>["pi"]) => void };
  return module.default;
}

function paramsFrom(message: JsonObject): JsonObject {
  return isObject(message.params) ? message.params : {};
}

function stateFromHerdrMessage(message: JsonObject): unknown {
  return paramsFrom(message).state;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function startSocketCapture(socketPath: string, reply: boolean): Promise<SocketCapture> {
  const messages: JsonObject[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let buffered = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        messages.push(JSON.parse(line) as JsonObject);
        if (reply) socket.write('{"ok":true}\n');
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });

  await listen(server, socketPath);

  return {
    messages,
    waitFor: async (predicate) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const match = messages.find(predicate);
        if (match) return match;
        await Bun.sleep(10);
      }
      throw new Error(`Timed out waiting for generated hook message; received ${JSON.stringify(messages)}`);
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    },
  };
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
