#!/usr/bin/env bash
# Pinned upstream binary + upstream native setup. No custom runtime or Pi patch.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

AI_MEMORY_VERSION="3.5.1"

# From the official v3.5.1 release's companion .sha256 files.
ai_memory_checksum() {
  case "$1" in
    linux-x86_64) echo 0e82461025db99cc8794b07708b43953ea111ffa7f26592ff896bbf64eb412bb ;;
    linux-aarch64) echo 120514a9279ee1d8036153da430feef25091477081030337c63bbee1c93be7eb ;;
    macos-aarch64) echo fda158379dc03331e5c71ab6b702a9335c7fc41e75dda4a2b1a7d1e8e98aaf04 ;;
    macos-x86_64) echo 49ff09af2eb904abf077a4a2a87660cad7800c6d6f4843abcab487f9315577c9 ;;
    *) return 1 ;;
  esac
}

ai_memory_platform() {
  local os arch
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=macos ;;
    *) printf 'error: ai-memory supports Linux and macOS only\n' >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x86_64 ;;
    arm64|aarch64) arch=aarch64 ;;
    *) printf 'error: unsupported ai-memory CPU architecture\n' >&2; return 1 ;;
  esac
  printf '%s-%s\n' "$os" "$arch"
}

install_ai_memory_binary() (
  set -euo pipefail
  local platform="$1" checksum="$2" runtime="$HOME/.local/lib/ai-memory"
  local bin="$runtime/ai-memory" marker="$runtime/version"
  local expected="$AI_MEMORY_VERSION $platform" tmp
  if [[ -x "$bin" && ! -L "$bin" && -f "$marker" && -d "$runtime/hooks/claude-code" && -d "$runtime/hooks/codex" && -d "$runtime/hooks/antigravity-cli" ]] \
    && [[ "$(< "$marker")" == "$expected" ]]; then
    log_item "ai-memory: already at $AI_MEMORY_VERSION ($platform)"
    return
  fi
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Download and SHA256-verify ai-memory $AI_MEMORY_VERSION ($platform)"
    return
  fi
  ensure_dir "$runtime" || return
  tmp="$(mktemp -d "$runtime/.ai-memory.XXXXXXXX")" || return
  trap 'rm -rf "$tmp"' EXIT
  curl --fail --silent --show-error --location --retry 3 \
    "https://github.com/akitaonrails/ai-memory/releases/download/v${AI_MEMORY_VERSION}/ai-memory-${platform}.tar.gz" \
    --output "$tmp/release.tar.gz" || return
  python3 - "$tmp" "$checksum" <<'PY' || return
import hashlib
from pathlib import Path
import shutil
import sys
import tarfile

stage = Path(sys.argv[1])
archive = stage / "release.tar.gz"
if hashlib.sha256(archive.read_bytes()).hexdigest() != sys.argv[2]:
    sys.exit("error: ai-memory archive SHA256 mismatch")
with tarfile.open(archive, "r:gz") as release:
    matches = [m for m in release.getmembers() if m.name in ("ai-memory", "./ai-memory") and m.isfile()]
    if len(matches) != 1:
        sys.exit("error: ai-memory archive must contain one regular executable")
    with release.extractfile(matches[0]) as source, (stage / "ai-memory").open("wb") as target:
        shutil.copyfileobj(source, target)
    for member in release.getmembers():
        name = member.name.removeprefix("./")
        if not name.startswith("hooks/"):
            continue
        if ".." in Path(name).parts or not (member.isdir() or member.isfile()):
            sys.exit("error: unsafe ai-memory hook archive member")
        target = stage / name
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with release.extractfile(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)
    if not all((stage / "hooks" / agent).is_dir() for agent in ("claude-code", "codex", "antigravity-cli")):
        sys.exit("error: ai-memory archive is missing its hook bundle")
(stage / "ai-memory").chmod(0o755)
PY
  mv -f "$tmp/ai-memory" "$bin" || return
  rm -rf "$runtime/hooks" || return
  mv "$tmp/hooks" "$runtime/hooks" || return
  printf '%s\n' "$expected" > "$tmp/version" || return
  mv -f "$tmp/version" "$marker" || return
  log_item "ai-memory: installed $AI_MEMORY_VERSION ($platform)"
)

