# Bash Machine Setup Toolkit

## What This Is

A personal machine setup toolkit that bootstraps Thierry's development machines from a clean OS to a fully configured working environment. One repo, three hosts, one command: `./setup.sh <host>`.

## Why It Exists

Thierry works across multiple machines — a MacBook (macOS/Homebrew), a dev server (Arch Linux/pacman), and an omarchy desktop (Arch Linux/pacman). Rather than manually remembering what to install and configure on each, this repo is the single source of truth. Run setup on a fresh machine and everything appears: CLI tools, shell config, editor setup, AI agent configuration, SSH, git, and work directories.

The repo has evolved from earlier approaches into a Bash-first design. No Ansible, no Nix, no abstraction frameworks — just shell scripts that are easy to read, debug, and extend.

## Hosts

| Host | OS | Package Manager | Notes |
|---|---|---|---|
| `macbook` | macOS | Homebrew | Primary laptop, also installs GUI apps (casks) |
| `dev` | Arch Linux | pacman + AUR | Remote dev server, runs Ollama |
| `omarchy` | Arch Linux | pacman + AUR | Desktop, runs Hyprland (tiling WM) |

All three share the same CLI tool set, shell config, and editor setup. Host-specific differences (GUI apps, SSH keys, Hyprland config, environment variables) live in `install/hosts/{host}.sh`.

## Architecture

Setup runs as a pipeline of phases. Each host module overrides these hooks from `install/hosts/common.sh`:

```
setup_host_prereqs     -> Host-specific prerequisites
setup_host_packages    -> Package installation (shared + host-specific)
setup_shared_machine_state -> Config deploy, env, shell, git, SSH, runtimes, AI CLIs
setup_host_machine_state   -> Host config targets (nvim, zellij, hypr, agents), work dirs
setup_post_host_state      -> Repo cloning, git hooks, agent review tools
```

Two separate layers do the real work:
- **Package installation** — `install/packages/common.sh` defines shared tool lists. `install/brew.sh` and `install/pacman.sh` install them on the respective platforms. Host modules add extras via `HOST_BREW_CASKS`, `HOST_PACMAN_PACKAGES`, `HOST_AUR_PACKAGES`.
- **Config deployment** — `install/configs.sh` symlinks repo-owned config directories into their expected locations. `HOST_CONFIG_TARGETS` controls which configs a host gets.

### Config Deployment Targets

| Source | Deployed To | Method | Hosts |
|---|---|---|---|
| `configs/nvim/` | `~/.config/nvim` | symlink | macbook, dev, omarchy |
| `configs/zellij/` | `~/.config/zellij` | symlink | macbook, dev, omarchy |
| `configs/hypr/` | `~/.config/hypr` | symlink | omarchy only |
| `configs/shell/` | sourced via `~/.zshrc` / `~/.zshenv` | written by `install/shell.sh` | all |
| `configs/agents/` | `~/.agents/`, `~/.claude/`, `~/.codex/` | special installer (see below) | macbook, dev, omarchy |

The agents installer (`configs/agents/install.sh`) is more complex than the others. It deploys to three targets:

| Source | Target | Method |
|---|---|---|
| `configs/agents/agents/` | `~/.agents/agents/`, `~/.claude/agents/`, `~/.codex/agents/` | symlink (`.claude`/`.agents`), copy with model stripping (`.codex`) |
| `configs/agents/skills/` | `~/.agents/skills/`, `~/.claude/skills/`, `~/.codex/skills/` | symlink |
| `configs/agents/hooks/` | `~/.agents/hooks/`, `~/.claude/hooks/` | symlink |
| `configs/agents/AGENTS.md` | `~/.agents/AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` | rendered (replaces `{{HOST_CONFIG}}` with detected hardware info) |
| `configs/agents/USER.md` | `~/.agents/USER.md`, `~/.claude/USER.md` | symlink |
| `configs/agents/claude-settings.json` | `~/.claude/settings.json` | `jq` recursive merge (preserves local keys) |
| `configs/agents/codex-config.toml` | `~/.codex/config.toml` | copy |
| `configs/agents/statusline.ts` | `~/.agents/statusline.ts` | symlink |

These layers are deliberately independent. A host can deploy a config without installing the backing tool, or install a tool without deploying config. This separation is intentional but is also the source of the most common class of bugs (see below).

## Design Principles

**Everything goes through the repo.** This is the most important principle. The repo is the single source of truth for every machine. Never install packages directly, never edit deployed config files in-place (e.g., `~/.config/nvim/init.lua` or `~/.claude/settings.json`), never configure tools outside the project scripts. Always make changes here in the repo, then let setup deploy them. If a change can't be reproduced by running `./setup.sh <host>` on a fresh machine, it doesn't exist.

**Idempotent and non-destructive.** Running setup twice produces the same result. Setup never deletes user data, overwrites local customizations outside its managed paths, or removes packages.

**Shared by default, host-specific by exception.** Tools, shell config, and editor setup go in shared layers. Only put something in a host module when it genuinely varies per machine.

**Declarative package lists, not imperative installs.** Never `brew install X` or `pacman -S X` directly in a session. Add it to the package list in `install/packages/common.sh` (or host arrays) so every machine gets it on next setup run.

**Simple bash over clever abstractions.** Each installer is a small, focused script. No plugin systems, no registration, no dynamic dispatch beyond the host module pattern.

## Known Pitfalls

**Config without binary.** The most recurring bug class: a config is deployed (nvim config symlinked, `EDITOR=nvim` set) but the binary itself isn't in the package list. The two layers don't validate each other. If you add a config target, also ensure the tool is in the package list.

**Brew vs pacman naming.** Package names differ between Homebrew and pacman. When adding a shared tool, you need to add it to both `COMMON_BREW_FORMULAE` and `COMMON_PACMAN_PACKAGES` in `install/packages/common.sh`, and the names may not match (e.g., `tree-sitter-cli` on Brew vs `tree-sitter` on pacman, `make` on Brew vs `gnumake` on pacman).

**Agent config is special-cased.** `configs/agents/install.sh` has its own installer that renders templates, detects host config dynamically, and manages symlinks. It doesn't follow the simple symlink pattern of other configs. The `configs/agents/AGENTS.md` is a template with a `{{HOST_CONFIG}}` placeholder that gets replaced at install time.

## The Agent Layer

`configs/agents/` is the most actively evolving part of the repo. It manages:
- Claude Code settings (`claude-settings.json`) — merged into the user's settings via `jq` recursive merge, preserving local keys
- Claude Code hooks and skills — deployed to `~/.agents/`
- Codex configuration (`codex-config.toml`)
- A statusline script (`statusline.ts`)
- A global `AGENTS.md` template rendered with host-specific hardware info

The merge-not-replace strategy for settings is important: the installer applies canonical values from the repo but doesn't clobber locally-added keys.

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

## Workflow

This is a personal repo with a trunk-based workflow. Commits go directly to `main`. Conventional commit messages are used (`feat(scope):`, `fix(scope):`). There are no PRs, no CI — the pre-commit hook runs `bash -n` syntax checks on shell scripts.
