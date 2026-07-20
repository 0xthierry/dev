# codex-detailed-reasoning

Requests detailed reasoning summaries for ChatGPT-backed Codex requests in Pi.

The extension listens for Pi's `before_provider_request` event and rewrites:

```json
{ "reasoning": { "summary": "auto" } }
```

to `"summary": "detailed"` on Codex-shaped requests for supported models (`gpt-5.4`, `gpt-5.5`, and the `gpt-5.6` family: `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`).

Pi hardcodes `reasoning.summary: "auto"` for the `openai-codex` provider and exposes no setting for it, and under `"auto"` the GPT-5.6 family often returns headline-only summaries (see [earendil-works/pi#6524](https://github.com/earendil-works/pi/issues/6524)). Requesting `"detailed"` asks the backend for the richest summary its summarizer produces. The detail level remains the backend's decision — raw chain-of-thought is never available from the Codex subscription backend, and headline-style output can still occur. The payload matcher is intentionally narrow so OpenAI API-key traffic and models that reject `reasoning.summary` values are left untouched.

## Install

This extension is part of Thierry's Pi extension bundle. On Thierry's machines, `configs/agents/install.sh` symlinks the bundle to `~/.pi/agent/extensions`.

To install this extension directly from a local checkout:

```bash
pi install ./configs/agents/pi/extensions/codex-detailed-reasoning
```

Restart Pi or run `/reload` after installing.
