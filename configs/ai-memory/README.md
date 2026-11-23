# Local ai-memory — upstream native setup

MacBook and Omarchy use pinned upstream **3.5.1** on
`http://127.0.0.1:49374`. Each machine has its own local memory; there is no
cloud dependency or cross-machine synchronization.

## Install / refresh

```sh
bash install/ai-memory.sh macbook --dry-run
bash install/ai-memory.sh macbook
# Run with omarchy on the Omarchy machine.
```

Normal `./setup.sh <host>` runs the same installer. Targeted refresh requires
the shared MCP runtime from normal setup. The repo downloads the official binary
and hook bundle, verifies the pinned SHA-256, and links `~/.local/bin/ai-memory`
directly to `~/.local/lib/ai-memory/ai-memory`. There is no runtime wrapper.

After the shared agent configurations are installed, it runs:

```sh
ai-memory setup --yes --agent claude-code --agent codex --agent pi
ai-memory install-mcp --client claude-desktop --apply
~/.local/share/mcp-services/venv/bin/python "$REPO_ROOT/configs/ai-memory/codex-bridge.py"
~/.local/share/mcp-services/venv/bin/python "$REPO_ROOT/configs/ai-memory/antigravity-client.py"
```

Upstream owns initialization, authentication, the service, MCP registrations,
hooks, skills, and its health/status/doctor checks. Setup uses native defaults:

| | MacBook | Omarchy |
|---|---|---|
| Data directory | `~/Library/Application Support/ai-memory` | `~/.local/share/ai-memory` |
| Configuration | `<data directory>/config.toml` | `<data directory>/config.toml` |
| Service | `com.github.akitaonrails.ai-memory` LaunchAgent | `ai-memory.service` user unit |

Default embeddings run locally in-process. Upstream downloads its pinned
`all-MiniLM-L6-v2` model in the background; full-text recall works while it is
unavailable. No Ollama or API key is required for embeddings.

## Client integrations

| Client | Integration | Capture |
|---|---|---|
| Claude Code CLI | Upstream session-aware `mcp-bridge` | Upstream lifecycle hooks |
| Claude app — Chat | Upstream session-less stdio bridge | None; use explicit memory tools |
| Claude app — local Code tab | Shared Claude Code hooks/settings; Desktop MCP entry also available | Supported by upstream; not a claim of Cowork/cloud capture |
| Codex CLI / local app | Upstream plugin-style session-less stdio bridge | Upstream hooks; setup persists trust for the eight reviewed repo-managed commands |
| Antigravity CLI (`agy`) | Upstream-selected HTTP or stdio registration in `~/.gemini/config/mcp_config.json` | Upstream lifecycle hooks in `~/.gemini/config/hooks.json` |
| Pi | **Unmodified upstream generated extension**, tools and lifecycle capture | Upstream extension |

**Codex transport adjustment:** the bare upstream Codex writer emits HTTP with
`bearer_token_env_var = "AI_MEMORY_AUTH_TOKEN"`. GUI launches do not reliably
inherit a shell token. `codex-bridge.py` changes only that transport to the same
`ai-memory mcp-bridge --no-session-id` used by upstream's official Codex plugin.
The bridge reads the native token file. Upstream's default read-tool approvals
and per-destructive-tool prompts remain unchanged. No token enters the Codex config.

**Antigravity policy survives refresh.** Upstream normally replaces its entire
MCP entry. `antigravity-client.py` asks it to generate the registration in a
private temporary directory instead, then installs it only if missing. For a
matching transport, the whole existing entry (including auth, disabled state and
tool restrictions) is retained, not refreshed. For a different transport, setup
stops: review and rename or reconcile the entry before retrying. The upstream
HTTP form may contain a bearer token; keep the config and backups private. The
helper then delegates hooks and global Antigravity skills to upstream. Unsupported
`httpUrl`-only entries also fail with a migration message rather than being
reported as configured. The guarded apply runs after the other clients' complete
setup, so an Antigravity-specific failure cannot interrupt Codex's bridge
adjustment. Only Antigravity files are covered by this helper's no-write-on-conflict
guarantee; host setup is not a cross-client transaction.

**Codex trust is narrowly automated for these reviewed hooks.** After upstream
installation, `trust-codex-hooks.py` uses Codex's own `hooks/list` and
`config/batchWrite` APIs—the same persistent trust mechanism as `/hooks`.
It accepts only the eight expected user-level ai-memory commands for the local
server and native data directory, and records Codex's `currentHash` for each.
Unknown/changed commands fail closed before any trust write. Unrelated hooks,
existing disabled states, tool approvals and sandbox settings are untouched.
We never pass `--dangerously-bypass-hook-trust` or edit Codex's internal database.
Identical setup reruns retain trust without prompting; a new/unrecognized hook
needs explicit review and an allowlist update. Fully restart the Codex app/CLI
after setup so an already-running process reloads its configuration.

