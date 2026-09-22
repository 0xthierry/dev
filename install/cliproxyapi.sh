#!/usr/bin/env bash
# Pinned local OAuth proxy. macOS setup enables and starts the user LaunchAgent.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CLIPROXYAPI_VERSION="7.3.12"
CLIPROXYAPI_PLUGIN_BUILD_VERSION="1"
CLIPROXYAPI_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# From the official v7.3.12 release's checksums.txt. Keep these in the repo,
# rather than trusting a checksum downloaded alongside the archive at install.
cliproxyapi_checksum() {
  case "$1" in
    darwin_aarch64) echo c20618ed6e4c76e6a73ed7dafa0d5f9569f0b6c20213fd450b3569bffde20114 ;;
    darwin_amd64) echo 72c3403ad94d708c4aec48be2f34bdef2c230824440111f156076efd75b1f550 ;;
    linux_aarch64) echo c3c2b2398222fcaa1f20e2bb09ef8c17bab708cef3a0d948e477e153517eee7a ;;
    linux_amd64) echo eb73eb43ef82dea0ffc7b433fc3b6f994cd0b3f35d3b59ee85870827e2fc3cec ;;
    *) return 1 ;;
  esac
}

install_cliproxyapi_binary() (
  set -euo pipefail
  local platform="$1" checksum="$2"
  local bin="$HOME/.local/bin/cli-proxy-api"
  local marker="$HOME/.local/share/cliproxyapi/version"
  local expected="$CLIPROXYAPI_VERSION $platform"
  local archive="CLIProxyAPI_${CLIPROXYAPI_VERSION}_${platform}.tar.gz"
  local tmp="" backup=""

  if [[ -x "$bin" && ! -L "$bin" && -f "$marker" ]] && [[ "$(< "$marker")" == "$expected" ]]; then
    log_item "CLIProxyAPI: already at $CLIPROXYAPI_VERSION ($platform)"
    return 0
  fi
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Download and SHA256-verify $archive; install $bin and version marker"
    return 0
  fi

  # Staging on the destination filesystem permits an atomic binary replacement.
  ensure_dir "$HOME/.local/bin" || return
  ensure_dir "$(dirname "$marker")" || return
  tmp="$(mktemp -d "$HOME/.local/bin/.cliproxyapi.XXXXXXXX")" || return
  trap 'rm -rf "$tmp"' EXIT
  curl --fail --silent --show-error --location --retry 3 \
    "https://github.com/router-for-me/CLIProxyAPI/releases/download/v${CLIPROXYAPI_VERSION}/$archive" \
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
    sys.exit("error: CLIProxyAPI archive SHA256 mismatch")
# Extract just the regular executable; never unpack arbitrary archive paths.
with tarfile.open(archive, "r:gz") as release:
    matches = [m for m in release.getmembers() if m.name in ("cli-proxy-api", "./cli-proxy-api") and m.isfile()]
    if len(matches) != 1:
        sys.exit("error: CLIProxyAPI archive must contain one regular cli-proxy-api executable")
    with release.extractfile(matches[0]) as source, (stage / "cli-proxy-api").open("wb") as target:
        shutil.copyfileobj(source, target)
(stage / "cli-proxy-api").chmod(0o755)
PY
  if [[ -e "$bin" || -L "$bin" ]]; then
    backup="$(next_backup_path "$bin")"
    mv "$bin" "$backup" || return
    log_item "CLIProxyAPI: previous binary backed up to $backup"
  fi
  mv "$tmp/cli-proxy-api" "$bin" || return
  # Replace, rather than follow, any existing marker symlink.
  printf '%s\n' "$expected" > "$tmp/version" || return
  mv -f "$tmp/version" "$marker" || return
  log_item "CLIProxyAPI: installed $CLIPROXYAPI_VERSION ($platform)"
)

install_cliproxyapi_plugin() (
  set -euo pipefail
  local os="$1" arch="$2" plugin_arch="$2" platform="" extension="" source_dir=""
  local plugin_dir="" destination="" marker="" source_digest="" expected=""
  local tmp="" backup=""

  if [[ "$plugin_arch" == aarch64 ]]; then
    plugin_arch=arm64
  fi
  platform="${os}_${plugin_arch}"
  source_dir="$CLIPROXYAPI_REPO_ROOT/configs/cliproxyapi/plugins/codex-current-models"
  plugin_dir="$HOME/.local/share/cliproxyapi/plugins/$os/$plugin_arch"
  marker="$HOME/.local/share/cliproxyapi/plugin-codex-current-models.version"
  case "$os" in
    linux) extension=so ;;
    darwin) extension=dylib ;;
    *) printf 'error: unsupported CLIProxyAPI plugin OS\n' >&2; return 1 ;;
  esac
  destination="$plugin_dir/codex-current-models.$extension"
  source_digest="$(python3 - "$source_dir" <<'PY'
