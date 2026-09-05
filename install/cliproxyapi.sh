#!/usr/bin/env bash
# Pinned local OAuth proxy. macOS setup enables and starts the user LaunchAgent.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CLIPROXYAPI_VERSION="7.2.151"
CLIPROXYAPI_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# From the official v7.2.151 release's checksums.txt. Keep these in the repo,
# rather than trusting a checksum downloaded alongside the archive at install.
cliproxyapi_checksum() {
  case "$1" in
    darwin_aarch64) echo 9115b9691ceff071735ec1365c2885dca5d4084105de09877f5afdb675f1f815 ;;
    darwin_amd64) echo 05d9344b0a39b81ef1d4217b1136964dadfba4a485d18a70564562fef4f6bf98 ;;
    linux_aarch64) echo 14c03fcc69923c012bd0dace189790cf1ad1586f17bb64d8c09784a0a23ad587 ;;
    linux_amd64) echo 194f38ad40bba5cb07cdc1521b0853be0f9868c53ade40c677f32b21005c33f9 ;;
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

configure_cliproxyapi() {
  local os="$1"
  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Persist private API and management keys and render CLIProxyAPI config (keys never displayed)"
    log_item "[dry-run] Install $os user service definition"
    return 0
  fi

  # All secret handling stays inside Python: no shell variables, command-line
  # arguments, environment values, or log output ever contain either key.
  python3 - "$HOME" "$CLIPROXYAPI_REPO_ROOT/configs/cliproxyapi/config.yaml" "$os" <<'PY'
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
