# Pinned browser automation runtime

`apply_browser_automation <dev|omarchy|macbook>` in
`install/browser-automation.sh` installs the package-local checked npm lock with
`npm ci --ignore-scripts --no-audit --no-fund`. Standalone:

```sh
bash install/browser-automation.sh dev --dry-run
```

Setup only installs dependencies, records the resolved absolute Node executable
in `~/.local/share/browser-automation/node-path`, and links launchers. It never
starts a browser, MCP server, relay, or extension installer. Rerun setup after
removing/upgrading the recorded Node runtime. GUI clients need no shell profile,
Node shim, `npx`, or package fetch at launch.

## Entrypoints

| Launcher in `~/.local/bin` | Published package entry | Behavior |
| --- | --- | --- |
| `playwriter` | `playwriter@0.9.0/bin.js` | Full upstream CLI for explicit sessions/evaluation |
| `playwriter-mcp` | `playwriter@0.9.0/bin.js` | No-argument extension-backed stdio MCP |
| `chrome-devtools-mcp` | `chrome-devtools-mcp@1.9.0/build/src/bin/chrome-devtools-mcp.js` | Stdio MCP attached only to existing `http://127.0.0.1:9222` |

The MCP launchers accept no arguments except `--help` / `--version`; use the
`playwriter` CLI for CLI operations. Playwriter's MCP may start its local relay
on demand, **not during setup**. The user must install/authorize the Playwriter
browser extension explicitly. No headless/cloud/direct mode is selected by the
MCP launcher. This registration deliberately requires the **local existing browser
extension**: it rejects nonempty `PLAYWRITER_DIRECT` and `PLAYWRITER_HOST` before
loading upstream code. Unset those variables in the MCP client's environment to
recover; the full CLI retains upstream's explicit alternate browser modes.

The exact 0.9.0 MCP implementation has no browser/profile environment selector:
its transport branches consult only `PLAYWRITER_DIRECT` and `PLAYWRITER_HOST`.
`PLAYWRITER_SESSION` is CLI-only; remote/headless/cloud session creation requires
explicit CLI options, not inherited `PLAYWRITER_REMOTE` / `PLAYWRITER_HEADLESS`
variables. Cloud credentials/URLs alone do not select cloud mode. Authentication,
execution timeout, logging, and unrelated application variables are preserved.
Agent routing must preserve the user's existing-browser requirement.

Chrome DevTools uses the diagnostics client's privacy flags: no usage statistics,
no CrUX URL submission, and redacted network headers. Memory tools are enabled.
Its detached registry update checker is disabled because upgrades belong to the
checked package lock, not runtime startup. A missing CDP browser must fail rather
than launch a fresh profile.

Shared native MCP entries are `playwriter` and `chrome-devtools` in the MCP
catalog. The renderer supplies absolute launcher paths to Pi, Claude Code,
Codex CLI/app (shared config), and Claude Desktop. Desktop rendering remains
limited to macbook/omarchy by the existing renderer. Claude Desktop and ChatGPT
also need the [browser workflow instructions](client-instructions.md) in their
project/custom instructions: native registration does not deliver local agent
skills. In particular, Chrome DevTools defaults new tabs to foreground unless
`background: true` is supplied. No server-wide no-focus guarantee is claimed.

## Upstream verification

Published metadata and tarball inspected for the exact pins:

- https://www.npmjs.com/package/playwriter/v/0.9.0 — tarball `package.json` uses
  the string bin `./bin.js`; this imports `dist/cli.js`. Its default command
  imports `startMcp`; browser/headless installation and launch are separate
  explicit CLI commands.
- https://www.npmjs.com/package/chrome-devtools-mcp/v/1.9.0 — package bin mapping
  points to `build/src/bin/chrome-devtools-mcp.js`; Node support is
  `^20.19.0 || ^22.12.0 || >=23`. `build/src/utils/check-for-updates.js` honors
  `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS`.

## Verification

```sh
python3 tests/browser-automation.test.py
# After deploying on this machine: real stdio tool discovery, no browser actions.
node scripts/check-browser-mcp.mjs
~/.local/share/mcp-services/venv/bin/python tests/mcp-clients.test.py
shellcheck -x install/browser-automation.sh configs/browser-automation/runtime.sh \
  configs/browser-automation/playwriter configs/browser-automation/playwriter-mcp \
  configs/browser-automation/chrome-devtools-mcp
```

The runtime tests use disposable homes/repos, including a real `npm ci` and
upstream `--help` check with a minimal GUI PATH. Other cases replace only the npm
package boundary to verify exact launcher argv, backup/foreign-link behavior,
dry run, retry, and failure publication. They do not connect to or manipulate a
user browser and do not prove browser-extension connectivity.
