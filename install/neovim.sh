#!/usr/bin/env bash
# Install pinned Neovim release from GitHub (Linux only; macOS uses Brew)
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

NEOVIM_INSTALL_DIR="/usr/local"

installed_nvim_version() {
  local version_line
  version_line="$(nvim --version 2>/dev/null | head -1)" || return 1
  # "NVIM v0.12.1" -> "0.12.1"
  printf '%s\n' "${version_line#NVIM v}"
}

install_neovim() {
  log_section "Neovim (pinned v${NEOVIM_VERSION})"

  local current_version
  if current_version="$(installed_nvim_version 2>/dev/null)"; then
    if [[ "$current_version" == "$NEOVIM_VERSION" ]]; then
      log_item "neovim $NEOVIM_VERSION: already installed"
      return 0
    fi
    log_item "neovim: upgrading $current_version -> $NEOVIM_VERSION"
  fi

  local arch
  arch="$(uname -m)"
  local tarball="nvim-linux-${arch}.tar.gz"
  local url="https://github.com/neovim/neovim/releases/download/v${NEOVIM_VERSION}/${tarball}"
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  log_item "Downloading $url"
  run_cmd curl -fSL -o "$tmp_dir/$tarball" "$url"
  run_cmd tar xzf "$tmp_dir/$tarball" -C "$tmp_dir"

  local extracted_dir="$tmp_dir/nvim-linux-${arch}"
  log_item "Installing to $NEOVIM_INSTALL_DIR"
  run_cmd sudo cp -rf "$extracted_dir"/bin/* "$NEOVIM_INSTALL_DIR/bin/"
  run_cmd sudo cp -rf "$extracted_dir"/lib/* "$NEOVIM_INSTALL_DIR/lib/"
  run_cmd sudo cp -rf "$extracted_dir"/share/* "$NEOVIM_INSTALL_DIR/share/"

  rm -rf "$tmp_dir"
  log_item "neovim $NEOVIM_VERSION: installed"
}
