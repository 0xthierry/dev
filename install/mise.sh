#!/usr/bin/env bash
# Install mise language runtimes
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

write_mise_config() {
  local config_path="$HOME/.config/mise/config.toml"
  local tmp=""

  log_section "Mise Configuration"
  # Persist the opt-out before replacing our baseline, preserving existing
  # disabled tools in the separate global override.
  # shellcheck source=install/retired-ai-tools.sh
  source "$(dirname "${BASH_SOURCE[0]}")/retired-ai-tools.sh"
  if (( ${DRY_RUN:-0} )) || resolve_mise_bin >/dev/null 2>&1; then
    disable_retired_ai_tools
  else
    log_item "Mise unavailable; retired AI tool opt-out deferred until mise is installed"
  fi
  ensure_dir "$(dirname "$config_path")"

  tmp="$(mktemp)"
  cat > "$tmp" <<'EOF'
[tools]
node = "latest"
"npm:@earendil-works/pi-coding-agent" = "1.2.0"
pnpm = "latest"
python = "3.12"
go = "latest"
bun = "latest"
rust = "latest"
java = "temurin-17.0.19+10"
dotnet = "8.0.420"
zig = "latest"
aws = "latest"
"github:herdrdev/herdr" = "0.9.5"

[settings]
experimental = false
verbose = false
not_found_auto_install = true
trusted_config_paths = ["~/Work"]
EOF
  write_if_changed "$tmp" "$config_path"
  log_item "Mise config: $config_path"
}

repair_legacy_bun_link() {
  local link="$HOME/bin/bun" shim="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}/shims/bun"
  # Only migrate the observed legacy link. Leave custom launchers and fresh homes alone.
  [[ -L "$link" && "$(readlink "$link")" == "$HOME/.local/share/mise/installs/bun/1.3.2/bin/bun" ]] || return 0
  if (( ! ${DRY_RUN:-0} )) && [[ ! -x "$shim" ]]; then
    printf 'Cannot repair %s: mise Bun shim is missing at %s\n' "$link" "$shim" >&2
    return 1
  fi
  run_cmd cp -P "$link" "$(next_backup_path "$link")" || return
  run_cmd ln -sfn "$shim" "$link" || return
  log_item "Legacy Bun launcher: $link now follows the worktree's mise pin"
}

install_runtimes() {
  local mise_bin=""
  local previous_herdr_version=""
  local installed_herdr_version=""
  local running_herdr_sessions=""

  log_section "Mise Runtimes"

  if (( ${DRY_RUN:-0} )); then
    mise_bin="mise"
  elif ! mise_bin="$(resolve_mise_bin 2>/dev/null)"; then
    write_mise_config
    log_item "Mise not installed, skipping runtimes"
    return 0
  else
    previous_herdr_version="$(herdr --version 2>/dev/null | head -1 || true)"
    running_herdr_sessions="$(herdr session list 2>/dev/null | awk '$2 == "running" { print $1 }' | paste -sd, - || true)"
  fi

  write_mise_config

  log_item "Installing language runtimes..."
  run_cmd "$mise_bin" install

  # `mise install` considers an already-installed floating selector (such as
  # `latest` or `3.12`) satisfied. Upgrade those selectors while retaining old
  # installs to preserve setup's non-destructive behavior.
  log_item "Upgrading floating language runtimes..."
  run_cmd "$mise_bin" upgrade --no-prune

  repair_legacy_bun_link
  log_item "Activating mise shims..."
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd /bin/bash -lc "eval \"\$(mise activate bash)\""
  else
    eval "$("$mise_bin" activate bash)"
    installed_herdr_version="$(herdr --version 2>/dev/null | head -1 || true)"
    if [[ -n "$previous_herdr_version" && "$installed_herdr_version" != "$previous_herdr_version" && -n "$running_herdr_sessions" ]]; then
      log_item "Herdr changed from $previous_herdr_version to $installed_herdr_version"
      log_item "Restart running Herdr sessions to load the new binary: $running_herdr_sessions"
    fi
  fi
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_runtimes
fi
