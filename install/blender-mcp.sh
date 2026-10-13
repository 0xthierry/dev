#!/usr/bin/env bash
# Contract: source this file, then apply_blender_mcp "$HOST" with REPO_ROOT,
# HOME and DRY_RUN set by setup. Only macbook and omarchy are supported.
# Never run upstream setup/update: they modify clients or unpin the runtime.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

apply_blender_linux_launcher() {
  local assets="$REPO_ROOT/configs/creative-mcp"
  if [[ ! -x "$assets/blender-linux" || ! -f "$assets/blender.desktop" ]]; then
    printf 'error: managed Blender Linux launchers are missing\n' >&2
    return 1
  fi
  ensure_dir "$HOME/.local/bin" || return $?
  ensure_dir "$HOME/.local/share/applications" || return $?
  safe_link_path "$assets/blender-linux" "$HOME/.local/bin/blender" "Blender system-Python launcher" || return $?
  safe_link_path "$assets/blender.desktop" "$HOME/.local/share/applications/blender.desktop" "Blender desktop launcher" || return $?
  if (( ! ${DRY_RUN:-0} )) && { [[ "$(resolve_symlink_target "$HOME/.local/bin/blender")" != "$(canonicalize_path "$assets/blender-linux")" ]] || [[ "$(resolve_symlink_target "$HOME/.local/share/applications/blender.desktop")" != "$(canonicalize_path "$assets/blender.desktop")" ]]; }; then
    printf 'error: Blender Linux launchers conflict with existing symlinks; resolve them before retrying\n' >&2
    return 1
  fi
}

apply_blender_mcp() {
  local host="${1:-}"
  local assets="$REPO_ROOT/configs/creative-mcp"
  local runtime="$HOME/.local/share/creative-mcp/blender-mcp"
  local launcher="$HOME/.local/bin/blender-mcp"
  local uv_bin="uv"
  local blender_bin="blender"
  local version_output=""
  local blender_version=""
  local config_base=""
  local candidate=""

  case "$host" in
    macbook) config_base="$HOME/Library/Application Support/Blender" ;;
    omarchy) config_base="$HOME/.config/blender" ;;
    *) printf 'error: Blender MCP supports only macbook and omarchy, not %s\n' "$host" >&2; return 1 ;;
  esac
  log_section "Blender MCP"

  if [[ ! -x "$assets/blender-mcp" || ! -f "$assets/install-blender-addon.py" || ! -f "$assets/blender-requirements.lock" ]]; then
    printf 'error: Blender MCP launcher, addon installer or dependency lock is missing: %s\n' "$assets" >&2
    return 1
  fi
  if [[ -L "$launcher" ]] && [[ "$(resolve_symlink_target "$launcher")" != "$(canonicalize_path "$assets/blender-mcp")" ]]; then
    printf 'error: refusing to replace an unrelated Blender MCP launcher symlink: %s\n' "$launcher" >&2
    return 1
  fi
  for candidate in "$runtime" "$runtime/venv"; do
    if [[ -L "$candidate" || ( -e "$candidate" && ! -d "$candidate" ) ]]; then
      printf 'error: refusing unrelated Blender MCP runtime path: %s\n' "$candidate" >&2
      return 1
    fi
  done

  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd uv venv --no-config --no-project --allow-existing --python 3.12 "$runtime/venv"
    dry_run_cmd uv pip sync --no-config --python "$runtime/venv/bin/python" --require-hashes --only-binary :all: --default-index https://pypi.org/simple "$assets/blender-requirements.lock"
    log_item "Would probe Blender --version (including the macOS app bundle) and install its matching bundled addon with numbered backups into $config_base/<major.minor>/scripts/addons"
    dry_run_cmd "$runtime/venv/bin/python" "$assets/install-blender-addon.py" --version 2.1.9 --stage "$runtime/addon.py" --addons-dir "$config_base/<major.minor>/scripts/addons"
  else
    if ! uv_bin="$(command -v uv)"; then
      for candidate in "$HOME/.local/bin/uv" /opt/homebrew/bin/uv /usr/local/bin/uv; do
        if [[ -x "$candidate" ]]; then uv_bin="$candidate"; break; fi
      done
      if [[ ! -x "$uv_bin" ]]; then
        printf 'error: uv is required; run host setup to install the declared shared runtime\n' >&2
        return 1
      fi
    fi
    if ! blender_bin="$(command -v blender)"; then
      blender_bin="/Applications/Blender.app/Contents/MacOS/Blender"
      if [[ "$host" != macbook || ! -x "$blender_bin" ]]; then
        printf 'error: Blender is required; run host setup to install the declared desktop package\n' >&2
        return 1
      fi
    fi
    version_output="$("$blender_bin" --version)" || return $?
    if [[ "$version_output" =~ Blender[[:space:]]([0-9]+)\.([0-9]+) ]]; then
      blender_version="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
    else
      printf 'error: could not determine Blender version from %s --version\n' "$blender_bin" >&2
      return 1
    fi
    ensure_dir "$runtime" || return $?
    if [[ ! -x "$runtime/venv/bin/python" ]]; then
      "$uv_bin" venv --no-config --no-project --allow-existing --python 3.12 "$runtime/venv" || return $?
    fi
    "$uv_bin" pip sync --no-config --python "$runtime/venv/bin/python" --require-hashes --only-binary :all: --default-index https://pypi.org/simple "$assets/blender-requirements.lock" || return $?
    "$runtime/venv/bin/python" "$assets/install-blender-addon.py" --version 2.1.9 --stage "$runtime/addon.py" --addons-dir "$config_base/$blender_version/scripts/addons" || return $?
  fi

  if [[ "$host" == omarchy ]]; then
    apply_blender_linux_launcher || return $?
  fi
  ensure_dir "$HOME/.local/bin" || return $?
  safe_link_path "$assets/blender-mcp" "$launcher" "Blender MCP" || return $?
  if (( ! ${DRY_RUN:-0} )) && { [[ ! -L "$launcher" ]] || [[ "$(resolve_symlink_target "$launcher")" != "$(canonicalize_path "$assets/blender-mcp")" ]]; }; then
    printf 'error: Blender MCP launcher was not linked: %s\n' "$launcher" >&2
    return 1
  fi
  log_item "Blender preferences and MCP client configuration are unchanged"
  log_item "In Blender: Preferences > Add-ons, enable Interface: MCP for Blender (or restart/re-enable after an update)"
  log_item "Open the 3D View sidebar (N) > MCP for Blender; click Connect to MCP server if it is not already running (default localhost:9876)"
  log_item "Keep Allow Telemetry off; the MCP launcher also forces telemetry off. No generation API key is needed for local Blender tools"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  DRY_RUN=0
  if [[ $# -eq 2 && "$2" == --dry-run ]]; then DRY_RUN=1
  elif [[ $# -ne 1 ]]; then
    printf 'Usage: bash install/blender-mcp.sh <macbook|omarchy> [--dry-run]\n' >&2
    exit 1
  fi
  apply_blender_mcp "$1"
fi
