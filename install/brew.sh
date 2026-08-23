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

upgrade_brew_casks_to_latest() {
  local -a packages=("$@")
  local -a installed_packages=()
  local -a failed_packages=()
  local brew_bin=""
  local package=""
  local upgrade_log=""

  if [[ ${#packages[@]} -eq 0 ]]; then
    return 0
  fi

  log_section "Homebrew Cask Upgrades"

  if (( ${DRY_RUN:-0} )); then
    run_brew update
    run_brew upgrade --cask --greedy "${packages[@]}"
    return 0
  fi

  if ! brew_bin="$(resolve_brew_bin 2>/dev/null)"; then
    log_item "Skipping: Homebrew not installed"
    return 1
  fi

  for package in "${packages[@]}"; do
    if "$brew_bin" list --cask --versions "$package" >/dev/null 2>&1; then
      installed_packages+=("$package")
    else
      log_item "Skipping upgrade for uninstalled cask: $package"
    fi
  done

  if [[ ${#installed_packages[@]} -eq 0 ]]; then
    return 0
  fi

  log_item "Refreshing Homebrew metadata"
  run_brew update

  for package in "${installed_packages[@]}"; do
    log_item "Upgrading to latest: $package"
    upgrade_log="$(mktemp)"

    if "$brew_bin" upgrade --cask --greedy "$package" 2>&1 | tee "$upgrade_log"; then
      rm -f "$upgrade_log"
      continue
    fi

    if grep -Fq "It seems the App source" "$upgrade_log" && grep -Fq "is not there" "$upgrade_log"; then
      log_item "Repairing missing app artifact for cask: $package"
      if run_brew reinstall --cask "$package"; then
        rm -f "$upgrade_log"
        continue
      fi
    fi

    rm -f "$upgrade_log"
    log_item "WARNING: failed to upgrade cask: $package"
    failed_packages+=("$package")
  done

  if [[ ${#failed_packages[@]} -gt 0 ]]; then
    log_item "WARNING: cask upgrades needing manual attention: ${failed_packages[*]}"
    return 1
  fi
}

install_brew_casks() {
  local -a packages=("$@")
  local -a pending_packages=()
  local -a failed_casks=()
  local brew_bin=""
  local package=""

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

  if (( ${DRY_RUN:-0} )); then
    log_item "Installing: ${packages[*]}"
    run_brew install --cask --adopt "${packages[@]}"
    return 0
  fi

  brew_bin="$(resolve_brew_bin)"

  for package in "${packages[@]}"; do
    if "$brew_bin" list --cask --versions "$package" >/dev/null 2>&1; then
      log_item "Already installed: $package"
      continue
    fi

    pending_packages+=("$package")
  done

  if [[ ${#pending_packages[@]} -eq 0 ]]; then
    log_item "Homebrew casks: already installed"
    return 0
  fi

  # Apps already sitting in /Applications were installed manually (drag-and-drop),
  # so brew won't overwrite them by default. --adopt brings a matching install
  # under brew management in place; when the manual copy differs from the cask
  # version, fall back to --force to overwrite and take ownership.
  for package in "${pending_packages[@]}"; do
    log_item "Installing/adopting: $package"

    if run_brew install --cask --adopt "$package"; then
      continue
    fi

    log_item "Adopt failed for $package; retrying with --force"
    if run_brew install --cask --force "$package"; then
      continue
    fi

    log_item "WARNING: failed to install cask: $package"
    failed_casks+=("$package")
  done

  if [[ ${#failed_casks[@]} -gt 0 ]]; then
    log_item "WARNING: casks needing manual attention: ${failed_casks[*]}"
  fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_homebrew
  install_common_brew_formulae
  install_brew_casks "${BREW_CASKS[@]}"
fi
