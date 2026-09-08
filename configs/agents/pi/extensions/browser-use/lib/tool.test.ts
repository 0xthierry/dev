import { describe, expect, test } from "bun:test";
import { browserUseToolDescription, parseBrowserUseCode, summarizeBrowserUseCode } from "./tool";

describe("parseBrowserUseCode", () => {
  test("reads the code field", () => {
    // Arrange
    const input = { code: "nodeRepl.write(1);" };

    // Act
    const result = parseBrowserUseCode(input);

    // Assert
    expect(result).toBe("nodeRepl.write(1);");
  });
});

describe("summarizeBrowserUseCode", () => {
  test("returns the first non-empty line", () => {
    // Arrange
    const input = { code: "\n  const x = 1;\nconst y = 2;" };

    // Act
    const result = summarizeBrowserUseCode(input);

    // Assert
    expect(result).toBe("const x = 1;");
  });
});

describe("browserUseToolDescription", () => {
  test("embeds the browser-client path", () => {
    // Arrange
    const path = "/tmp/browser-client.mjs";

    // Act
    const result = browserUseToolDescription(path);

    // Assert
    expect(result).toContain('await import("/tmp/browser-client.mjs")');
    expect(result).toContain("setupBrowserRuntime");
  });
});
