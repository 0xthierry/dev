import { describe, expect, mock, test } from "bun:test";
import {
  buildPullRequestUrl,
  loadGitStatus,
  parseGitHubRemoteUrl,
  parsePullRequestFromBranch,
  parsePullRequestFromGh,
  summarizeChanges,
} from "./git";
import type { CommandResult, CommandRunner, CommandRunOptions } from "./types";

describe("parsePullRequestFromBranch", () => {
  test("extracts PR markers from branch names", () => {
    // Arrange
    const branches = ["feature/pr-42-statusline", "gh-readonly-queue/main/pr-313-abc", "pull/88", "fix/#123"];

    // Act
    const results = branches.map((branch) => parsePullRequestFromBranch(branch));

    // Assert
    expect(results).toEqual([
      { number: 42, source: "branch" },
      { number: 313, source: "branch" },
      { number: 88, source: "branch" },
      { number: 123, source: "branch" },
    ]);
  });

  test("does not treat arbitrary ticket numbers as PR numbers", () => {
    // Arrange
    const branches = ["feature/123-statusline", "linear-ENG-12", "main"];

    // Act
    const results = branches.map((branch) => parsePullRequestFromBranch(branch));

    // Assert
    expect(results).toEqual([null, null, null]);
  });
});

describe("parsePullRequestFromGh", () => {
  test("reads a numeric gh pr view response", () => {
    // Arrange
    const stdout = "  987\n";

    // Act
    const result = parsePullRequestFromGh(stdout);

    // Assert
    expect(result).toEqual({ number: 987, source: "gh" });
  });

  test("reads gh JSON with a PR URL", () => {
    // Arrange
    const stdout = JSON.stringify({ number: 321, url: "https://github.com/0xthierry/dev/pull/321" });

    // Act
    const result = parsePullRequestFromGh(stdout);

    // Assert
    expect(result).toEqual({ number: 321, source: "gh", url: "https://github.com/0xthierry/dev/pull/321" });
  });
});

describe("GitHub remote URL parsing", () => {
  test("normalizes common GitHub remote forms", () => {
    // Arrange
    const remotes = [
      "https://github.com/0xthierry/dev.git",
      "git@github.com:0xthierry/dev.git",
      "ssh://git@github.com/0xthierry/dev.git",
    ];

    // Act
    const results = remotes.map((remote) => parseGitHubRemoteUrl(remote));

    // Assert
    expect(results).toEqual([
      "https://github.com/0xthierry/dev",
      "https://github.com/0xthierry/dev",
      "https://github.com/0xthierry/dev",
    ]);
  });

  test("builds a pull request URL from a GitHub remote", () => {
    // Arrange
    const remote = "git@github.com:0xthierry/dev.git";

    // Act
    const result = buildPullRequestUrl(remote, 42);

    // Assert
    expect(result).toBe("https://github.com/0xthierry/dev/pull/42");
  });
});

describe("summarizeChanges", () => {
  test("combines porcelain file counts with numstat line counts", () => {
    // Arrange
    const status = [" M package.json", "A  src/new.ts", "?? notes.md", "R  old.ts -> new.ts"].join("\n");
    const numstat = ["5\t1\tpackage.json", "10\t0\tsrc/new.ts", "-\t-\timage.png"].join("\n");

    // Act
    const result = summarizeChanges(status, numstat);

    // Assert
    expect(result).toEqual({ added: 15, removed: 1, changedFiles: 3, untrackedFiles: 1, binaryFiles: 1 });
  });
});

describe("loadGitStatus", () => {
  test("loads git branch, PR URL, and changes through the command runner", async () => {
    // Arrange
    const run = mock(async (command: string, args: string[], _options: CommandRunOptions): Promise<CommandResult> => {
      if (args.join(" ") === "rev-parse --show-toplevel") return ok("/repo");
      if (args.join(" ") === "branch --show-current") return ok("feature/pr-77-statusline\n");
      if (args.join(" ") === "status --porcelain=v1 --untracked-files=normal") return ok(" M index.ts\n?? todo.md\n");
      if (args.join(" ") === "diff --numstat HEAD --") return ok("2\t1\tindex.ts\n");
      if (args.join(" ") === "config --get remote.origin.url") return ok("git@github.com:0xthierry/dev.git\n");
      if (command === "gh") return { stdout: "", stderr: "no pr", code: 1 };
      return { stdout: "", stderr: "unexpected", code: 2 };
    });
    const runner: CommandRunner = { run };

    // Act
    const result = await loadGitStatus(runner, "/worktree");

    // Assert
    expect(result).toEqual({
      branch: "feature/pr-77-statusline",
      pullRequest: { number: 77, source: "branch", url: "https://github.com/0xthierry/dev/pull/77" },
      changes: { added: 2, removed: 1, changedFiles: 1, untrackedFiles: 1, binaryFiles: 0 },
    });
    expect(run).toHaveBeenCalledWith("git", ["rev-parse", "--show-toplevel"], {
      cwd: "/worktree",
      signal: undefined,
      timeoutMs: 2_000,
    });
    expect(run).toHaveBeenCalledWith("gh", ["pr", "view", "--json", "number,url"], {
      cwd: "/repo",
      signal: undefined,
      timeoutMs: 2_500,
    });
    expect(run).toHaveBeenCalledWith("git", ["config", "--get", "remote.origin.url"], {
      cwd: "/repo",
      signal: undefined,
      timeoutMs: 2_000,
    });
  });
});

function ok(stdout: string): CommandResult {
  return { stdout, stderr: "", code: 0 };
}
