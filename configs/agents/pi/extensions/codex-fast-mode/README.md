# codex-fast-mode

Enables OpenAI Codex Fast mode for eligible ChatGPT-backed requests in Pi, both through the direct `openai-codex` provider and the local `cliproxyapi` Codex account pool.

The extension listens for Pi's `before_provider_request` event and adds:

```json
{ "service_tier": "priority" }
```

to Codex-shaped requests for opted-in models: `gpt-5.4`, `gpt-5.5`, `gpt-5.6`, `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-6-luna`.

Automatic Fast mode is disabled for Sol and Astra models, including `gpt-5.6-sol`, `gpt-6-sol`, and `gpt-6-astra`: this extension leaves their payloads unchanged and does not add a priority service tier.

Codex CLI persists this setting as `service_tier = "fast"`, but the ChatGPT Codex responses backend expects the request-time value `priority`. The matcher requires an opted-in model on either `openai-codex` or `cliproxyapi`, plus the Codex-shaped request fields, so unrelated OpenAI API-key traffic is not moved to Priority processing.

## Install

This extension is part of Thierry's Pi extension bundle. On Thierry's machines, `configs/agents/install.sh` symlinks the bundle to `~/.pi/agent/extensions`.

To install this extension directly from a local checkout:

```bash
pi install ./configs/agents/pi/extensions/codex-fast-mode
```

Restart Pi or run `/reload` after installing.
