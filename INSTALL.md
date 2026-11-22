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
- **Docker is strict standby, not socket-activated.** Setup disables automatic startup of both `docker.service` and `docker.socket`. When the engine is inactive or failed it stops the listening socket; when the engine is running or transitioning it preserves the engine, socket, and workloads. Setup never starts or restarts Docker to apply policy and does not mask the socket required by the packaged service. Start deliberately with `sudo systemctl start docker.service`; to return to standby after saving/stopping workloads, explicitly stop both `docker.service` and `docker.socket`. Do not use Docker client probes to check standby: they can activate a listening socket.
- The Docker slice budget is `MemoryHigh=24G`, `MemoryMax=32G`, and `MemorySwapMax=8G`. These limits are independent of desktop layout and do not authorize workload shutdown or daemon restarts.

The obsolete 3.x cutover bundle and ARM Parallels guide are retained only as [historical Git references](docs/history/README.md), not current installation instructions.

### `macbook`

- macOS setup
- Installs the shared CLI layer through Homebrew
- Uses OrbStack as the container engine and installs the `docker` CLI through Homebrew
- Applies `nvim`, `agents`, and Moshi host integration

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
4. Linux hosts install Docker; Omarchy applies the strict standby policy and 24G/32G/8G slice budget described above without starting or restarting the engine
5. Repo-owned config directories for the selected host
6. Moshi host integration on hosts that include the `moshi` config target: installs the pinned `moshi-hook`, allows inbound Tailscale connections, exposes Herdr at `~/.local/bin/herdr` for SSH probes, opens the Tailscale mosh UDP range with UFW, refreshes hooks for installed/configured agents, and starts the `moshi-hook` user service after pairing
7. Herdr integrations for installed/configured agents, with the Pi integration loaded from the pinned repository-generated extension
8. Agent hook dependencies from `configs/agents/hooks`
9. Agent code review tools from `configs/agents/bin/install-cr-tools.sh`
10. The [shared MCP catalog](configs/mcp/README.md) merges Neon, Datadog US5, Figma, REA, Playwriter, Chrome DevTools, Blender, and Roblox registrations. It does not own ai-memory and removes the retired native Pi memory entry.
11. Upstream `ai-memory setup --yes --agent claude-code --agent codex --agent pi` owns the local service, native hooks, MCP registration, and six official skills. Pi uses its unmodified generated extension for tools and capture. Claude Code's bridge is session-aware; Claude Desktop Chat uses the upstream session-less bridge and has no automatic capture. Codex CLI/app uses upstream's plugin-style stdio bridge for file-backed auth, preserving upstream tool approval rules; review and trust hooks in `/hooks` or app hook settings. See [ai-memory setup](configs/ai-memory/README.md). OAuth and account authorization remain explicit; setup starts no tunnels.

The setup is intended to be idempotent and non-destructive. Existing unrelated paths are warned about and left in place instead of being overwritten.

## Verification

Run the Bash checks after changing the setup code:

```bash
bash -n setup.sh install/*.sh install/hosts/*.sh
shellcheck setup.sh install/*.sh install/hosts/*.sh
bash tests/moshi.test.sh
bash tests/flatpak.test.sh
bash tests/flatpak-launchers.test.sh
bash tests/pacman.test.sh
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
