#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

write_git_files() {
  local config_dir="$HOME/.config/dev-setup"
  local gitconfig_path="$config_dir/gitconfig"
  local gitignore_path="$config_dir/gitignore"
  local tmp_config=""
  local tmp_ignore=""

  log_section "Git Configuration"
  ensure_dir "$config_dir"

  tmp_config="$(mktemp)"
  cat > "$tmp_config" <<EOF
[user]
	name = Thierry Santos
	email = thierrysantoos123@gmail.com
[alias]
	co = checkout
	br = branch
	ci = commit
	st = status
[init]
	defaultBranch = main
[pull]
	rebase = true
[push]
	autoSetupRemote = true
[diff]
	algorithm = histogram
	colorMoved = plain
	mnemonicPrefix = true
[commit]
	verbose = true
[rerere]
	enabled = true
	autoupdate = true
[branch]
	sort = -committerdate
[tag]
	sort = -version:refname
[column]
	ui = auto
[worktree]
	useRelativePaths = true
[core]
	editor = nvim
	excludesfile = $gitignore_path
[include]
	path = $HOME/.config/delta/config
EOF
  write_if_changed "$tmp_config" "$gitconfig_path"

  tmp_ignore="$(mktemp)"
  cat > "$tmp_ignore" <<'EOF'
**/.claude/settings.local.json
.DS_Store
*~
*.swp
.idea/
.vscode/
result
result-*
EOF
  write_if_changed "$tmp_ignore" "$gitignore_path"

  ensure_git_include "$gitconfig_path"

  if (( ${DRY_RUN:-0} )); then
    log_item "Git LFS install would run if available"
  elif command -v git-lfs >/dev/null 2>&1; then
    run_cmd git lfs install --skip-repo
  fi
}

ensure_git_include() {
  local include_path="$1"
  local global_config="$HOME/.gitconfig"
  local tmp=""

  if [[ -f "$global_config" ]] && grep -Fq "$include_path" "$global_config"; then
    log_item "Git include: already configured"
    return 0
  fi

  tmp="$(mktemp)"
  if [[ -f "$global_config" ]]; then
    cat "$global_config" > "$tmp"
    printf '\n' >> "$tmp"
  fi

  printf '[include]\n\tpath = %s\n' "$include_path" >> "$tmp"
  write_if_changed "$tmp" "$global_config"
  log_item "Git include: $global_config"
}
