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
pi install ./configs/agents/pi/extensions/personality
pi install ./configs/agents/pi/extensions/web-access
pi install ./configs/agents/pi/extensions/create-image
pi install ./configs/agents/pi/extensions/oracle
pi install ./configs/agents/pi/extensions/agent-feedback
pi install ./configs/agents/pi/extensions/subagent
pi install ./configs/agents/pi/extensions/statusline
pi install ./configs/agents/pi/extensions/token-speed
pi install ./configs/agents/pi/extensions/codex-fast-mode
pi install ./configs/agents/pi/extensions/codex-compaction
pi install ./configs/agents/pi/extensions/nested-agents
pi install ./configs/agents/pi/extensions/lsp
pi install ./configs/agents/pi/extensions/fff
pi install ./configs/agents/pi/extensions/excalidraw-session
pi install ./configs/agents/pi/extensions/goal
```

The GitHub/repository-root package installs all extensions declared in the root `package.json`. To install only one extension, clone the repo and use one of the local per-extension install commands above, or install the bundle and use `pi config` to disable resources you do not want.

For day-to-day use on Thierry's machines, `configs/agents/install.sh` symlinks this directory to `~/.pi/agent/extensions`, so no `pi install` command is required.

## Extensions

- [`desktop-notification`](./desktop-notification/README.md) — sends an OSC 777 desktop notification when an agent turn finishes.
- [`personality`](./personality/README.md) — appends a pragmatic engineering personality prompt for all OpenAI models.
- [`web-access`](./web-access/README.md) — registers web search, content fetch, and stored-content retrieval tools.
- [`create-image`](./create-image/README.md) — registers `/create-image` for prompt-to-image generation.
- [`oracle`](./oracle/README.md) — registers `oracle` for ChatGPT Web / GPT-5.5 Pro state-of-the-art second opinions.
- [`agent-feedback`](./agent-feedback/README.md) — registers `agent_feedback` for durable workflow feedback and verification blockers.
- [`subagent`](./subagent/README.md) — registers a Claude-compatible `Agent` tool for foreground single and parallel child Pi subagents.
- [`statusline`](./statusline/README.md) — appends clickable PR number, git change counts, and the Cloudflare BDR quote to Pi's existing footer.
- [`token-speed`](./token-speed/README.md) — displays real-time assistant streaming throughput in Pi's footer.
- [`codex-fast-mode`](./codex-fast-mode/README.md) — injects Codex Fast mode's `service_tier: "priority"` for eligible ChatGPT-backed Codex requests.
- [`codex-compaction`](./codex-compaction/README.md) — uses Codex native opaque compaction for `/compact` on ChatGPT-backed Codex models.
- [`nested-agents`](./nested-agents/README.md) — dynamically loads nested `AGENTS.md` / `CLAUDE.md` files when the agent touches files under those directories.
- [`lsp`](./lsp/README.md) — exposes configured Language Server Protocol diagnostics and source fixes to Pi tools.
- [`fff`](./fff/README.md) — overrides `grep`, `find`, and `multi_grep` with FFF-backed search and autocomplete.
- [`excalidraw-session`](./excalidraw-session/README.md) — exposes an always-on local Excalidraw bridge tool for the focused browser canvas.
- [`goal`](./goal/README.md) — adds persistent autonomous goals with safe continuation, a high turn limit, and mandatory completion auditing.

## Dependencies

The bundle package uses the repository root dependencies. `setup.sh` runs `bun install --frozen-lockfile` at the repository root so the symlinked extensions can resolve their runtime packages.

Individual extension directories also include `package.json` manifests so they can be installed or packaged independently. If you copy an individual extension directory outside this repository, run `npm install` or `bun install` in that extension directory when it declares dependencies.
