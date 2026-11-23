#!/usr/bin/env bash
# Real installer/filesystem, fake release binary and service-manager boundaries.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/install/ai-memory.sh"
TEST_TMP="$(mktemp -d)"
TEST_TMP="$(cd "$TEST_TMP" && pwd -P)"
trap 'rm -rf "$TEST_TMP"' EXIT
PYTHON_BIN="$(python3 -c 'import sys; print(sys.executable)')"
mkdir -p "$TEST_TMP/tools"
ln -s "$PYTHON_BIN" "$TEST_TMP/tools/python3"
export PATH="$TEST_TMP/tools:$PATH" TEST_TMP
export HOME="$TEST_TMP/home with spaces"
curl() {
  local output=""
  while (( $# )); do
    if [[ "$1" == --output ]]; then output="$2"; shift; fi
    shift
  done
  printf 'download\n' >> "$TEST_TMP/downloads"
  cp "$TEST_TMP/release.tar.gz" "$output"
}
launchctl() {
  printf '%s\n' "$*" >> "$TEST_TMP/services"
  case "$1" in
    print) [[ -f "$TEST_TMP/loaded" ]] ;;
    bootout) rm "$TEST_TMP/loaded" ;;
    disable) return 0 ;;
    *) return 99 ;;
  esac
}
systemctl() { printf '%s\n' "$*" >> "$TEST_TMP/services"; }
uname() {
  case "$1" in
    -s) echo "${TEST_OS:-Linux}" ;;
    -m) echo "${TEST_ARCH:-x86_64}" ;;
  esac
}
for TEST_OS in Linux Darwin; do
  for TEST_ARCH in x86_64 aarch64; do
    DRY_RUN=1 install_ai_memory >> "$TEST_TMP/dry-run.log"
    DRY_RUN=1 configure_ai_memory_agents >> "$TEST_TMP/dry-run.log"
  done
done
[[ ! -e "$HOME" && ! -e "$TEST_TMP/downloads" ]]
echo 'ok: platform dry runs neither download nor write nor execute upstream setup'
python3 - "$TEST_TMP" <<'PY'
import hashlib, io, pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
binary = b'''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
if args[:3] == ["install-mcp", "--client", "antigravity-cli"]:
    staged = pathlib.Path(args[args.index("--config-file") + 1])
    assert staged.parent.stat().st_mode & 0o077 == 0
    if (pathlib.Path(os.environ["TEST_TMP"]) / "edit-during-plan").exists():
        (pathlib.Path.home() / ".gemini/config/mcp_config.json").write_text('{"concurrent":"keep"}')
    staged.write_text(json.dumps({"mcpServers": {"ai-memory": {"serverUrl": "http://127.0.0.1:49374/mcp", "headers": {"Authorization": "Bearer fixture"}}}}))
    args = args[:args.index("--config-file")] + ["--config-file", "<private stage>"]
with (pathlib.Path(os.environ["TEST_TMP"]) / "calls.jsonl").open("a") as f:
    f.write(json.dumps({"args": args, "cwd": os.getcwd(), "overrides": [k for k in os.environ if k.startswith("AI_MEMORY_")]}) + "\\n")
'''
with tarfile.open(root / "release.tar.gz", "w:gz") as archive:
    entry = tarfile.TarInfo("ai-memory")
    entry.size = len(binary)
    archive.addfile(entry, io.BytesIO(binary))
    for agent in ("claude-code", "codex", "antigravity-cli"):
        directory = tarfile.TarInfo("hooks/" + agent)
        directory.type = tarfile.DIRTYPE
        archive.addfile(directory)
