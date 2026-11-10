# REA MCP — pinned local runtime

[REA (Reverse Engineer Anything)](https://github.com/morluto/rea) is installed
as **`rea-agents@6.7.0`**. `package.json` pins the release and
`package-lock.json` locks the complete npm dependency tree with integrity hashes.
Node **26.12.0** is installed separately through mise. This does not change the
shared/global Node selection.

## Install

Full host setup installs prerequisites, REA, Ghidra, native CLI tools, and MCP registrations:

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
command. All npm lifecycle scripts stay disabled. After dependency installation,
it explicitly runs the locked `prebuild-install` tool in the locked Frida package
to install its platform-specific Node-API 8 binding, then verifies that Frida
imports with the pinned Node runtime. If no compatible prebuild is available,
setup fails rather than falling back to a source build. The prebuild comes from
the Frida version's upstream GitHub release; npm lockfile integrity covers the
npm packages, not this separately downloaded binary.

Frida is provisioned on all three hosts so rerunning setup does not remove its
binding. Setup does not attach to a process, start a capture session, launch a
target program, or change OS security settings.

## Runtime and clients

| Path | Purpose |
|---|---|
| `configs/rea/node_modules/` | Ignored, lockfile-installed runtime dependencies |
| `~/.local/share/rea/source` | Link to this repo directory |
| `~/.local/share/rea/node-path` | Absolute pinned Node executable for GUI clients |
| `~/.local/share/rea/ghidra-path` | Isolated REA-compatible Ghidra installation path |
| `~/.local/share/rea/java-home` | Isolated full JDK used only by REA |
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

## Supported capabilities

The installed baseline supports MCP discovery, session diagnostics, and static
JavaScript/Electron analysis without a native decompiler. It does **not** make
every advertised tool ready. Check the specific workflow, not the tool count.

Live process inspection uses the installed Frida binding. Check the read-only
process-discovery path with:

```bash
rea list-frida-processes --device-id local --format json
```

This verifies process discovery, not permission to attach to any particular
process. macOS security policy and target protections still apply. Installing
Frida does not expose a game's scene graph or automatically recover geometry.
An already-running MCP server may need a restart after repairing a previously
failed Frida import.

### Ghidra and native CLI tools

`install/rea-ghidra.sh` installs checksum-pinned **Ghidra 12.1.4** with an
isolated **Temurin JDK 21**. Full setup calls it after the baseline REA installer;
it can also run separately:

```bash
bash install/rea-ghidra.sh macbook --dry-run
bash install/rea-ghidra.sh macbook
rea doctor --provider ghidra --format json
```

The existing ghidra-cli 12.0.4 runtime and global Java 17 selection stay unchanged.
The REA launcher reads the installer records as plain data, supplies
`GHIDRA_INSTALL_DIR` unless the caller explicitly sets it, and sets `JAVA_HOME`
to the recorded JDK for its child process only. GUI clients use the same launcher;
no per-client environment edit is needed. Restart existing MCP servers to load it.
Reruns reuse a validated installation and finish interrupted record publication.
If an owned Ghidra installation is corrupted, setup fails and preserves it;
rerunning alone does not repair it. Deliberate diagnosis and recovery are needed
before replacement. User-repointed records and foreign paths are also preserved.

Ghidra's release includes Linux x86_64 binaries. On macOS arm64, the installer
builds its decompiler and Sleigh compiler from the checksum-verified release
sources using Xcode Command Line Tools. No Gradle downloads are needed. Allow
about 1.5–2 GB of temporary disk space for the release, JDK, and build.

The shared package lists include **Rizin** and **GDB** on both platforms and
**LLDB** on Linux. macOS uses LLDB from Xcode Command Line Tools. Installation
does not grant debugger permissions, change signing policy, or attach to apps.
The tested Apple Silicon GDB build can read DWARF 4 symbols but reports
`Don't know how to run` when launching a native fixture; use LLDB for native
macOS debugging. GDB's installation alone does not establish native-debug support.

### Commercial and other optional engines

Hopper and IDA are not installed automatically. Hopper's public download is a
limited demo; IDA Free lacks the Python integration and ARM analysis needed for
this use case. A suitable licensed edition and its REA adapter configuration
remain separate. Android and capture tools also have task-specific dependencies
and permissions; they are not silently installed or enabled here.

Use provider-scoped checks. Do not run unscoped `rea doctor` as the acceptance
check for core MCP readiness: it also audits optional tools and can report
unhealthy while the configured workflows work.

Upstream references:

- [Installation and requirements at v6.7.0](https://github.com/morluto/rea/blob/v6.7.0/docs/installation.md)
- [MCP contracts](https://github.com/morluto/rea/blob/v6.7.0/docs/mcp-contracts.md)

## Verify

```bash
rea --version
python3 tests/rea.test.py
python3 tests/rea-ghidra.test.py
~/.local/share/mcp-services/venv/bin/python tests/mcp-clients.test.py
python3 scripts/check-rea-mcp.py --frida
```

`tests/rea.test.py` is offline integration coverage: real installer/launcher
scripts and filesystem operations, with package-manager boundaries replaced.
Client tests exercise the real configuration renderer in isolated temporary homes.

`check-rea-mcp.py` requires the installed runtime. It opens the real stdio MCP
server, verifies the pinned server version, lists tools, checks session status,
and analyzes a temporary JavaScript fixture. It does not inspect user projects,
connect to browsers, or require optional engines. It closes its server and
removes its fixture. A successful report proves that path, not macOS execution
or optional native providers. With `--frida`, it also verifies local process
discovery finds its own PID. It never attaches to any process.

## Upgrade deliberately

Change the exact `rea-agents` dependency, regenerate `package-lock.json` with
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund --prefix configs/rea`,
review the release and lock diff, then rerun the installer and checks above.
Update the pinned Node version in `install/rea-prereqs.sh` only when needed,
and update this document with it. Never use `rea update`, a floating package
selector, or npm installation at MCP startup.
