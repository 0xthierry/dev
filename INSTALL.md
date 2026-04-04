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

### `omarchy`

- Linux desktop setup
- Installs the shared CLI layer through `pacman`
- Applies `nvim`, `zellij`, `hypr`, and `agents`

### `macbook`

- macOS setup
- Installs the shared CLI layer through Homebrew
- Uses OrbStack as the container engine and installs the `docker` CLI through Homebrew
- Applies `nvim`, `zellij`, and `agents`

## What Setup Applies

`./setup.sh <host>` applies the Bash-managed machine state in this order:

1. Shared CLI packages for the selected host
2. Shared CLI tool config under `configs/cli/`
3. Shared env, shell, git, SSH, `mise`, and AI CLI setup
4. Linux hosts also install and enable Docker
5. Repo-owned config directories for the selected host
6. Agent hook dependencies from `configs/agents/hooks`
7. Agent code review tools from `configs/agents/bin/install-cr-tools.sh`

The setup is intended to be idempotent and non-destructive. Existing unrelated paths are warned about and left in place instead of being overwritten.

## Verification

Run the Bash checks after changing the setup code:

```bash
bash -n setup.sh install/*.sh install/hosts/*.sh
shellcheck setup.sh install/*.sh install/hosts/*.sh
./setup.sh dev --dry-run
./setup.sh omarchy --dry-run
./setup.sh macbook --dry-run
```

For repo-owned config deployment, verify the symlink targets after a real setup:

```bash
ls -la ~/.config/nvim
ls -la ~/.config/zellij
ls -la ~/.config/hypr
ls -la ~/.config/zsh
```

For the agent setup, verify:

```bash
ls -la ~/.codex
ls -la ~/.claude
```

## Troubleshooting

If a dry-run shows warnings about an existing path, setup is intentionally refusing to replace that path automatically. Inspect it and decide whether to move it aside manually.

If Homebrew or `pacman` is missing, the host package step cannot complete. Install the platform package manager first, then rerun `./setup.sh <host>`.
