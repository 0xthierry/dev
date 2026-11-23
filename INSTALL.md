# Machine Setup Guide

## Supported Setup Path

The supported machine setup entrypoint is:

```bash
./setup.sh <omarchy|macbook>
```

Use `--dry-run` first when changing the setup flow or validating a host:

```bash
./setup.sh omarchy --dry-run
./setup.sh macbook --dry-run
```

`bootstrap.sh` is now only a compatibility shim that forwards to `setup.sh`.

## Prerequisites

- A cloned checkout of this repo at the canonical `~/dev` path; run setup from that checkout
- `git`
- `zsh`
- `sudo` access on Linux hosts
- 1Password SSH agent configured separately from this repo

## Host Notes

### `omarchy`

- Brave is the default for web links and local HTML/XHTML files. Verify with `omarchy default browser` (expected: `brave`) and `xdg-mime query default text/html` (expected: `brave-browser.desktop`). Hyprland may report `omarchy-browser.desktop` for HTTP(S): that is the stock dispatcher, not Chromium.
- Installs the shared CLI layer through `pacman`
- Applies `nvim`, `hypr`, `agents`, and Moshi host integration
- **Quattro (4.x) is the supported desktop.** Start with a working packaged Quattro installation and run `cd ~/dev && ./setup.sh omarchy --dry-run` before applying setup. Setup is not an OS upgrade and needs no migration checkout, sibling `upstream` directory, preflight, or cutover rehearsal.
- **Preserve the stock live desktop by default.** Keep `~/.config/hypr` a real directory with its stock Lua entrypoint. Ordinary setup does not activate a personal desktop overlay or replace current monitors, scale, workspaces, shortcuts, or dictation defaults. [Personal settings](configs/hypr-quattro/README.md) are optional, review-only material; review individual choices separately instead of importing an old desktop layout wholesale.
- **Docker starts automatically at boot.** Setup enables `docker.service` and starts it if inactive or failed. A running or transitioning engine and its workloads are preserved; setup never stops or restarts Docker merely to apply policy. The packaged service starts its required `docker.socket`, so the socket does not need independent boot enablement. Verify with `systemctl is-enabled docker.service` and `systemctl is-active docker.service docker.socket`; no Docker client probe is needed. To stop Docker deliberately, first save/stop the workloads you want to shut down, then run `sudo systemctl stop docker.service`; the managed socket follows the engine's stop.
- The Docker slice budget is `MemoryHigh=24G`, `MemoryMax=32G`, and `MemorySwapMax=8G`. These limits are independent of desktop layout and do not authorize workload shutdown or daemon restarts.

The obsolete 3.x cutover bundle and ARM Parallels guide are retained only as [historical Git references](docs/history/README.md), not current installation instructions.

### `macbook`

