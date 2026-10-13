#!/usr/bin/env bash
# Install AI desktop apps that are not covered by host package managers.
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

AI_DESKTOP_ROOT="$HOME/.local/share/dev-setup/ai-desktop"

linux_arch_deb() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'amd64\n' ;;
    arm64|aarch64) printf 'arm64\n' ;;
    *) return 1 ;;
  esac
}

linux_arch_cursor() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'linux-x64\n' ;;
    arm64|aarch64) printf 'linux-arm64\n' ;;
    *) return 1 ;;
  esac
}

ensure_linux_desktop_dirs() {
  ensure_dir "$HOME/.local/bin"
  ensure_dir "$HOME/.local/share/applications"
  ensure_dir "$AI_DESKTOP_ROOT"
}

write_desktop_entry() {
  local desktop_id="$1"
  local name="$2"
  local exec_path="$3"
  local icon_name="${4:-$desktop_id}"
  local desktop_path="$HOME/.local/share/applications/${desktop_id}.desktop"
  local tmp_path=""

  tmp_path="$(mktemp)"
  cat > "$tmp_path" <<EOF
[Desktop Entry]
Name=$name
Exec=$exec_path %U
Terminal=false
Type=Application
Icon=$icon_name
Categories=Development;
EOF
  write_if_changed "$tmp_path" "$desktop_path"

  if check_installed update-desktop-database; then
    run_cmd update-desktop-database "$HOME/.local/share/applications"
  fi
}

install_linux_appimage() {
  local name="$1"
  local bin_name="$2"
  local url="$3"
  local desktop_name="$4"
  local app_dir="$AI_DESKTOP_ROOT/$bin_name"
  local appimage_path="$app_dir/${bin_name}.AppImage"
  local wrapper_path="$HOME/.local/bin/$bin_name"
  local tmp_path=""

  log_section "$name"

  if check_installed "$bin_name" || [[ -x "$wrapper_path" ]]; then
    log_item "$name: installed"
    return 0
  fi

  ensure_linux_desktop_dirs
  ensure_dir "$app_dir"

  log_item "Installing $name from upstream AppImage..."
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd curl -fL "$url" -o "$appimage_path"
    dry_run_cmd chmod +x "$appimage_path"
    dry_run_cmd install -Dm755 /dev/stdin "$wrapper_path"
    dry_run_cmd install -Dm644 /dev/stdin "$HOME/.local/share/applications/${bin_name}.desktop"
    return 0
  fi

  tmp_path="$(mktemp "/tmp/${bin_name}.XXXXXX.AppImage")"
  run_cmd curl -fL "$url" -o "$tmp_path"
  run_cmd chmod +x "$tmp_path"
  run_cmd mv "$tmp_path" "$appimage_path"

  cat > "$wrapper_path" <<EOF
#!/usr/bin/env bash
exec "$appimage_path" "\$@"
EOF
  run_cmd chmod +x "$wrapper_path"
  write_desktop_entry "$bin_name" "$desktop_name" "$wrapper_path" "$bin_name"
  log_item "$name: installed"
}

install_linux_cursor_desktop() {
  local platform=""
  local url=""

  platform="$(linux_arch_cursor)" || {
    log_item "Cursor Desktop: unsupported architecture $(uname -m)"
    return 0
  }

  # Official Cursor download endpoint redirects to the latest AppImage for the track.
  url="https://api2.cursor.sh/updates/download/golden/${platform}/cursor/3.11"
  install_linux_appimage "Cursor Desktop" "cursor" "$url" "Cursor"
}

install_linux_t3_code_desktop() {
  local version="0.0.28"
  local url="https://github.com/pingdotgg/t3code/releases/download/v${version}/T3-Code-${version}-x86_64.AppImage"

  if [[ "$(uname -m)" != "x86_64" && "$(uname -m)" != "amd64" ]]; then
    log_item "T3 Code: unsupported architecture $(uname -m)"
    return 0
  fi

  install_linux_appimage "T3 Code" "t3code" "$url" "T3 Code"
}

install_deb_payload_to_system() {
  local deb_path="$1"
  local tmp_dir=""
  local data_archive=""

  if ! check_installed ar; then
    log_item "ar not available, skipping deb extraction"
    return 1
  fi

  tmp_dir="$(mktemp -d)"
  if (( ${DRY_RUN:-0} )); then
    # shellcheck disable=SC2016 # $1/$2 are intentionally expanded by the inner bash.
    dry_run_cmd bash -c 'cd "$1" && ar x "$2"' _ "$tmp_dir" "$deb_path"
    dry_run_cmd sudo tar -xf "$tmp_dir/data.tar.xz" -C /
    rm -rf "$tmp_dir"
    return 0
  fi

  if ! (cd "$tmp_dir" && ar x "$deb_path"); then
    printf 'error: could not extract deb archive: %s\n' "$deb_path" >&2
    rm -rf "$tmp_dir"
    return 1
  fi

  data_archive="$(find "$tmp_dir" -maxdepth 1 -name 'data.tar.*' -print -quit)"
  if [[ -z "$data_archive" ]]; then
    printf 'error: no data.tar.* payload in %s\n' "$deb_path" >&2
    rm -rf "$tmp_dir"
    return 1
  fi

  if ! run_cmd sudo tar -xf "$data_archive" -C /; then
    rm -rf "$tmp_dir"
    return 1
  fi
  rm -rf "$tmp_dir"
}

