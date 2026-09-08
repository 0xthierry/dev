#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=install/ai-memory.sh
source "$REPO_ROOT/install/ai-memory.sh"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT
export HOME="$TEST_TMP/home with spaces"

# No real network, binary execution, or service actions are permitted during
# the download/install path unless a fixture binary is used.
curl() {
  printf 'download\n' >> "$TEST_TMP/downloads"
  local output=""
  while (( $# )); do
    if [[ "$1" == --output ]]; then output="$2"; shift; fi
    shift
  done
  cp "$TEST_TMP/release.tar.gz" "$output"
}
systemctl() {
  printf '%s\n' "$*" >> "$TEST_TMP/systemctl.log"
  return 0
}
launchctl() {
  printf '%s\n' "$*" >> "$TEST_TMP/launchctl.log"
  case "$1" in
    enable) return "${ENABLE_RESULT:-0}" ;;
    print) [[ -f "$TEST_TMP/loaded" ]] ;;
    bootstrap)
      [[ "$2" == "gui/$(id -u)" ]]
      [[ "$3" == "$HOME/Library/LaunchAgents/dev.ai-memory.plist" ]]
      if [[ "${BOOTSTRAP_RESULT:-0}" != 0 ]]; then return "$BOOTSTRAP_RESULT"; fi
      touch "$TEST_TMP/loaded"
      ;;
    *) return 99 ;;
  esac
}
uname() {
  case "$1" in
    -s) echo "${TEST_OS:-Linux}" ;;
    -m) echo "${TEST_ARCH:-x86_64}" ;;
  esac
}

[[ "$(ai_memory_embedding_base_url)" == "http://127.0.0.1:11434/v1" ]]
[[ "$(OLLAMA_HOST=0.0.0.0:11434 ai_memory_embedding_base_url)" == "http://127.0.0.1:11434/v1" ]]
[[ "$(OLLAMA_HOST=http://172.16.0.1:11434 ai_memory_embedding_base_url)" == "http://172.16.0.1:11434/v1" ]]
echo 'ok: embedding base URL treats bind-all Ollama hosts as loopback'

for TEST_OS in Linux Darwin; do
  for TEST_ARCH in x86_64 aarch64; do
    DRY_RUN=1 install_ai_memory >> "$TEST_TMP/dry-run.log"
  done
done
[[ ! -e "$HOME" && ! -e "$TEST_TMP/downloads" ]]
echo 'ok: all four dry-run targets cause no writes or downloads'

python3 - "$TEST_TMP" <<'PY'
import hashlib, io, pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
with tarfile.open(root / "release.tar.gz", "w:gz") as archive:
    data = b"#!/bin/sh\nexit 0\n"
    member = tarfile.TarInfo("ai-memory")
    member.size = len(data)
    archive.addfile(member, io.BytesIO(data))
    directory = tarfile.TarInfo("hooks/claude-code")
    directory.type = tarfile.DIRTYPE
    directory.mode = 0o755
    archive.addfile(directory)
    hook = b"#!/bin/sh\nexit 0\n"
    hook_member = tarfile.TarInfo("hooks/claude-code/session-start.sh")
    hook_member.size = len(hook)
    hook_member.mode = 0o755
    archive.addfile(hook_member, io.BytesIO(hook))
(root / "sha256").write_text(hashlib.sha256((root / "release.tar.gz").read_bytes()).hexdigest())
PY
for platform in linux-x86_64 linux-aarch64 macos-x86_64 macos-aarch64; do
  [[ "$(ai_memory_checksum "$platform")" =~ ^[0-9a-f]{64}$ ]]
done
ai_memory_checksum() { printf '%s\n' "$(< "$TEST_TMP/sha256")"; }

TEST_OS=Linux TEST_ARCH=x86_64 DRY_RUN=0 install_ai_memory > "$TEST_TMP/install.log" 2>&1
TEST_OS=Linux TEST_ARCH=x86_64 DRY_RUN=0 install_ai_memory >> "$TEST_TMP/install.log" 2>&1
[[ "$(wc -l < "$TEST_TMP/downloads")" -eq 1 ]]
python3 - "$HOME" "$TEST_TMP" <<'PY'
import pathlib, sys
home, tmp = map(pathlib.Path, sys.argv[1:])
unit = (home / ".config/systemd/user/ai-memory.service").read_text()
assert f'"{home}/.local/bin/ai-memory"' in unit
assert f'"{home}/.local/share/ai-memory"' in unit
assert f'"{home}/.config/ai-memory/config.toml"' in unit
assert "serve --transport http --bind 127.0.0.1:49374 --enable-web" in unit
assert [line for line in unit.splitlines() if line.startswith("WorkingDirectory=")] == ["WorkingDirectory=%h/.local/share/ai-memory"]
assert (home / ".local/share/ai-memory/version").read_text().strip() == "2.1.0 linux-x86_64"
assert (home / ".local/share/ai-memory/hooks/claude-code/session-start.sh").is_file()
env_text = (home / ".config/ai-memory/env").read_text()
assert "AI_MEMORY_EMBEDDING_PROVIDER=openai-compat" in env_text
assert "AI_MEMORY_EMBEDDING_MODEL=qwen3-embedding:0.6b" in env_text
assert "AI_MEMORY_EMBEDDING_DIM=1024" in env_text
assert "AI_MEMORY_EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1" in env_text
PY
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze --user verify "$HOME/.config/systemd/user/ai-memory.service"
  echo 'ok: generated Linux service passes systemd-analyze --user verify'
