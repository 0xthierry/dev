import { afterEach, describe, expect, test } from "bun:test";
import { extractViaHttp } from "./http";

describe("web-access HTTP fetch integration", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  test("extracts readable markdown from a real HTTP response", async () => {
    const body = Array.from(
      { length: 20 },
      (_, index) => `<p>Paragraph ${index + 1} with enough readable content for Readability extraction.</p>`,
    ).join("\n");
    server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          `<!doctype html><html><head><title>Local Article</title></head><body><article>${body}</article></body></html>`,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
    });

    const result = await extractViaHttp(new URL("/article", server.url).toString());

    expect(result.error).toBeNull();
    expect(result.provider).toBe("http");
    expect(result.title).toBe("Local Article");
    expect(result.content).toContain("Paragraph 1");
  });
});