import hashlib
import pathlib
import sys

source_dir = pathlib.Path(sys.argv[1])
digest = hashlib.sha256()
for name in ("go.mod", "main.go"):
    path = source_dir / name
    digest.update(name.encode())
    digest.update(b"\0")
    digest.update(path.read_bytes())
    digest.update(b"\0")
print(digest.hexdigest())
PY
)" || return
  expected="$source_digest $platform build-$CLIPROXYAPI_PLUGIN_BUILD_VERSION"

  if [[ -f "$destination" && ! -L "$destination" && -f "$marker" ]] && [[ "$(< "$marker")" == "$expected" ]]; then
    log_item "CLIProxyAPI model plugin: already current ($platform)"
    return 0
  fi
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Build and install CLIProxyAPI Codex model plugin for $platform"
    return 0
  fi
  if ! command -v go >/dev/null 2>&1; then
    printf 'error: Go is required to build the CLIProxyAPI model plugin\n' >&2
    return 1
  fi
  if ! command -v cc >/dev/null 2>&1; then
    printf 'error: a C compiler (cc) is required to build the CLIProxyAPI model plugin\n' >&2
    return 1
  fi

  ensure_dir "$plugin_dir" || return
  tmp="$(mktemp -d "$plugin_dir/.codex-current-models.XXXXXXXX")" || return
  trap 'rm -rf "$tmp"' EXIT
  (
    cd "$source_dir" || exit
    CGO_ENABLED=1 go build -buildvcs=false -trimpath -buildmode=c-shared \
      -o "$tmp/codex-current-models.$extension" .
  ) || return
  rm -f "$tmp/codex-current-models.h" || return
  chmod 0700 "$tmp/codex-current-models.$extension" || return
  if [[ -e "$destination" || -L "$destination" ]]; then
    backup="$(next_backup_path "$destination")"
    mv "$destination" "$backup" || return
    log_item "CLIProxyAPI model plugin: previous file backed up to $backup"
  fi
  mv "$tmp/codex-current-models.$extension" "$destination" || return
  printf '%s\n' "$expected" > "$tmp/version" || return
  if [[ -e "$marker" || -L "$marker" ]]; then
    rm -f "$marker" || return
  fi
  mv "$tmp/version" "$marker" || return
  log_item "CLIProxyAPI model plugin: installed ($platform)"
)

configure_cliproxyapi() {
  local os="$1"
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Persist private API and management keys and render CLIProxyAPI config (keys never displayed)"
    log_item "[dry-run] Install $os user service definition"
    return 0
  fi

  # All secret handling stays inside Python: no shell variables, command-line
  # arguments, environment values, or log output ever contain either key.
  python3 - "$HOME" "$CLIPROXYAPI_REPO_ROOT/configs/cliproxyapi/config.yaml" "$os" "$HOME/.local/share/cliproxyapi/plugins" <<'PY'
import os
import pathlib
import plistlib
import re
import secrets
import sys
import tempfile

home = pathlib.Path(sys.argv[1]).absolute()
template = pathlib.Path(sys.argv[2]).read_text()
if "{{API_KEY}}" not in template:
    sys.exit("error: CLIProxyAPI config template has no API key placeholder")
if "{{PLUGIN_DIR}}" not in template:
    sys.exit("error: CLIProxyAPI config template has no plugin directory placeholder")
config_dir = home / ".config/cliproxyapi"
state_dir = home / ".local/share/cliproxyapi"
auth_dir = state_dir / "auth"
for directory in (config_dir, state_dir, auth_dir):
    if directory.is_symlink():
        sys.exit("error: CLIProxyAPI private directory must not be a symlink")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)


