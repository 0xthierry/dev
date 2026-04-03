#!/usr/bin/env bash
# Install Homebrew and desktop apps via casks (macOS)
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/packages/common.sh"

# Desktop apps (casks)
BREW_CASKS=(
  slack
  spotify
  obsidian
  signal
  obs
  orbstack
)

resolve_brew_bin() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return 0
  fi

  if [[ -x /opt/homebrew/bin/brew ]]; then
    printf '%s\n' /opt/homebrew/bin/brew
    return 0
  fi

  if [[ -x /usr/local/bin/brew ]]; then
    printf '%s\n' /usr/local/bin/brew
    return 0
  fi

  return 1
}

run_brew() {
  local brew_bin=""

  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd brew "$@"
    return 0
  fi

  brew_bin="$(resolve_brew_bin)"
  run_cmd "$brew_bin" "$@"
}

install_homebrew() {
  local install_script='curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | /bin/bash'
  local brew_bin=""

  log_section "Homebrew"

  if brew_bin="$(resolve_brew_bin 2>/dev/null)"; then
    log_item "Homebrew: installed"
    return 0
  fi

  log_item "Installing Homebrew..."
  run_cmd /bin/bash -lc "$install_script"

  if (( ${DRY_RUN:-0} )); then
    return 0
  fi

  brew_bin="$(resolve_brew_bin)"
  eval "$("$brew_bin" shellenv)"
}

install_brew_formulae() {
  local -a packages=("$@")

  if [[ ${#packages[@]} -eq 0 ]]; then
    return 0
  fi

  if ! (( ${DRY_RUN:-0} )) && ! resolve_brew_bin >/dev/null 2>&1; then
    log_item "Skipping: Homebrew not installed"
    return 0
  fi

  log_item "Installing formulae: ${packages[*]}"
  run_brew install "${packages[@]}"
}

install_common_brew_formulae() {
  log_section "Shared CLI Packages (brew)"
  install_brew_formulae "${COMMON_BREW_FORMULAE[@]}"
}

install_brew_casks() {
  local -a packages=("$@")

  if [[ ${#packages[@]} -eq 0 ]]; then
    packages=("${BREW_CASKS[@]}")
  fi

  if [[ ${#packages[@]} -eq 0 ]]; then
    return 0
  fi

  log_section "Homebrew Casks"

  if ! (( ${DRY_RUN:-0} )) && ! resolve_brew_bin >/dev/null 2>&1; then
    log_item "Skipping: Homebrew not installed"
    return 1
  fi

  log_item "Installing: ${packages[*]}"
  run_brew install --cask "${packages[@]}"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_homebrew
  install_common_brew_formulae
  install_brew_casks "${BREW_CASKS[@]}"
fi
