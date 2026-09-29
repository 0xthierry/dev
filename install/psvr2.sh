#!/usr/bin/env bash
# Install user-local, checksum-verified PSVR2Toolkit releases on Omarchy.
set -euo pipefail
# shellcheck source=install/lib.sh
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"

apply_psvr2() {
  log_section "PSVR2Toolkit (Omarchy)"
  if (( ${DRY_RUN:-0} )); then
    python3 "$REPO_ROOT/configs/psvr2/psvr2" install --dry-run
  else
    python3 "$REPO_ROOT/configs/psvr2/psvr2" install
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  apply_psvr2
fi
