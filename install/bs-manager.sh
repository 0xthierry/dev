#!/usr/bin/env bash
# Work around bs-manager-bin 1.6.0-1 stripping its .NET single-file bundle.
# Keep this scoped to the known damaged binary; retire when AUR uses !strip.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BS_MANAGER_RPM_SHA=f701450bca18084904cdee2aa4abc9d8f58787375272b8eab6d83040ac30d0b2
BS_MANAGER_DOWNLOADER_SHA=53ee1efe78aaf9d47d9bceacb74ba5156f8a10a50a5fbaa13ff844c94d0e01bc
BS_MANAGER_STRIPPED_SHA=1ce96dda6cd2f44f78eef5a89ad85fb054fb959e51f803a7d8e18e2608934306
BS_MANAGER_DOWNLOADER=/opt/BSManager/resources/assets/scripts/DepotDownloader

repair_bs_manager_downloader() {
  local source="$1" current stage backup
  export PATH=/usr/bin:/bin
  (( EUID == 0 )) || { printf 'Root authorization required.\n' >&2; return 1; }
  [[ -f "$source" && ! -L "$source" ]] || return 1
  printf '%s  %s\n' "$BS_MANAGER_DOWNLOADER_SHA" "$source" | sha256sum --check --status
  [[ -f "$BS_MANAGER_DOWNLOADER" && ! -L "$BS_MANAGER_DOWNLOADER" ]] || return 1
  current="$(sha256sum "$BS_MANAGER_DOWNLOADER")"
  current="${current%% *}"
  [[ "$current" != "$BS_MANAGER_DOWNLOADER_SHA" ]] || return 0
  if [[ "$current" != "$BS_MANAGER_STRIPPED_SHA" ]]; then
    printf 'Refusing to replace an unknown BSManager downloader.\n' >&2
    return 1
  fi
  backup="${BS_MANAGER_DOWNLOADER}.stripped.bak"
  if [[ -e "$backup" || -L "$backup" ]]; then
    [[ -f "$backup" && ! -L "$backup" ]] || return 1
    cmp -s "$backup" "$BS_MANAGER_DOWNLOADER" || return 1
  else
    cp -p -- "$BS_MANAGER_DOWNLOADER" "$backup"
  fi
  stage="$(mktemp "${BS_MANAGER_DOWNLOADER}.repair.XXXXXX")"
  install -m755 -- "$source" "$stage"
  # Verify the staged copy again before replacing the package's damaged file.
  if ! printf '%s  %s\n' "$BS_MANAGER_DOWNLOADER_SHA" "$stage" | sha256sum --check --status; then
    rm -f -- "$stage"
    return 1
  fi
  mv -fT -- "$stage" "$BS_MANAGER_DOWNLOADER"
  printf 'Restored the unstripped official BSManager downloader.\n'
}

apply_bs_manager() {
  local cache archive stage current
  log_section 'BSManager downloader integrity'
  if (( ${DRY_RUN:-0} )); then
    log_item '[dry-run] Repair only the known stripped BSManager 1.6.0 downloader using the SHA256-verified upstream RPM'
    return 0
  fi
  [[ -f "$BS_MANAGER_DOWNLOADER" ]] || { log_item 'BSManager missing; install the Omarchy bs-manager-bin package first'; return 1; }
  current="$(sha256sum "$BS_MANAGER_DOWNLOADER")"
  current="${current%% *}"
  if [[ "$current" != "$BS_MANAGER_STRIPPED_SHA" ]]; then
    log_item 'Known stripped downloader not present; no repair needed'
    return 0
  fi
  cache="${XDG_CACHE_HOME:-$HOME/.cache}/dev-setup/bs-manager"
  mkdir -p "$cache"
  archive="$cache/bs-manager-1.6.0.x86_64.rpm"
  if [[ ! -f "$archive" ]]; then
    stage="$(mktemp "$cache/download.XXXXXX")"
    curl -fL --retry 2 https://github.com/Zagrios/bs-manager/releases/download/v1.6.0/bs-manager-1.6.0.x86_64.rpm -o "$stage"
    printf '%s  %s\n' "$BS_MANAGER_RPM_SHA" "$stage" | sha256sum --check --status
    mv -- "$stage" "$archive"
  fi
  printf '%s  %s\n' "$BS_MANAGER_RPM_SHA" "$archive" | sha256sum --check --status
  stage="$(mktemp "$cache/DepotDownloader.XXXXXX")"
  bsdtar -xOf "$archive" ./opt/BSManager/resources/assets/scripts/DepotDownloader > "$stage"
  printf '%s  %s\n' "$BS_MANAGER_DOWNLOADER_SHA" "$stage" | sha256sum --check --status
  log_item "Prepared verified downloader: $stage"
  run_cmd sudo /usr/bin/bash "$REPO_ROOT/install/bs-manager.sh" --repair "$stage"
  rm -f -- "$stage"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "${1:-}" == --repair && $# == 2 ]]; then
    repair_bs_manager_downloader "$2"
  else
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    apply_bs_manager
  fi
fi
