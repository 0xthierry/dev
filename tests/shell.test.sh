#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/home" "$tmp/zdot"

output="$({ HOME="$tmp/home" ZDOTDIR="$tmp/zdot" zsh -fc '
  source "$1"
  pi() { printf "%s\n" "$@"; }
  if (( $+functions[glm] )); then
    print -u2 "legacy glm launcher is still defined"
    exit 1
  fi
  luna "prompt with spaces"
' -- "$ROOT/configs/shell/zshrc"; } 2>"$tmp/stderr")"

expected=$'--provider\ncliproxyapi\n--model\ngpt-6-luna\n--thinking\nhigh\nprompt with spaces'
[[ "$output" == "$expected" ]] || {
  printf 'not ok: Luna launcher arguments differ\nexpected:\n%s\nactual:\n%s\n' "$expected" "$output" >&2
  exit 1
}
[[ ! -s "$tmp/stderr" ]] || {
  printf 'not ok: Luna launcher emitted stderr\n' >&2
  cat "$tmp/stderr" >&2
  exit 1
}

printf 'ok: shell replaces GLM with GPT-6 Luna high through cliproxyapi\n'
