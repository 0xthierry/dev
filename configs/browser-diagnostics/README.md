# Portable browser diagnostics runtime

This package ports the bounded browser capture CLI and the persistent, skill-driven Chrome DevTools MCP client. It attaches only to the existing local browser at `http://127.0.0.1:9222`. It does not register an MCP server, start a browser, select an alternate browser, accept a remote endpoint, or create a tunnel.

## Installed entrypoints

The setup installer symlinks these package files into `~/.local/bin`:

- `bin/browser-diagnostics` → `browser-diagnostics`
- `bin/chrome-devtools-cli` → `chrome-devtools-cli`

Both POSIX shell wrappers resolve their physical source through relative or absolute symlinks and quote paths. Repository and home paths may contain spaces.

### Bounded capture CLI

```text
browser-diagnostics targets
browser-diagnostics doctor --target ID --url URL
browser-diagnostics record --target ID --url URL --kind cpu|network|coverage \
  --duration-ms N --scenario NAME [--build REV] [--reload] [--disable-cache]
browser-diagnostics heap --target ID --url URL --scenario NAME \
  [--build REV] [--collect-garbage]
browser-diagnostics summarize --run ABS_PATH
browser-diagnostics compare --before ABS_PATH --after ABS_PATH
```

Normal commands have no endpoint option. Tests may use `--fixture-port N` only when `BROWSER_DIAGNOSTICS_TEST_MODE=1`; the host remains fixed to loopback. Captures retain the source limits and evidence contract: 100–300000 ms duration, one recorder, a 512 MiB artifact limit, exact target ID and URL verification, foreground/viewport checks, explicit cache/reload/GC controls, and `recording`/`complete`/`incomplete` manifests. Only `complete` is valid evidence.

Artifacts and MCP state use `$HOME/.local/state/browser-diagnostics`. Directories are private mode `0700`; files are mode `0600`. The UNIX socket uses a short private directory under `$XDG_RUNTIME_DIR` when available, otherwise the system temporary directory. Raw profiles, traces, network metadata, coverage, and heaps may contain private data.

### Persistent MCP CLI

```text
chrome-devtools-cli list [TOOL]
chrome-devtools-cli call TOOL '<JSON object>'
chrome-devtools-cli status
chrome-devtools-cli stop
```

The package pins `chrome-devtools-mcp` 1.9.0 and `@modelcontextprotocol/sdk` 1.29.0 locally. The daemon exposes exactly the 24 diagnostic tools in `src/tool-catalog.ts`, uses a private generation-authorized UNIX socket, caps arguments at 1 MiB and results at 8 MiB, and gives a tool call 130 seconds. One backend remains alive across calls so manual performance traces and loaded heap snapshots survive related invocations.

A failed, interrupted, timed-out, or error-returning tool call invalidates the generation. The client does not replay an operation with an unknown outcome. Run `stop`, re-establish the target and controls, and start a new investigation.

## Stop and process ownership

A normal `stop` authenticates the daemon generation over the private socket. The daemon closes its MCP client, verifies that its owned stdio backend exited, and only then removes lifecycle state. On Linux it may retire a surviving backend only after the namespace, UID, start ticks, exact executable argument, and exact `--workspace` root match. If termination cannot be verified, state and process identities are retained and `stop` fails. It never sends a signal to Brave, Chromium, Chrome, or a process selected by browser name or debugging port. Evidence files remain on disk.

Lost-daemon recovery is platform-specific:

- **Linux:** the runtime retains the source safety model and scopes it to one diagnostics namespace. A daemon must also carry the exact state-root marker and generation in argv. A backend must carry the exact `--workspace` state root. Only same-UID processes with matching `/proc` start ticks, role, executable, and namespace may be retired. Recovery for a fixture namespace cannot retire the production namespace, Brave, or another fixture namespace. It then removes stale private client state.
- **Darwin:** there is no `/proc` start-tick identity. If the generation cannot be authenticated while a recorded PID still exists, recovery fails closed, keeps state, and sends no PID-only or broad `ps`-matched signal. After both recorded processes are gone, explicit `stop` may clear stale private state.

This Darwin refusal is intentional. It preserves the outcome that stop must not kill an unrelated process after PID reuse, at the cost of requiring manual inspection or process exit after an abnormal daemon loss. Invalid or corrupt `state.json` is also retained on every platform: the CLI reports that inspection is required instead of deleting state or broad-matching processes.

## Development and validation

From the repository root, install the package-local dependencies without lifecycle scripts and run the canonical checks:

```bash
bun install --cwd configs/browser-diagnostics --frozen-lockfile --ignore-scripts
bun run test:browser-diagnostics
bun run test:browser-diagnostics:e2e
bun run typecheck:browser-diagnostics
bun run lint:browser-diagnostics
```

`*.test.ts` tests are deterministic and do not attach to a browser. `*.spec.ts` tests launch an isolated Brave fixture on a test-only loopback port and a new private profile. Linux uses `/usr/bin/brave`. Darwin uses `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser` (or the same application under `~/Applications`) and fails clearly when Brave is absent. The suite does not fall back to a user browser or another browser. It exercises real CPU/network/coverage/heap captures, manifests and cleanup, persistent MCP trace/heap calls across separate CLI invocations, explicit invalidation, client stop, and the guarantee that the fixture browser remains reachable after stop. It never attaches to the user's browser on port 9222. A controlled HTTP fixture also checks stopping an interrupted client while browser readiness is pending. Fixture directories use physical paths so macOS temporary-directory aliases do not weaken or trip the production symlink checks.

macOS runtime behavior is covered by portable code paths and deterministic recovery-policy tests in this Linux development environment; it has not been executed on Darwin here.
