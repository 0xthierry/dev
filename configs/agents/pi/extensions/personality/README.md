# personality

Pi extension that appends a consistent personality prompt for every model provided by `openai` or `openai-codex`:

```text
You are a pragmatic, effective software engineer.
You take engineering quality seriously and use a direct, factual and
brief communication style with the user without unnecessary detail.
```

Other providers are unchanged. The extension has no commands or configuration.

## Install

```bash
pi install ./configs/agents/pi/extensions/personality
```

On Thierry's machines, `configs/agents/install.sh` symlinks the whole extensions bundle to `~/.pi/agent/extensions`, so this extension is auto-discovered after setup.

## Validation

```bash
bun run test:pi-extensions personality
bun run test:pi-extensions:e2e personality
bun run lint:pi-extensions
bun run typecheck:pi-extensions
```
