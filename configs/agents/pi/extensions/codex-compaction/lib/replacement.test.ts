import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { hashAccountId } from "./binding";
import { applyCompactionReplacement, planInjection } from "./replacement";
import { SEAM_STRIKE_THRESHOLD } from "./types";

const model = {
  id: "gpt-5.6-sol",
  provider: "openai-codex",
  api: "openai-codex-responses",
  name: "sol",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 32000,
} as Model<Api>;

const accountHash = hashAccountId("acct_123");

describe("planInjection / applyCompactionReplacement", () => {
  test("newer ordinary Pi compaction above older Codex does not inject artifacts", () => {
    // Arrange
    const branch: SessionEntry[] = [v2Entry("old-codex", "real summary A"), ordinary("new-pi", "portable B")];
    const payload = {
      input: [{ role: "user", content: "The conversation history... portable B ..." }],
    };

    // Act
    const plan = planInjection({ model, branchEntries: branch, accountHash });
    const result = applyCompactionReplacement({
      payload,
      model,
      branchEntries: branch,
      accountHash,
    });

    // Assert
    expect(plan.kind).toBe("none");
    expect(result.mutated).toBe(false);
  });

  test("compatible v2 replaces summary with userPrefix + artifact", () => {
    // Arrange
    const summary = "meaningful portable summary about alpha";
    const branch = [v2Entry("cmp", summary)];
    const payload = {
      input: [
        { role: "user", content: `prefix ${summary} suffix` },
        { role: "user", content: "tail" },
      ],
    };

    // Act
    const result = applyCompactionReplacement({
      payload,
      model,
      branchEntries: branch,
      accountHash,
    });

    // Assert
    expect(result).toEqual({ mutated: true, mode: "artifact" });
    expect(payload.input[0]).toEqual({ role: "user", content: "prior user" });
    expect(payload.input[1] as unknown).toEqual({
      type: "compaction",
      encrypted_content: "enc",
      id: "cmp_1",
    });
    expect(payload.input[2]).toEqual({ role: "user", content: "tail" });
  });

  test("binding mismatch keeps summary and inserts prefix-only", () => {
    // Arrange
    const summary = "meaningful portable summary";
    const branch = [v2Entry("cmp", summary)];
    const payload = {
      input: [
        { role: "user", content: summary },
        { role: "user", content: "tail" },
      ],
    };

    // Act
    const result = applyCompactionReplacement({
      payload,
      model,
      branchEntries: branch,
      accountHash: hashAccountId("other-account"),
    });

    // Assert
    expect(result).toEqual({ mutated: true, mode: "prefix-only" });
    expect(payload.input[0]).toEqual({ role: "user", content: "prior user" });
    expect(payload.input[1]).toEqual({ role: "user", content: summary });
  });

  test("invalid artifact degrades to prefix-only", () => {
    // Arrange
    const summary = "summary text";
    const branch = [v2Entry("cmp", summary, { artifact: [] })];
    const payload = { input: [{ role: "user", content: summary }] };

    // Act
    const plan = planInjection({ model, branchEntries: branch, accountHash });
    const result = applyCompactionReplacement({ payload, model, branchEntries: branch, accountHash });

    // Assert
    expect(plan.kind).toBe("prefix-only");
    expect(result).toEqual({ mutated: true, mode: "prefix-only" });
  });

  test("malformed prefix items are not injected", () => {
    // Arrange
    const summary = "summary text";
    const branch = [
      v2Entry("cmp", summary, {
        userPrefix: [{ role: "system", content: "nope" } as never],
        artifact: [],
      }),
    ];

    // Act
    const plan = planInjection({ model, branchEntries: branch, accountHash });

    // Assert
    expect(plan.kind).toBe("none");
  });

  test("prefix-only is idempotent on second application", () => {
    // Arrange
    const summary = "summary text";
    const branch = [v2Entry("cmp", summary, { artifact: [] })];
    const payload = { input: [{ role: "user", content: summary }] };

    // Act
    const first = applyCompactionReplacement({ payload, model, branchEntries: branch, accountHash });
    const second = applyCompactionReplacement({ payload, model, branchEntries: branch, accountHash });

    // Assert
    expect(first).toEqual({ mutated: true, mode: "prefix-only" });
    expect(second).toEqual({ mutated: false, reason: "prefix-already-present" });
    expect(payload.input.filter((item) => item.content === "prior user")).toHaveLength(1);
  });

  test("after seam strikes planInjection chooses prefix-only not artifact", () => {
    // Arrange
    const summary = "summary text";
    const strikes = Array.from({ length: SEAM_STRIKE_THRESHOLD }, (_, index) => seamError(index));
    const branch: SessionEntry[] = [v2Entry("cmp", summary), ...strikes];

    // Act
    const plan = planInjection({ model, branchEntries: branch, accountHash });

    // Assert
    expect(plan.kind).toBe("prefix-only");
  });

  test("auth hash failure degrades to prefix-only", () => {
    // Arrange
    const summary = "summary text";
    const branch = [v2Entry("cmp", summary)];
    const payload = { input: [{ role: "user", content: summary }] };

    // Act
    const result = applyCompactionReplacement({
      payload,
      model,
      branchEntries: branch,
      accountHash: undefined,
    });

    // Assert
    expect(result).toEqual({ mutated: true, mode: "prefix-only" });
  });
});

function ordinary(id: string, summary: string): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: new Date(1).toISOString(),
    summary,
    firstKeptEntryId: "kept",
    tokensBefore: 1,
    details: { readFiles: [], modifiedFiles: [] },
  } as SessionEntry;
}

function v2Entry(
  id: string,
  summary: string,
  overrides: { userPrefix?: unknown[]; artifact?: unknown[] } = {},
): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    summary,
    firstKeptEntryId: "kept",
    tokensBefore: 10,
    details: {
      readFiles: ["a.ts"],
      modifiedFiles: ["b.ts"],
      codexCompaction: {
        version: 2,
        binding: {
          provider: "openai-codex",
          api: "openai-codex-responses",
          modelId: "gpt-5.6-sol",
          endpoint: "https://chatgpt.com/backend-api/codex/responses",
          accountHash,
        },
        userPrefix: overrides.userPrefix ?? [{ role: "user", content: "prior user" }],
        artifact:
          overrides.artifact !== undefined
            ? overrides.artifact
            : [{ type: "compaction", encrypted_content: "enc", id: "cmp_1" }],
        firstKeptEntryId: "kept",
        tokensBefore: 10,
      },
    },
  } as SessionEntry;
}

function seamError(index: number): SessionEntry {
  return {
    type: "message",
    id: `seam-${index}`,
    parentId: "cmp",
    timestamp: new Date(index + 1).toISOString(),
    message: {
      role: "assistant",
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      content: [],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      timestamp: index + 1,
      errorMessage: "invalid_request_error No tool call found for function call output",
    },
  } as SessionEntry;
}
