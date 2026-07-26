# codex-compaction

Durable dual-representation compaction for Codex (`openai-codex-responses`) models.

## Dual representation

Each compaction entry remains a normal Pi compaction:

- `summary` is always a real portable Pi summary produced through exported `compact()`
- `details.readFiles` / `details.modifiedFiles` stay Pi-native and accumulate across repeated extension compactions
- when remote Codex compaction succeeds, `details.codexCompaction` (v2) adds opaque provider state

v2 never writes placeholder summaries. Legacy v1 entries (sentinel placeholder + single opaque item) are still read for migration/recovery, but are never written.

A successfully parsed v2 record is never treated as legacy recovery, even if the portable summary text happens to mention `pi-codex-compaction:`.

### v2 record

```ts
details.codexCompaction = {
  version: 2,
  binding: { provider, api, modelId, endpoint, accountHash }, // accountHash = sha256(accountId).slice(0,16)
  userPrefix: JsonObject[],  // validated literal user turns only
  artifact: [compactionItem], // empty when invalid → prefix-only degradation
  firstKeptEntryId,
  tokensBefore,
  responseId?,
  remoteUsage?,
  recovery?, // only after v1/legacy recovery
}
```

No raw account id, token, headers, or system prompt is persisted.

## Two-call cost

On Codex models, `session_before_compact` runs two calls concurrently (`Promise.allSettled`):

1. portable Pi `compact()` over the prepared discarded span (plus turn-prefix split handling)
2. direct remote Codex `/codex/responses` fetch with a `compaction_trigger`

**Transport note:** the remote fetch is a direct subscription-endpoint HTTP call. It bypasses Pi provider transport, retry policy, and proxy hooks. The portable `compact()` call also does **not** inherit `AgentSession` retry callbacks; only the default `compact()` behavior applies.

Outcomes:

| Summary | Remote | Result |
|---|---|---|
| ok | ok | combined usage + Pi details + v2 codex record |
| ok | fail | summary-only (Pi details; combine known remote failure usage when present) |
| fail | any | `undefined` so Pi retries/defaults (non-recovery); remote artifact discarded |
| abort | any | `undefined` without warning (non-recovery) |
| recovery + any hard failure | | `{ cancel: true }` — never lets Pi compact the original placeholder prep |

## Pi-hybrid retention

The cut boundary stays Pi-owned:

- compact only `messagesToSummarize` + `turnPrefixMessages`
- keep Pi `firstKeptEntryId` tail unchanged

At provider time (`before_provider_request`, Codex only):

1. inspect **only the latest** `type=compaction` entry on the branch
2. locate the Pi compaction-summary item in a small input prefix window
3. if binding+artifact are valid and not invalidated: replace that one summary item with `userPrefix + artifact`, then run seam repair after the inserted boundary
4. if binding mismatches, artifact invalid/empty, seam-strike threshold reached, or custom v1 invalidation present: insert binding-independent validated `userPrefix` before the retained summary (prefix-only; idempotent if already present)
5. ordinary Pi compaction or no record: no mutation

A newer ordinary Pi compaction above an older Codex entry never injects or chains the older artifact.

## Fallback and migration

- **Remote failure**: keep portable summary; next turns use normal Pi summary text.
- **v1 / exact legacy sentinel recovery** (model-agnostic, before the Codex guard): clear `previousSummary`, prepend budget-bounded raw pre-boundary messages (skipping compaction entries; missing `firstKept` falls back to entries before the latest compaction only — never the whole branch), merge **full** recovered file ops, and summarize once. Budget uses model `contextWindow` headroom minus `reserveTokens`, a fixed prompt margin, and estimated existing summarize/turn-prefix tokens — not `reserveTokens` alone. Reports `attempted` / `truncated` / `recoveredMessages`. **If recovery is truncated, the extension always `{ cancel: true }` before any portable/dual compact can persist** (lossy migration is refused). When a compatible v1 artifact is chained for the remote call, remote input is `old artifact + original current span` (not recovered duplicates). Other recovery failures also cancel rather than falling back to Pi default. Ordinary-placeholder detection matches only the exact trimmed two-line legacy template with a bracketed `pi-codex-compaction:<id>` sentinel.
- **Invalidation** is stateless branch evidence after the latest boundary (no `after_provider_response` correlation): custom `codex-compaction-invalidated` entries (v1 sentinel/entry id), deterministic compaction/encrypted/unknown-item rejections, and missing-tool-call seam errors after a small strike threshold all disable the artifact (prefix-only/none). False positives degrade to summary/prefix-only.
- **Repeated compaction**: candidate `userPrefix` is previous v2 `userPrefix` plus newly discarded literal user text (images ignored; drop only when no text remains), re-trimmed to `keepRecentTokens`. Latest compaction file lists are merged into `fileOps` before portable compact so cumulative file metadata survives `fromHook` drops.

## Scope

Subscription Codex endpoint/auth only. No provider registration and no direct-OpenAI transport.
