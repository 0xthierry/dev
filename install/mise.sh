#!/usr/bin/env bash
# Install mise language runtimes
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

write_mise_config() {
  local config_path="$HOME/.config/mise/config.toml"
  local tmp=""

  log_section "Mise Configuration"
  ensure_dir "$(dirname "$config_path")"

  tmp="$(mktemp)"
  cat > "$tmp" <<'EOF'
[tools]
node = "25.2.0"
python = "3.12"
go = "latest"
bun = "latest"
rust = "latest"
zig = "latest"
aws = "latest"

[settings]
experimental = false
verbose = false
not_found_auto_install = true
trusted_config_paths = ["~/Work"]
EOF
  write_if_changed "$tmp" "$config_path"
  log_item "Mise config: $config_path"
}

install_runtimes() {
  log_section "Mise Runtimes"
  write_mise_config

  if ! (( ${DRY_RUN:-0} )) && ! command -v mise &> /dev/null; then
    log_item "Mise not installed, skipping runtimes"
    return 0
  fi

  log_item "Installing language runtimes..."
  run_cmd mise install

  log_item "Activating mise shims..."
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd /bin/bash -lc "eval \"\$(mise activate bash)\""
  else
    eval "$(mise activate bash)"
  fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_runtimes
fi
