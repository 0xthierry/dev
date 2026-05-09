import { describe, expect, test } from "bun:test";
import { expandPatternList, matchFirstGlob, normalizeRulePath } from "./glob";

describe("matchFirstGlob", () => {
  test("matches recursive globs and brace expansions", () => {
    // Arrange
    const patterns = ["src/**/*.{ts,tsx}"];

    // Act
    const match = matchFirstGlob("@src/components/Button.tsx:12", patterns);

    // Assert
    expect(match).toEqual({ pattern: "src/**/*.tsx", path: "src/components/Button.tsx" });
  });

  test("does not treat root globs as recursive", () => {
    // Arrange
    const patterns = ["*.md"];

    // Act
    const rootMatch = matchFirstGlob("README.md", patterns);
    const nestedMatch = matchFirstGlob("docs/README.md", patterns);

    // Assert
    expect(rootMatch?.pattern).toBe("*.md");
    expect(nestedMatch).toBeUndefined();
  });

  test("normalizes shell and prompt path decorations", () => {
    // Arrange
    const path = "@./src/index.ts:10:2,";

    // Act
    const normalized = normalizeRulePath(path);

    // Assert
    expect(normalized).toBe("src/index.ts");
  });
});

describe("expandPatternList", () => {
  test("expands comma-free brace alternatives", () => {
    // Arrange
    const patterns = ["lib/**/*.{ts,tsx}"];

    // Act
    const expanded = expandPatternList(patterns);

    // Assert
    expect(expanded).toEqual(["lib/**/*.ts", "lib/**/*.tsx"]);
  });
});
