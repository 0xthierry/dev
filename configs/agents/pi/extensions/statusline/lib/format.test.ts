import { describe, expect, test } from "bun:test";
import { formatChangeSummary, formatPullRequest, formatStatusline, formatStockQuote } from "./format";
import type { StatuslineSnapshot } from "./types";

const pr42Link = "\x1b]8;;https://github.com/0xthierry/dev/pull/42\x1b\\PR #42\x1b]8;;\x1b\\";

describe("formatPullRequest", () => {
  test("formats pull requests as terminal hyperlinks when a URL is available", () => {
    // Arrange
    const pullRequest = { number: 42, source: "branch" as const, url: "https://github.com/0xthierry/dev/pull/42" };

    // Act
    const result = formatPullRequest(pullRequest);

    // Assert
    expect(result).toBe(pr42Link);
  });

  test("formats pull requests as plain text without a URL", () => {
    // Arrange
    const pullRequest = { number: 42, source: "branch" as const };

    // Act
    const result = formatPullRequest(pullRequest);

    // Assert
    expect(result).toBe("PR #42");
  });
});

describe("formatChangeSummary", () => {
  test("formats line, file, untracked, and binary changes", () => {
    // Arrange
    const changes = { added: 12, removed: 3, changedFiles: 2, untrackedFiles: 1, binaryFiles: 1 };

    // Act
    const result = formatChangeSummary(changes);

    // Assert
    expect(result).toBe("+12/-3 ~2 ?1 bin1");
  });

  test("returns undefined for a clean tree", () => {
    // Arrange
    const changes = { added: 0, removed: 0, changedFiles: 0, untrackedFiles: 0, binaryFiles: 0 };

    // Act
    const result = formatChangeSummary(changes);

    // Assert
    expect(result).toBeUndefined();
  });
});

describe("formatStockQuote", () => {
  test("formats BRL stock quotes with reais", () => {
    // Arrange
    const quote = { symbol: "N2ET34.SA", label: "NET", price: 42.123, currency: "BRL" };

    // Act
    const result = formatStockQuote(quote);

    // Assert
    expect(result).toBe("NET R$42.12");
  });

  test("formats non-BRL stock quotes with currency codes", () => {
    // Arrange
    const quote = { symbol: "NET", label: "NET", price: 74.123, currency: "USD" };

    // Act
    const result = formatStockQuote(quote);

    // Assert
    expect(result).toBe("NET USD 74.12");
  });
});

describe("formatStatusline", () => {
  test("joins clickable PR, changes, and stock segments", () => {
    // Arrange
    const snapshot: StatuslineSnapshot = {
      git: {
        branch: "feature/pr-42-statusline",
        pullRequest: { number: 42, source: "branch", url: "https://github.com/0xthierry/dev/pull/42" },
        changes: { added: 4, removed: 1, changedFiles: 1, untrackedFiles: 0, binaryFiles: 0 },
      },
      stock: { symbol: "N2ET34.SA", label: "NET", price: 42, currency: "BRL" },
    };

    // Act
    const result = formatStatusline(snapshot);

    // Assert
    expect(result).toBe(`${pr42Link} · +4/-1 ~1 · NET R$42.00`);
  });

  test("returns undefined when there is nothing useful to show", () => {
    // Arrange
    const snapshot: StatuslineSnapshot = { git: null, stock: null };

    // Act
    const result = formatStatusline(snapshot);

    // Assert
    expect(result).toBeUndefined();
  });
});
