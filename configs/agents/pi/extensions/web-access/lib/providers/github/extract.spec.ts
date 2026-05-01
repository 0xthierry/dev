import { afterEach, describe, expect, test } from "bun:test";
import { clearCloneCache } from "./clone";
import { extractGitHub } from "./extract";

describe("web-access GitHub live clone contract", () => {
  afterEach(() => {
    clearCloneCache();
  });

  test("clones a public GitHub repository and returns local exploration guidance", async () => {
    const result = await extractGitHub("https://github.com/octocat/Hello-World");

    expect(result?.error).toBeNull();
    expect(result?.provider).toBe("github");
    expect(result?.title).toBe("octocat/Hello-World");
    expect(result?.content).toContain("Repository cloned to:");
    expect(result?.content).toContain("Use read and bash tools at the cloned path");
  }, 60_000);
});