(root / "sha256").write_text(hashlib.sha256((root / "release.tar.gz").read_bytes()).hexdigest())
PY
ai_memory_checksum() { printf '%s\n' "$(< "$TEST_TMP/sha256")"; }
mkdir -p "$HOME/.local/bin" "$HOME/Library/LaunchAgents" "$HOME/.config/ai-memory"
ln -s "$REPO_ROOT/configs/ai-memory/ai-memory" "$HOME/.local/bin/ai-memory"
printf 'old repo plist\n' > "$HOME/Library/LaunchAgents/dev.ai-memory.plist"
touch "$TEST_TMP/loaded"
printf 'AI_MEMORY_EMBEDDING_PROVIDER=openai-compat\nAI_MEMORY_EMBEDDING_MODEL=qwen3-embedding:0.6b\nAI_MEMORY_EMBEDDING_DIM=1024\nAI_MEMORY_EMBEDDING_BASE_URL=http://old-ollama:11434/v1\nCUSTOM=keep\n' > "$HOME/.config/ai-memory/env"
TEST_OS=Darwin TEST_ARCH=aarch64 DRY_RUN=0 install_ai_memory > "$TEST_TMP/install.log" 2>&1
TEST_OS=Darwin TEST_ARCH=aarch64 DRY_RUN=0 install_ai_memory >> "$TEST_TMP/install.log" 2>&1
[[ "$(wc -l < "$TEST_TMP/downloads")" -eq 1 ]]
[[ "$(grep -c '^bootout ' "$TEST_TMP/services")" -eq 1 ]]
[[ ! -e "$TEST_TMP/loaded" ]]
python3 - "$HOME" <<'PY'
from pathlib import Path
import sys
home = Path(sys.argv[1])
assert (home / ".local/bin/ai-memory").readlink() == home / ".local/lib/ai-memory/ai-memory"
assert (home / ".local/lib/ai-memory/version").read_text() == "3.5.1 macos-aarch64\n"
assert (home / "Library/LaunchAgents/dev.ai-memory.plist.bak").read_text() == "old repo plist\n"
assert (home / ".config/ai-memory/env").read_text() == "CUSTOM=keep\n"
PY
echo 'ok: repeat install links actual upstream binary, retires old service, removes only managed embedding overrides'
# Fake only the downstream Codex adjustment's Python runtime; its real behavior
# is covered by ai-memory-clients.test.py with the actual TOML writer.
mkdir -p "$HOME/.local/share/mcp-services/venv/bin"
cat > "$HOME/.local/share/mcp-services/venv/bin/python" <<'SH'
#!/bin/sh
case "$1" in */antigravity-client.py) exec python3 "$@";; esac
printf 'codex-bridge\n' >> "$TEST_TMP/adjustments"
SH
chmod +x "$HOME/.local/share/mcp-services/venv/bin/python"
export AI_MEMORY_SERVER_URL=https://retired.invalid AI_MEMORY_AUTH_TOKEN=obsolete AI_MEMORY_DATA_DIR=/wrong
agy="$HOME/.gemini/config/mcp_config.json"
mkdir -p "${agy%/*}"
printf '{"mcpServers":{"custom":{"command":"keep"}}}\n' > "$agy"
DRY_RUN=0 configure_ai_memory_agents >> "$TEST_TMP/install.log" 2>&1
python3 - "$HOME" "$TEST_TMP" <<'PY'
import json
from pathlib import Path
import sys
home, root = map(Path, sys.argv[1:])
calls = [json.loads(line) for line in (root / "calls.jsonl").read_text().splitlines()]
assert calls == [
    {"args": ["setup", "--yes", "--agent", "claude-code", "--agent", "codex", "--agent", "pi"], "cwd": str(home), "overrides": []},
    {"args": ["install-mcp", "--client", "claude-desktop", "--apply"], "cwd": str(home), "overrides": []},
    {"args": ["install-mcp", "--client", "antigravity-cli", "--apply", "--config-file", "<private stage>"], "cwd": str(home), "overrides": []},
    {"args": ["install-hooks", "--agent", "antigravity-cli", "--apply"], "cwd": str(home), "overrides": []},
    {"args": ["install-skills", "--scope", "global", "--agent", "antigravity"], "cwd": str(home), "overrides": []},
]
assert (root / "adjustments").read_text() == "codex-bridge\n"
path = home / '.gemini/config/mcp_config.json'
config = json.loads(path.read_bytes())
assert config == {'mcpServers': {'custom': {'command': 'keep'}, 'ai-memory': {
    'serverUrl': 'http://127.0.0.1:49374/mcp', 'headers': {'Authorization': 'Bearer fixture'}}}}
