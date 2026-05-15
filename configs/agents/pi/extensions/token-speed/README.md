# token-speed

Pi extension that displays assistant streaming throughput in the footer status bar.

It shows `⚡ TPS: --` when idle, updates while assistant text/thinking deltas stream, and leaves the final average tokens-per-second value visible when the response ends.

## Configuration

Add a `tokenSpeed` block to `~/.pi/agent/settings.json`:

```json
{
  "tokenSpeed": {
    "display": "tps",
    "tpsSlow": 0,
    "tpsMedium": 15,
    "tpsFast": 30,
    "tpsBlazing": 45,
    "colorSlow": "#ff4444",
    "colorMedium": "#ffaa00",
    "colorFast": "#00ff88",
    "colorBlazing": "#44ddff"
  }
}
```

`display` may be `"tps"` or `"full"`. Full mode also shows the counted stream deltas and elapsed seconds.

## Install

```bash
pi install ./configs/agents/pi/extensions/token-speed
```

On Thierry's machines, `configs/agents/install.sh` symlinks the whole extensions bundle to `~/.pi/agent/extensions`, so this extension is auto-discovered after setup.

## Validation

```bash
bun run test:pi-extensions token-speed
bun run test:pi-extensions:e2e token-speed
bun run lint:pi-extensions
bun run typecheck:pi-extensions
```
