#!/usr/bin/env bash
# Pinned local ai-memory server. Setup enables the user service and wires
# Claude Code, Codex, and the repository-owned Pi extension.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

AI_MEMORY_VERSION="2.1.0"
AI_MEMORY_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AI_MEMORY_SERVER_URL="${AI_MEMORY_SERVER_URL:-http://127.0.0.1:49374}"

# From the official v2.1.0 release's companion .sha256 files. Keep these in the
# repo, rather than trusting a checksum downloaded alongside the archive.
ai_memory_checksum() {
  case "$1" in
    linux-x86_64) echo b4d911f392fea7f151c9c1ff83521922417570e5104ffb02a5e82253afc877ac ;;
    linux-aarch64) echo 3eafda7afaba63008c2b0e27713c1076dff3b366c377c30f43a7b04a0d78b6c1 ;;
    macos-aarch64) echo 61811954da0ee1519024f81271cb7b34893a28d7c9e3d14d07eb80fadcf44d58 ;;
    macos-x86_64) echo 13259e2d60705d09b8b7dd8bbcea0d361b994498333095c91d0128f382a6a1da ;;
    *) return 1 ;;
  esac
}

resolve_ai_memory_bin() {
  if [[ -x "$HOME/.local/bin/ai-memory" ]]; then
    printf '%s\n' "$HOME/.local/bin/ai-memory"
    return 0
  fi
  if command -v ai-memory >/dev/null 2>&1; then
    command -v ai-memory
    return 0
  fi
  return 1
}

ai_memory_platform() {
  local os="" arch=""
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
  local platform="$1" checksum="$2"
  local bin="$HOME/.local/bin/ai-memory"
  local marker="$HOME/.local/share/ai-memory/version"
  local hooks_dir="$HOME/.local/share/ai-memory/hooks"
  local expected="$AI_MEMORY_VERSION $platform"
  local archive="ai-memory-${platform}.tar.gz"
  local tmp="" backup=""

  if [[ -x "$bin" && ! -L "$bin" && -f "$marker" && -d "$hooks_dir/claude-code" ]] && [[ "$(< "$marker")" == "$expected" ]]; then
    log_item "ai-memory: already at $AI_MEMORY_VERSION ($platform)"
    return 0
  fi
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Download and SHA256-verify $archive; install $bin, hook scripts, and version marker"
    return 0
  fi

  ensure_dir "$HOME/.local/bin" || return
  ensure_dir "$(dirname "$marker")" || return
  tmp="$(mktemp -d "$HOME/.local/bin/.ai-memory.XXXXXXXX")" || return
  trap 'rm -rf "$tmp"' EXIT
  curl --fail --silent --show-error --location --retry 3 \
    "https://github.com/akitaonrails/ai-memory/releases/download/v${AI_MEMORY_VERSION}/$archive" \
    --output "$tmp/release.tar.gz" || return
  python3 - "$tmp" "$checksum" <<'PY' || return
import hashlib
import pathlib
import shutil
import sys
import tarfile

stage = pathlib.Path(sys.argv[1])
archive = stage / "release.tar.gz"
with archive.open("rb") as stream:
    digest = hashlib.file_digest(stream, "sha256").hexdigest() if hasattr(hashlib, "file_digest") else hashlib.sha256(stream.read()).hexdigest()
if digest != sys.argv[2]:
    sys.exit("error: ai-memory archive SHA256 mismatch")
with tarfile.open(archive, "r:gz") as release:
    matches = [m for m in release.getmembers() if m.name in ("ai-memory", "./ai-memory") and m.isfile()]
    if len(matches) != 1:
        sys.exit("error: ai-memory archive must contain one regular ai-memory executable")
    with release.extractfile(matches[0]) as source, (stage / "ai-memory").open("wb") as target:
        shutil.copyfileobj(source, target)
    hook_members = []
    for member in release.getmembers():
        name = member.name[2:] if member.name.startswith("./") else member.name
        if name == "hooks" or name.startswith("hooks/"):
            if member.issym() or member.islnk() or ".." in pathlib.PurePosixPath(name).parts:
                sys.exit("error: ai-memory archive hook path is unsafe")
            hook_members.append((member, name))
    if not hook_members:
        sys.exit("error: ai-memory archive must contain a hooks/ directory")
    staged_hooks = stage / "hooks"
    if staged_hooks.exists():
        shutil.rmtree(staged_hooks)
    for member, name in hook_members:
        dest = stage / name
        if member.isdir():
            dest.mkdir(parents=True, exist_ok=True)
            continue
        if not member.isfile():
            sys.exit("error: ai-memory archive hook member must be a file or directory")
        dest.parent.mkdir(parents=True, exist_ok=True)
        with release.extractfile(member) as source, dest.open("wb") as target:
            shutil.copyfileobj(source, target)
        dest.chmod(0o755 if member.mode & 0o111 else 0o644)
(stage / "ai-memory").chmod(0o755)
PY
  if [[ -e "$bin" || -L "$bin" ]]; then
    backup="$(next_backup_path "$bin")"
    mv "$bin" "$backup" || return
    log_item "ai-memory: previous binary backed up to $backup"
  fi
  mv "$tmp/ai-memory" "$bin" || return
  rm -rf "$hooks_dir"
  mv "$tmp/hooks" "$hooks_dir" || return
  printf '%s\n' "$expected" > "$tmp/version" || return
  mv -f "$tmp/version" "$marker" || return
  log_item "ai-memory: installed $AI_MEMORY_VERSION ($platform)"
)

