#!/usr/bin/env bash
# Desktop creative tools: local clients by default; ChatGPT tunnel is opt-in.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck source=install/blender-mcp.sh
source "$(dirname "${BASH_SOURCE[0]}")/blender-mcp.sh"
# shellcheck source=install/creative-mcp-tunnel.sh
source "$(dirname "${BASH_SOURCE[0]}")/creative-mcp-tunnel.sh"

configure_creative_mcp_clients() {
  local host="$1"
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Merge blender and Roblox_Studio into Claude Code, Claude Desktop, and Codex configs ($host); preserve unrelated entries"
    return 0
  fi
  run_cmd python3 "$REPO_ROOT/configs/creative-mcp/configure-clients.py" "$host"
  run_cmd python3 "$REPO_ROOT/configs/creative-mcp/configure-codex.py"
}

apply_creative_mcp() {
  local host="${SETUP_HOST:-}"
  case "$host" in
    macbook|omarchy) ;;
    *) printf 'error: creative MCP setup is only for macbook and omarchy\n' >&2; return 1 ;;
  esac
  log_section "Blender and Roblox MCP"
  apply_blender_mcp "$host"
  ensure_dir "$HOME/.local/bin"
  safe_link_path "$REPO_ROOT/configs/creative-mcp/roblox-studio-mcp" \
    "$HOME/.local/bin/roblox-studio-mcp" "Roblox Studio MCP launcher"
  if (( ! ${DRY_RUN:-0} )) && [[ "$(resolve_symlink_target "$HOME/.local/bin/roblox-studio-mcp")" != "$(canonicalize_path "$REPO_ROOT/configs/creative-mcp/roblox-studio-mcp")" ]]; then
    printf 'error: Roblox MCP launcher is a foreign symlink; resolve it before retrying\n' >&2
    return 1
  fi
  apply_creative_mcp_tunnel "$host"
  configure_creative_mcp_clients "$host"
  log_item "Enable the Blender add-on and Studio MCP in each app, then restart clients. See configs/creative-mcp/README.md."
  log_item "ChatGPT: tunnel client installed, but no tunnel is started and no account is connected automatically."
}
