#!/usr/bin/env bash
# Exercise package requests without a live package manager or privileged writes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/pacman.sh
source "$ROOT/install/pacman.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
export PACMAN_TEST_LOG="$TEMP/request"
mkdir -p "$TEMP/bin" "$TEMP/no-tools"
cat > "$TEMP/bin/sudo" <<'EOF'
#!/bin/bash
printf '%s\n' "$@" > "$PACMAN_TEST_LOG"
exit "${PACMAN_TEST_EXIT:-0}"
EOF
printf '#!/bin/sh\nexit 99\n' > "$TEMP/bin/pacman"
chmod +x "$TEMP/bin/sudo" "$TEMP/bin/pacman"
export PATH="$TEMP/bin:$PATH"
DRY_RUN=0 install_pacman_packages steam 'package with spaces'
printf '%s\n' pacman -S --needed --noconfirm steam 'package with spaces' > "$TEMP/expected"
cmp "$TEMP/expected" "$PACMAN_TEST_LOG"
printf 'ok: uses system pacman config and preserves package arguments\n'
if DRY_RUN=0 PACMAN_TEST_EXIT=24 install_pacman_packages steam; then
  printf 'error: package-manager failure was swallowed\n' >&2; exit 1
else
  status=$?
fi
[[ "$status" == 24 ]]
printf 'ok: package-manager error propagates\n'
rm "$PACMAN_TEST_LOG"
DRY_RUN=1 PATH="$TEMP/no-tools" install_pacman_packages steam > "$TEMP/dry"
grep -Fq 'sudo pacman -S --needed --noconfirm steam' "$TEMP/dry"
[[ ! -e "$PACMAN_TEST_LOG" ]]
DRY_RUN=0 PATH="$TEMP/no-tools" install_pacman_packages > "$TEMP/empty"
[[ ! -s "$TEMP/empty" ]]
printf 'ok: dry-run plans without tools; empty input does nothing\n'
