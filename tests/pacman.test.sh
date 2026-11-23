#!/usr/bin/env bash
# Exercise package requests without a live package manager or privileged writes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/pacman.sh
source "$ROOT/install/pacman.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
export PACMAN_TEST_LOG="$TEMP/request" PACMAN_TEST_INSTALLED="$TEMP/installed"
mkdir -p "$TEMP/bin" "$TEMP/no-tools"
cat > "$TEMP/bin/pacman" <<'EOF'
#!/bin/bash
set -eu
op=$1; shift
if [[ ${1:-} == -- ]]; then shift; fi
case $op in
  -Qq)
    if [[ -n ${PACMAN_TEST_QUERY_EXIT:-} ]]; then exit "$PACMAN_TEST_QUERY_EXIT"; fi
    if (($# == 0)); then
      [[ -s $PACMAN_TEST_INSTALLED ]] || exit 1
      cat "$PACMAN_TEST_INSTALLED"; exit 0
    fi
    ;;
  -T) if [[ -n ${PACMAN_TEST_DEP_EXIT:-} ]]; then exit "$PACMAN_TEST_DEP_EXIT"; fi ;;
  *) exit 99 ;;
esac
status=0
for pkg do
  if grep -Fxq -- "$pkg" "$PACMAN_TEST_INSTALLED"; then
    resolved=$pkg
  elif [[ $pkg == mise ]] && grep -Fxq mise-bin "$PACMAN_TEST_INSTALLED"; then
    resolved=mise-bin
  elif [[ $pkg == mail-transport-agent ]] && grep -Fxq postfix "$PACMAN_TEST_INSTALLED"; then
    resolved=postfix
  else
    if [[ $op == -T ]]; then printf '%s\n' "$pkg"; status=127; else status=1; fi
    continue
  fi
  if [[ $op == -Qq ]]; then printf '%s\n' "$resolved"; fi
done
exit "$status"
EOF
cat > "$TEMP/bin/sudo" <<'EOF'
#!/bin/bash
set -eu
printf '%s\n' "$@" > "$PACMAN_TEST_LOG"
[[ $1 == pacman && $2 == -S && $3 == --needed && $4 == --noconfirm ]] || exit 99
shift 4
if [[ -n ${PACMAN_TEST_EXIT:-} ]]; then exit "$PACMAN_TEST_EXIT"; fi
for pkg do
  if [[ $pkg == mise ]] && grep -Fxq mise-bin "$PACMAN_TEST_INSTALLED"; then
    echo 'mise and mise-bin are in conflict' >&2; exit 1
  fi
  grep -Fxq -- "$pkg" "$PACMAN_TEST_INSTALLED" || printf '%s\n' "$pkg" >> "$PACMAN_TEST_INSTALLED"
done
EOF
chmod +x "$TEMP/bin/sudo" "$TEMP/bin/pacman"
export PATH="$TEMP/bin:$PATH"
DRY_RUN=0

printf '%s\n' mise-bin steam postfix > "$PACMAN_TEST_INSTALLED"
install_pacman_packages mise steam 'package with spaces'
printf '%s\n' pacman -S --needed --noconfirm steam 'package with spaces' > "$TEMP/expected"
cmp "$TEMP/expected" "$PACMAN_TEST_LOG"
printf 'ok: preserves alternative provider and submits exact upgrades and missing package arguments\n'

rm "$PACMAN_TEST_LOG"
install_pacman_packages mise steam 'package with spaces'
cmp "$TEMP/expected" "$PACMAN_TEST_LOG"
printf 'ok: repeated setup preserves provider while still checking exact packages for upgrades\n'

rm "$PACMAN_TEST_LOG"
install_pacman_packages mise mail-transport-agent
[[ ! -e "$PACMAN_TEST_LOG" ]]
printf 'ok: no sudo transaction for provider-only request\n'

: > "$PACMAN_TEST_INSTALLED"
install_pacman_packages mise
printf '%s\n' pacman -S --needed --noconfirm mise > "$TEMP/expected"
cmp "$TEMP/expected" "$PACMAN_TEST_LOG"
printf 'ok: absent provider requests the declared package\n'

if PACMAN_TEST_EXIT=24 install_pacman_packages mise; then
  printf 'error: package-manager failure was swallowed\n' >&2; exit 1
else
  status=$?
fi
[[ "$status" == 24 ]]
printf 'ok: package-manager error propagates\n'

rm "$PACMAN_TEST_LOG"
if PACMAN_TEST_DEP_EXIT=42 install_pacman_packages mise; then exit 1; else status=$?; fi
[[ $status == 42 && ! -e "$PACMAN_TEST_LOG" ]]
if PACMAN_TEST_QUERY_EXIT=1 install_pacman_packages mise; then exit 1; else status=$?; fi
[[ $status == 1 && ! -e "$PACMAN_TEST_LOG" ]]
printf 'ok: query errors propagate before any privileged transaction\n'

DRY_RUN=1 PATH="$TEMP/no-tools" install_pacman_packages steam > "$TEMP/dry"
grep -Fq 'sudo pacman -S --needed --noconfirm steam' "$TEMP/dry"
[[ ! -e "$PACMAN_TEST_LOG" ]]
DRY_RUN=0 PATH="$TEMP/no-tools" install_pacman_packages > "$TEMP/empty"
[[ ! -s "$TEMP/empty" ]]
printf 'ok: dry-run plans without tools; empty input does nothing\n'
