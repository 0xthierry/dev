#!/usr/bin/env bash
# Install Homebrew and desktop apps via casks (macOS)
set -e
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Desktop apps (casks)
BREW_CASKS=(
  slack
  spotify
  obsidian
  signal
  obs
  orbstack
)

install_homebrew() {
  log_section "Homebrew"

  if check_installed brew; then
    log_item "Homebrew: installed"
    return 0
  fi

  log_item "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
}

install_brew_casks() {
  log_section "Homebrew Casks"

  if ! check_installed brew; then
    log_item "Skipping: Homebrew not installed"
    return 1
  fi

  log_item "Installing: ${BREW_CASKS[*]}"
  brew install --cask "${BREW_CASKS[@]}"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_homebrew
  install_brew_casks
fi
