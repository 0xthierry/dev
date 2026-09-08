import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import { resolveBrowserUsePaths } from "./lib/paths";
import type { BrowserUseContentBlock } from "./lib/result";

test("dogfoods navigation, UI input, screenshots, errors, cross-turn handles, and tab cleanup through Pi", async () => {
  // Arrange: this page receives only generated test data and has no external resources.
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        `<!doctype html><html lang="en"><title>Browser Use verification</title>
      <body style="font:24px sans-serif;padding:40px;background:#f4f7fb;color:#142338">
      <h1>Browser Use verification</h1><label>Test message <input id="message"></label>
      <button onclick="document.getElementById('status').textContent='Verified: '+document.getElementById('message').value">Check</button>
      <p id="status" role="status">Waiting for input</p></body></html>`,
        { headers: { "content-type": "text/html" } },
      ),
  });
  const paths = resolveBrowserUsePaths();
  if (!paths.available) {
    server.stop(true);
    throw new Error(paths.reason);
  }
  const artifactDir = await mkdtemp(join(tmpdir(), "browser-use-dogfood-"));
  const code = [
    `const { setupBrowserRuntime } = await import(${JSON.stringify(paths.browserClient)}); const agent = await setupBrowserRuntime(); const browser = await agent.browsers.get("extension"); nodeRepl.write(await browser.documentation());`,
    `await browser.nameSession("🔎 Browser Use verification"); const originalTabs = await browser.user.openTabs(); const tab = await browser.tabs.new(); await tab.goto(${JSON.stringify(server.url.toString())}); await tab.ax.write("both"); await tab.markHandoff();`,
    `await tab.playwright.getByLabel("Test message", {exact:true}).fill("Pi browser tool works"); await tab.playwright.getByRole("button", {name:"Check",exact:true}).click(); await tab.ax.write("both"); await tab.markHandoff();`,
    `if (typeof tab !== "undefined") await tab.close(); const remaining = await browser.user.openTabs(); nodeRepl.write({closedTestTab: !(await browser.tabs.list()).some(item => item.id === tab.id), originalTabsStillOpen: originalTabs.every(item => remaining.some(current => current.id === item.id))});`,
  ];
  const plan = [
    { toolCalls: [{ id: "docs", name: "browser_use", arguments: { code: code[0] } }] },
    { toolCalls: [{ id: "before", name: "browser_use", arguments: { code: code[1] } }] },
    { text: "Test page opened; continue next turn." },
    { toolCalls: [{ id: "after", name: "browser_use", arguments: { code: code[2] } }] },
    {
      toolCalls: [
        {
          id: "failure",
          name: "browser_use",
          arguments: { code: 'throw new Error("EXPECTED_BROWSER_TEST_FAILURE");' },
        },
      ],
    },
    { text: "Screenshot captured and separate expected error recorded; cleanup next turn." },
    { toolCalls: [{ id: "cleanup", name: "browser_use", arguments: { code: code[3] } }] },
    { text: "Temporary tab closed." },
  ];
  const harness = await startPiRpcHarness({
    extensionPath: resolve("configs/agents/pi/extensions/browser-use"),
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
    env: { PI_EXTENSION_E2E_FAUX_API_KEY: "local-test", PI_EXTENSION_E2E_FAUX_RESPONSE_PLAN: JSON.stringify(plan) },
  });
  let unapprovedOrigin = false;
  try {
    // Act: explicitly enable the real registered tool; no alternate browser driver.
    await harness.request({ type: "prompt", message: "/browser-use on" });
    for (const message of [
      "Open the verification page",
      "Test input and screenshot delivery",
      "Close only the verification tab",
    ]) {
      let cursor = harness.events.length;
      await harness.request({ type: "prompt", message });
      while (true) {
        const event = await harness.waitForEvent(
          (event) =>
            harness.events.indexOf(event) >= cursor &&
            (event.type === "agent_end" || (event.type === "extension_ui_request" && event.method === "confirm")),
          120_000,
        );
        cursor = harness.events.indexOf(event) + 1;
        if (event.type === "agent_end") break;
        // Forward the real Pi confirmation to the human running this live spec.
        // Never substitute an automated approval or change browser permission config.
        const confirmed =
          process.stdin.isTTY &&
          prompt(`${String(event.title)}\n${String(event.message)}\nApprove this request? Type yes:`) === "yes";
        if (!confirmed) unapprovedOrigin = true;
        harness.send({ type: "extension_ui_response", id: event.id, confirmed });
      }
    }
    const results = harness.events.filter((event) => event.type === "tool_execution_end");
    const resultFor = (id: string) => {
      const event = results.find((item) => item.toolCallId === id);
      if (!event) throw new Error(`Missing tool result: ${id}`);
      return { event, content: (event.result as { content: BrowserUseContentBlock[] }).content };
    };
    for (const id of ["before", "after"]) {
      const image = resultFor(id).content.find((block) => block.type === "image");
      if (image?.type === "image") await writeFile(join(artifactDir, `${id}.png`), Buffer.from(image.data, "base64"));
    }
    console.log(`Browser Use dogfood screenshots: ${artifactDir}`);

    // Assert after cleanup so an assertion failure cannot strand a marked test tab.
    if (unapprovedOrigin)
      throw new Error(
        "Browser-origin approval was not granted. Run this live spec in a terminal and explicitly confirm the loopback test-page request, or dogfood browser_use interactively in Pi.",
      );
    expect(resultFor("docs").event.isError).toBe(false);
    expect(
      resultFor("before").event.isError,
      JSON.stringify(resultFor("before").content.filter((item) => item.type === "text")),
    ).toBe(false);
    expect(resultFor("before").content.some((block) => block.type === "image")).toBe(true);
    expect(resultFor("after").event.isError).toBe(false);
    expect(resultFor("failure").event.isError).toBe(true);
    expect(resultFor("after").content.some((block) => block.type === "image")).toBe(true);
    expect(JSON.stringify(resultFor("after").content.filter((item) => item.type === "text"))).toContain(
      "Verified: Pi browser tool works",
    );
    expect(JSON.stringify(resultFor("failure").content.filter((item) => item.type === "text"))).toContain(
      "EXPECTED_BROWSER_TEST_FAILURE",
    );
    expect(resultFor("cleanup").event.isError, JSON.stringify(resultFor("cleanup").content)).toBe(false);
    const cleanupText = resultFor("cleanup")
      .content.filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(cleanupText).toContain('"closedTestTab": true');
    expect(cleanupText).toContain('"originalTabsStillOpen": true');
  } finally {
    await harness.stop();
    server.stop(true);
  }
}, 360_000);
