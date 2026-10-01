# codex-fast-mode

Enables OpenAI Codex Fast mode for eligible ChatGPT-backed requests in Pi, both through the direct `openai-codex` provider and the local `cliproxyapi` Codex account pool.

## Commands and status

- `/fast on` enables priority requests for supported GPT models.
- `/fast off` stops this extension from adding the priority service tier.
- `/fast` reports the current setting without changing it.
- `on` and `off` have argument autocomplete.

The status line shows `[fast]` in the theme's green/success color when on, and dimmed when off. It is hidden on unsupported models/providers; the command reports when the setting does not apply to the current model.

Fast mode defaults to **on**, preserving the previous behavior. Changes are saved in the current session branch and restored on reload, resume, fork, and tree navigation. New sessions default to on. This does not change Codex CLI settings or Grok fast mode.

When enabled, the extension listens for Pi's `before_provider_request` event and adds:

```json
{ "service_tier": "priority" }
```

to Codex-shaped requests for all `gpt-*` models, including Astra and Sol. There is no per-model allowlist; whether priority processing is honored depends on the backend.

Codex CLI persists this setting as `service_tier = "fast"`, but the ChatGPT Codex responses backend expects the request-time value `priority`. The matcher requires a `gpt-*` model on either `openai-codex` or `cliproxyapi`, plus the Codex-shaped request fields, so unrelated OpenAI API-key traffic is not moved to Priority processing.

## Install

This extension is part of Thierry's Pi extension bundle. On Thierry's machines, `configs/agents/install.sh` symlinks the bundle to `~/.pi/agent/extensions`.

To install this extension directly from a local checkout:

```bash
pi install ./configs/agents/pi/extensions/codex-fast-mode
```

Restart Pi or run `/reload` after installing.
