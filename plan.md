# Pre-Format Readiness Plan

Everything that needs to change before formatting omarchy and rebuilding from this repo.

---

## 1. Sync Claude config (live → repo)

Live (`~/.claude`) is always the source of truth. Copy live → repo for everything.

### 1.1 settings.json — copy live to repo

Copy `~/.claude/settings.json` → `configs/claude/settings.json`. Live version has:
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS: "128000"`
- `model: "opus"`
- `statusLine` config block
- `claude-sonnet-4-5` model env vars
- No quality-gate hook (was in repo but not deployed to live)

The quality-gate hook that existed only in repo gets dropped — if it's not running live, it's not the source of truth.

### 1.2 Copy files only in live (not tracked in repo)

| File | Why |
|------|-----|
| `USER.md` | User identity doc, referenced by context-injection |
| `statusline.ts` | Referenced by live settings.json statusLine config |
| `skills/agent-browser/` | Entire skill directory |
| `skills/writing-plans-v2/` | Entire skill directory |
| `skills/dogfood/` | Entire skill directory |
| `skills/skill-creator/SKILL.md` | Updated skill (repo version is outdated) |
| `skills/skill-creator/references/output-patterns.md` | Missing reference file |
| `skills/skill-creator/references/workflows.md` | Missing reference file |
| `skills/skill-creator/scripts/` | 3 Python scripts |
| `skills/asking-oracle/references/` | Mode-specific prompts (code, general, plan-review) |

### 1.3 Update files where live is ahead of repo

| File | What changed |
|------|-------------|
| `agents/oracle.md` | GPT-5.3, session resume, critical evaluation, codex exec directly |
| `skills/asking-oracle/SKILL.md` | GPT-5.3, session resume, mode tables |
| `skills/linear/SKILL.md` | context: fork, model: sonnet, expanded API descriptions |
| `skills/linear/issues.ts` | state/projectMilestone fields, resolution by name |
| `skills/linear/projects.ts` | Team filter, default limit 50 |
| `skills/linear/references/api.md` | Expanded parameter lists, troubleshooting rows |
| `skills/researching-codebase/SKILL.md` | context: fork, model: sonnet metadata |
| `skills/reviewing-code/SKILL.md` | context: fork metadata |
| `skills/reviewing-plan/SKILL.md` | GPT-5.3, session resume for re-review |
| `bin/index-skills.ts` | Handles symlinks (isSymbolicLink check) |

### 1.4 Copy live versions (live is source of truth even when repo was "ahead")

| File | What to do |
|------|-----------|
| `CLAUDE.md` | Copy live → repo. Live is what's running. |
| `hooks/context-injection/index.ts` | Copy live → repo. Repo had SOUL.md injection but it was never deployed. |

### 1.5 Delete from repo (dead code)

| File | Why |
|------|-----|
| `bin/openai` | Never deployed to live, oracle.md now uses `codex exec` directly |

---

## 2. Sync Nvim config (live → repo)

### 2.1 Update lazy-lock.json

Copy `~/.config/nvim/lazy-lock.json` → `configs/nvim/lazy-lock.json`. Live has newer plugin versions. Also adds missing `catppuccin` and removes `tokyonight.nvim` (theme changed).

No other nvim files differ (init.lua and all plugin configs are identical).

---

## 3. Sync Zsh config (live → zsh.nix)

Live `~/.zshrc` is the source of truth. Home Manager has never been applied, so when it is, its generated `.zshrc` replaces the live one. `common/zsh.nix` must capture everything from live.

### 3.1 Add missing live features to zsh.nix

**`omz_termsupport_preexec` function** — custom terminal title that shows folder name during command execution. ~30 lines in live `.zshrc`. Add to `initContent` in zsh.nix.

**`~/.secrets` sourcing** — live has `[[ -f ~/.secrets ]] && source ~/.secrets`. Add to `initContent`.

**SSH-aware EDITOR** — live switches to `vim` over SSH connections. Add to `initContent`:
```
if [[ -n $SSH_CONNECTION ]]; then
  export EDITOR='vim'
else
  export EDITOR='nvim'
