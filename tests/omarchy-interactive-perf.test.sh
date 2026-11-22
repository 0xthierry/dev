#!/usr/bin/env bash
# Exercise the real Arch loader against a temporary makepkg.conf(.d) stack.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp/makepkg.conf.d" "$tmp/bin"
cp "$root/configs/omarchy/makepkg-interactive.conf" "$tmp/makepkg.conf.d/90-dev-setup-interactive.conf"
# The literal variable belongs to the generated test stub.
# shellcheck disable=SC2016
printf '%s\n' '#!/bin/sh' 'echo "${TEST_CPUS:-32}"' > "$tmp/bin/nproc"; chmod +x "$tmp/bin/nproc"
printf '%s\n' 'MAKEFLAGS="-j32"' 'COMPRESSZST=(zstd -c -T0 -)' > "$tmp/makepkg.conf"
check(){
  local opt=$1 expect=$2
  local got
  got=$(PATH="$tmp/bin:$PATH" DEV_MAKEPKG_JOBS="$opt" bash -c 'source /usr/share/makepkg/util/config.sh; source_makepkg_config "$1"; printf "%s|%s" "$MAKEFLAGS" "${COMPRESSZST[*]}"' _ "$tmp/makepkg.conf")
  [[ $got == "$expect" ]] || { printf 'got %s; expected %s\n' "$got" "$expect" >&2; return 1; }
}
check '' '-j8|zstd -c -T8 -'; check 12 '-j12|zstd -c -T12 -'; check 16 '-j16|zstd -c -T16 -'
check 99 '-j8|zstd -c -T8 -'; TEST_CPUS=4 check 12 '-j4|zstd -c -T4 -'
printf '%s\n' 'MAKEFLAGS="-j3 -l2"' 'COMPRESSZST=(zstd -1 -T2)' > "$tmp/makepkg.conf"
check '' '-j3 -l2|zstd -1 -T2'
printf 'ok: makepkg loader preserved custom flags; profile bounded automatic 8/12/16 and zstd threads\n'