**Pi has one memory tool owner.** Its stock extension registers `memory_*` tools
and forwards session identity to MCP. Do not also register `ai-memory` in Pi's
native `mcp.json`; the shared renderer removes known old repo entries and refuses
unknown same-name entries. Other native Pi MCP services are unaffected. The old
capture-only patch and static-native-MCP instructions are removed. The source is
vendored without edits; `vendor/refresh-ai-memory-pi.py` verifies exact upstream
`install-hooks --apply` output. Stock whitespace is intentional.

Six upstream skills remain repo-symlinked into the existing shared agent skill
roots. Upstream setup finds matching content and leaves it unchanged. Antigravity
receives upstream-managed copies in its CLI and App/IDE global skill directories. Refresh the repo copies
with the pinned binary's `install-skills --target-dir` before upgrading the pin.

## Migration

The installer retires the old repo `dev.ai-memory` LaunchAgent / custom Linux
unit and replaces the wrapper with the real binary. It removes only the old
repo's exact Ollama embedding overrides from the service env file, preserving
unrelated settings. It does not copy or merge old memory into a new store, create
migration snapshots, or reset databases. Old inactive data/credentials can remain
on disk; they are not consulted by the Mac's new native-default installation.

`configs/mcp/catalog.json` no longer owns ai-memory. Upstream setup writes its
client entries; the shared MCP renderer preserves those entries rather than
rebuilding them.

## Verification and limits

```sh
bash tests/ai-memory.test.sh
# Exercise the installed pinned binary in disposable homes (no running server needed):
python3 tests/ai-memory-antigravity.test.py
~/.local/share/mcp-services/venv/bin/python tests/ai-memory-clients.test.py
python3 tests/ai-memory-codex-trust.test.py
python3 tests/codex-hook-state.test.py
python3 tests/ai-memory-skills.test.py
~/.local/share/mcp-services/venv/bin/python tests/mcp-clients.test.py
python3 tests/mcp-runtime.test.py
bun run test:pi-extensions ai-memory-pi-tests
bun run test:pi-extensions:e2e ai-memory-pi-tests
bun run lint:pi-extensions
bun run typecheck:pi-extensions
python3 configs/agents/pi/extensions/vendor/refresh-ai-memory-pi.py
# Live installed registrations + actual Codex trust report:
python3 scripts/check-ai-memory.py
# Also invoke installed Claude/Codex hook commands in a disposable project:
python3 scripts/check-ai-memory.py --capture
```

Setup and the check run doctor from this repository, not `$HOME`. Project
identity is derived from the Git remote; an absent marker is not an error when
the server reports an exact project match. A fresh store does not contain old
sessions: zero historical capture alone does not mean hooks are missing. Start a
new session and check its captured observations before reinstalling hooks.

The direct capture check exercises the real local server and installed commands
but **does not prove Codex executed them through its harness**. Its separate
read-only doctor check reports Codex's authoritative persisted trust state.
MCP checks launch the entries from the real client files, not the GUI applications. Pi's RPC spec runs actual
Pi and a deterministic no-cost model, replacing only the external memory service
with an authenticated fixture. Live GUI behavior needs an app restart and an
in-app memory call. Do not claim GUI validation from configuration alone.

Fully quit/relaunch Claude and the Codex app, and restart Pi/CLI sessions after
setup. Cloud-executed tasks cannot reach this machine's loopback service. Ordinary
Claude Chat does not gain automatic lifecycle capture; Cowork capture is not
claimed. Omarchy service verification must run on Omarchy, not macOS.

## Sources

- [Upstream native setup](https://github.com/akitaonrails/ai-memory/blob/v3.5.1/INSTALL_FOR_AGENTS.md)
- [Client registration and desktop limitations](https://github.com/akitaonrails/ai-memory/blob/v3.5.1/docs/mcp-install.md)
- [Official plugins, including Codex stdio bridge](https://github.com/akitaonrails/ai-memory/blob/v3.5.1/docs/install.md#marketplace-plugins)
- [Codex hook trust](https://learn.chatgpt.com/docs/hooks)
- [Codex's own persisted `/hooks` approval implementation](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/tui/src/hooks_rpc.rs#L64-L95)
- [Codex local app/CLI MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
