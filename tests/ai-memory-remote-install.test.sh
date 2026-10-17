#!/usr/bin/env bash
# Isolated installer boundary: no real download, service action, or HOME writes.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/install/ai-memory.sh"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT
export HOME="$TEST_TMP/home with spaces"
export SETUP_HOST=omarchy
mkdir -p "$HOME/.config/ai-memory" "$HOME/.config/systemd/user" "$HOME/.local/share/ai-memory/wiki"
printf 'aim_fixture_machine_user_key_01234567890123456789\n' > "$HOME/.config/ai-memory/api-key"
chmod 600 "$HOME/.config/ai-memory/api-key"
printf 'old memory stays\n' > "$HOME/.local/share/ai-memory/wiki/keep.md"
printf '[Service]\n' > "$HOME/.config/systemd/user/ai-memory.service"

systemctl() { printf '%s\n' "$*" >> "$TEST_TMP/services"; }
install_ai_memory_binary() {
  [[ "$AI_MEMORY_VERSION" == 3.1.0 ]]
  [[ "$AI_MEMORY_BIN_PATH" == "$HOME/.local/share/ai-memory-client/bin/ai-memory" ]]
  [[ "$2" == 670f9cffd2e9aeb6c8b533c15ec9c3fddd0a3070d5ef2fd3dc6fa8251cb7990d ]]
  if (( ${DRY_RUN:-0} )); then return; fi
  mkdir -p "$(dirname "$AI_MEMORY_BIN_PATH")"
  printf '#!/bin/sh\nexit 0\n' > "$AI_MEMORY_BIN_PATH"
  chmod +x "$AI_MEMORY_BIN_PATH"
}
uname() { case "$1" in -s) echo Linux;; -m) echo aarch64;; esac; }
DRY_RUN=1 install_ai_memory
[[ ! -e "$HOME/.config/ai-memory/client.json" && ! -e "$TEST_TMP/services" ]]
DRY_RUN=0 install_ai_memory
[[ -L "$HOME/.local/bin/ai-memory" ]]
[[ "$(readlink "$HOME/.local/bin/ai-memory")" == "$REPO_ROOT/configs/ai-memory/client.py" ]]
[[ "$(< "$TEST_TMP/services")" == '--user disable --now ai-memory.service' ]]
[[ "$(< "$HOME/.local/share/ai-memory/wiki/keep.md")" == 'old memory stays' ]]
[[ ! -f "$HOME/.local/share/ai-memory-client/memory.db" ]]
python3 - "$HOME" <<'PY'
import pathlib,sys,tomllib
home=pathlib.Path(sys.argv[1])
config=tomllib.loads((home/'.local/share/ai-memory-client/config.toml').read_text())
assert config['server_url']=='https://ai-memory-cloud.tail4e339.ts.net'
assert config['embedding_provider']=='none'
assert config['auth']['bearer_token_file']==str(home/'.config/ai-memory/api-key')
PY
printf 'ok: remote installer installs only 3.1 client, stops owned local service, preserves data; dry-run has no side effects\n'
