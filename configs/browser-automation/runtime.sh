#!/bin/bash
# Sourced by the absolute launchers; no shell profile or launch-time package fetch.
set -euo pipefail
runtime="$HOME/.local/share/browser-automation"
if [[ ! -r "$runtime/node-path" || ! -d "$runtime/source/node_modules" ]]; then
  printf 'error: browser automation runtime is missing; rerun host setup\n' >&2
  exit 1
fi
IFS= read -r node_bin < "$runtime/node-path"
if [[ "$node_bin" != /* || ! -x "$node_bin" ]]; then
  printf 'error: recorded browser automation Node runtime is unavailable; rerun host setup\n' >&2
  exit 1
fi
export PATH="${node_bin%/*}:${PATH:-/usr/bin:/bin}"
# Used by the sourcing launchers.
# shellcheck disable=SC2034
assets="$runtime/source"
