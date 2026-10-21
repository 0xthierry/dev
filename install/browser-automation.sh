#!/usr/bin/env bash
# Pinned package-local browser tools. Setup never starts a server or browser.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

apply_browser_automation() (
  local host="${1:-}" assets="$REPO_ROOT/configs/browser-automation"
  local runtime="$HOME/.local/share/browser-automation" node_bin="" npm_bin="" tmp=""
  local name="" target="" source_path=""
  case "$host" in
    dev|omarchy|macbook) ;;
    *) printf 'error: browser automation requires dev, omarchy, or macbook\n' >&2; return 1 ;;
  esac
  log_section "Browser Automation"
  for name in package.json package-lock.json runtime.sh playwriter playwriter-mcp chrome-devtools-mcp; do
    if [[ ! -f "$assets/$name" ]]; then
      printf 'error: missing browser automation asset: %s\n' "$assets/$name" >&2
      return 1
    fi
  done
  if [[ -L "$runtime" || ( -e "$runtime" && ! -d "$runtime" ) || -L "$runtime/node-path" ||
        ( -e "$runtime/node-path" && ! -f "$runtime/node-path" ) ]]; then
    printf 'error: refusing unrelated browser automation runtime path: %s\n' "$runtime" >&2
    return 1
  fi
  # Preflight every link before installing packages or publishing any launcher.
  for name in source playwriter playwriter-mcp chrome-devtools-mcp; do
    if [[ "$name" == source ]]; then
      target="$runtime/source"; source_path="$assets"
    else
      target="$HOME/.local/bin/$name"; source_path="$assets/$name"
      if [[ -d "$target" && ! -L "$target" ]]; then
        printf 'error: refusing browser automation command directory: %s\n' "$target" >&2
        return 1
      fi
      if [[ ! -x "$source_path" ]]; then
        printf 'error: browser automation launcher is not executable: %s\n' "$source_path" >&2
        return 1
      fi
    fi
    if [[ -L "$target" && "$(resolve_symlink_target "$target")" != "$(canonicalize_path "$source_path")" ]]; then
      printf 'error: refusing unrelated browser automation symlink: %s\n' "$target" >&2
      return 1
    fi
  done
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd npm ci --prefix "$assets" --ignore-scripts --no-audit --no-fund
    log_item "Would record the absolute Node executable for GUI clients"
  else
    if ! check_installed node || ! check_installed npm; then
      printf 'error: Node and npm are required; run host setup to install the declared mise runtime\n' >&2
      return 1
    fi
    # Resolve mise shims now: GUI clients may have only /usr/bin:/bin in PATH.
    node_bin="$(node -p 'process.execPath')" || return
    if [[ "$node_bin" != /* || ! -x "$node_bin" ]]; then
      printf 'error: could not resolve an absolute Node executable\n' >&2
      return 1
    fi
    npm_bin="$(command -v npm)" || return
    export PATH="${node_bin%/*}:$PATH"
    "$npm_bin" ci --prefix "$assets" --ignore-scripts --no-audit --no-fund || return
    "$node_bin" --input-type=module - "$assets" <<'JS' || return
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).dependencies;
for (const [name, bin, entry] of [
  ['playwriter', 'playwriter', 'bin.js'],
  ['chrome-devtools-mcp', 'chrome-devtools-mcp', 'build/src/bin/chrome-devtools-mcp.js'],
]) {
  const dir = path.join(root, 'node_modules', name);
  const installed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
  const publishedBin = typeof installed.bin === 'string' ? installed.bin : installed.bin[bin];
  if (installed.version !== expected[name] || publishedBin?.replace(/^\.\//, '') !== entry || !fs.existsSync(path.join(dir, entry))) {
    throw new Error(`Incomplete or unpinned browser runtime: ${name}`);
  }
}
const [major, minor] = process.versions.node.split('.').map(Number);
if (!(major >= 23 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19))) {
  throw new Error('Chrome DevTools MCP requires Node ^20.19.0 || ^22.12.0 || >=23');
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
  safe_link_path "$assets" "$runtime/source" "Browser automation source" || return
  for name in playwriter playwriter-mcp chrome-devtools-mcp; do
    safe_link_path "$assets/$name" "$HOME/.local/bin/$name" "$name" || return
  done
  log_item "Playwriter uses the existing browser extension; install/authorize it explicitly"
  log_item "Chrome DevTools MCP attaches only to http://127.0.0.1:9222"
  log_item "No browser, extension, or background server was started or installed"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  DRY_RUN=0
  if [[ $# -eq 2 && "$2" == --dry-run ]]; then DRY_RUN=1
  elif [[ $# -ne 1 ]]; then
    printf 'Usage: bash install/browser-automation.sh <dev|macbook|omarchy> [--dry-run]\n' >&2
    exit 1
  fi
  apply_browser_automation "$1"
fi