- macOS setup
- Installs the shared CLI layer through Homebrew
- Uses OrbStack as the container engine and installs the `docker` CLI through Homebrew
- Applies `nvim`, `agents`, and Moshi host integration
- Installs [Superwhisper](https://formulae.brew.sh/cask/superwhisper) through its Homebrew cask (macOS 14+). Open the app and complete permissions/sign-in yourself; setup does not change dictation settings or remove Handy. Omarchy's stock dictation remains unchanged.

## Antigravity CLI and Pi

Both hosts install Google's [Antigravity CLI](https://antigravity.google/docs/getting-started?tab=cli)
as `~/.local/bin/agy`. This is the CLI, not the Antigravity editor or Gemini CLI.
Setup installs version 1.5.15 from checksum-pinned official archives. Upstream
may self-update during normal use; rerunning setup reconciles the pinned version.
After verifying the binary, setup opts `antigravity-cli` out of mise management so
Omarchy's floating distro entry cannot shadow it or trigger another download.
Existing mise installs and unrelated settings are preserved. No login, agent
session, or shell-startup modification is performed by this installer.

To install only the CLI from this checkout:

```bash
bash -c 'source install/antigravity-cli.sh; install_antigravity_cli'
agy --version
agy  # Start explicitly and complete Google's sign-in flow
```

Normal host setup also merges the eight shared MCP services into
`~/.gemini/config/mcp_config.json` and asks upstream ai-memory to install its
Antigravity MCP, lifecycle hooks, and official skills. Existing unrelated
servers and user options are preserved. OAuth and application permissions stay
manual; registration is not proof of connectivity. See the
[client matrix and scoped refresh command](configs/mcp/README.md#client-matrix).

New Pi sessions and `cliproxy pi` use `cliproxyapi/gpt-6.2-astra` with `high`
reasoning. Astra subagent guidance and the `use-agent` Astra profile also use 6.2;
the stable `pi-gpt6-astra-N` handles, Sol/Opus roles, and task-specific reasoning
policy are preserved. Existing sessions keep their model; switch with `/model`
and reload updated skills/extensions with `/reload`, or start a new session.
The separate Codex CLI default is unchanged. See [the proxy setup](configs/cliproxyapi/README.md).

### Antigravity models inside Pi

Both hosts declare [`pi-agy-provider`](https://github.com/teededung/pi-agy-provider)
**1.1.13** as a pinned npm package in `configs/agents/pi-settings.json`. Pi resolves
it on startup; `pi install npm:pi-agy-provider@1.1.13` explicitly installs the
already-declared package. In Pi 1.2.0, `pi update` alone did not materialize a
package that was declared but not installed. The complete upstream package is
loaded, including its `/btw` extension and skill; it is not copied into our
extension bundle.
The existing `cliproxyapi/gpt-6.2-astra` default stays unchanged.

Reopen Pi after setup. Use `/agy-login` if Antigravity is not signed in, then
select an `antigravity` model with `/model`. `/agy` and `/agy-tools status`
show the integration state; `/agy-models` refreshes its model catalog. Login
is manual; setup does not extract or copy OAuth credentials. Startup may run
`agy models` to refresh discovery, which is not a generation request.

The configured driver is `acp` with `toolMode: "pi"`. Ordinary bridged Pi tool
calls pass through Pi's tool loop. **This is not a blanket sandbox:** native mode
(`/agy-tools off`) executes actions outside Pi's tool hooks, some native web/image
tools remain available in Pi mode, and `/boost`, `/teamwork` and `/swarm` use
native orchestration rather than the restricted Pi-tools agent. The stream-json
route uses `--dangerously-skip-permissions`; ACP auto-approves ordinary native
permission requests. ACP is a transport,
not a stronger permission boundary. `/btw` uses a separate runtime with its own
tools and does not inherit the main session's extension permission hooks;
`/btw:ask` narrows that side thread to read-only tools. Do not treat these modes
as permission-equivalent to ordinary Pi tools or activate them implicitly.
The upstream footer can be toggled with
`/agy-config footer off` without removing provider or side-chat functionality.

## Cua Driver: Omarchy and Pi on MacBook

Setup pins **Cua Driver 0.59.4**, verifies its archive checksum and exact-release
Sigstore signature using the shared `cosign` package, and installs a matching
repo-owned skill. The scope is intentional:

| Host | Cua clients |
|---|---|
| Omarchy | Claude Code, Pi, Codex, Antigravity CLI |
| MacBook | **Pi only**; other Mac clients keep their existing browser workflow |

On Omarchy, the native Wayland and private X11 services remain separate. Setup
updates/restarts only stale Cua services; it does not restart Hyprland or install
the experimental input plugin. On Mac, the signed `CuaDriver.app` owns OS
permissions and a user LaunchAgent runs the daemon. Complete any required macOS
permissions yourself; setup never grants them or re-signs the app.

Cua is primary for qualified GUI workflows in those clients. Keep the user's
browser and profile: Brave support and native Hyprland raw input have documented
limits, so Playwriter/DevTools remain for verified gaps and specialist diagnostics.
Do not treat an MCP registration as proof of a successful GUI action. Domain APIs
remain appropriate for their semantic operations.

For a runtime-only Omarchy refresh, followed by the normal service reconciliation:

```bash
SETUP_HOST=omarchy bash install/cua-driver.sh
bash -c 'export REPO_ROOT="$PWD"; source install/lib.sh; source install/hosts/omarchy.sh; configure_cua_driver_service'
# Reconcile the intended client's MCP registrations; repeat for claude/codex/antigravity:
~/.local/share/mcp-services/venv/bin/python configs/mcp/configure-clients.py omarchy --client pi
python3 scripts/check-cua-mcp.py  # Discovery and read-only guide, not GUI acceptance.
```

Use normal `./setup.sh macbook` on the MacBook. Reload/restart the agent after
configuration changes. Never switch to a fresh profile, grant broad permissions,
or take foreground control merely to make validation pass.

## Roblox: play and develop

Run the normal setup on each desktop:

```bash
./setup.sh macbook   # On macOS: native Roblox and Roblox Studio via Homebrew
./setup.sh omarchy   # On Linux: Flatpak, Sober (play), and Vinegar (Studio)
```

### macOS

Open **Roblox** or **RobloxStudio** from Applications and sign in with your Roblox
account. Both are native apps. Homebrew casks: `roblox` and `robloxstudio`.

### Omarchy

Setup installs the [upstream-supported Flatpaks](https://vinegarhq.org/Vinegar/Installation.html)
from Flathub for the current user, including their required runtimes. It preserves
existing app data and permissions and skips already-installed user apps on reruns.
It does not install a separate system Wine or change sandbox permissions.

Only packaged Omarchy 4.x is supported. Setup uses the configured pacman repositories; it does not add an archive mirror, change package verification, or perform an OS upgrade. Quattro watches Flatpak desktop entries and does not need a launcher restart. If Flatpak was first installed after your session started,
you may need to log out and back in for the Quattro launcher to see its exports.
If setup runs without a user service manager, log out and back in to refresh the
desktop environment. Launch **Sober** to play or **Vinegar** to develop:

```bash
flatpak run org.vinegarhq.Sober
flatpak run org.vinegarhq.Vinegar
```

On Sober's first launch, leave **Automatic** Roblox installation selected.
Vinegar downloads/configures Studio on first launch. Complete the prompts and
sign in yourself; setup does not handle credentials or launch the apps.

Linux is unofficial: Sober is experimental, and Roblox updates can break either
tool. Both currently require an x86-64 CPU; Sober also requires SSE4.1 (SSE4.2 is
recommended). See the current [Sober requirements](https://vinegarhq.org/Sober/Installation.html)
and [Vinegar requirements](https://vinegarhq.org/Vinegar/Installation.html) for GPU
and OS support. Native macOS remains the fallback if Linux compatibility breaks.

Update the Linux apps explicitly when needed:

```bash
flatpak update --user org.vinegarhq.Sober org.vinegarhq.Vinegar
```

After installation, verify **both outcomes**: join an experience in Roblox/Sober,
then create a Baseplate in Studio/Vinegar, press Play, stop, and save it. Package
installation alone does not verify gameplay or the Studio graphics/runtime path.

## What Setup Applies

`./setup.sh <host>` applies the Bash-managed machine state in this order:

1. Shared CLI packages for the selected host
2. Shared CLI tool config under `configs/cli/`
3. Shared env, shell, git, SSH, `mise`, and AI CLI setup, including the pinned `ai-memory` v3.5.1 binary and local user service on each host
4. Linux hosts install Docker; Omarchy enables engine startup at boot, starts an inactive/failed engine, and applies the 24G/32G/8G slice budget described above without restarting a running engine
5. Repo-owned config directories for the selected host
6. Moshi host integration on hosts that include the `moshi` config target: installs the pinned `moshi-hook`, allows inbound Tailscale connections, exposes Herdr at `~/.local/bin/herdr` for SSH probes, opens the Tailscale mosh UDP range with UFW, refreshes hooks for installed/configured agents, and starts the `moshi-hook` user service after pairing
7. Herdr integrations for installed/configured agents, with the Pi integration loaded from the pinned repository-generated extension
8. Agent hook dependencies from `configs/agents/hooks`
9. Agent code review tools from `configs/agents/bin/install-cr-tools.sh`
10. The [shared MCP catalog](configs/mcp/README.md) merges Neon, Datadog US5, Figma, REA, Playwriter, Chrome DevTools, Blender, and Roblox registrations. It does not own ai-memory and removes the retired native Pi memory entry.
11. Upstream `ai-memory setup --yes --agent claude-code --agent codex --agent pi` owns the local service, native hooks, MCP registration, and six official skills. Antigravity receives upstream-generated MCP, hooks and skills separately, with a guarded staged MCP merge that preserves disable/tool-restriction options and refuses conflicting transports. Pi uses its unmodified generated extension for tools and capture. Claude Code's bridge is session-aware; Claude Desktop Chat uses the upstream session-less bridge and has no automatic capture. Codex CLI/app uses upstream's plugin-style stdio bridge for file-backed auth, preserving upstream tool approval rules. Setup uses Codex's own persistent trust API for only the eight reviewed repo-managed ai-memory hooks; unrelated or unrecognized hooks still require review. See [ai-memory setup](configs/ai-memory/README.md). OAuth and account authorization remain explicit; setup starts no tunnels.

The setup is intended to be idempotent and non-destructive. Existing unrelated paths are warned about and left in place instead of being overwritten.
Factory/Droid is no longer installed by setup on either host. Existing copies are
not automatically uninstalled; removal is a separate, explicitly requested action.

## Verification

Run the Bash checks after changing the setup code:

```bash
bash -n setup.sh install/*.sh install/hosts/*.sh
shellcheck setup.sh install/*.sh install/hosts/*.sh
bash tests/moshi.test.sh
bash tests/flatpak.test.sh
bash tests/flatpak-launchers.test.sh
bash tests/pacman.test.sh
python3 tests/docker-startup.test.py
bash tests/quattro-config-deploy.test.sh
python3 tests/hypr-quattro.test.py
python3 tests/setup-hosts.test.py
./setup.sh omarchy --dry-run
./setup.sh macbook --dry-run
```

The offline Quattro tests use `OMARCHY_TEST_UPSTREAM`, falling back to
`~/.cache/dev-setup/omarchy-test-upstream`. Prepare a separate pristine Omarchy
source fixture at that location (or point the environment variable at one).
The tested source is v4.5.0, pinned to commit
`ac2690cd7be4f47e4a255f5e2e78d904d436b068`; the tests reject another revision.
This is a test-only prerequisite, not a setup dependency or a migration checkout.
For example, with an existing fixture:

```bash
OMARCHY_TEST_UPSTREAM=/path/to/pristine/omarchy python3 tests/hypr-quattro.test.py
```

For repo-owned config deployment, verify the symlink targets after a real setup.
The Hyprland directory must remain a real directory, not a repo symlink:

```bash
ls -la ~/.config/nvim
ls -la ~/.config/hypr
ls -la ~/.config/zsh
```

For the agent setup, verify:

```bash
ls -la ~/.codex
ls -la ~/.claude
ls -la ~/.pi/agent/extensions
```

For ai-memory, verify:

```bash
ai-memory --version
systemctl --user status ai-memory.service   # Linux
# launchctl print gui/$(id -u)/dev.ai-memory  # macOS
curl -sS http://127.0.0.1:49374/mcp | head
pi mcp list
grep -n 'ai-memory' ~/.claude/settings.json ~/.codex/config.toml ~/.codex/hooks.json
```

Independent clones of one repo still get different project names unless that repo contains `.ai-memory.toml` with a fixed `project`. Example for four `background-coding-agent` checkouts:

```toml
workspace = "meistrari"
project = "background-coding-agent"
```

### Claude Code inline images (Ghostty and Herdr)

Setup installs the pinned `inline-images@thierry-local` plugin from the repo-local marketplace. It previews image reads, MCP image results, pasted images, and local image references in Claude's terminal transcript. New Ghostty and Herdr shells opt into terminal images; other terminals are not forced. No Ghostty graphics setting needs changing.

For an already-open shell, run `export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` before starting Claude again. Use `claude --continue` to resume your last conversation. See [the plugin README](configs/agents/claude/plugins/inline-images/README.md) for provenance, tests, and the two-path visual check. Plugin tests verify rendering elements, not the pixels in your terminal.

```bash
claude plugin list
python3 tests/claude-inline-images.test.py
python3 tests/terminal-images.test.py
claude plugin test configs/agents/claude/plugins/inline-images
```

For Moshi + Herdr setup, verify:

```bash
moshi-hook version
amq --version
herdr --version
ls -la ~/.local/bin/herdr
systemctl --user status moshi-hook                        # Linux
launchctl print gui/$(id -u)/app.getmoshi.moshi-hook     # macOS
moshi-hook probe
moshi-hook status
herdr integration status
herdr session list --json
```

Phone-specific Moshi steps stay manual because they require device-held secrets:

```bash
moshi-hook host setup --host <tailscale-ip> --name <host-name> --user "$USER"
moshi-hook pair --token <token-from-Moshi-Settings-Hooks>
```

After pairing, rerun `./setup.sh <host>` so Moshi refreshes the installed agent hooks and starts or restarts its service.

## Troubleshooting

If a dry-run shows warnings about an existing path, setup is intentionally refusing to replace that path automatically. Inspect it and decide whether to move it aside manually.

If Homebrew or `pacman` is missing, the host package step cannot complete. Install the platform package manager first, then rerun `./setup.sh <host>`.
