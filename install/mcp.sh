#!/usr/bin/env bash
# Shared six-service MCP catalog. Never performs OAuth login or starts a tunnel.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

install_shared_mcp_runtime() {
  local assets="$REPO_ROOT/configs/mcp"
  local runtime="$HOME/.local/share/mcp-services"
  local source_link="$runtime/source" launcher="$HOME/.local/bin/mcp-service"
  local node_bin=""

  if [[ -L "$source_link" ]] && [[ "$(resolve_symlink_target "$source_link")" != "$(canonicalize_path "$assets")" ]]; then
    printf 'error: shared MCP runtime source is a foreign symlink: %s\n' "$source_link" >&2
    return 1
  fi
  if [[ -L "$launcher" ]] && [[ "$(resolve_symlink_target "$launcher")" != "$(canonicalize_path "$assets/mcp-service")" ]]; then
    printf 'error: shared MCP launcher is a foreign symlink: %s\n' "$launcher" >&2
    return 1
  fi
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd uv venv --no-config --no-project --allow-existing --python 3.12 "$runtime/venv"
    dry_run_cmd uv pip sync --no-config --python "$runtime/venv/bin/python" --require-hashes --only-binary :all: "$assets/requirements.lock"
    dry_run_cmd npm ci --prefix "$assets" --ignore-scripts --no-audit --no-fund
    log_item "[dry-run] Record the managed Node executable for GUI MCP clients"
  else
    for tool in uv node npm; do
      if ! check_installed "$tool"; then
        printf 'error: %s is required; install the declared shared packages/runtimes first\n' "$tool" >&2
        return 1
      fi
    done
    ensure_dir "$runtime" || return
    if [[ -L "$runtime/venv" ]]; then
      printf 'error: refusing foreign shared MCP Python environment symlink\n' >&2
      return 1
    fi
    if [[ ! -x "$runtime/venv/bin/python" ]]; then
      run_cmd uv venv --no-config --no-project --allow-existing --python 3.12 "$runtime/venv" || return
    fi
    run_cmd uv pip sync --no-config --python "$runtime/venv/bin/python" --require-hashes --only-binary :all: "$assets/requirements.lock" || return
    run_cmd npm ci --prefix "$assets" --ignore-scripts --no-audit --no-fund || return
    node_bin="$(node -p 'process.execPath')" || return
    "$runtime/venv/bin/python" - "$runtime/runtime.json" "$node_bin" <<'PY' || return
import json, os, pathlib, sys, tempfile
path = pathlib.Path(sys.argv[1])
if path.is_symlink():
    sys.exit("error: refusing linked shared MCP runtime configuration")
content = json.dumps({"node": sys.argv[2]}, indent=2) + "\n"
if path.exists() and path.read_text() == content:
    sys.exit(0)
fd, staged = tempfile.mkstemp(prefix=".runtime-", dir=path.parent)
try:
    with os.fdopen(fd, "w") as stream:
        stream.write(content)
    os.replace(staged, path)
finally:
    if os.path.exists(staged):
        os.unlink(staged)
PY
  fi
  ensure_dir "$runtime" || return
  ensure_dir "$HOME/.local/bin" || return
  safe_link_path "$assets" "$source_link" "Shared MCP runtime source" || return
  safe_link_path "$assets/mcp-service" "$launcher" "Shared MCP HTTP bridge" || return
}

configure_shared_mcp() {
  local host="${1:-${SETUP_HOST:-}}"
  case "$host" in
    dev|macbook|omarchy) ;;
    *) printf 'error: shared MCP setup requires dev, macbook, or omarchy\n' >&2; return 1 ;;
  esac
  log_section "Shared MCP Services (Datadog US5)"
  install_shared_mcp_runtime || return
  run_cmd "$HOME/.local/share/mcp-services/venv/bin/python" \
    "$REPO_ROOT/configs/mcp/configure-clients.py" "$host" || return
  log_item "MCP configuration installed; remote OAuth authorization is separate. No tunnel started."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  DRY_RUN=0
  if [[ $# -eq 2 && "$2" == --dry-run ]]; then DRY_RUN=1
  elif [[ $# -ne 1 ]]; then
    printf 'Usage: bash install/mcp.sh <dev|macbook|omarchy> [--dry-run]\n' >&2
    exit 1
  fi
  configure_shared_mcp "$1"
fi
