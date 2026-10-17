# Private ai-memory clients

`macbook` and `omarchy` use the fresh ai-memory **3.1.0** deployment at
`https://ai-memory-cloud.tail4e339.ts.net`. The server lives in the private
`0xthierry/ai-memory-cloud` repository/Railway project. This repo owns machine
configuration, not the server deployment. `dev` keeps its existing local 2.1.0
installation; no remote credentials are installed there.

## Targeted setup

Provision the machine's **native `aim_` user API key**, not the server root bearer,
as the owner-only regular file `~/.config/ai-memory/api-key` (mode 0600). Obtain it
through private secret storage; never paste it into shell arguments, Git, or logs.
The two desktop hosts use different revocable keys belonging to the same human.

On an already provisioned machine with the shared MCP runtime:

```sh
bash install/ai-memory.sh macbook --dry-run
bash install/ai-memory.sh macbook
# On Omarchy itself, use omarchy instead of macbook.
```

Normal `./setup.sh macbook` / `./setup.sh omarchy` uses the same installer.
Targeted setup does not run unrelated package or agent installers. Fully quit and
restart Claude/Codex/Desktop; restart Pi or `/reload` to reconnect native MCP.
Tailscale connectivity and DNS must work before live memory calls can succeed.
The installer does not log into Tailscale or alter network access policy.

## Files and behavior

- `deployment.json`: committed HTTPS endpoint, no secrets.
- `~/.config/ai-memory/client.json`: generated endpoint marker, published only after
  credential validation. A present but invalid marker fails closed; it never
  falls back to local memory.
- `~/.config/ai-memory/api-key`: canonical per-machine user credential, read at
  launch/request time. Root-token shapes, symlinks, and group/world-readable keys
  are refused.
- `~/.local/share/ai-memory-client/`: dedicated 3.1 binary, private config,
  vendored hooks, and offline spool. No old memory is imported or opened.
- `~/.local/bin/ai-memory`: repo-owned launcher that always supplies the remote
  config/data directory, clears stale `AI_MEMORY_*` settings, and uses the
  canonical machine key. Native Claude/Codex hook commands are routed through
  this launcher so ambient old root credentials cannot override the key.
- Native HTTP MCP: Claude Code/Codex require copies of the user key in their
  existing owner-only client configs. Setup replaces stale root auth and keeps
  private numbered backups. Pi uses its documented command-derived Authorization
  header, reading the canonical file without embedding its value. After rotating
  a key, rerun targeted setup to refresh Claude/Codex copies.
- Desktop: native ai-memory stdio-to-HTTP bridge through the launcher, with no
  `mcp-remote` OAuth or localhost endpoint. Capture is not provided for Desktop.
- Pi: upstream 3.1 capture/handoff code with its obsolete tool bridge removed.
  Native MCP owns all memory tools. Explicit workspace/project scope remains
  required for static native MCP calls.

No embeddings, local server initialization, or data migration runs for these two
hosts. Their old managed LaunchAgent/systemd user service is stopped/disabled;
service definitions and all old data remain untouched. The `dev` path remains
local and does not consult remote credentials. Pi's previous capture is retained
only for that unmarked local-host mode; it is not a remote compatibility fallback.

The five shared upstream skills remain the existing 2.1.0 content. They were not
audited for every 3.1 tool in this deployment task; do not assume newly introduced
3.1 commands are covered by those skills.

## Verification

```sh
bash tests/ai-memory.test.sh
bash tests/ai-memory-remote-install.test.sh
python3 tests/ai-memory-remote.test.py
~/.local/share/mcp-services/venv/bin/python tests/mcp-clients.test.py
python3 tests/mcp-runtime.test.py
bun run test:pi-extensions ai-memory-pi-tests
bun run test:pi-extensions:e2e ai-memory-pi-tests
bun run lint:pi-extensions
bun run typecheck:pi-extensions
```

Fixtures isolate HOME, files, services, package boundaries, and HTTP fetches. The
Pi RPC spec runs actual Pi with only its external memory service replaced. These
checks do not prove live Tailscale connectivity; verify authenticated capture,
retrieval, handoffs, and reconnect replay on each actual machine separately.
