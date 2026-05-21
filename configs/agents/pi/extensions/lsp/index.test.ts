import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import lsp from "./index";

describe("lsp extension entrypoint", () => {
  test("registers the lsp command and tools", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    lsp(fakePi.pi);

    // Assert
    expect(fakePi.commands.has("lsp")).toBe(true);
    expect(fakePi.tools.has("lsp_diagnostics")).toBe(true);
    expect(fakePi.tools.has("lsp_fix")).toBe(true);
  });
});
