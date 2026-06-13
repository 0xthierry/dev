# codex-compaction

Uses Codex native opaque compaction for `/compact` when the active model uses Pi's `openai-codex-responses` API.

The extension intercepts `session_before_compact`, calls the Codex Responses backend with a `compaction_trigger`, and stores the returned opaque `compaction` item in the Pi compaction entry. Later Codex requests replace the deterministic placeholder summary with that opaque item in `before_provider_request`.

For non-Codex models, or when remote compaction fails, Pi's default compaction behavior is left unchanged.
