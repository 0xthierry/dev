import { describe, expect, test } from "bun:test";
import { isUnsupportedMethodError, LspResponseError } from "./lsp-client";

describe("isUnsupportedMethodError", () => {
  test("recognizes JSON-RPC method-not-found errors", () => {
    // Arrange
    const error = new LspResponseError(-32601, "typescript LSP error: Unhandled method textDocument/diagnostic");

    // Act
    const unsupported = isUnsupportedMethodError(error);

    // Assert
    expect(unsupported).toBe(true);
  });

  test("recognizes language-server unsupported-method wording", () => {
    // Arrange
    const errors = [
      new Error("typescript LSP error: Unhandled method textDocument/diagnostic"),
      new Error("server does not support textDocument/diagnostic"),
      new Error("Method not found: textDocument/diagnostic"),
    ];

    // Act
    const results = errors.map((error) => isUnsupportedMethodError(error));

    // Assert
    expect(results).toEqual([true, true, true]);
  });

  test("does not classify unrelated LSP failures as unsupported methods", () => {
    // Arrange
    const error = new LspResponseError(-32603, "typescript LSP error: failed to parse project");

    // Act
    const unsupported = isUnsupportedMethodError(error);

    // Assert
    expect(unsupported).toBe(false);
  });
});