install_linux_deb_app() {
  local name="$1"
  local bin_name="$2"
  local url="$3"
  local executable_relpath="$4"
  local desktop_name="$5"
  local expected_sha256="${6:-}"
  local force_install="${7:-0}"
  local wrapper_path="$HOME/.local/bin/$bin_name"
  local deb_path=""
  local executable_path=""

  log_section "$name"

  if (( ! force_install )) && { check_installed "$bin_name" || [[ -x "$wrapper_path" ]]; }; then
    log_item "$name: installed"
    return 0
  fi

  ensure_linux_desktop_dirs

  deb_path="$(mktemp "/tmp/${bin_name}.XXXXXX.deb")"
  log_item "Installing $name from upstream deb..."
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd curl -fL "$url" -o "$deb_path"
    if [[ -n "$expected_sha256" ]]; then
      log_item "Would verify SHA256 $expected_sha256 before extraction"
    fi
    dry_run_cmd ar x "$deb_path"
    dry_run_cmd sudo tar -xf data.tar.xz -C /
    if [[ -L "$wrapper_path" ]]; then
      log_item "$name: preserving existing symlink launcher $wrapper_path"
    else
      dry_run_cmd install -Dm755 /dev/stdin "$wrapper_path"
    fi
    dry_run_cmd install -Dm644 /dev/stdin "$HOME/.local/share/applications/${bin_name}.desktop"
    rm -f "$deb_path"
    return 0
  fi

  if ! run_cmd curl -fL "$url" -o "$deb_path"; then
    printf 'error: could not download %s package from %s\n' "$name" "$url" >&2
    rm -f "$deb_path"
    return 1
  fi
  if [[ -n "$expected_sha256" ]] && ! printf '%s  %s\n' "$expected_sha256" "$deb_path" | sha256sum --check --status; then
    printf 'error: %s package SHA256 mismatch; refusing installation\n' "$name" >&2
    rm -f "$deb_path"
    return 1
  fi
  if ! install_deb_payload_to_system "$deb_path"; then
    rm -f "$deb_path"
    return 1
  fi
  rm -f "$deb_path"

  executable_path="/$executable_relpath"
  if [[ "$bin_name" == "claude-desktop" && -x "/usr/lib/claude-desktop/chrome-sandbox" ]]; then
    run_cmd sudo chmod 4755 /usr/lib/claude-desktop/chrome-sandbox
  fi

  if (( ! ${DRY_RUN:-0} )) && [[ ! -x "$executable_path" ]]; then
    printf 'error: expected executable not found: %s\n' "$executable_path" >&2
    return 1
  fi

  # Symlink launchers belong to the config layer and may carry required flags.
  if [[ -L "$wrapper_path" ]]; then
    log_item "$name: preserving existing symlink launcher $wrapper_path"
  else
    cat > "$wrapper_path" <<EOF
#!/usr/bin/env bash
exec "$executable_path" "\$@"
EOF
    run_cmd chmod +x "$wrapper_path"
  fi
  write_desktop_entry "$bin_name" "$desktop_name" "$wrapper_path" "$bin_name"
  log_item "$name: installed"
}

latest_devin_linux_deb_url() {
  local metadata=""

  metadata="$(curl -fsSL https://windsurf-stable.codeium.com/api/update/linux-x64-deb/stable/latest)"
  printf '%s' "$metadata" | sed -n -E 's/.*"url"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p'
}

install_linux_devin_desktop() {
  local url=""

  if [[ "$(uname -m)" != "x86_64" && "$(uname -m)" != "amd64" ]]; then
    log_item "Devin Desktop: unsupported architecture $(uname -m)"
    return 0
  fi

  url="$(latest_devin_linux_deb_url)"
  install_linux_deb_app "Devin Desktop" "devin-desktop" "$url" "usr/share/devin-desktop/bin/devin-desktop" "Devin"
}

