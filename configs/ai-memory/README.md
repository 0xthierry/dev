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
| Codex CLI / local app | Upstream plugin-style session-less stdio bridge | Upstream hooks, **after user trust approval** |
| Pi | **Unmodified upstream generated extension**, tools and lifecycle capture | Upstream extension |

**Codex transport adjustment:** the bare upstream Codex writer emits HTTP with
`bearer_token_env_var = "AI_MEMORY_AUTH_TOKEN"`. GUI launches do not reliably
inherit a shell token. `codex-bridge.py` changes only that transport to the same
`ai-memory mcp-bridge --no-session-id` used by upstream's official Codex plugin.
The bridge reads the native token file. Upstream's default read-tool approvals
and per-destructive-tool prompts remain unchanged. No token enters client files.

**Codex trust is not automated.** Open `/hooks` in Codex, or the app's hook
settings, review the ai-memory hooks, and trust them. Changed hook commands need
approval again. Setup reports untrusted/modified hooks instead of claiming
capture is ready. We never pass `--dangerously-bypass-hook-trust`.

**Pi has one memory tool owner.** Its stock extension registers `memory_*` tools
and forwards session identity to MCP. Do not also register `ai-memory` in Pi's
native `mcp.json`; the shared renderer removes known old repo entries and refuses
unknown same-name entries. Other native Pi MCP services are unaffected. The old
capture-only patch and static-native-MCP instructions are removed. The source is
vendored without edits; `vendor/refresh-ai-memory-pi.py` verifies exact upstream
`install-hooks --apply` output. Stock whitespace is intentional.

Six upstream skills remain repo-symlinked into the agent skill roots. Upstream
setup finds matching content and leaves it unchanged. Refresh the repo copies
with the pinned binary's `install-skills --target-dir` before upgrading the pin.

## Migration

The installer retires the old repo `dev.ai-memory` LaunchAgent / custom Linux
unit and replaces the wrapper with the real binary. It removes only the old
repo's exact Ollama embedding overrides from the service env file, preserving
unrelated settings. It does not copy or merge old memory into a new store, create
migration snapshots, or reset databases. Old inactive data/credentials can remain
on disk; they are not consulted by the Mac's new native-default installation.

`configs/mcp/catalog.json` no longer owns ai-memory. Upstream setup writes its
client entries after the shared renderer; later shared MCP refreshes preserve
those entries rather than rebuilding them.

## Verification and limits

```sh
bash tests/ai-memory.test.sh
~/.local/share/mcp-services/venv/bin/python tests/ai-memory-clients.test.py
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

The capture check exercises the real local server and installed commands but
**does not bypass or prove Codex's hook trust**. MCP checks launch the entries
from the real client files, not the GUI applications. Pi's RPC spec runs actual
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
- [Codex local app/CLI MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
