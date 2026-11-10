#!/usr/bin/env bash
# Rokit: toolchain manager for Roblox projects. Each project pins its own Rojo,
# Wally, Selene, StyLua and Lune in rokit.toml; setup installs only Rokit itself.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ROKIT_VERSION="1.2.0"

install_rokit() (
  log_section "Rokit ($ROKIT_VERSION)"
  local platform archive checksum target temp_dir current
  target="$HOME/.rokit/bin/rokit"
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)
      platform=macos-aarch64
      checksum=eb8e6b4f8026db2b80ad0887c50f342958ecdbacbdeda2fd6028b3c4f774a3ee
      ;;
    Darwin-x86_64)
      platform=macos-x86_64
      checksum=9643ca30421e9c3dda1f4996bb03b3a43b08dfdc17c28198843e2233e446ba10
      ;;
    Linux-x86_64)
      platform=linux-x86_64
      checksum=951a7f3ec3d2a5e021fd1867d32f69f010ee4c2927f644b759578afc59c65fc0
      ;;
    Linux-aarch64|Linux-arm64)
      platform=linux-aarch64
      checksum=b9ba200dd70620d9dbc11bbb0b368a62c6891328e6bc5fab4b7f68200089553a
      ;;
    *) printf 'error: unsupported Rokit platform\n' >&2; return 1 ;;
  esac
  archive="rokit-${ROKIT_VERSION}-${platform}.zip"
  if [[ -x "$target" ]]; then
    current="$("$target" --version 2>/dev/null)" || current=""
    if [[ "$current" == "rokit $ROKIT_VERSION" ]]; then
      log_item "rokit: already at $ROKIT_VERSION"
      return 0
    fi
  fi
  if (( ${DRY_RUN:-0} )); then
    log_item "Would download $archive at $ROKIT_VERSION, verify SHA-256 $checksum, and run its self-install into $HOME/.rokit"
    return 0
  fi

  temp_dir="$(mktemp -d)"
  trap 'rm -rf -- "$temp_dir"' EXIT
  curl -fSL --retry 3 -o "$temp_dir/$archive" \
    "https://github.com/rojo-rbx/rokit/releases/download/v$ROKIT_VERSION/$archive"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$temp_dir" && printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -)
  else
    (cd "$temp_dir" && printf '%s  %s\n' "$checksum" "$archive" | shasum -a 256 -c -)
  fi
  unzip -q "$temp_dir/$archive" -d "$temp_dir/unpacked"
  chmod +x "$temp_dir/unpacked/rokit"
  current="$("$temp_dir/unpacked/rokit" --version)"
  [[ "$current" == "rokit $ROKIT_VERSION" ]] || {
    printf 'error: unexpected Rokit version: %s\n' "$current" >&2
    return 1
  }
  # Copies the binary to ~/.rokit/bin, writes ~/.rokit/env and relinks installed
  # tools. configs/shell/zshenv already sources ~/.rokit/env, so self-install
  # leaves the shell profile untouched.
  "$temp_dir/unpacked/rokit" self-install
  log_item "Installed $target"
)
