import { describe, expect, test } from "bun:test";
import { extractAgentsPathTargets } from "./targets";

describe("extractAgentsPathTargets", () => {
  test("classifies file mutation and read tool paths as files", () => {
    // Arrange
    const inputs = [
      ["read", { path: "src/app.ts" }],
      ["edit", { path: "src/app.ts" }],
      ["write", { path: "src/app.ts" }],
    ] as const;

    // Act
    const results = inputs.map(([toolName, input]) => extractAgentsPathTargets(toolName, input));

    // Assert
    expect(results).toEqual([
      [{ path: "src/app.ts", kind: "file" }],
      [{ path: "src/app.ts", kind: "file" }],
      [{ path: "src/app.ts", kind: "file" }],
    ]);
  });

  test("classifies directory exploration tool paths", () => {
    // Arrange
    const inputs = [
      ["ls", { path: "src" }],
      ["find", { path: "src" }],
      ["grep", { path: "src" }],
    ] as const;

    // Act
    const results = inputs.map(([toolName, input]) => extractAgentsPathTargets(toolName, input));

    // Assert
    expect(results).toEqual([
      [{ path: "src", kind: "directory" }],
      [{ path: "src", kind: "directory" }],
      [{ path: "src", kind: "unknown" }],
    ]);
  });

  test("extracts common custom tool path fields", () => {
    // Arrange
    const input = {
      path: ["src/app.ts", 123, "src/api.ts"],
      file_path: "test/app.test.ts",
      cwd: "packages/web",
      directory: "docs",
    };

    // Act
    const result = extractAgentsPathTargets("custom", input);

    // Assert
    expect(result).toEqual([
      { path: "src/app.ts", kind: "unknown" },
      { path: "src/api.ts", kind: "unknown" },
      { path: "test/app.test.ts", kind: "file" },
      { path: "packages/web", kind: "directory" },
      { path: "docs", kind: "directory" },
    ]);
  });

  test("ignores invalid or empty inputs", () => {
    // Arrange
    const inputs = [undefined, null, [], { path: "   " }];

    // Act
    const results = inputs.map((input) => extractAgentsPathTargets("read", input));

    // Assert
    expect(results).toEqual([[], [], [], []]);
  });
});