retire_ai_memory_custom_service() {
  # Retire only the old repo service. Upstream setup owns the replacement.
  local path service
  if [[ "$(uname -s)" == Darwin ]]; then
    path="$HOME/Library/LaunchAgents/dev.ai-memory.plist"
    service="gui/$(id -u)/dev.ai-memory"
    if [[ -f "$path" ]]; then
      if launchctl print "$service" >/dev/null 2>&1; then launchctl bootout "$service" || return; fi
      launchctl disable "$service" || return
      mv "$path" "$(next_backup_path "$path")" || return
    fi
  else
    path="$HOME/.config/systemd/user/ai-memory.service"
    if [[ -f "$path" ]] && grep -q 'Description=ai-memory local project memory server' "$path"; then
      systemctl --user disable --now ai-memory.service || return
      mv "$path" "$(next_backup_path "$path")" || return
      systemctl --user daemon-reload || return
    fi
  fi
  # The upstream Linux unit reads this file. Retire the old repo's Ollama
  # embedding overrides, but never discard unrelated operator settings.
  python3 "$REPO_ROOT/configs/ai-memory/retire-env.py"
}

install_ai_memory() {
  local platform checksum launcher="$HOME/.local/bin/ai-memory" binary="$HOME/.local/lib/ai-memory/ai-memory"
  platform="$(ai_memory_platform)" || return
  checksum="$(ai_memory_checksum "$platform")" || return
  install_ai_memory_binary "$platform" "$checksum" || return
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Replace legacy launcher with direct upstream binary link; retire old repo service"
    return
  fi
  retire_ai_memory_custom_service || return
  ensure_dir "$HOME/.local/bin"
  if [[ ! -L "$launcher" || "$(readlink "$launcher")" != "$binary" ]]; then
    if [[ -e "$launcher" || -L "$launcher" ]]; then mv "$launcher" "$(next_backup_path "$launcher")"; fi
    ln -s "$binary" "$launcher"
  fi
}

configure_ai_memory_agents() (
  # Use upstream's default platform paths, credentials, service, hooks and
  # skills. Strip stale cloud/previous custom-runtime overrides for setup only.
  local name runtime="$HOME/.local/share/mcp-services/venv/bin/python"
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] ai-memory setup --yes --agent claude-code --agent codex --agent pi"
    log_item "[dry-run] Configure Antigravity MCP without replacing existing policy; install upstream hooks and skills"
    log_item "[dry-run] Install upstream Claude Desktop MCP; use upstream Codex bridge for GUI file-token auth"
    log_item "[dry-run] Codex /hooks trust approval remains manual"
    return
  fi
  for name in ${!AI_MEMORY_@}; do unset "$name"; done
  cd "$HOME" || return
  "$runtime" "$REPO_ROOT/configs/ai-memory/antigravity-client.py" --preflight || return
  "$HOME/.local/bin/ai-memory" setup --yes --agent claude-code --agent codex --agent pi || return
  "$HOME/.local/bin/ai-memory" install-mcp --client claude-desktop --apply || return
  # Upstream's Codex plugin uses this bridge too. The bare Codex writer instead
  # requires exporting a root token in the GUI's environment. Keep upstream's
  # tool approval policy, replacing only that transport with file-backed auth.
  "$runtime" "$REPO_ROOT/configs/ai-memory/codex-bridge.py" || return
  # Finish existing clients before an Antigravity-specific failure can interrupt
  # setup, particularly the GUI-safe Codex transport adjustment above.
  "$runtime" "$REPO_ROOT/configs/ai-memory/antigravity-client.py" || return
  # setup prints Codex's real trust state. Never accept hooks on the user's behalf.
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  SETUP_HOST="${1:-}"
  DRY_RUN=0
  case "$SETUP_HOST" in
    macbook|omarchy) ;;
    *) printf 'Usage: bash install/ai-memory.sh <macbook|omarchy> [--dry-run]\n' >&2; exit 2 ;;
  esac
  if [[ $# -eq 2 && "$2" == --dry-run ]]; then DRY_RUN=1
  elif [[ $# -ne 1 ]]; then
    printf 'Usage: bash install/ai-memory.sh <macbook|omarchy> [--dry-run]\n' >&2; exit 2
  fi
  runtime="$HOME/.local/share/mcp-services/venv/bin/python"
  if (( ! DRY_RUN )) && [[ ! -x "$runtime" ]]; then
    printf 'error: shared MCP runtime missing; run normal host setup first\n' >&2; exit 1
  fi
  install_ai_memory
  configure_ai_memory_agents
  run_cmd "$runtime" "$REPO_ROOT/configs/mcp/configure-clients.py" "$SETUP_HOST"
fi
