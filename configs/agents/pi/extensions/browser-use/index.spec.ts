import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import { resolveBrowserUsePaths } from "./lib/paths";

type JsonObject = Record<string, unknown>;

const extensionPath = resolve("configs/agents/pi/extensions/browser-use");
const emitTestImage = `await nodeRepl.emitImage({bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBf8AAAAASUVORK5CYII=", "base64"), mimeType: "image/png"});`;

describe("browser-use extension E2E", () => {
  let harness: PiRpcHarness | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
  });

  test("keeps browser_use registered while off and enforces the session toggle through Pi", async () => {
    // Arrange
    const steps = ["default-off", "enabled", "disabled-again", "re-enabled"];
    harness = await startPiRpcHarness({
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        resolve("configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts"),
        "--provider",
        "pi-extension-e2e-faux",
        "--model",
        "pi-extension-e2e-faux-model",
      ],
      env: {
        PI_EXTENSION_E2E_FAUX_API_KEY: "local-test",
        PI_EXTENSION_E2E_FAUX_RESPONSE_PLAN: JSON.stringify(
          steps.flatMap((id) => [
            {
              toolCalls: [
                {
                  id,
                  name: "browser_use",
                  arguments: { code: 'const sentinel = "ENABLED"; nodeRepl.write(sentinel);' },
                },
              ],
            },
            { text: "Step complete." },
          ]),
        ),
      },
    });

    // Act / Assert: if disabled calls disappear from the tool catalog, these tool events cannot occur.
    for (const [index, id] of steps.entries()) {
      if (index > 0) await harness.request({ type: "prompt", message: `/browser-use ${index === 2 ? "off" : "on"}` });
      const start = harness.events.length;
      await harness.request({ type: "prompt", message: `Try ${id}` });
      const event = await harness.waitForEvent(
        (event) => event.type === "tool_execution_end" && event.toolCallId === id,
        90_000,
      );
      const disabled = index === 0 || index === 2;
      expect(event.isError).toBe(disabled);
      expect(JSON.stringify(event.result)).toContain(disabled ? "disabled" : "ENABLED");
      await harness.waitForEvent(
        (event) => event.type === "agent_end" && (harness?.events.indexOf(event) ?? -1) >= start,
        90_000,
      );
    }
  }, 180_000);

  test("runs browser_use through Pi across turns and marks JavaScript failures", async () => {
    // Arrange
    harness = await startPiRpcHarness({
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        resolve("configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts"),
        "--provider",
        "pi-extension-e2e-faux",
        "--model",
        "pi-extension-e2e-faux-model",
      ],
      env: {
        PI_EXTENSION_E2E_FAUX_API_KEY: "local-test",
        PI_EXTENSION_E2E_FAUX_RESPONSE_PLAN: JSON.stringify([
          {
            toolCalls: [
              { id: "first", name: "browser_use", arguments: { code: "const value = 41; nodeRepl.write(value);" } },
            ],
          },
          { text: "First turn finished." },
          {
            toolCalls: [
              { id: "second", name: "browser_use", arguments: { code: `nodeRepl.write(value + 1); ${emitTestImage}` } },
            ],
          },
          { text: "Second turn finished." },
          {
            toolCalls: [
              {
                id: "failure",
                name: "browser_use",
                arguments: { code: `${emitTestImage} throw new Error('EXPECTED_BROWSER_TEST_FAILURE');` },
              },
            ],
          },
          { text: "Failure recorded." },
        ]),
      },
    });

    // Act / Assert
    await harness.request({ type: "prompt", message: "/browser-use on" });
    for (const [id, expected, isError] of [
      ["first", "41", false],
      ["second", "42", false],
      ["failure", "EXPECTED_BROWSER_TEST_FAILURE", true],
    ] as const) {
      const start = harness.events.length;
      await harness.request({ type: "prompt", message: `Run ${id}` });
      const event = await harness.waitForEvent(
        (event) => event.type === "tool_execution_end" && event.toolCallId === id,
        90_000,
      );
      expect(event.isError).toBe(isError);
      expect(JSON.stringify(event.result)).toContain(expected);
      // This upstream kernel discards buffered images when JavaScript throws.
      // The adapter's mixed error-image contract is covered with fake MCP results.
      if (id === "second") {
        expect(
          (event.result as { content: Array<{ type: string }> }).content.some((block) => block.type === "image"),
          `Image missing from ${id}: ${JSON.stringify(event.result)}`,
        ).toBe(true);
      }
      await harness.waitForEvent(
        (event) => event.type === "agent_end" && (harness?.events.indexOf(event) ?? -1) >= start,
        90_000,
      );
    }
  }, 180_000);

  test("connects to the installed browser backend through the actual Pi tool", async () => {
    // Arrange
    const paths = resolveBrowserUsePaths();
    if (!paths.available) throw new Error(paths.reason);
    harness = await startPiRpcHarness({
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        resolve("configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts"),
        "--provider",
        "pi-extension-e2e-faux",
        "--model",
        "pi-extension-e2e-faux-model",
      ],
      env: {
        PI_EXTENSION_E2E_FAUX_API_KEY: "local-test",
        PI_EXTENSION_E2E_FAUX_TOOL_CALLS: JSON.stringify([
          {
            id: "browser-live",
            name: "browser_use",
            arguments: {
              code: `const { setupBrowserRuntime } = await import(${JSON.stringify(paths.browserClient)}); const agent = await setupBrowserRuntime(); const browser = await agent.browsers.get("extension"); nodeRepl.write({ connected: true, userTabCount: (await browser.user.openTabs()).length, sessionTabCount: (await browser.tabs.list()).length });`,
            },
          },
        ]),
      },
    });

    // Act
    await harness.request({ type: "prompt", message: "/browser-use on" });
    await harness.request({ type: "prompt", message: "Check the browser connection without changing any tabs." });
    const event = await harness.waitForEvent(
      (event) => event.type === "tool_execution_end" && event.toolCallId === "browser-live",
      90_000,
    );

    // Assert
    expect(event.isError, JSON.stringify(event.result)).toBe(false);
    expect(JSON.stringify(event.result)).toContain("connected");
    await harness.waitForEvent((event) => event.type === "agent_end", 90_000);
  }, 120_000);

  test("reports kernel availability through Pi", async () => {
    // Arrange
    harness = await startPiRpcHarness({
      extensionPath,
      args: ["--no-extensions", "--no-skills", "--no-context-files"],
    });

    // Act
    const commandsResponse = await harness.request({ type: "get_commands" });
    const commandResponse = await harness.request({ type: "prompt", message: "/browser-use-status" });
    const statusEvent = await harness.waitForEvent(
      (event) =>
        event.type === "extension_ui_request" &&
        event.method === "notify" &&
        typeof event.message === "string" &&
        (event.message.includes('"available": true') || event.message.includes('"available": false')),
      30_000,
    );

    // Assert
    expect(commandNames(commandsResponse)).toContain("browser-use-status");
    expect(commandNames(commandsResponse)).toContain("browser-use");
    expect(commandResponse.success).toBe(true);
    expect(typeof statusEvent.message).toBe("string");
    expect(harness.stderr()).toBe("");
  }, 45_000);
});

function commandNames(response: JsonObject): string[] {
  const data = response.data as { commands?: Array<{ name?: unknown }> } | undefined;
  return (
    data?.commands?.map((command) => command.name).filter((name): name is string => typeof name === "string") ?? []
  );
}
