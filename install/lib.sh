#!/usr/bin/env bash
# Shared functions for install scripts

log_section() {
  echo ""
  echo "=== $1 ==="
}

log_item() {
  echo "  $1"
}

check_installed() {
  command -v "$1" &> /dev/null
}

install_if_missing() {
  local name="$1"
  local cmd="$2"
  local install_cmd="$3"

  if check_installed "$cmd"; then
    log_item "$name: installed"
    return 0
  else
    log_item "Installing $name..."
    eval "$install_cmd"
  fi
}

get_aur_helper() {
  if command -v paru &> /dev/null; then
    echo "paru"
  elif command -v yay &> /dev/null; then
    echo "yay"
  else
    echo ""
  fi
}

set_default_shell() {
  local target_shell="$1"
  local shell_path
  shell_path=$(which "$target_shell" 2>/dev/null)

  if [ -z "$shell_path" ]; then
    log_item "Shell $target_shell not found, skipping"
    return 1
  fi

  if [ "$SHELL" = "$shell_path" ]; then
    log_item "Default shell: already $target_shell"
    return 0
  fi

  # Add to /etc/shells if not already listed (required for chsh)
  if ! grep -qx "$shell_path" /etc/shells 2>/dev/null; then
    log_item "Adding $shell_path to /etc/shells..."
    echo "$shell_path" | sudo tee -a /etc/shells > /dev/null
  fi

  log_item "Setting default shell to $target_shell..."
  chsh -s "$shell_path"
}
