#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

clone_repo_if_missing() {
  local repo_url="$1"
  local target_dir="$2"
  local label="$3"

  if [[ -d "$target_dir" ]]; then
    log_item "$label: installed"
    return 0
  fi

  ensure_dir "$(dirname "$target_dir")"
  log_item "Installing $label..."
  run_cmd git clone --depth=1 "$repo_url" "$target_dir"
}

install_shell_dependencies() {
  log_section "Shell Dependencies"

  clone_repo_if_missing "https://github.com/ohmyzsh/ohmyzsh.git" "$HOME/.oh-my-zsh" "Oh My Zsh"
  clone_repo_if_missing "https://github.com/zsh-users/zsh-autosuggestions.git" "$HOME/.oh-my-zsh/custom/plugins/zsh-autosuggestions" "zsh-autosuggestions"
  clone_repo_if_missing "https://github.com/zsh-users/zsh-syntax-highlighting.git" "$HOME/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting" "zsh-syntax-highlighting"
  clone_repo_if_missing "https://github.com/zsh-users/zsh-history-substring-search.git" "$HOME/.oh-my-zsh/custom/plugins/zsh-history-substring-search" "zsh-history-substring-search"
  clone_repo_if_missing "https://github.com/spaceship-prompt/spaceship-prompt.git" "$HOME/.oh-my-zsh/custom/themes/spaceship-prompt" "spaceship-prompt"

  ensure_dir "$HOME/.oh-my-zsh/custom/themes"
  safe_link_path "$HOME/.oh-my-zsh/custom/themes/spaceship-prompt/spaceship.zsh-theme" "$HOME/.oh-my-zsh/custom/themes/spaceship.zsh-theme" "spaceship theme"
}

apply_shell_files() {
  log_section "Shell Files"

  ensure_dir "$HOME/.config/zsh"
  ensure_dir "$HOME/.local/share/zsh"
  safe_link_path "$REPO_ROOT/configs/shell/zshrc" "$HOME/.config/zsh/.zshrc" "zshrc"
  safe_link_path "$REPO_ROOT/configs/shell/fzf.sh" "$HOME/.config/zsh/fzf.sh" "fzf shell config"
  safe_link_path "$REPO_ROOT/configs/shell/prompt.sh" "$HOME/.config/zsh/prompt.sh" "prompt config"
  safe_link_path "$REPO_ROOT/configs/shell/zshenv" "$HOME/.zshenv" "zshenv"
}

apply_shell_setup() {
  apply_shell_files
  install_shell_dependencies

  log_section "Shell Configuration"
  set_default_shell zsh
}
