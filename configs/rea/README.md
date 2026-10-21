# REA MCP — pinned local runtime

[REA (Reverse Engineer Anything)](https://github.com/morluto/rea) is installed
as **`rea-agents@6.7.0`**. `package.json` pins the release and
`package-lock.json` locks the complete npm dependency tree with integrity hashes.
Node **26.12.0** is installed separately through mise. This does not change the
shared/global Node selection.

## Install

Full host setup installs prerequisites, REA, and its MCP registrations:

```bash
./setup.sh omarchy # or dev / macbook
```

To install only REA on an already bootstrapped host:

```bash
bash install/rea.sh omarchy --dry-run
bash install/rea.sh omarchy
bash install/mcp.sh omarchy
```

The first installer calls `install/rea-prereqs.sh` automatically. That script
can also run on its own:

```bash
bash install/rea-prereqs.sh omarchy [--dry-run]
```

Prerequisites:

- **mise**: installed by the shared pacman/Homebrew package layer. On an
  unprovisioned machine, run full host setup first.
- **Node 26.12.0 and its npm**: installed with `mise install node@26.12.0`,
  without `mise use` or a global configuration rewrite.
- **Linux `procps-ng`**: declared in `install/packages/common.sh` and installed
  by the normal package layer or the dedicated prerequisite script when missing.
  REA needs a procps-compatible `ps` for process ownership checks. `procs` is not
  a substitute. macOS uses its platform process tools.

The runtime installer runs `npm ci --ignore-scripts --no-audit --no-fund` in this
directory. It never runs upstream `rea setup`/`rea update` or a floating `npx`
command. npm lifecycle scripts are disabled, so optional packages that require
native install hooks (notably Frida) are not provisioned by this installer.
No native engine, browser, capture session, tunnel, or target program is started
by setup.

## Runtime and clients

| Path | Purpose |
|---|---|
| `configs/rea/node_modules/` | Ignored, lockfile-installed runtime dependencies |
| `~/.local/share/rea/source` | Link to this repo directory |
| `~/.local/share/rea/node-path` | Absolute pinned Node executable for GUI clients |
| `~/.local/bin/rea` | Repo launcher for CLI diagnostics and analysis |
| `~/.local/bin/rea-mcp` | Repo launcher for `rea mcp` over stdio |

Launchers do not install or download packages. They fail with a recovery command
when the installed runtime is incomplete. Re-running the installer repairs
missing dependencies. Foreign launcher/source links are refused; regular
existing launcher files receive numbered backups. Client configuration is
handled by the existing [shared MCP renderer](../mcp/README.md), preserving
unrelated servers and user options.

The `rea` server is registered in Pi, Claude Code, and Codex on all three hosts,
and Claude Desktop on macbook/omarchy. Pi uses deferred tool exposure. Restart
your client to load the new registration. ChatGPT is not configured.

## Supported baseline and optional engines

The installed baseline supports MCP discovery, session diagnostics, and static
JavaScript/Electron analysis without a native decompiler. It does **not** make
every advertised tool ready. Check the specific workflow, not the tool count.

Native binary analysis needs a compatible provider such as Ghidra, Hopper, or
IDA. **The existing repo-managed Ghidra 12.0.4 / Java 17 stack is not compatible
with REA 6.7.0's Ghidra provider.** Upstream accepts Ghidra 12.1.x with a full
JDK 21+ and the correct native decompiler. This integration leaves the existing
stack unchanged. A separate, explicit native-engine installation is needed
before those tools can work. Android, runtime instrumentation, and capture tools
also have task-specific dependencies and permissions; they are not silently
installed or enabled here.

If a compatible engine is installed separately, REA supports `GHIDRA_INSTALL_DIR`
and `JAVA_HOME`. For GUI clients, set absolute paths in the `rea` entry's `env`
map through the repo-managed configuration workflow; shared MCP refreshes retain
user environment options. Check it with `rea doctor --provider ghidra --json`.
Do not run unscoped `rea doctor` as the acceptance check for core MCP readiness:
it also audits optional tools and can report unhealthy while core workflows work.

Upstream references:

- [Installation and requirements at v6.7.0](https://github.com/morluto/rea/blob/v6.7.0/docs/installation.md)
- [MCP contracts](https://github.com/morluto/rea/blob/v6.7.0/docs/mcp-contracts.md)

## Verify

```bash
rea --version
python3 tests/rea.test.py
~/.local/share/mcp-services/venv/bin/python tests/mcp-clients.test.py
python3 scripts/check-rea-mcp.py
```

`tests/rea.test.py` is offline integration coverage: real installer/launcher
scripts and filesystem operations, with package-manager boundaries replaced.
Client tests exercise the real configuration renderer in isolated temporary homes.

`check-rea-mcp.py` requires the installed runtime. It opens the real stdio MCP
server, verifies the pinned server version, lists tools, checks session status,
and analyzes a temporary JavaScript fixture. It does not inspect user projects,
connect to browsers, or require optional engines. It closes its server and
removes its fixture. A successful report proves that path, not macOS execution
or optional native providers.

## Upgrade deliberately

Change the exact `rea-agents` dependency, regenerate `package-lock.json` with
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund --prefix configs/rea`,
review the release and lock diff, then rerun the installer and checks above.
Update the pinned Node version in `install/rea-prereqs.sh` only when needed,
and update this document with it. Never use `rea update`, a floating package
selector, or npm installation at MCP startup.