fi
```

### 3.2 Keep zsh.nix additions not in live

These are improvements in zsh.nix that live doesn't have — safe to keep since they add functionality without breaking anything:

- Extra aliases: `ll`, `la`, `lt`, `g` (git), `..`, `...`, `....`
- `mkcd()` function
- History substring search
- XDG-compliant zsh config directory
- `envExtra` TERM fallback for ghostty

### 3.3 Remove from zsh.nix

- `/opt/homebrew` PATH entries — only needed on macOS, and macbook host can add it. Clutters Linux shell.

---

## 4. Nix config fixes

### 4.1 Move cli-tools.nix import to home.nix

Currently each host imports `../common/cli-tools.nix` independently. Move it to `home.nix` alongside git, zsh, mise, neovim to prevent forgetting it on new hosts.

**Change:** `home.nix` — add `./common/cli-tools.nix` to imports
**Change:** `hosts/omarchy.nix`, `hosts/dev.nix`, `hosts/macbook.nix` — remove `../common/cli-tools.nix` from imports

### 4.2 Remove redundant neovim declaration on omarchy

`hosts/omarchy.nix:30-33` declares `programs.neovim` again, but `common/neovim.nix` (imported via home.nix) already enables it. Remove the duplicate.

### 4.3 Fix mise aws plugin name

`common/mise.nix:17` uses `"aws-cli"` but live system uses `"aws"` as the mise plugin name. Change to match what actually works.

---

## 5. Bootstrap fixes

### 5.1 Make AUR helper failure non-fatal

`install/pacman.sh:44` — change `return 1` to `return 0`. With `set -e`, returning 1 kills the entire bootstrap before Nix even installs. Print a warning instead.

### 5.2 Clean up AUR_PACKAGES (remove Omarchy defaults)

These are already installed by Omarchy and don't need to be in the AUR list:
- ~~spotify~~ (Omarchy default)
- ~~obsidian~~ (Omarchy default)
- ~~signal-desktop~~ (Omarchy default)
- ~~obs-studio~~ (Omarchy default)

Keep: `ollama-rocm`, `slack-desktop`

### 5.3 Add non-default apps to pacman.sh

Apps the user has installed that are NOT shipped by Omarchy:

**Desktop apps (AUR):**
- `beekeeper-studio-bin` — DB GUI
- `cursor-bin` — AI editor
- `google-chrome` — browser (Omarchy ships chromium, not chrome)
- `kavita-bin` — book server

**Desktop apps (pacman):**
- `bitwarden` — password manager
- `dbeaver` — DB GUI

**Gaming stack (AUR/pacman):**
- `steam`
- `lutris`
- `gamescope`
- `gamemode`, `lib32-gamemode`
- `proton-ge-custom-bin`
- `protontricks`
- `mangohud`, `lib32-mangohud`

**System tools (pacman):**
- `tailscale` — VPN
- `ngrok` — tunneling
- `valkey` — Redis fork
- `tmux` — multiplexer
- `docker-buildx` — Docker build extensions
- `docker-compose` — Docker compose

**Printing (pacman):**
- `cups`, `cups-browsed`, `cups-filters`, `cups-pdf`

**Firewall (pacman):**
- `ufw`, `ufw-docker`

### 5.4 Restructure pacman.sh

Split the current monolithic arrays into categorized groups:
- GPU_PACKAGES (keep as-is)
- AUR_PACKAGES (cleaned up + new apps)
- DESKTOP_PACKAGES (new: pacman desktop apps)
- GAMING_PACKAGES (new: steam + friends)
- SYSTEM_PACKAGES (new: docker-compose, tailscale, fonts, etc.)

### 5.5 AI CLIs: claude-code is now a pacman package

`install/ai-cli.sh:10-11` installs Claude via `curl | bash`, but the user has `claude-code 2.1.56-1` from pacman. Move claude-code to pacman.sh and remove curl install from ai-cli.sh. Keep codex/gemini/opencode in ai-cli.sh (opencode is also pacman on Omarchy, so may also move).

---

## 6. Documentation

### 6.1 Create INSTALL.md

Fresh install runbook with exact steps:

```
1. Install Omarchy (this gives you: yay, git, base system)
2. Set up 1Password + SSH agent
3. git clone git@github.com:0xthierry/dev.git ~/dev
4. cd ~/dev && ./bootstrap.sh omarchy
5. Restart shell (exec zsh)
6. Verify: home-manager --version, mise current, nvim --version
```

### 6.2 Document 1Password/SSH setup

The bootstrap requires SSH to clone repos, but SSH keys come from 1Password. Document the chicken-and-egg solution (1Password is an Omarchy default, so it's available pre-bootstrap).

---

## 7. Decisions (resolved)

1. **Zellij**: Nix only. Remove from pacman.sh system tools list.
2. **Gaming stack**: Include in pacman.sh.
3. **Printing stack (cups)**: Include in pacman.sh.
4. **Fonts**: Skip — likely handled by Omarchy.
5. **tmux**: Keep installed (in pacman.sh system tools).
6. **valkey**: Include in pacman.sh.
7. ~~**Claude model env vars**~~ — resolved: live is source of truth, `claude-sonnet-4-5` wins.

---

## Order of execution

1. Sync Claude config (section 1)
2. Sync Nvim config (section 2)
3. Sync Zsh config (section 3)
4. Nix config fixes (section 4)
5. Bootstrap fixes (section 5)
6. Documentation (section 6)
7. Run `nix flake check` to validate
8. Commit
