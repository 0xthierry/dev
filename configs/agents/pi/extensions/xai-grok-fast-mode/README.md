# xai-grok-fast-mode

Optimizes direct xAI Grok requests and long-context sessions in Pi.

For models selected through Pi's direct `xai` provider whose IDs begin with `grok-`, the extension:

- adds `{ "service_tier": "priority" }` through `before_provider_request`;
- sends `x-grok-conv-id` with Pi's stable session ID through `before_provider_headers`, matching Grok Build's cache-affinity routing alongside Pi's existing `prompt_cache_key`;
- triggers Pi's stock semantic compaction when context usage reaches **85%** of the model context window. For a 500,000-token Grok model, this is **425,000 tokens** instead of Pi's default 483,616-token threshold.

It intentionally does not modify Grok requests routed through OpenRouter or custom proxy providers. The early-compaction handler has an in-flight guard and reports failures through Pi's UI without replacing Pi's normal compaction implementation.

xAI Priority Processing typically reduces time-to-first-token and inter-token latency, but availability is not guaranteed. The response's `service_tier` reports whether priority capacity was granted. Requests served at the priority tier are billed at premium token rates. See [xAI's Priority Processing documentation](https://docs.x.ai/developers/advanced-api-usage/priority-processing).

Lowering Pi's thinking level is a separate latency/quality control.

## Install

This extension is part of Thierry's Pi extension bundle. On Thierry's machines, `configs/agents/install.sh` symlinks the bundle to `~/.pi/agent/extensions`.

To install this extension directly from a local checkout:

```bash
pi install ./configs/agents/pi/extensions/xai-grok-fast-mode
```

Restart Pi or run `/reload` after installing.