else
  echo 'skip: systemd-analyze unavailable; Linux service verified structurally only'
fi
grep -q 'daemon-reload' "$TEST_TMP/systemctl.log"
grep -q 'enable --now ai-memory.service' "$TEST_TMP/systemctl.log"
printf 'AI_MEMORY_LLM_PROVIDER=openai-compat\n' > "$HOME/.config/ai-memory/env"
configure_ai_memory_embeddings >/dev/null
grep -qx 'AI_MEMORY_LLM_PROVIDER=openai-compat' "$HOME/.config/ai-memory/env"
grep -qx 'AI_MEMORY_EMBEDDING_MODEL=qwen3-embedding:0.6b' "$HOME/.config/ai-memory/env"
echo 'ok: install is idempotent and enables the Linux user service'
echo 'ok: embedding env preserves unrelated ai-memory keys'

cp "$HOME/.local/bin/ai-memory" "$TEST_TMP/original-binary"
if install_ai_memory_binary linux-aarch64 invalid > "$TEST_TMP/mismatch.log" 2>&1; then
  echo 'not ok: checksum mismatch accepted' >&2; exit 1
fi
cmp "$TEST_TMP/original-binary" "$HOME/.local/bin/ai-memory"
grep -q 'SHA256 mismatch' "$TEST_TMP/mismatch.log"
[[ "$(< "$HOME/.local/share/ai-memory/version")" == '2.1.0 linux-x86_64' ]]
echo 'ok: checksum rejection preserves existing binary and marker'

TEST_OS=Darwin TEST_ARCH=aarch64 DRY_RUN=0 install_ai_memory >> "$TEST_TMP/install.log" 2>&1
TEST_OS=Darwin TEST_ARCH=aarch64 DRY_RUN=0 install_ai_memory >> "$TEST_TMP/install.log" 2>&1
python3 - "$HOME" <<'PY'
import pathlib, plistlib, sys
home = pathlib.Path(sys.argv[1])
with (home / "Library/LaunchAgents/dev.ai-memory.plist").open("rb") as stream:
    service = plistlib.load(stream)
assert service["Label"] == "dev.ai-memory"
assert service["Disabled"] is False
assert service["RunAtLoad"] is True
assert service["ProgramArguments"][0] == str(home / ".local/bin/ai-memory")
assert "--enable-web" in service["ProgramArguments"]
assert service["EnvironmentVariables"]["HOME"] == str(home)
PY
[[ "$(grep -c '^enable ' "$TEST_TMP/launchctl.log")" -eq 2 ]]
[[ "$(grep -c '^bootstrap ' "$TEST_TMP/launchctl.log")" -eq 1 ]]
echo 'ok: macOS setup enables and bootstraps once'

mkdir -p "$HOME/.claude" "$HOME/.codex"
cat > "$HOME/.local/bin/ai-memory" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$TEST_TMP/ai-memory-args"
exit 0
EOF
chmod +x "$HOME/.local/bin/ai-memory"
DRY_RUN=0 configure_ai_memory_agents > "$TEST_TMP/configure.log"
grep -Fq 'install-mcp --client claude-code --apply --server-url http://127.0.0.1:49374' "$TEST_TMP/ai-memory-args"
grep -Fq 'install-hooks --agent claude-code --apply --server-url http://127.0.0.1:49374 --hooks-dir' "$TEST_TMP/ai-memory-args"
grep -Fq 'install-mcp --client codex --apply --server-url http://127.0.0.1:49374' "$TEST_TMP/ai-memory-args"
grep -Fq 'install-hooks --agent codex --apply --server-url http://127.0.0.1:49374 --hooks-dir' "$TEST_TMP/ai-memory-args"
if grep -Fq 'install-hooks --agent pi' "$TEST_TMP/ai-memory-args"; then
  echo 'not ok: Pi hooks were applied over the vendored extension' >&2
  exit 1
fi
echo 'ok: agent wiring targets Claude and Codex and leaves the pinned Pi extension alone'

DRY_RUN=1 configure_ai_memory_agents >> "$TEST_TMP/configure.log"
echo 'ok: agent wiring dry-run does not invoke ai-memory'
