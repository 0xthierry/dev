#!/usr/bin/env bash
# Pinned, package-local REA runtime. Never run upstream setup/update or npx.
set -euo pipefail
# shellcheck source=install/rea-prereqs.sh
source "$(dirname "${BASH_SOURCE[0]}")/rea-prereqs.sh"

install_rea() (
  local host="${1:-}" assets="$REPO_ROOT/configs/rea"
  local runtime="$HOME/.local/share/rea" node_dir="" node_bin="" tmp=""
  local name="" target="" source_path=""
  case "$host" in
    dev|omarchy|macbook) ;;
    *) printf 'error: REA setup requires dev, omarchy, or macbook\n' >&2; return 1 ;;
  esac
  log_section "REA MCP"
  for name in package.json package-lock.json rea rea-mcp; do
    if [[ ! -f "$assets/$name" ]]; then
      printf 'error: missing REA runtime asset: %s\n' "$assets/$name" >&2
      return 1
    fi
  done
  # Check ownership before package installation. Never write through runtime links.
  if [[ -L "$runtime" || ( -e "$runtime" && ! -d "$runtime" ) || -L "$runtime/node-path" ||
        ( -e "$runtime/node-path" && ! -f "$runtime/node-path" ) ]]; then
    printf 'error: refusing unrelated REA runtime path: %s\n' "$runtime" >&2
    return 1
  fi
  for name in source rea rea-mcp; do
    if [[ "$name" == source ]]; then
      target="$runtime/source"; source_path="$assets"
    else
      target="$HOME/.local/bin/$name"; source_path="$assets/$name"
    fi
    if [[ -L "$target" && "$(resolve_symlink_target "$target")" != "$(canonicalize_path "$source_path")" ]]; then
      printf 'error: refusing unrelated REA symlink: %s\n' "$target" >&2
      return 1
    fi
  done
  install_rea_prereqs "$host" || return
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd npm ci --prefix "$assets" --ignore-scripts --no-audit --no-fund
    log_item "Would record the absolute Node $REA_NODE_VERSION executable for GUI clients"
  else
    node_dir="$("$(resolve_mise_bin)" where "node@$REA_NODE_VERSION")" || return
    node_bin="$node_dir/bin/node"
    if [[ "$node_bin" != /* || ! -x "$node_bin" || ! -x "$node_dir/bin/npm" ]] ||
       [[ "$("$node_bin" --version)" != "v$REA_NODE_VERSION" ]]; then
      printf 'error: pinned REA Node/npm runtime is missing or has the wrong version\n' >&2
      return 1
    fi
    export PATH="$node_dir/bin:$PATH"
    "$node_dir/bin/npm" ci --prefix "$assets" --ignore-scripts --no-audit --no-fund || return
    # Ensure a published entrypoint exists and the exact lockfile package was installed.
    "$node_bin" --input-type=module - "$assets" <<'JS' || return
import fs from 'node:fs';
import path from 'node:path';
const assets = process.argv[2];
const expected = JSON.parse(fs.readFileSync(path.join(assets, 'package.json'))).dependencies['rea-agents'];
const installed = JSON.parse(fs.readFileSync(path.join(assets, 'node_modules/rea-agents/package.json')));
if (installed.version !== expected || !fs.existsSync(path.join(assets, 'node_modules/rea-agents/scripts/rea.mjs'))) {
  throw new Error('Incomplete or unpinned REA installation');
}
JS
    ensure_dir "$runtime" || return
    tmp="$(mktemp "$runtime/.node-path.XXXXXX")" || return
    trap '[[ -z "$tmp" ]] || rm -f -- "$tmp"' EXIT
    printf '%s\n' "$node_bin" > "$tmp"
    write_if_changed "$tmp" "$runtime/node-path" || return
  fi
  ensure_dir "$runtime" || return
  ensure_dir "$HOME/.local/bin" || return
  safe_link_path "$assets" "$runtime/source" "REA runtime source" || return
  safe_link_path "$assets/rea" "$HOME/.local/bin/rea" "REA CLI" || return
  safe_link_path "$assets/rea-mcp" "$HOME/.local/bin/rea-mcp" "REA MCP" || return
  log_item "REA runtime installed; install/mcp.sh merges the shared MCP registrations"
  log_item "Optional native engines are separate; the existing Ghidra 12.0/Java 17 stack is not compatible with REA"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  DRY_RUN=0
  if [[ $# -eq 2 && "$2" == --dry-run ]]; then DRY_RUN=1
  elif [[ $# -ne 1 ]]; then
    printf 'Usage: bash install/rea.sh <dev|macbook|omarchy> [--dry-run]\n' >&2
    exit 1
  fi
  install_rea "$1"
fi