ai_memory_embedding_base_url() {
  local host="${OLLAMA_HOST:-}"
  host="${host%/}"
  if [[ -z "$host" || "$host" == *"0.0.0.0"* || "$host" == *"::"* ]]; then
    printf 'http://127.0.0.1:11434/v1\n'
    return 0
  fi
  if [[ "$host" != http://* && "$host" != https://* ]]; then
    host="http://${host}"
  fi
  if [[ "$host" != */v1 ]]; then
    host="${host}/v1"
  fi
  printf '%s\n' "$host"
}

configure_ai_memory_embeddings() {
  local env_file="$HOME/.config/ai-memory/env"
  local base_url=""

  base_url="$(ai_memory_embedding_base_url)"
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Point ai-memory embeddings at $base_url model qwen3-embedding:0.6b dim 1024"
    return 0
  fi

  ensure_dir "$HOME/.config/ai-memory" || return
  local output=""
  if ! output="$(python3 - "$env_file" "$base_url" <<'PY'
import os
import pathlib
import sys
import tempfile

path = pathlib.Path(sys.argv[1])
wanted = {
    "AI_MEMORY_EMBEDDING_PROVIDER": "openai-compat",
    "AI_MEMORY_EMBEDDING_BASE_URL": sys.argv[2],
    "AI_MEMORY_EMBEDDING_MODEL": "qwen3-embedding:0.6b",
    "AI_MEMORY_EMBEDDING_DIM": "1024",
}
lines = path.read_text().splitlines() if path.is_file() else []
seen = set()
rendered = []
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        rendered.append(line)
        continue
    key = stripped.split("=", 1)[0]
    if key in wanted:
        rendered.append(f"{key}={wanted[key]}")
        seen.add(key)
    else:
        rendered.append(line)
for key, value in wanted.items():
    if key not in seen:
        rendered.append(f"{key}={value}")
content = ("\n".join(rendered) + "\n").encode()
if path.is_file() and path.read_bytes() == content:
    path.chmod(0o600)
    sys.exit(0)
path.parent.mkdir(parents=True, exist_ok=True)
fd, name = tempfile.mkstemp(prefix=".ai-memory-env-", dir=path.parent)
try:
    with os.fdopen(fd, "wb") as stream:
        stream.write(content)
        os.fchmod(stream.fileno(), 0o600)
    os.replace(name, path)
finally:
    if os.path.exists(name):
        os.unlink(name)
print("updated")
PY
)"; then
    return 1
  fi
  log_item "ai-memory: embeddings qwen3-embedding:0.6b via $base_url"
  if [[ "$output" == *updated* ]] && check_installed systemctl \
    && systemctl --user is-active --quiet ai-memory.service 2>/dev/null; then
    run_cmd systemctl --user restart ai-memory.service
    log_item "ai-memory: restarted to load embedding env"
  fi
}

init_ai_memory() {
  local bin="$HOME/.local/bin/ai-memory"
  local config="$HOME/.config/ai-memory/config.toml"
  local data="$HOME/.local/share/ai-memory"

  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Initialise ai-memory data dir $data and config $config when missing"
    return 0
  fi

  ensure_dir "$HOME/.config/ai-memory" || return
  ensure_dir "$data" || return
  if [[ -f "$config" ]]; then
    log_item "ai-memory: config already present"
    return 0
  fi
  "$bin" --data-dir "$data" --config "$config" init
  log_item "ai-memory: initialised $config"
}

configure_ai_memory_service() {
  local os="$1"
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Install $os ai-memory user service definition"
    return 0
  fi

  python3 - "$HOME" "$os" <<'PY'
import os
import pathlib
import plistlib
import sys
import tempfile

home = pathlib.Path(sys.argv[1]).absolute()
os_name = sys.argv[2]
binary = str(home / ".local/bin/ai-memory")
config = str(home / ".config/ai-memory/config.toml")
data = str(home / ".local/share/ai-memory")


def write_private(path, content, mode=0o644):
    path = pathlib.Path(path)
    if not path.is_symlink() and path.is_file() and path.read_bytes() == content:
        path.chmod(mode)
        return
    if path.exists() and path.is_dir() and not path.is_symlink():
        sys.exit("error: ai-memory destination is a directory: " + str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".ai-memory-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            os.fchmod(stream.fileno(), mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


if os_name == "linux":
    def unit_quote(value, executable=False):
        value = value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
        if executable:
            value = value.replace("$", "$$")
        return '"' + value + '"'

    service = "\n".join([
        "[Unit]",
        "Description=ai-memory local project memory server",
        "Documentation=https://github.com/akitaonrails/ai-memory",
        "After=network.target",
        "",
        "[Service]",
        "Type=simple",
        "EnvironmentFile=-%h/.config/ai-memory/env",
        "ExecStart=" + unit_quote(binary, True)
        + " --data-dir " + unit_quote(data, True)
        + " --config " + unit_quote(config, True)
        + " serve --transport http --bind 127.0.0.1:49374 --enable-web",
        "WorkingDirectory=%h/.local/share/ai-memory",
        "Restart=on-failure",
        "RestartSec=5",
        "NoNewPrivileges=true",
        "PrivateTmp=true",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
    ])
    write_private(home / ".config/systemd/user/ai-memory.service", service.encode(), 0o644)
else:
    service = {
        "Label": "dev.ai-memory",
        "ProgramArguments": [
            binary,
            "--data-dir", data,
            "--config", config,
            "serve",
            "--transport", "http",
            "--bind", "127.0.0.1:49374",
            "--enable-web",
        ],
        "WorkingDirectory": data,
        "EnvironmentVariables": {"HOME": str(home)},
        "Disabled": False,
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 5,
        "StandardOutPath": str(pathlib.Path(data) / "stdout.log"),
        "StandardErrorPath": str(pathlib.Path(data) / "stderr.log"),
    }
    write_private(home / "Library/LaunchAgents/dev.ai-memory.plist", plistlib.dumps(service), 0o600)
print("  ai-memory: user service definition installed")
PY
}

enable_ai_memory_linux() {
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Enable and start ai-memory systemd user service"
    return 0
  fi
  if ! check_installed systemctl; then
    log_item "systemctl not available, skipping ai-memory service enable"
    return 0
  fi
  run_cmd systemctl --user daemon-reload
  run_cmd systemctl --user enable --now ai-memory.service
  log_item "ai-memory: Linux user service enabled"
}

enable_ai_memory_macos() {
  local domain service
  domain="gui/$(id -u)" || return
  service="$domain/dev.ai-memory"
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Enable and start ai-memory macOS LaunchAgent (leave an already loaded service running)"
    return 0
  fi

  launchctl enable "$service" || return
  if launchctl print "$service" >/dev/null 2>&1; then
    log_item "ai-memory: macOS LaunchAgent enabled and already loaded"
  else
    launchctl bootstrap "$domain" "$HOME/Library/LaunchAgents/dev.ai-memory.plist" || return
    log_item "ai-memory: macOS LaunchAgent enabled and started"
  fi
}

configure_ai_memory_agents() {
  local bin=""
  local pi_extension="$AI_MEMORY_REPO_ROOT/configs/agents/pi/extensions/ai-memory-pi.ts"

  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Wire ai-memory MCP and hooks for Claude Code and Codex; keep the pinned Pi extension"
    return 0
  fi

  if ! bin="$(resolve_ai_memory_bin 2>/dev/null)"; then
    log_item "ai-memory not available, skipping agent wiring"
    return 0
  fi

  if [[ ! -f "$pi_extension" ]] || ! grep -q 'const AGENT = "pi";' "$pi_extension"; then
    log_item "ai-memory Pi extension is not current; refresh configs/agents/pi/extensions/ai-memory-pi.ts from the pinned ai-memory release"
  fi

  if [[ -d "$HOME/.claude" ]]; then
    run_cmd "$bin" install-mcp --client claude-code --apply --server-url "$AI_MEMORY_SERVER_URL"
    run_cmd "$bin" install-hooks --agent claude-code --apply --server-url "$AI_MEMORY_SERVER_URL" \
      --hooks-dir "$HOME/.local/share/ai-memory/hooks"
  else
    log_item "Claude Code config missing, skipping ai-memory Claude wiring"
  fi

  if [[ -d "$HOME/.codex" ]]; then
    run_cmd "$bin" install-mcp --client codex --apply --server-url "$AI_MEMORY_SERVER_URL"
    run_cmd "$bin" install-hooks --agent codex --apply --server-url "$AI_MEMORY_SERVER_URL" \
      --hooks-dir "$HOME/.local/share/ai-memory/hooks"
  else
    log_item "Codex config missing, skipping ai-memory Codex wiring"
  fi
}

install_ai_memory() {
  local os="" platform="" checksum=""
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) printf 'error: ai-memory supports Linux and macOS only\n' >&2; return 1 ;;
  esac
  platform="$(ai_memory_platform)" || return
  checksum="$(ai_memory_checksum "$platform")" || return
  install_ai_memory_binary "$platform" "$checksum" || return
  init_ai_memory || return
  configure_ai_memory_embeddings || return
  configure_ai_memory_service "$os" || return
  if [[ "$os" == darwin ]]; then
    enable_ai_memory_macos || return
  else
    enable_ai_memory_linux || return
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  install_ai_memory
fi
