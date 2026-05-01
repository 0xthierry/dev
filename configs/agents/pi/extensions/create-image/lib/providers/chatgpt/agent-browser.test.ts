import { describe, expect, mock, test } from "bun:test";
import { type ChatGptAgentBrowserTransport, generateWithChatGptAgentBrowser } from "./agent-browser";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodeEvalResult(value: unknown): string {
  return JSON.stringify(JSON.stringify(value));
}

function transport(): { transport: ChatGptAgentBrowserTransport; runAgentBrowser: ReturnType<typeof mock> } {
  const runAgentBrowser = mock(async (args: string[]) => {
    const command = args.join(" ");
    if (command.startsWith("tab new")) return "✓ ChatGPT\n";
    if (command === "wait #prompt-textarea") return "✓ Done\n";
    if (command === 'click button[aria-label="Send prompt"]') return "✓ Done\n";
    if (command === "tab close pi-chatgpt-image-test") return "✓ Closed\n";
    if (command === "eval --stdin") {
      const call = runAgentBrowser.mock.calls.filter((entry) => entry[0].join(" ") === "eval --stdin").length;
      if (call === 1) return encodeEvalResult({ ok: true });
      if (call === 2) {
        return encodeEvalResult({
          ok: true,
          conversationId: "conversation-id",
          status: 200,
          assets: [{ assetPointer: "sediment://file-id", fileId: "file-id" }],
        });
      }
      return encodeEvalResult({
        ok: true,
        status: 200,
        contentType: "image/png",
        bytes: pngBytes.length,
        magicHex: Buffer.from(pngBytes).toString("hex"),
        base64: Buffer.from(pngBytes).toString("base64"),
      });
    }
    throw new Error(`Unexpected agent-browser command: ${command}`);
  });

  return {
    runAgentBrowser,
    transport: {
      runAgentBrowser,
      sleep: mock(async () => undefined),
      randomLabel: () => "pi-chatgpt-image-test",
      timeoutMs: 30_000,
      pollIntervalMs: 1,
    },
  };
}

describe("generateWithChatGptAgentBrowser", () => {
  test("generates and downloads images through agent-browser", async () => {
    // Arrange
    const fake = transport();

    // Act
    const result = await generateWithChatGptAgentBrowser({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result).toEqual({
      providerId: "chatgpt-web",
      providerLabel: "ChatGPT Web",
      images: [{ bytes: pngBytes, mimeType: "image/png", extension: "png", providerImageId: "file-id" }],
    });
    expect(fake.runAgentBrowser.mock.calls.map((call) => call[0])).toEqual([
      ["tab", "new", "--label", "pi-chatgpt-image-test", "https://chatgpt.com/"],
      ["wait", "#prompt-textarea"],
      ["eval", "--stdin"],
      ["click", 'button[aria-label="Send prompt"]'],
      ["eval", "--stdin"],
      ["eval", "--stdin"],
      ["tab", "close", "pi-chatgpt-image-test"],
    ]);
  });

  test("closes the ChatGPT tab when generation fails", async () => {
    // Arrange
    const fake = transport();
    fake.runAgentBrowser.mockImplementation(async (args: string[]) => {
      const command = args.join(" ");
      if (command.startsWith("tab new")) return "✓ ChatGPT\n";
      if (command === "wait #prompt-textarea") return "✓ Done\n";
      if (command === 'click button[aria-label="Send prompt"]') return "✓ Done\n";
      if (command === "tab close pi-chatgpt-image-test") return "✓ Closed\n";
      if (command === "eval --stdin") return encodeEvalResult({ ok: false, error: "submit failed" });
      throw new Error(`Unexpected agent-browser command: ${command}`);
    });

    // Act
    const promise = generateWithChatGptAgentBrowser({ prompt: "generate a fox" }, fake.transport);

    // Assert
    await expect(promise).rejects.toThrow("submit failed");
    expect(fake.runAgentBrowser.mock.calls.at(-1)?.[0]).toEqual(["tab", "close", "pi-chatgpt-image-test"]);
  });
});
