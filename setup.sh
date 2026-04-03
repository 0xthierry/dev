#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

source "$REPO_ROOT/install/lib.sh"
source "$REPO_ROOT/install/setup.sh"

HOST=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-n)
      DRY_RUN=1
      ;;
    dev|omarchy|macbook)
      HOST="$1"
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      printf 'Usage: ./setup.sh [--dry-run] <dev|omarchy|macbook>\n' >&2
      exit 1
      ;;
  esac
  shift
done

if [[ -z "$HOST" ]]; then
  printf 'Usage: ./setup.sh [--dry-run] <dev|omarchy|macbook>\n' >&2
  exit 1
fi

run_setup "$REPO_ROOT" "$HOST" "$DRY_RUN"
