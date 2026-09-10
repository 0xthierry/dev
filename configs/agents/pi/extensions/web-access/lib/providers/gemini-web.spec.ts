import { describe, expect, test } from "bun:test";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web";

describe("web-access Gemini Web live contract", () => {
  test("accepts Gemini-sized response headers under Node, not just Bun", async () => {
    // Arrange: use Node's actual HTTP parser with fake cookies and a local server.
    const script = `
      import { createServer } from "node:http";
      import { createJiti } from "jiti";
      const jiti = createJiti(import.meta.url);
      const { queryWithCookies } = await jiti.import("./configs/agents/pi/extensions/web-access/lib/providers/gemini-web.ts");
      const server = createServer((req, res) => {
        res.setHeader("x-large-header", "x".repeat(32 * 1024));
        if (req.method === "POST") {
          const candidate = [null, ["Gemini large headers work"]];
          res.end(JSON.stringify([[null, null, JSON.stringify([null, null, null, null, [candidate]])]]));
        } else {
          res.end('"SNlM0e":"fake-token"');
        }
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = (_url, options) => nativeFetch("http://127.0.0.1:" + server.address().port, options);
      try {
        console.log(await queryWithCookies("test", { SID: "fake-cookie" }, { timeoutMs: 5000 }));
      } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    `;

    // Act
    const child = Bun.spawn(["node", "--input-type=module", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    // Assert
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Gemini large headers work");
  }, 15_000);

  test("validates Brave/Chromium cookie access and Gemini Web responses", async () => {
    const cookies = await isGeminiWebAvailable();
    expect(cookies).toBeTruthy();
    if (!cookies)
      throw new Error("Gemini Web cookies were not found. Sign into gemini.google.com in Brave or Chromium.");

    const response = await queryWithCookies("Reply with exactly these words: Gemini web smoke", cookies, {
      timeoutMs: 60_000,
    });
    expect(response.toLowerCase()).toContain("gemini web smoke");
  }, 90_000);
});
