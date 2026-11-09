# codex-compaction

Remote-only opaque compaction for direct Codex (`openai-codex-responses`) and CLIProxyAPI (`provider: cliproxyapi`, `api: openai-responses`) models. Other OpenAI-compatible providers retain ordinary Pi compaction.

## One endpoint path with bounded retries

Every supported compaction—manual, Pi threshold/overflow, early extension threshold, or legacy recovery—uses a Responses request with one trailing `compaction_trigger` input item:

- Direct Codex: the subscription endpoint `/codex/responses`, with its OAuth token and account header.
- CLIProxyAPI: the configured proxy base URL plus `/responses` (normally `http://127.0.0.1:8317/v1/responses`), with only the local proxy bearer key. The proxy selects and authenticates the upstream account. The extension never reads pooled OAuth credentials or bypasses the proxy.

Transient failures repeat that same request; they never invoke a portable summary or another model.

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

The compaction fetch bypasses Pi's provider transport/hooks and applies the bounded retry and idle-timeout policy above itself. CLIProxyAPI compaction still goes through the configured proxy. Normal proxy requests and compaction share the Pi session's `prompt_cache_key` for routing affinity; compaction also sends `Session_id`.

CLIProxyAPI affinity is not a strict upstream-account pin: the proxy may fail over. A live check on the pinned proxy successfully replayed a native artifact through two different pooled credentials, but this does not guarantee portability across every account or future upstream release.

## Persisted v2 record

```ts
details.codexCompaction = {
  version: 2,
  binding: { provider, api, modelId, endpoint, accountHash }, // direct Codex
  // Proxy instead: { provider, api, modelId, endpoint, scope: "proxy", proxyKeyHash },
  userPrefix: JsonObject[],   // validated literal user text only
  artifact: [compactionItem],
  firstKeptEntryId,
  tokensBefore,
  responseId?,
  remoteUsage?,
  recovery?,
}
```

Direct bindings retain the existing `accountHash` (`sha256(accountId).slice(0, 16)`). Proxy bindings use `scope: "proxy"` and `proxyKeyHash` (full SHA256 of the local proxy credential); they do not claim to identify an upstream account. Provider, API, model, endpoint, and binding identity must match before artifact reuse. Changing the proxy key or endpoint invalidates that binding.

No raw account id, bearer token, headers, or system prompt is persisted.

## Provider injection

On `before_provider_request` for supported direct/proxy models, the extension inspects only the latest compaction entry on the active branch.

- Compatible binding and valid artifact: replace the placeholder summary payload item with `userPrefix + artifact`, then repair orphan tool-output seams after the inserted boundary.
- Incompatible binding, unavailable credential identity, invalidated artifact, invalid artifact, or repeated seam errors: replace the opaque placeholder with validated `userPrefix` only. This is lossy degradation, not a regenerated summary; assistant-only details in an unusable artifact are not preserved in that request.
- No usable prefix: remove the opaque placeholder rather than present it as a semantic summary.
- Older v2 records containing a real semantic summary retain that summary during prefix-only migration behavior.
- A newer ordinary Pi compaction prevents injection of any older Codex artifact.

Replacement searches only a small input prefix and is idempotent after the placeholder has been removed.

## Early Codex threshold

A `turn_end` handler uses `ctx.getContextUsage()` and calls `ctx.compact()` after successful `stop` or `toolUse` turns when supported direct/proxy context reaches **90% of the active model context window**, matching Codex Rust's native `context_window * 9 / 10` policy. For a configured 300,000-token window, the threshold is **270,000 tokens**. Error, length, and aborted turns remain owned by Pi's overflow/retry path. An in-flight guard prevents duplicate extension triggers until `onComplete` or `onError` fires. While that extension-triggered compaction is pending, the `session_before_compact` hook cancels overlapping Pi threshold/overflow compaction so both paths cannot compact the same successful turn.

Before calling `ctx.compact()`, the extension checks whether Pi's visible conversation history has a cut point outside the configured `keepRecentTokens` budget. This respects trusted project settings and per-model retention overrides, excludes system prompt state and already-compacted history, and applies context edits. High provider-reported usage alone is not enough: if the retained conversation is too small, the tool loop continues without an abort or a compaction request. Once enough new history exists, the 90% trigger remains eligible.

Pi's extension-triggered `ctx.compact()` uses manual compaction semantics: it aborts the active agent run and does not retry it automatically. When the threshold is reached after a tool batch, the extension therefore queues a hidden continuation after successful compaction so the interrupted tool loop resumes without requiring the user to type `continue`. Completed non-tool responses are compacted without starting another turn.

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

## Verification

```bash
bun run test:pi-extensions codex-compaction
bun run test:pi-extensions:e2e codex-compaction
```

`lifecycle.spec.ts` checks real Pi scheduling with a deterministic provider fixture, including high-usage turns with too little compactable history before and after a successful compaction. It verifies that failed tool commands still reach the assistant without an unnecessary abort, and covers per-model retention overrides. `proxy.spec.ts` uses the normally configured CLIProxyAPI provider and running service. It compacts a synthetic conversation, restarts Pi, verifies assistant-only information survives artifact replay, and repeats compaction. It isolates its config/session and deletes them afterward. It makes real model calls; missing proxy configuration or authentication is a failure, not a skip. `CODEX_COMPACTION_PROXY_MODEL` optionally selects another configured proxy model (default `gpt-6-astra`).

## Scope

Direct subscription Codex and explicitly named CLIProxyAPI Responses models only. No provider registration, generic OpenAI API compaction, or direct-OpenAI transport.
