#!/usr/bin/env bash
# Cross-platform document opener — prefers Obsidian for markdown files.
# Usage: open-doc.sh <file_path>

set -euo pipefail

FILE="${1:?Usage: open-doc.sh <file_path>}"

if [[ ! -f "$FILE" ]]; then
  echo "File not found: $FILE" >&2
  exit 1
fi

if [[ "$(uname)" == "Darwin" ]]; then
  if [[ -d "/Applications/Obsidian.app" ]]; then
    open -a Obsidian "$FILE"
  else
    open "$FILE"
  fi
else
  if command -v obsidian &>/dev/null; then
    ABS_PATH="$(realpath "$FILE")"
    obsidian "obsidian://open?path=$ABS_PATH" &>/dev/null &
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$FILE" &>/dev/null &
  else
    echo "No suitable viewer found. File: $FILE" >&2
    exit 1
  fi
fi
