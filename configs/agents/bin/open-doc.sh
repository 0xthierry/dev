#!/usr/bin/env bash
# Cross-platform document opener — uses the system's default viewer.
# Usage: open-doc.sh <file_path>

set -euo pipefail

FILE="${1:?Usage: open-doc.sh <file_path>}"

if [[ ! -f "$FILE" ]]; then
  echo "File not found: $FILE" >&2
  exit 1
fi

if [[ "$(uname)" == "Darwin" ]]; then
  open "$FILE"
else
  if command -v xdg-open &>/dev/null; then
    xdg-open "$FILE" &>/dev/null &
  else
    echo "No suitable viewer found. File: $FILE" >&2
    exit 1
  fi
fi
