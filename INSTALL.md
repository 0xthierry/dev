# Machine Setup Guide

## Supported Setup Path

The supported machine setup entrypoint is:

```bash
./setup.sh <dev|omarchy|macbook>
```

Use `--dry-run` first when changing the setup flow or validating a host:

```bash
./setup.sh dev --dry-run
./setup.sh omarchy --dry-run
./setup.sh macbook --dry-run
```

`bootstrap.sh` is now only a compatibility shim that forwards to `setup.sh`.

## Prerequisites

- A cloned checkout of this repo, typically at `~/dev`
- `git`
- `zsh`
- `sudo` access on Linux hosts
- 1Password SSH agent configured separately from this repo

## Host Notes

### `dev`

- Linux VM-oriented setup
- Creates `~/Work/Sideprojects` and `~/Work/Meistrari`
- Writes the `github.com` SSH override used by the VM
- Applies Moshi host integration for mobile SSH/Mosh + Herdr/Pi sessions

### `omarchy`

- Linux desktop setup
- Installs the shared CLI layer through `pacman`
- Applies `nvim`, `hypr`, `agents`, and Moshi host integration

### `macbook`

- macOS setup
- Installs the shared CLI layer through Homebrew
- Uses OrbStack as the container engine and installs the `docker` CLI through Homebrew
- Applies `nvim`, `agents`, and Moshi host integration

## Roblox: play and develop

Run the normal setup on each desktop (the `dev` server is unchanged):

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

Log out and back in after installing Flatpak for the first time if the apps do
not appear in the launcher. Launch **Sober** to play or **Vinegar** to develop:

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
3. Shared env, shell, git, SSH, `mise`, and AI CLI setup, including the pinned `ai-memory` binary and user service
4. Linux hosts also install and enable Docker
5. Repo-owned config directories for the selected host
6. Moshi host integration on hosts that include the `moshi` config target: installs the pinned `moshi-hook`, allows inbound Tailscale connections, exposes Herdr at `~/.local/bin/herdr` for SSH probes, opens the Tailscale mosh UDP range with UFW, refreshes hooks for installed/configured agents, and starts the `moshi-hook` user service after pairing
7. Herdr integrations for installed/configured agents, with the Pi integration loaded from the pinned repository-generated extension
8. Agent hook dependencies from `configs/agents/hooks`
9. Agent code review tools from `configs/agents/bin/install-cr-tools.sh`
10. Claude Code / Codex ai-memory MCP and lifecycle hooks merged into the rendered agent configs. Pi uses the vendored `ai-memory-pi.ts` extension; do not run `ai-memory install-hooks --agent pi --apply`

The setup is intended to be idempotent and non-destructive. Existing unrelated paths are warned about and left in place instead of being overwritten.

## Verification

Run the Bash checks after changing the setup code:

```bash
bash -n setup.sh install/*.sh install/hosts/*.sh
shellcheck setup.sh install/*.sh install/hosts/*.sh
bash tests/moshi.test.sh
bash tests/flatpak.test.sh
./setup.sh dev --dry-run
./setup.sh omarchy --dry-run
./setup.sh macbook --dry-run
```

For repo-owned config deployment, verify the symlink targets after a real setup:

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
ls -la ~/.pi/agent/extensions/ai-memory-pi.ts
grep -n 'ai-memory' ~/.claude/settings.json ~/.codex/config.toml ~/.codex/hooks.json
```

Independent clones of one repo still get different project names unless that repo contains `.ai-memory.toml` with a fixed `project`. Example for four `background-coding-agent` checkouts:

```toml
workspace = "meistrari"
project = "background-coding-agent"
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
