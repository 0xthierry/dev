# Bash Machine Setup Toolkit

Personal machine setup. One repo, three hosts, one command: `./setup.sh <host>`. Single source of truth for every machine Thierry uses.

## Hosts

| Host | OS | Package Manager | Notes |
|---|---|---|---|
| `macbook` | macOS | Homebrew | Laptop, also installs GUI casks |
| `dev` | Arch Linux | pacman + AUR | Remote dev server, runs Ollama |
| `omarchy` | Arch Linux | pacman + AUR | Desktop, runs Hyprland |

Shared CLI tools, shell, and editor across all three. Host-specific bits live in `install/hosts/{host}.sh`.

## Two-Layer Model

Setup has two independent layers:

- **Packages** — `install/packages/common.sh` plus host arrays (`HOST_BREW_CASKS`, `HOST_PACMAN_PACKAGES`, `HOST_AUR_PACKAGES`). Installed by `install/brew.sh` and `install/pacman.sh`.
- **Configs** — `install/configs.sh` symlinks repo-owned directories into their expected locations. `HOST_CONFIG_TARGETS` picks which configs each host gets.

The two layers don't validate each other. **Most recurring bug:** config deployed (e.g. `EDITOR=nvim`) but the binary missing from the package list. When adding a config target, also add the tool to the package list.

## Config Targets

| Source | Deployed To | Method |
|---|---|---|
| `configs/nvim/` | `~/.config/nvim` | symlink |
| `configs/zellij/` | `~/.config/zellij` | symlink |
| `configs/hypr/` | `~/.config/hypr` | symlink (omarchy only) |
| `configs/shell/` | sourced via `~/.zshrc` / `~/.zshenv` | written by `install/shell.sh` |
| `configs/agents/` | `~/.agents/`, `~/.claude/`, `~/.codex/`, `~/.pi/agent/` | special installer |

**Agent config is special-cased.** `configs/agents/install.sh` renders `AGENTS.md` (replaces `{{HOST_CONFIG}}` with detected hardware) into `~/.agents/AGENTS.md`; symlinks `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` to that rendered file; renders a separate `~/.pi/agent/AGENTS.md` so Pi does not depend on `~/.agents`; symlinks agents/skills/hooks (Codex gets copies with model stripping); syncs `claude-settings.json` into `~/.claude/settings.json`; copies `codex-config.toml`; copies `pi-settings.json` into `~/.pi/agent/settings.json`; links shared `configs/agents/agents` to `~/.pi/agent/agents`; symlinks each shared skill into `~/.pi/agent/skills` without rewriting skill frontmatter; links Pi-owned `configs/agents/pi/{prompts,extensions}` to `~/.pi/agent/{prompts,extensions}`; and links `configs/agents/pi/APPEND_SYSTEM.md` to `~/.pi/agent/APPEND_SYSTEM.md` for Pi-specific appended system instructions. Pi settings exclude `~/.agents`, `~/.claude`, and `~/.codex` resources so Pi only sees repo-managed Pi resources.

## Principles

- **Everything goes through the repo.** Never install packages or edit deployed configs directly (`~/.config/nvim`, `~/.claude/settings.json`, etc.). If a change can't be reproduced by `./setup.sh <host>` on a fresh machine, it doesn't exist.
- **Idempotent and non-destructive.** Setup never deletes user data or removes packages.
- **Shared by default, host-specific by exception.**
- **Declarative package lists.** Add to `install/packages/common.sh` or a host array — never `brew install X` / `pacman -S X` directly.

## Brew vs pacman naming

Names differ between Homebrew and pacman (`tree-sitter-cli` vs `tree-sitter`, `make` vs `gnumake`). Shared tools go in **both** `COMMON_BREW_FORMULAE` and `COMMON_PACMAN_PACKAGES`.

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

Default to shared. Only touch `install/hosts/{host}.sh` when the user names a host.

| User says | Location |
|---|---|
| "add X" / "for all hosts" | shared layers |
| "on omarchy" / "only macbook" | `install/hosts/{host}.sh` |
| Ambiguous | Ask |

## Testing

```bash
bash -n setup.sh install/*.sh install/hosts/*.sh
shellcheck setup.sh install/*.sh install/hosts/*.sh
./setup.sh dev --dry-run
./setup.sh omarchy --dry-run
./setup.sh macbook --dry-run
```

For agent hooks:

```bash
cd configs/agents/hooks
bun test
bun run lint
```

## Workflow

Trunk-based — commits go directly to `main`. Conventional commit messages (`feat(scope):`, `fix(scope):`). No PRs, no CI; pre-commit hook runs `bash -n`.
