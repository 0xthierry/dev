# xai-grok-fast-mode

Optimizes direct xAI Grok cache affinity and long-context sessions in Pi.

For models selected through Pi's direct `xai` provider whose IDs begin with `grok-`, the extension:

- sends `x-grok-conv-id` with Pi's stable session ID through `before_provider_headers`, matching Grok Build's cache-affinity routing alongside Pi's existing `prompt_cache_key`;
- triggers Pi's stock semantic compaction when context usage reaches **85%** of the model context window. For a 500,000-token Grok model, this is **425,000 tokens** instead of Pi's default 483,616-token threshold.

It does not request xAI Priority Processing or modify provider payloads. It also leaves Grok requests routed through OpenRouter or custom proxy providers unchanged. The early-compaction handler has an in-flight guard and reports failures through Pi's UI without replacing Pi's normal compaction implementation.

Lowering Pi's thinking level is a separate latency/quality control.

## Install

This extension is part of Thierry's Pi extension bundle. On Thierry's machines, `configs/agents/install.sh` symlinks the bundle to `~/.pi/agent/extensions`.

To install this extension directly from a local checkout:

```bash
pi install ./configs/agents/pi/extensions/xai-grok-fast-mode
```

Restart Pi or run `/reload` after installing.