latest_claude_desktop_deb_metadata() {
  local arch="$1"
  local packages_url="https://downloads.claude.ai/claude-desktop/apt/stable/dists/stable/main/binary-${arch}/Packages"
  local metadata=""

  if ! metadata="$(curl -fsSL "$packages_url")"; then
    printf 'error: could not download Claude Desktop package metadata from %s\n' "$packages_url" >&2
    return 1
  fi

  # Keep the version, filename, and checksum from the same Packages stanza.
  printf '%s' "$metadata" | python3 -c '
import re
import sys

arch = sys.argv[1]
try:
    packages = []
    for stanza in re.split(r"\n\s*\n", sys.stdin.read()):
        fields = {}
        for line in stanza.splitlines():
            if line and not line[0].isspace() and ": " in line:
                key, value = line.split(": ", 1)
                fields[key] = value
        if fields.get("Package") != "claude-desktop" or fields.get("Architecture") != arch:
            continue
        version = fields.get("Version", "")
        filename = fields.get("Filename", "")
        checksum = fields.get("SHA256", "")
        if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
            raise ValueError("invalid or missing Version")
        if filename != f"pool/main/c/claude-desktop/claude-desktop_{version}_{arch}.deb":
            raise ValueError("invalid or missing Filename")
        if not re.fullmatch(r"[0-9a-fA-F]{64}", checksum):
            raise ValueError("invalid or missing SHA256")
        packages.append((tuple(map(int, version.split("."))), version, filename, checksum.lower()))
    if not packages:
        raise ValueError(f"no Claude Desktop packages for {arch}")
    _, version, filename, checksum = max(packages)
    print(f"{version}\thttps://downloads.claude.ai/claude-desktop/apt/stable/{filename}\t{checksum}")
except ValueError as error:
    sys.exit(f"error: invalid Claude Desktop package metadata: {error}")
' "$arch"
}

installed_claude_desktop_version() {
  local asar_path="${1:-/usr/lib/claude-desktop/resources/app.asar}"
  [[ -e "$asar_path" ]] || return 0

  # ASAR stores a Chromium Pickle JSON header, then files at header-relative offsets.
  python3 - "$asar_path" <<'PY'
import json
import re
import struct
import sys

try:
    with open(sys.argv[1], "rb") as archive:
        size_pickle, header_size, payload_size, json_size = struct.unpack("<4I", archive.read(16))
        if size_pickle != 4 or not 8 <= header_size <= 64 * 1024 * 1024 or json_size > header_size - 8 or payload_size != header_size - 4:
            raise ValueError("invalid ASAR header")
        header = json.loads(archive.read(json_size))
        package = header["files"]["package.json"]
        if package.get("unpacked") or "link" in package:
            raise ValueError("package.json is not packed in app.asar")
        offset, size = int(package["offset"]), int(package["size"])
        if offset < 0 or not 0 < size <= 1024 * 1024:
            raise ValueError("invalid package.json bounds")
        archive.seek(8 + header_size + offset)
        version = json.loads(archive.read(size))["version"]
        if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
            raise ValueError("invalid package.json version")
        print(version)
except (OSError, ValueError, KeyError, TypeError, struct.error) as error:
    sys.exit(f"warning: could not read installed Claude Desktop version: {error}")
PY
}

install_linux_claude_desktop() {
  local arch=""
  local metadata=""
  local version=""
  local url=""
  local checksum=""
  local installed_version=""

  arch="$(linux_arch_deb)" || {
    log_item "Claude Desktop: unsupported architecture $(uname -m)"
    return 0
  }
  if ! check_installed python3; then
    printf 'error: python3 is required to resolve Claude Desktop versions\n' >&2
    return 1
  fi
  metadata="$(latest_claude_desktop_deb_metadata "$arch")" || return 1
  IFS=$'\t' read -r version url checksum <<< "$metadata"
  # Missing or unreadable installed metadata must not suppress an install/repair.
  installed_version="$(installed_claude_desktop_version)" || installed_version=""
  if [[ -n "$installed_version" ]] && [[ "$(printf '%s\n%s\n' "$version" "$installed_version" | sort -V | tail -n 1)" == "$installed_version" ]]; then
    log_item "Claude Desktop: up to date (installed $installed_version, latest $version)"
    return 0
  fi

  log_item "Claude Desktop: ${installed_version:-not installed} -> $version"
  install_linux_deb_app "Claude Desktop" "claude-desktop" "$url" "usr/lib/claude-desktop/claude-desktop" "Claude" "$checksum" 1
}

install_linux_conductor_desktop() {
  log_section "Conductor"
  log_item "Conductor: no Linux build from upstream; skipping"
}

install_ai_desktop_apps_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    return 0
  fi

  install_linux_cursor_desktop
  install_linux_devin_desktop
  install_linux_t3_code_desktop
  install_linux_claude_desktop
  install_linux_conductor_desktop
}