def write_private(path, content, mode=0o600):
    """Atomic and idempotent, preserving any different existing file/symlink."""
    if not path.is_symlink() and path.is_file() and path.read_bytes() == content:
        path.chmod(mode)
        return
    if path.exists() and path.is_dir() and not path.is_symlink():
        sys.exit("error: CLIProxyAPI destination is a directory: " + str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".cliproxyapi-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            os.fchmod(stream.fileno(), mode)
        if path.exists() or path.is_symlink():
            backup = pathlib.Path(str(path) + ".bak")
            counter = 1
            while backup.exists() or backup.is_symlink():
                backup = pathlib.Path(str(path) + ".bak." + str(counter))
                counter += 1
            os.replace(path, backup)
            print("  CLIProxyAPI: previous file backed up to " + str(backup))
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def private_key(name):
    key_file = config_dir / name
    if key_file.is_symlink():
        sys.exit("error: CLIProxyAPI " + name + " must not be a symlink")
    if key_file.exists():
        key_file.chmod(0o600)
        key = key_file.read_text().strip()
        if not re.fullmatch(r"[0-9a-f]{64}", key):
            sys.exit("error: existing CLIProxyAPI " + name + " is invalid; refusing to replace it")
    else:
        key = secrets.token_hex(32)
        # Exclusive creation avoids silently replacing a concurrently created key.
        fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(key + "\n")
    return key


key = private_key("api-key")
rendered = template.replace("{{API_KEY}}", key)
rendered = rendered.replace("{{PLUGIN_DIR}}", sys.argv[4])
if "{{MANAGEMENT_KEY}}" in rendered:
    rendered = rendered.replace("{{MANAGEMENT_KEY}}", private_key("management-key"))
write_private(config_dir / "config.yaml", rendered.encode())

binary = str(home / ".local/bin/cli-proxy-api")
config = str(config_dir / "config.yaml")
if sys.argv[3] == "linux":
    def unit_quote(value, executable=False):
        value = value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
        if executable:
            value = value.replace("$", "$$")
        return '"' + value + '"'

    service = "\n".join([
        "# Managed by dev-setup; installation does not enable or start this unit.",
        "[Unit]", "Description=CLIProxyAPI local OAuth proxy", "After=network.target", "",
        "[Service]", "Type=simple",
        "ExecStart=" + unit_quote(binary, True) + " -config " + unit_quote(config, True),
        "WorkingDirectory=%h/.local/share/cliproxyapi", "UMask=0077",
        "Restart=on-failure", "RestartSec=5", "", "[Install]", "WantedBy=default.target", "",
    ])
    write_private(home / ".config/systemd/user/cliproxyapi.service", service.encode(), 0o644)
else:
    service = {
        "Label": "dev.cliproxyapi",
        "ProgramArguments": [binary, "-config", config],
        "WorkingDirectory": str(state_dir),
        "EnvironmentVariables": {"HOME": str(home)},
        "Disabled": False,
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 5,
        "Umask": 0o077,
        "StandardOutPath": str(state_dir / "stdout.log"),
        "StandardErrorPath": str(state_dir / "stderr.log"),
    }
    write_private(home / "Library/LaunchAgents/dev.cliproxyapi.plist", plistlib.dumps(service), 0o600)
print("  CLIProxyAPI: private config and service definition installed")
PY
}

enable_cliproxyapi_macos() {
  local domain service
  domain="gui/$(id -u)" || return
  service="$domain/dev.cliproxyapi"
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Enable and start CLIProxyAPI macOS LaunchAgent (leave an already loaded service running)"
    return 0
  fi

  # Clear a persisted disabled override, including one from an older install.
  launchctl enable "$service" || return
  if launchctl print "$service" >/dev/null 2>&1; then
    log_item "CLIProxyAPI: macOS LaunchAgent enabled and already loaded"
  else
    launchctl bootstrap "$domain" "$HOME/Library/LaunchAgents/dev.cliproxyapi.plist" || return
    log_item "CLIProxyAPI: macOS LaunchAgent enabled and started"
  fi
}

install_cliproxyapi() {
  local os="" arch="" platform="" checksum=""
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) printf 'error: CLIProxyAPI supports Linux and macOS only\n' >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=amd64 ;;
    arm64|aarch64) arch=aarch64 ;;
    *) printf 'error: unsupported CLIProxyAPI CPU architecture\n' >&2; return 1 ;;
  esac
  platform="${os}_${arch}"
  checksum="$(cliproxyapi_checksum "$platform")" || return
  install_cliproxyapi_binary "$platform" "$checksum" || return
  install_cliproxyapi_plugin "$os" "$arch" || return
  configure_cliproxyapi "$os" || return
  ensure_dir "$HOME/.local/bin" || return
  safe_link_path "$CLIPROXYAPI_REPO_ROOT/scripts/cliproxy" "$HOME/.local/bin/cliproxy" "CLIProxyAPI helper" || return
  if [[ "$os" == darwin ]]; then
    enable_cliproxyapi_macos || return
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  install_cliproxyapi
fi
