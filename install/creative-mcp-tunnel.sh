#!/usr/bin/env bash
# Optional foreground ChatGPT transport. Installation never starts a tunnel.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

creative_mcp_tunnel_check_link() {
  local source_path="$1" target_path="$2"
  if [[ -d "$target_path" && ! -L "$target_path" ]]; then
    printf 'error: refusing command directory: %s\n' "$target_path" >&2
    return 1
  fi
  if [[ -L "$target_path" ]] && [[ "$(resolve_symlink_target "$target_path")" != "$(canonicalize_path "$source_path")" ]]; then
    printf 'error: refusing unrelated ChatGPT tunnel symlink: %s\n' "$target_path" >&2
    return 1
  fi
}

install_creative_mcp_tunnel_linux() (
  set -euo pipefail
  local arch="$1" checksum="$2"
  local base="$HOME/.local/share/creative-mcp/tunnel-client"
  local destination="$base/v0.0.16-linux-$arch"
  local verifier="$REPO_ROOT/configs/creative-mcp/chatgpt-verify-release.py"
  local url="https://github.com/openai/tunnel-client/releases/download/v0.0.16/tunnel-client-runtime-v0.0.16-linux-$arch.zip"
  local stage=""

  creative_mcp_tunnel_check_link "$destination/tunnel-client-runtime" "$base/runtime" || return
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Download $url; verify SHA256 $checksum; install $destination"
    ensure_dir "$base"
    safe_link_path "$destination/tunnel-client-runtime" "$base/runtime" "ChatGPT tunnel runtime"
    return 0
  fi
  if ! check_installed python3 || ! check_installed curl; then
    printf 'error: Python 3 and curl are required for the pinned tunnel-client install\n' >&2
    return 1
  fi
  if [[ -e "$destination" || -L "$destination" ]]; then
    if [[ -L "$destination" || ! -d "$destination" ]]; then
      printf 'error: refusing unrelated tunnel-client payload: %s\n' "$destination" >&2
      return 1
    fi
    python3 "$verifier" verify "$destination" "$checksum" "$arch" || {
      printf 'error: preserve/move the conflicting payload %s, then rerun setup\n' "$destination" >&2
      return 1
    }
    [[ -x "$destination/tunnel-client-runtime" ]] || {
      printf 'error: installed tunnel-client runtime is not executable: %s\n' "$destination" >&2
      return 1
    }
    log_item "tunnel-client runtime: verified existing v0.0.16 ($arch)"
  else
    ensure_dir "$base" || return
    stage="$(mktemp -d "$base/.install.XXXXXXXX")" || return
    trap 'rm -rf "$stage"' EXIT
    curl --fail --silent --show-error --location --retry 3 "$url" --output "$stage/release.zip" || return
    python3 "$verifier" extract "$stage" "$checksum" "$arch" || return
    chmod 0755 "$stage/tunnel-client-runtime" || return
    # Same-filesystem rename publishes only a fully verified payload.
    mv -T "$stage" "$destination" || return
    stage=""
    log_item "tunnel-client runtime: installed v0.0.16 ($arch)"
  fi
  safe_link_path "$destination/tunnel-client-runtime" "$base/runtime" "ChatGPT tunnel runtime"
)

apply_creative_mcp_tunnel() {
  local host="${1:-${HOST:-}}" arch="" checksum="" brew_bin=""
  local launcher="$REPO_ROOT/configs/creative-mcp/chatgpt-creative-mcp"
  log_section "Optional ChatGPT Local MCP Tunnel"
  case "$host" in
    macbook|omarchy) ;;
    *) printf 'error: creative MCP tunnel supports only macbook and omarchy, not %s\n' "${host:-an unspecified host}" >&2; return 1 ;;
  esac
  [[ -x "$launcher" && -f "$REPO_ROOT/configs/creative-mcp/chatgpt-verify-release.py" ]] || {
    printf 'error: repo-owned ChatGPT tunnel launcher or release verifier is missing\n' >&2
    return 1
  }
  creative_mcp_tunnel_check_link "$launcher" "$HOME/.local/bin/chatgpt-creative-mcp" || return
  creative_mcp_tunnel_check_link "$launcher" "$HOME/.local/bin/chatgpt-browser-mcp" || return
  if [[ "$host" == macbook ]]; then
    # The macbook package layer owns brew install openai/tools/tunnel-client.
    if (( ${DRY_RUN:-0} )); then
      log_item "[dry-run] Require supported Homebrew formula openai/tools/tunnel-client"
    else
      brew_bin="$(command -v brew || true)"
      [[ -n "$brew_bin" ]] || { [[ ! -x /opt/homebrew/bin/brew ]] || brew_bin=/opt/homebrew/bin/brew; }
      [[ -n "$brew_bin" ]] || { [[ ! -x /usr/local/bin/brew ]] || brew_bin=/usr/local/bin/brew; }
      if [[ -z "$brew_bin" ]] || ! "$brew_bin" list --versions openai/tools/tunnel-client >/dev/null 2>&1; then
        printf 'error: install the declared Homebrew formula openai/tools/tunnel-client through macbook setup first\n' >&2
        return 1
      fi
    fi
  else
    case "$(uname -m)" in
      x86_64) arch=amd64; checksum=f8f48017e752810c2c6f02065cdc4ca1ad045b91a6d045cbab144b957fdcbdb1 ;;
      aarch64|arm64) arch=arm64; checksum=ec3bc4815e1b9f7a0773b24de45f64841d9aebe170a58b62742e3f1cef4ac088 ;;
      *) printf 'error: unsupported tunnel-client Linux architecture\n' >&2; return 1 ;;
    esac
    install_creative_mcp_tunnel_linux "$arch" "$checksum" || return
  fi
  ensure_dir "$HOME/.local/bin" || return
  safe_link_path "$launcher" "$HOME/.local/bin/chatgpt-creative-mcp" "ChatGPT local MCP launcher" || return
  safe_link_path "$launcher" "$HOME/.local/bin/chatgpt-browser-mcp" "ChatGPT browser MCP launcher" || return
  log_item "No tunnel, public listener, connector, or background service was started"
  log_item "Supply CONTROL_PLANE_API_KEY and CONTROL_PLANE_TUNNEL_ID at runtime; explicitly run chatgpt-browser-mcp playwriter|chrome-devtools or chatgpt-creative-mcp blender|roblox|ai-memory"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  DRY_RUN=0
  if [[ $# -eq 2 && "$2" == --dry-run ]]; then DRY_RUN=1;
  elif [[ $# -ne 1 ]]; then
    printf 'Usage: bash install/creative-mcp-tunnel.sh <macbook|omarchy> [--dry-run]\n' >&2
    exit 1
  fi
  apply_creative_mcp_tunnel "$1"
fi
