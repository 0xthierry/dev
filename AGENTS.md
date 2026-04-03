# Bash Machine Setup Toolkit

This repo now uses a Bash-first machine setup flow for `dev`, `omarchy`, and `macbook`.

## Structure

```text
setup.sh                  # Primary setup entrypoint
bootstrap.sh              # Compatibility shim to setup.sh
install/setup.sh          # Shared setup orchestration
install/hosts/            # Host-specific setup modules
install/packages/         # Shared package lists
install/*.sh              # Shared installers and deploy helpers
configs/cli/              # CLI tool config fragments
configs/shell/            # Shared shell files
configs/agents/           # Agent config, hooks, and installers
configs/nvim/             # Repo-owned Neovim config
configs/zellij/           # Repo-owned Zellij config
configs/hypr/             # Repo-owned Hyprland config
```

## Key Constraints

- `./setup.sh <host>` is the supported setup path.
- Keep setup idempotent and non-destructive.
- Prefer direct host scripts and small shared helpers over generic registries.
- `configs/agents/install.sh` remains the special-case installer for agent setup.
- SSH keys stay outside the repo-managed setup.

## Testing Changes

```bash
bash -n setup.sh install/*.sh install/hosts/*.sh
shellcheck setup.sh install/*.sh install/hosts/*.sh
./setup.sh dev --dry-run
./setup.sh omarchy --dry-run
./setup.sh macbook --dry-run
```

If you change agent hooks:

```bash
cd configs/agents/hooks
bun test
bun run lint
```

## Common Tasks

| Task | Location |
|---|---|
| Add shared CLI tool | `install/packages/common.sh` |
| Add tool config | `configs/cli/` plus `install/tools.sh` if needed |
| Add shell behavior | `configs/shell/` plus `install/shell.sh` |
| Add shared env var | `install/env.sh` |
| Add host-specific env, SSH, or configs | `install/hosts/{host}.sh` |
| Add repo-owned config deploy | `install/configs.sh` |

## Host Scope

Default to shared setup unless the user names one host explicitly.

| User says | Location | Why |
|---|---|---|
| "add X" / "install X" / "for all hosts" | shared install/config layers | Default shared behavior |
| "on omarchy" / "just on dev" / "only macbook" | `install/hosts/{host}.sh` | Explicit single-host scope |
| Ambiguous host scope | Ask | Prevent accidental cross-host changes |

## Documentation

- `ai_docs/tasks/` contains implementation research, outlines, and plans.
- `configs/agents/` contains the active agent hooks, skills, and installer.
