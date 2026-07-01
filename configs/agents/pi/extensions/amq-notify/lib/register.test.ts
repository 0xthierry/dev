import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { BINDING_ENTRY } from "./binding";
import { registerAmqNotifyExtension } from "./register";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Entry = { type: string; customType?: string; data?: unknown };
type ExecCall = { command: string; args: string[]; options: Record<string, unknown> };

type SentMessage = { text: string; options?: unknown };

const TEST_CWD = "/tmp/amq-notify-test";

afterEach(() => {
  rmSync(TEST_CWD, { recursive: true, force: true });
});

// A session store whose custom entries persist across extension instances — this is
// how pi carries state across a /reload (rebind) or a stop+resume (new process).
function makeSession() {
  const entries: Entry[] = [];
  return { entries, sessionManager: { getEntries: () => entries } };
}

function isBindingData(data: unknown): data is { root: string } {
  return typeof data === "object" && data !== null && "root" in data && typeof data.root === "string";
}

// One extension instance bound to a (possibly shared) session, modelling pi's
// per-session rebinding: each reload/resume re-runs the factory with a fresh `pi`.
function makeInstance(session: ReturnType<typeof makeSession>, options: { idle?: boolean } = {}) {
  const handlers: Record<string, Handler> = {};
  const sent: SentMessage[] = [];
  const execCalls: ExecCall[] = [];
  let monitorCalls = 0;
  const pi = {
    on(event: string, handler: Handler) {
      handlers[event] = handler;
    },
    appendEntry(customType: string, data: unknown) {
      session.entries.push({ type: "custom", customType, data });
      if (customType === BINDING_ENTRY && isBindingData(data)) mkdirSync(data.root, { recursive: true });
    },
    async exec(command: string, args: string[] = [], execOptions: Record<string, unknown> = {}) {
      execCalls.push({ command, args, options: execOptions });
      await new Promise((resolve) => setTimeout(resolve, 1));

      if (args[0] === "monitor") {
        monitorCalls += 1;
        if (monitorCalls === 1) {
          return {
            stdout: JSON.stringify({
              event: "messages",
              mode: "peek",
              me: "pi",
              count: 1,
              drained: [{ id: "msg-1", from: "tester", thread: "p2p/tester__pi", body: "hello" }],
            }),
            stderr: "",
            code: 0,
          };
        }

        return {
          stdout: JSON.stringify({ event: "timeout", mode: "peek", me: "pi", count: 0, drained: [] }),
          stderr: "monitor timed out",
          code: 4,
        };
      }

      return { stdout: "", stderr: "", code: 0 };
    },
    sendUserMessage(text: string, sendOptions?: unknown) {
      sent.push({ text, options: sendOptions });
    },
  };
  const ctx = {
    cwd: TEST_CWD,
    isIdle: () => options.idle ?? true,
    sessionManager: session.sessionManager,
  };
  return {
    execCalls,
    sent,
    // biome-ignore lint/suspicious/noExplicitAny: minimal ExtensionAPI mock
    register: () => registerAmqNotifyExtension(pi as any),
    start: (reason: string) => handlers.session_start?.({ type: "session_start", reason }, ctx),
    beforeAgentStart: (systemPrompt: string) => handlers.before_agent_start?.({ systemPrompt }, ctx),
    shutdown: () => handlers.session_shutdown?.({ type: "session_shutdown", reason: "reload" }, ctx),
  };
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function bindingEntries(session: ReturnType<typeof makeSession>) {
  return session.entries.filter((entry) => entry.customType === "amq-notify-binding");
}

test("a rebound instance (reload/resume) reuses the persisted room and keeps delivering", async () => {
  // Arrange
  const prev = {
    root: process.env.AM_ROOT,
    me: process.env.AM_ME,
    role: process.env.AMQ_NOTIFY_ROLE,
  };
  delete process.env.AM_ROOT;
  delete process.env.AM_ME;
  delete process.env.AMQ_NOTIFY_ROLE;

  try {
    const session = makeSession();
    const a = makeInstance(session);
    a.register();

    // Act
    a.start("startup");
    await tick(25);
    const rootA = process.env.AM_ROOT;
    a.shutdown();
    const b = makeInstance(session);
    b.register();
    b.start("reload");
    await tick(25);

    // Assert
    expect(rootA).toBeTruthy();
    expect(a.sent.length).toBe(1);
    expect(process.env.AM_ROOT).toBe(rootA);
    expect(b.sent.length).toBe(1);
    expect(bindingEntries(session).length).toBe(1);
    expect(b.execCalls.some((call) => call.args[0] === "read" && call.args.includes("msg-1"))).toBe(true);
    b.shutdown();
  } finally {
    if (prev.root !== undefined) process.env.AM_ROOT = prev.root;
    else delete process.env.AM_ROOT;
    if (prev.me !== undefined) process.env.AM_ME = prev.me;
    else delete process.env.AM_ME;
    if (prev.role !== undefined) process.env.AMQ_NOTIFY_ROLE = prev.role;
    else delete process.env.AMQ_NOTIFY_ROLE;
  }
});

test("a coop-exec worker (inherited AM_ROOT) stays out of the way", async () => {
  // Arrange
  const prev = { root: process.env.AM_ROOT, role: process.env.AMQ_NOTIFY_ROLE };
  process.env.AM_ROOT = "/tmp/coop-session";
  delete process.env.AMQ_NOTIFY_ROLE;

  try {
    const session = makeSession();
    const worker = makeInstance(session);

    // Act
    worker.register();
    worker.start("startup");
    await tick(10);

    // Assert
    expect(worker.sent.length).toBe(0);
    expect(bindingEntries(session).length).toBe(0);
    expect(process.env.AM_ROOT).toBe("/tmp/coop-session");
  } finally {
    if (prev.root !== undefined) process.env.AM_ROOT = prev.root;
    else delete process.env.AM_ROOT;
    if (prev.role !== undefined) process.env.AMQ_NOTIFY_ROLE = prev.role;
    else delete process.env.AMQ_NOTIFY_ROLE;
  }
});

test("busy sessions steer incoming AMQ notices into the active agent turn", async () => {
  // Arrange
  const prev = { root: process.env.AM_ROOT, role: process.env.AMQ_NOTIFY_ROLE };
  delete process.env.AM_ROOT;
  delete process.env.AMQ_NOTIFY_ROLE;

  try {
    const session = makeSession();
    const instance = makeInstance(session, { idle: false });
    instance.register();

    // Act
    instance.start("startup");
    await tick(25);

    // Assert
    expect(instance.sent).toHaveLength(1);
    expect(instance.sent[0]?.options).toEqual({ deliverAs: "steer" });
    instance.shutdown();
  } finally {
    if (prev.root !== undefined) process.env.AM_ROOT = prev.root;
    else delete process.env.AM_ROOT;
    if (prev.role !== undefined) process.env.AMQ_NOTIFY_ROLE = prev.role;
    else delete process.env.AMQ_NOTIFY_ROLE;
  }
});

test("adds stable wait guidance to the system prompt", () => {
  // Arrange
  const prev = { root: process.env.AM_ROOT, role: process.env.AMQ_NOTIFY_ROLE };
  delete process.env.AM_ROOT;
  delete process.env.AMQ_NOTIFY_ROLE;
  const session = makeSession();
  const instance = makeInstance(session);

  try {
    instance.register();

    // Act
    const result = instance.beforeAgentStart("base prompt") as { systemPrompt: string };

    // Assert
    expect(result.systemPrompt).toContain("base prompt");
    expect(result.systemPrompt).toContain("[amq-notify]");
    expect(result.systemPrompt).toContain("By default");
    expect(result.systemPrompt).toContain("If the user explicitly asks/orders you to manually check AMQ, obey");
    expect(result.systemPrompt).toContain("Do not substitute filesystem probes for an AMQ check");
  } finally {
    if (prev.root !== undefined) process.env.AM_ROOT = prev.root;
    else delete process.env.AM_ROOT;
    if (prev.role !== undefined) process.env.AMQ_NOTIFY_ROLE = prev.role;
    else delete process.env.AMQ_NOTIFY_ROLE;
  }
});
