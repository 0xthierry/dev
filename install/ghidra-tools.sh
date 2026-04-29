#!/usr/bin/env bash
# Install reverse engineering tools used by the ghidra-cli agent skills.
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

GHIDRA_CLI_REPO_URL="https://github.com/akiselev/ghidra-cli.git"
GHIDRA_CLI_VERSION="v0.1.10"
GHIDRA_CLI_SOURCE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ghidra-cli/source"
GHIDRA_VERSION="12.0.4"

export PATH="$HOME/.cargo/bin:$PATH"

has_working_java() {
  command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1
}

has_working_dotnet() {
  command -v dotnet >/dev/null 2>&1 && dotnet --info >/dev/null 2>&1
}

is_ghidra_cli_installed() {
  command -v ghidra >/dev/null 2>&1 && ghidra --version 2>/dev/null | grep -qi 'ghidra-cli'
}

is_ilspy_cli_installed() {
  command -v ilspy >/dev/null 2>&1 && ilspy --version 2>/dev/null | grep -qi 'ilspy-cli'
}

sync_ghidra_cli_source() {
  if [[ -d "$GHIDRA_CLI_SOURCE_DIR/.git" ]]; then
    log_item "Checking out ghidra-cli $GHIDRA_CLI_VERSION"
    run_cmd git -C "$GHIDRA_CLI_SOURCE_DIR" fetch --depth=1 origin "refs/tags/$GHIDRA_CLI_VERSION:refs/tags/$GHIDRA_CLI_VERSION"
    run_cmd git -C "$GHIDRA_CLI_SOURCE_DIR" checkout --detach "$GHIDRA_CLI_VERSION"
    return 0
  fi

  if [[ -e "$GHIDRA_CLI_SOURCE_DIR" ]]; then
    printf 'warning: ghidra-cli source path exists but is not a git checkout: %s\n' "$GHIDRA_CLI_SOURCE_DIR" >&2
    return 1
  fi

  ensure_dir "$(dirname "$GHIDRA_CLI_SOURCE_DIR")"
  log_item "Cloning ghidra-cli $GHIDRA_CLI_VERSION"
  run_cmd git clone --depth=1 --branch "$GHIDRA_CLI_VERSION" "$GHIDRA_CLI_REPO_URL" "$GHIDRA_CLI_SOURCE_DIR"
}

install_ghidra_binary() {
  if is_ghidra_cli_installed; then
    log_item "ghidra-cli: installed"
    return 0
  fi

  if ! (( ${DRY_RUN:-0} )) && ! command -v cargo >/dev/null 2>&1; then
    log_item "ghidra-cli: cargo not found, skipping"
    return 0
  fi

  log_item "Installing ghidra-cli"
  run_cmd cargo install --path "$GHIDRA_CLI_SOURCE_DIR" --locked
}

install_ilspy_binary() {
  if is_ilspy_cli_installed; then
    log_item "ilspy-cli: installed"
    return 0
  fi

  if ! (( ${DRY_RUN:-0} )) && ! command -v cargo >/dev/null 2>&1; then
    log_item "ilspy-cli: cargo not found, skipping"
    return 0
  fi

  if ! (( ${DRY_RUN:-0} )) && ! has_working_dotnet; then
    log_item "ilspy-cli: .NET 8 SDK not available yet, skipping"
    return 0
  fi

  log_item "Installing ilspy-cli"
  run_cmd cargo install --path "$GHIDRA_CLI_SOURCE_DIR/ilspy-cli" --locked
}

install_ghidra_runtime() {
  if (( ${DRY_RUN:-0} )); then
    log_item "Installing Ghidra runtime $GHIDRA_VERSION"
    run_cmd ghidra setup --version "$GHIDRA_VERSION"
    return 0
  fi

  if ! is_ghidra_cli_installed; then
    log_item "Ghidra runtime: ghidra-cli not installed yet, skipping"
    return 0
  fi

  if ghidra doctor >/dev/null 2>&1; then
    log_item "Ghidra runtime: configured"
    return 0
  fi

  if ! has_working_java; then
    log_item "Ghidra runtime: Java 17+ not available yet, skipping"
    return 0
  fi

  log_item "Installing Ghidra runtime $GHIDRA_VERSION"
  run_cmd ghidra setup --version "$GHIDRA_VERSION"
}

install_ghidra_cli_tools() {
  log_section "Ghidra CLI Tools"
  sync_ghidra_cli_source
  install_ghidra_binary
  install_ilspy_binary
  install_ghidra_runtime
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_ghidra_cli_tools
fi
