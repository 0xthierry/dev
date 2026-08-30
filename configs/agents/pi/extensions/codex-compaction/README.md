# codex-compaction

Remote-only opaque compaction for Codex (`openai-codex-responses`) models.

## One endpoint path with bounded retries

Every Codex compaction—manual, Pi threshold/overflow, early extension threshold, or legacy recovery—uses only the direct subscription endpoint `/codex/responses` with one trailing `compaction_trigger` input item. Transient failures repeat that same request; they never invoke a portable summary or another model.

The retry policy mirrors Codex CLI remote compaction v2:

- request opening: up to four retries for transport failures and HTTP 5xx, with 200 ms exponential backoff and ±10% jitter
- response stream: up to two full compaction retries for retryable stream failures, with 200/400 ms jittered backoff or a server-provided `Retry-After`
- stream reads: a 300-second inactivity timeout reset by every response chunk
- terminal responses, malformed completed artifacts, external aborts, and exhausted retries are not retried further

Codex CLI can switch from WebSockets to HTTPS after stream retry exhaustion. This extension already uses direct HTTPS, so that transport fallback is not applicable.

The extension does not call Pi's exported `compact()` on Codex. A successful endpoint response becomes the complete `CompactionResult`:

- `summary` is the stable required placeholder `[Opaque Codex compaction artifact — replaced only on compatible Codex provider requests.]`
- `usage` is the remote endpoint usage
- `details.codexCompaction` stores the opaque artifact, remote usage, response id, binding, and validated recent user prefix
- `details.readFiles` and `details.modifiedFiles` are derived from Pi's prepared file operations and merged latest metadata, without another model call

The direct fetch still bypasses Pi provider transport and proxy hooks, but applies the bounded retry and idle-timeout policy above itself.

## Persisted v2 record

```ts
details.codexCompaction = {
  version: 2,
  binding: { provider, api, modelId, endpoint, accountHash }, // sha256(accountId).slice(0, 16)
  userPrefix: JsonObject[],   // validated literal user text only
  artifact: [compactionItem],
  firstKeptEntryId,
  tokensBefore,
  responseId?,
  remoteUsage?,
  recovery?,
}
```

No raw account id, bearer token, headers, or system prompt is persisted.

## Provider injection

On `before_provider_request` for Codex, the extension inspects only the latest compaction entry on the active branch.

- Compatible binding and valid artifact: replace the placeholder summary payload item with `userPrefix + artifact`, then repair orphan tool-output seams after the inserted boundary.
- Incompatible binding, unavailable auth hash, invalidated artifact, invalid artifact, or repeated seam errors: replace the opaque placeholder with validated `userPrefix` only.
- No usable prefix: remove the opaque placeholder rather than present it as a semantic summary.
- Older v2 records containing a real semantic summary retain that summary during prefix-only migration behavior.
- A newer ordinary Pi compaction prevents injection of any older Codex artifact.

Replacement searches only a small input prefix and is idempotent after the placeholder has been removed.

## Early Codex threshold

A `turn_end` handler uses `ctx.getContextUsage()` and calls `ctx.compact()` when Codex context reaches **90% of the active model context window**, matching Codex Rust's native `context_window * 9 / 10` policy. For GPT-5.6 Sol's 272,000-token window, the threshold is **244,800 tokens**. An in-flight guard prevents duplicate triggers until `onComplete` or `onError` fires. The resulting `session_before_compact` path is the same single-endpoint path used by manual and core-triggered compactions.

## Failure behavior

Endpoint, authentication, account-binding, malformed-response, and abort failures return `{ cancel: true }` from `session_before_compact`. Pi therefore does not silently make a second portable summary model call. Interactive failures notify with the final endpoint reason and attempt counts; aborts remain quiet. No placeholder entry is persisted on a failed regular compaction.

## Legacy recovery

Legacy v1 entries and the exact historical two-line sentinel placeholder remain readable for migration:

- Recovery is detected before the Codex model guard.
- Raw pre-boundary messages are budget-bounded, compaction entries are skipped, and full recovered file operations are merged.
- Missing `firstKeptEntryId` falls back only to entries before the latest compaction, never the whole branch.
- Truncated recovery always cancels to avoid lossy migration.
- Compatible Codex v1 artifacts chain into the same remote endpoint flow with only the original current span, avoiding recovered-message duplication.
- Codex recovery endpoint failure cancels; it never invokes a portable fallback.
- Non-Codex legacy recovery may use `portableCompactOnly()` once because it is a model-migration fallback.

Legacy v1 records are read but never written.

## Scope

Subscription Codex endpoint/auth only. No provider registration and no direct-OpenAI transport.