assert path.stat().st_mode & 0o777 == 0o600
assert path.with_suffix('.json.bak').stat().st_mode & 0o777 == 0o600
config['mcpServers']['ai-memory'].update(disabled=True, disabledTools=['memory_delete_page'], headers={'X-Custom': 'keep'})
path.write_text(json.dumps(config))
PY
cp "$agy" "$TEST_TMP/restricted"
DRY_RUN=0 configure_ai_memory_agents >> "$TEST_TMP/install.log" 2>&1
cmp "$agy" "$TEST_TMP/restricted"
[[ ! -e "$agy.bak.1" ]]
echo 'ok: refresh retains complete restricted Antigravity entry, auth and unrelated entries'
printf '%s' '{"mcpServers":{"ai-memory":{"command":"unrelated"}}}' > "$agy"
cp "$agy" "$TEST_TMP/conflict"
before_adjustments="$(wc -l < "$TEST_TMP/adjustments")"
if DRY_RUN=0 configure_ai_memory_agents >> "$TEST_TMP/install.log" 2>&1; then exit 1; fi
cmp "$agy" "$TEST_TMP/conflict"
[[ "$(wc -l < "$TEST_TMP/adjustments")" -eq $((before_adjustments + 1)) ]]
python3 - "$TEST_TMP/calls.jsonl" <<'PY'
import json, pathlib, sys
calls = [json.loads(line)['args'] for line in pathlib.Path(sys.argv[1]).read_text().splitlines()]
assert calls[-2] == ['install-mcp', '--client', 'claude-desktop', '--apply']
assert calls[-1][:3] == ['install-mcp', '--client', 'antigravity-cli']
PY
echo 'ok: Antigravity conflict leaves Desktop configured and Codex bridge adjustment completed'
grep -q 'different or unclear ai-memory transport' "$TEST_TMP/install.log"
printf '{' > "$agy"
cp "$TEST_TMP/calls.jsonl" "$TEST_TMP/before-invalid"
if DRY_RUN=0 configure_ai_memory_agents >> "$TEST_TMP/install.log" 2>&1; then exit 1; fi
cmp "$TEST_TMP/before-invalid" "$TEST_TMP/calls.jsonl"
rm "$agy"
ln -s "$TEST_TMP/restricted" "$agy"
if DRY_RUN=0 configure_ai_memory_agents >> "$TEST_TMP/install.log" 2>&1; then exit 1; fi
cmp "$TEST_TMP/before-invalid" "$TEST_TMP/calls.jsonl"
echo 'ok: refuses different transport, malformed JSON, and symlinked Antigravity config'
rm "$agy"
touch "$TEST_TMP/edit-during-plan"
if DRY_RUN=0 configure_ai_memory_agents >> "$TEST_TMP/install.log" 2>&1; then exit 1; fi
[[ "$(< "$agy")" == '{"concurrent":"keep"}' ]]
grep -q 'Antigravity config changed during planning' "$TEST_TMP/install.log"
echo 'ok: an edit during upstream rendering survives; setup asks for retry'
echo 'ok: delegates service/hooks/skills/MCP to upstream setup, with no stale cloud overrides or hook-trust bypass'
cp "$TEST_TMP/services" "$TEST_TMP/services-before"
cp "$HOME/.local/lib/ai-memory/ai-memory" "$TEST_TMP/original-binary"
ai_memory_checksum() { echo invalid; }
if TEST_OS=Linux TEST_ARCH=x86_64 DRY_RUN=0 install_ai_memory > "$TEST_TMP/mismatch.log" 2>&1; then exit 1; fi
cmp "$TEST_TMP/services-before" "$TEST_TMP/services"
cmp "$TEST_TMP/original-binary" "$HOME/.local/lib/ai-memory/ai-memory"
grep -q 'SHA256 mismatch' "$TEST_TMP/mismatch.log"
echo 'ok: rejected archive leaves the binary and services untouched'
if bash "$REPO_ROOT/install/ai-memory.sh" dev --dry-run >/dev/null 2>&1; then exit 1; fi
echo 'ok: retired dev host rejected'
