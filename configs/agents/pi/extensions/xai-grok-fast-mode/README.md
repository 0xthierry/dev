# xai-grok-fast-mode

Enables xAI Priority Processing for direct xAI Grok requests in Pi.

The extension listens for Pi's `before_provider_request` event and adds:

```json
{ "service_tier": "priority" }
```

to models selected through Pi's direct `xai` provider whose IDs begin with `grok-`. It intentionally does not modify Grok requests routed through OpenRouter or custom proxy providers.

xAI Priority Processing typically reduces time-to-first-token and inter-token latency, but availability is not guaranteed. The response's `service_tier` reports whether priority capacity was granted. Requests served at the priority tier are billed at premium token rates. See [xAI's Priority Processing documentation](https://docs.x.ai/developers/advanced-api-usage/priority-processing).

Lowering Pi's thinking level is a separate latency/quality control; this extension only changes request scheduling priority.

## Install

This extension is part of Thierry's Pi extension bundle. On Thierry's machines, `configs/agents/install.sh` symlinks the bundle to `~/.pi/agent/extensions`.

To install this extension directly from a local checkout:

```bash
pi install ./configs/agents/pi/extensions/xai-grok-fast-mode
```

Restart Pi or run `/reload` after installing.
