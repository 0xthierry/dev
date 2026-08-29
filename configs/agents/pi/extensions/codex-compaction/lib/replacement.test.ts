import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { hashAccountId } from "./binding";
import { applyCompactionReplacement, planInjection } from "./replacement";
import { CODEX_OPAQUE_SUMMARY_PLACEHOLDER, SEAM_STRIKE_THRESHOLD } from "./types";

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
  test("newer ordinary Pi compaction above older Codex state does not inject artifacts", () => {
    // Arrange
    const branch: SessionEntry[] = [
      v2Entry("old-codex", CODEX_OPAQUE_SUMMARY_PLACEHOLDER),
      ordinary("new-pi", "portable B"),
    ];
    const payload = { input: [{ role: "user", content: "portable B" }] };

    // Act
    const result = applyCompactionReplacement({ payload, model, branchEntries: branch, accountHash });

    // Assert
    expect(result.mutated).toBe(false);
    expect(payload.input).toEqual([{ role: "user", content: "portable B" }]);
  });

  test("compatible v2 removes the opaque placeholder in favor of user prefix and artifact", () => {
    // Arrange
    const branch = [v2Entry("cmp", CODEX_OPAQUE_SUMMARY_PLACEHOLDER)];
    const payload: { input: Record<string, unknown>[] } = {
      input: [
        { role: "user", content: `prefix ${CODEX_OPAQUE_SUMMARY_PLACEHOLDER} suffix` },
        { role: "user", content: "tail" },
      ],
    };

    // Act
    const result = applyCompactionReplacement({ payload, model, branchEntries: branch, accountHash });

    // Assert
    expect(result).toEqual({ mutated: true, mode: "artifact" });
    expect(payload.input).toEqual([
      { role: "user", content: "prior user" },
      { type: "compaction", encrypted_content: "enc", id: "cmp_1" },
      { role: "user", content: "tail" },
    ]);
  });

  test("binding mismatch replaces the opaque placeholder with prefix-only context", () => {
    // Arrange
    const branch = [v2Entry("cmp", CODEX_OPAQUE_SUMMARY_PLACEHOLDER)];
    const payload = {
      input: [
        { role: "user", content: CODEX_OPAQUE_SUMMARY_PLACEHOLDER },
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
    expect(payload.input).toEqual([
      { role: "user", content: "prior user" },
      { role: "user", content: "tail" },
    ]);
  });

  test("binding mismatch preserves semantic summaries from older v2 records", () => {
    // Arrange
    const summary = "meaningful portable summary";
    const branch = [v2Entry("cmp", summary)];
    const payload = { input: [{ role: "user", content: summary }] };

    // Act
    const result = applyCompactionReplacement({
      payload,
      model,
      branchEntries: branch,
      accountHash: hashAccountId("other-account"),
    });

    // Assert
    expect(result).toEqual({ mutated: true, mode: "prefix-only" });
    expect(payload.input).toEqual([
      { role: "user", content: "prior user" },
      { role: "user", content: summary },
    ]);
  });

  test("invalid artifact degrades to prefix-only without preserving the opaque placeholder", () => {
    // Arrange
    const branch = [v2Entry("cmp", CODEX_OPAQUE_SUMMARY_PLACEHOLDER, { artifact: [] })];
    const payload = { input: [{ role: "user", content: CODEX_OPAQUE_SUMMARY_PLACEHOLDER }] };

    // Act
    const plan = planInjection({ model, branchEntries: branch, accountHash });
    const result = applyCompactionReplacement({ payload, model, branchEntries: branch, accountHash });

    // Assert
    expect(plan.kind).toBe("prefix-only");
    expect(result).toEqual({ mutated: true, mode: "prefix-only" });
    expect(payload.input).toEqual([{ role: "user", content: "prior user" }]);
  });

  test("clears the opaque placeholder when neither artifact nor validated prefix is usable", () => {
    // Arrange
    const branch = [
      v2Entry("cmp", CODEX_OPAQUE_SUMMARY_PLACEHOLDER, {
        userPrefix: [{ role: "system", content: "not valid" }],
        artifact: [],
      }),
    ];
    const payload = {
      input: [
        { role: "user", content: CODEX_OPAQUE_SUMMARY_PLACEHOLDER },
        { role: "user", content: "tail" },
      ],
    };

    // Act
    const result = applyCompactionReplacement({ payload, model, branchEntries: branch, accountHash });

    // Assert
    expect(result).toEqual({ mutated: true, mode: "placeholder-cleared" });
    expect(payload.input).toEqual([{ role: "user", content: "tail" }]);
  });

  test("semantic prefix-only insertion is idempotent for migrated v2 records", () => {
    // Arrange
    const summary = "old semantic summary";
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

  test("seam strikes disable artifact injection and remove the opaque placeholder", () => {
    // Arrange
    const strikes = Array.from({ length: SEAM_STRIKE_THRESHOLD }, (_, index) => seamError(index));
    const branch: SessionEntry[] = [v2Entry("cmp", CODEX_OPAQUE_SUMMARY_PLACEHOLDER), ...strikes];
    const payload = { input: [{ role: "user", content: CODEX_OPAQUE_SUMMARY_PLACEHOLDER }] };

    // Act
    const plan = planInjection({ model, branchEntries: branch, accountHash });
    const result = applyCompactionReplacement({ payload, model, branchEntries: branch, accountHash });

    // Assert
    expect(plan.kind).toBe("prefix-only");
    expect(result).toEqual({ mutated: true, mode: "prefix-only" });
    expect(payload.input).toEqual([{ role: "user", content: "prior user" }]);
  });

  test("auth hash failure uses prefix-only and removes the opaque placeholder", () => {
    // Arrange
    const branch = [v2Entry("cmp", CODEX_OPAQUE_SUMMARY_PLACEHOLDER)];
    const payload = { input: [{ role: "user", content: CODEX_OPAQUE_SUMMARY_PLACEHOLDER }] };

    // Act
    const result = applyCompactionReplacement({ payload, model, branchEntries: branch, accountHash: undefined });

    // Assert
    expect(result).toEqual({ mutated: true, mode: "prefix-only" });
    expect(payload.input).toEqual([{ role: "user", content: "prior user" }]);
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
