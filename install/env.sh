#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SHARED_ENV_VARS=(
  "EDITOR=nvim"
  "VISUAL=nvim"
  "PAGER=less -R"
  "OPENCODE_ENABLE_EXA=true"
  "NODE_OPTIONS=--max-old-space-size=16384 --localstorage-file=\$HOME/.node-localstorage"
  "PI_OFFLINE=1"
  "PI_SKIP_VERSION_CHECK=1"
  "PI_TELEMETRY=0"
  "CODEX_MULTI_AUTH_APP_BIND_INSTALL=0"
  "CODEX_MULTI_AUTH_APP_LAUNCHER_INSTALL=0"
  "CODEX_MULTI_AUTH_RUNTIME_ROTATION_PROXY=1"
  "GROK_DISABLE_AUTOUPDATER=1"
  "GROK_TELEMETRY_ENABLED=false"
  "GROK_TELEMETRY_TRACE_UPLOAD=false"
  "GROK_TELEMETRY_MIXPANEL_ENABLED=false"
  "GROK_EXTERNAL_OTEL=0"
  "GROK_FEEDBACK_ENABLED=false"
  "GROK_RELAY_SYNC_ENABLED=false"
)

write_env_file() {
  local target="$HOME/.config/dev-setup/env.sh"
  local tmp=""
  local entry=""
  local key=""
  local value=""

  log_section "Environment"
  ensure_dir "$(dirname "$target")"
  ensure_dir "$HOME/.cache/pi/fff"

  tmp="$(mktemp)"
  {
    for entry in "${SHARED_ENV_VARS[@]}"; do
      key="${entry%%=*}"
      value="${entry#*=}"
      printf 'export %s="%s"\n' "$key" "$value"
    done

    for entry in "${HOST_ENV_VARS[@]}"; do
      key="${entry%%=*}"
      value="${entry#*=}"
      printf 'export %s="%s"\n' "$key" "$value"
    done
  } > "$tmp"

  write_if_changed "$tmp" "$target"
  log_item "Environment file: $target"
}
