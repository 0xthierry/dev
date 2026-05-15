# Thierry's Pi Extensions

Repository-owned Pi extension package.

## Install as a Pi package

Install the whole extension bundle directly from GitHub:

```bash
pi install git:github.com/0xthierry/dev
```

Equivalent HTTPS and SSH forms also work:

```bash
pi install https://github.com/0xthierry/dev
pi install git:git@github.com:0xthierry/dev
```

To pin a tag, branch, or commit, append `@<ref>`:

```bash
pi install git:github.com/0xthierry/dev@main
```

From a local checkout, install the repository root as a Pi package:

```bash
pi install /path/to/dev
```

Or install this extensions bundle directory:

```bash
pi install ./configs/agents/pi/extensions
```

Or install one extension at a time from a local checkout:

```bash
pi install ./configs/agents/pi/extensions/desktop-notification
pi install ./configs/agents/pi/extensions/web-access
pi install ./configs/agents/pi/extensions/create-image
pi install ./configs/agents/pi/extensions/comment
pi install ./configs/agents/pi/extensions/agent-feedback
pi install ./configs/agents/pi/extensions/subagent
pi install ./configs/agents/pi/extensions/blueprint
pi install ./configs/agents/pi/extensions/statusline
pi install ./configs/agents/pi/extensions/token-speed
pi install ./configs/agents/pi/extensions/codex-fast-mode
pi install ./configs/agents/pi/extensions/nested-agents
pi install ./configs/agents/pi/extensions/project-rules
```

The GitHub/repository-root package installs all extensions declared in the root `package.json`. To install only one extension, clone the repo and use one of the local per-extension install commands above, or install the bundle and use `pi config` to disable resources you do not want.

For day-to-day use on Thierry's machines, `configs/agents/install.sh` symlinks this directory to `~/.pi/agent/extensions`, so no `pi install` command is required.

## Extensions

- [`desktop-notification`](./desktop-notification/README.md) — sends an OSC 777 desktop notification when an agent turn finishes.
- [`web-access`](./web-access/README.md) — registers web search, content fetch, and stored-content retrieval tools.
- [`create-image`](./create-image/README.md) — registers `/create-image` for prompt-to-image generation.
- [`comment`](./comment/README.md) — registers `/comment` to edit a quoted copy of the last assistant response in `$EDITOR`.
- [`agent-feedback`](./agent-feedback/README.md) — registers `agent_feedback` for durable workflow feedback and verification blockers.
- [`subagent`](./subagent/README.md) — registers a Claude-compatible `Agent` tool for foreground single and parallel child Pi subagents.
- [`blueprint`](./blueprint/README.md) — registers `/blueprint` for deterministic graph workflows that can spawn isolated child Pi sessions.
- [`statusline`](./statusline/README.md) — appends clickable PR number, git change counts, and the Cloudflare BDR quote to Pi's existing footer.
- [`token-speed`](./token-speed/README.md) — displays real-time assistant streaming throughput in Pi's footer.
- [`codex-fast-mode`](./codex-fast-mode/README.md) — injects Codex Fast mode's `service_tier: "priority"` for eligible ChatGPT-backed Codex requests.
- [`nested-agents`](./nested-agents/README.md) — dynamically loads nested `AGENTS.md` / `CLAUDE.md` files when the agent touches files under those directories.
- [`project-rules`](./project-rules/README.md) — loads `.pi/rules`, `.agents/rules`, and `.claude/rules` with cache-friendly activation.

## Dependencies

The bundle package uses the repository root dependencies. `setup.sh` runs `bun install --frozen-lockfile` at the repository root so the symlinked extensions can resolve their runtime packages.

Individual extension directories also include `package.json` manifests so they can be installed or packaged independently. If you copy an individual extension directory outside this repository, run `npm install` or `bun install` in that extension directory when it declares dependencies.
