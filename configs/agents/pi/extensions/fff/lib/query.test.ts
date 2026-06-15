import { describe, expect, test } from "bun:test";
import { buildQuery, normalizeExcludes, normalizePathConstraint } from "./query";

const cwd = "/tmp/workspace";

describe("normalizePathConstraint", () => {
  test("converts absolute in-workspace paths to repo-relative constraints", () => {
    // Arrange
    const pathConstraint = "/tmp/workspace/.agents/**";

    // Act
    const result = normalizePathConstraint(pathConstraint, cwd);

    // Assert
    expect(result).toBe(".agents/");
  });

  test("rejects absolute paths outside the workspace", () => {
    // Arrange
    const pathConstraint = "/tmp/other/.agents/**";

    // Act
    const act = () => normalizePathConstraint(pathConstraint, cwd);

    // Assert
    expect(act).toThrow("Path constraint must be relative to the workspace");
  });

  test("collapses simple trailing recursive directory globs", () => {
    // Arrange
    const constraints = [".agents/**", "src/**/*", "src/**/*.ts", "{src,lib}/**"];

    // Act
    const results = constraints.map((constraint) => normalizePathConstraint(constraint, cwd));

    // Assert
    expect(results).toEqual([".agents/", "src/", "src/**/*.ts", "{src,lib}/**"]);
  });

  test("treats workspace roots as no constraint", () => {
    // Arrange
    const constraints = [".", "./", cwd];

    // Act
    const results = constraints.map((constraint) => normalizePathConstraint(constraint, cwd));

    // Assert
    expect(results).toEqual([null, null, null]);
  });

  test("normalizes bare directories and files differently", () => {
    // Arrange
    const constraints = ["app", "src/nested", "src/main.rs", "*.ts"];

    // Act
    const results = constraints.map((constraint) => normalizePathConstraint(constraint, cwd));

    // Assert
    expect(results).toEqual(["app/", "src/nested/", "src/main.rs", "*.ts"]);
  });

  test("strips @ mention prefixes from path constraints", () => {
    // Arrange
    const constraints = ["@src/main.ts", '@"src/with space.ts"'];

    // Act
    const results = constraints.map((constraint) => normalizePathConstraint(constraint, cwd));

    // Assert
    expect(results).toEqual(["src/main.ts", "src/with space.ts"]);
  });
});

describe("normalizeExcludes", () => {
  test("splits comma and space separated excludes and adds negation", () => {
    // Arrange
    const exclude = "test/,*.min.js,!vendor/";

    // Act
    const result = normalizeExcludes(exclude, cwd);

    // Assert
    expect(result).toEqual(["!test/", "!*.min.js", "!vendor/"]);
  });
});

describe("buildQuery", () => {
  test("builds queries with normalized include and exclude constraints", () => {
    // Arrange
    const pathConstraint = "/tmp/workspace/.agents/**";
    const pattern = "needle";
    const exclude = "/tmp/workspace/test/**";

    // Act
    const result = buildQuery(pathConstraint, pattern, exclude, cwd);

    // Assert
    expect(result).toBe(".agents/ !test/ needle");
  });

  test("omits root path constraints", () => {
    // Arrange
    const pathConstraint = ".";
    const pattern = "needle";

    // Act
    const result = buildQuery(pathConstraint, pattern, undefined, cwd);

    // Assert
    expect(result).toBe("needle");
  });
});
