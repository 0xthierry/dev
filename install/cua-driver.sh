#!/usr/bin/env bash
# Install only the tagged Cua runtime and repo skill, never upstream install/connect.
set -euo pipefail
# shellcheck source=install/lib.sh disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
CUA_DRIVER_VERSION=0.59.4
CUA_DRIVER_RELEASE_TAG="cua-driver-rs-v${CUA_DRIVER_VERSION}"
CUA_DRIVER_RELEASE_BASE_URL="${CUA_DRIVER_RELEASE_BASE_URL:-https://github.com/trycua/cua/releases/download/${CUA_DRIVER_RELEASE_TAG}}"

cua_driver_platform() {
  local os="${1:-$(uname -s)}" arch="${2:-$(uname -m)}" major
  case "$os/$arch" in
    Linux/x86_64|Linux/amd64) echo 'linux-x86_64 x86_64-unknown-linux-gnu' ;;
    Linux/aarch64|Linux/arm64) echo 'linux-arm64 aarch64-unknown-linux-gnu' ;;
    Darwin/x86_64|Darwin/arm64)
      major="$(sw_vers -productVersion)" || return
      if [[ ! "$major" =~ ^[0-9]+(\.|$) ]] || (( ${major%%.*} < 14 )); then
        echo 'error: Cua Driver requires macOS 14 or later' >&2; return 1
      fi
      echo 'darwin-universal universal-apple-darwin' ;;
    *) echo "error: unsupported Cua Driver platform: $os $arch" >&2; return 1 ;;
  esac
}

# Pin against the tag's SHA256SUMS; the *-binary Darwin tarball has NO .app.
cua_driver_binary_checksum() {
  case "$1" in
    linux-x86_64) echo e846172bacd203d15d41990c3b78c0f110b730346a57427f38c60638cd7196df ;;
    linux-arm64) echo 91a4abc81d235516a1fb9607e9d7be1b0a2ce11cfff7eed501a2582c475605ca ;;
    darwin-universal) echo 9f3579df27542b744bd7572b6f3fed79c90f758f8074da66749ed0a847b6ee8c ;;
    *) return 1 ;;
  esac
}

cua_driver_download() {
  local name="$1" tmp="$2" checksum="$3" url="$CUA_DRIVER_RELEASE_BASE_URL/$1" actual
  command -v cosign >/dev/null || { echo 'error: cosign is required for Cua Driver release verification' >&2; return 1; }
  curl -fsSL --retry 3 --output "$tmp/$name" "$url" || return
  actual="$(shasum -a 256 < "$tmp/$name")" || return
  if [[ "${actual%% *}" != "$checksum" ]]; then
    echo "error: Cua Driver archive SHA256 mismatch for $name" >&2; return 1
  fi
  curl -fsSL --retry 3 --output "$tmp/bundle.json" "$url.sigstore.json" || return
  cosign verify-blob --bundle "$tmp/bundle.json" \
    --certificate-identity "https://github.com/trycua/cua/.github/workflows/cd-rust-cua-driver.yml@refs/tags/$CUA_DRIVER_RELEASE_TAG" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com "$tmp/$name"
}

cua_driver_extract_runtime_archive() {
  python3 "$REPO_ROOT/configs/cua-driver/extract-runtime.py" "$1" "$2" "${3:-linux-x86_64}" "$CUA_DRIVER_VERSION"
}

# Fingerprints of the exact subset extracted from each verified signed archive.
# Never execute a preexisting executable to decide whether it is trusted.
cua_driver_linux_digest() {
  case "$1" in
    linux-x86_64) echo baf3902e6f7902c45dce3208b6900e52a09b43738b38b2541e7a8b6c317d98db ;;
    linux-arm64) echo 88c30c16311133c788155401669e64e16347601cc12aa03d6c818bb35891a2e7 ;;
    *) return 1 ;;
  esac
}

cua_driver_linux_ready() {
  local actual expected
  [[ -d "$1" && ! -L "$1" ]] || return 1
  expected="$(cua_driver_linux_digest "$2")" || return
  actual="$(/usr/bin/python3 -IB "$REPO_ROOT/configs/cua-driver/linux-runtime-digest.py" "$1" 2>/dev/null)" || return
  [[ "$actual" == "$expected" ]]
}

# Back up non-links; only update an existing symlink if it is our release pointer.
# os.replace replaces the link itself even when it resolves to a directory (BSD & GNU).
cua_driver_safe_link() {
  local source_path="$1" target="$2" managed_root="${3:-}" backup_base="${4:-$2}" resolved backup
  if (( foreign_plan )); then dry_run_cmd ln -s "$source_path" "$target"; return; fi
  if [[ -L "$target" ]]; then
    resolved="$(resolve_symlink_target "$target")" || return
    if [[ "$resolved" == "$(canonicalize_path "$source_path")" ]]; then return 0; fi
    if [[ -z "$managed_root" || "$(dirname "$resolved")" != "$(canonicalize_path "$managed_root")" || -L "$resolved" ]]; then
      echo "error: refusing to replace an unrelated Cua Driver symlink: $target" >&2; return 1
    fi
  fi
  (( ! preflight )) || return 0
  if [[ ! -L "$target" && -e "$target" ]]; then
    backup="$(next_backup_path "$backup_base")" || return
    ensure_dir "$(dirname "$backup")" || return
    run_cmd mv "$target" "$backup" || return
    log_item "Cua Driver: backed up $target to $backup"
  fi
  ensure_dir "$(dirname "$target")" || return
  if (( ${DRY_RUN:-0} )); then dry_run_cmd ln -s "$source_path" "$target"; return; fi
  python3 - "$source_path" "$target" <<'PY'
import os, pathlib, sys, tempfile
source, target = sys.argv[1:]
with tempfile.TemporaryDirectory(dir=pathlib.Path(target).parent) as tmp:
    staged = pathlib.Path(tmp) / 'link'
    staged.symlink_to(source)
    os.replace(staged, target)
PY
}

cua_driver_macos() {
  /usr/bin/python3 -IB "$REPO_ROOT/configs/cua-driver/macos-runtime.py" "$1" "$CUA_DRIVER_VERSION" "${@:2}"
}

# Visit the same complete set during preflight and installation (apply's scoped paths).
cua_driver_links() {
  local name surface
  if (( ! mac )); then cua_driver_safe_link "$release" "$current" "$releases" || return; fi
  cua_driver_safe_link "$binary" "$bin/cua-driver" || return
  cua_driver_safe_link "$config/cua-driver-mcp" "$bin/cua-driver-mcp" || return
  if [[ "${SETUP_HOST:-}" == omarchy ]]; then
    for name in cua-omarchy-display cua-omarchy-window; do
      [[ -x "$config/$name" ]] || { echo "error: missing $name" >&2; return 1; }
      cua_driver_safe_link "$config/$name" "$bin/$name" || return
    done
  fi
  for surface in "${surfaces[@]}"; do
    cua_driver_safe_link "$skill" "$HOME/$surface/skills/cua-driver" '' "$backups/${surface//\//-}" || return
  done
}

apply_cua_driver() (
  local config="$REPO_ROOT/configs/cua-driver" base="$HOME/.cua-driver" skillsrc="$REPO_ROOT/configs/cua-driver/skill"
  local skill="$base/skills/cua-driver" releases="$base/packages/releases" current="$base/packages/current"
  local backups="$base/backups/skills" bin="$HOME/.local/bin" os arch release archive checksum binary tmp backup file dir
  local mac=0 ready=0 skill_ready=1 preflight=0 foreign_plan=0
  local -a skill_files=(SKILL.md BROWSER.md OMARCHY.md MACOS.md) surfaces=(.pi/agent)
  # Host dry-runs may be requested from the other host; never use that shortcut to install.
  if [[ "${DRY_RUN:-0}/${SETUP_HOST:-}" == 1/macbook ]]; then
    foreign_plan=1; os='darwin-universal universal-apple-darwin'
  elif [[ "${DRY_RUN:-0}/${SETUP_HOST:-}/$(uname -s)" == 1/omarchy/Darwin ]]; then
    foreign_plan=1; os='linux-x86_64 x86_64-unknown-linux-gnu'
  else
    os="$(cua_driver_platform)" || return
  fi
  read -r os arch <<< "$os"
  release="$releases/$CUA_DRIVER_VERSION-$arch"
  checksum="$(cua_driver_binary_checksum "$os")" || return
  if [[ "$os" == darwin-universal ]]; then
    [[ "${SETUP_HOST:-macbook}" == macbook ]] || { echo 'error: wrong Cua Driver host for macOS' >&2; return 1; }
    mac=1; archive="cua-driver-rs-$CUA_DRIVER_VERSION-$os.tar.gz"; binary='/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
  else
    [[ "${SETUP_HOST:-omarchy}" != macbook ]] || { echo 'error: macbook Cua Driver installation requires macOS' >&2; return 1; }
    archive="cua-driver-rs-$CUA_DRIVER_VERSION-$os-binary.tar.gz"; binary="$current/cua-driver"
    surfaces+=(.agents .claude .codex .gemini/antigravity-cli)
  fi
  log_section "Cua Driver (pinned v$CUA_DRIVER_VERSION, $os)"
  if [[ "$(awk '$1 == "version:" {print $2; exit}' "$skillsrc/SKILL.md")" != "$CUA_DRIVER_VERSION" ]]; then
    echo "error: repository Cua Driver skill is missing or does not match runtime version $CUA_DRIVER_VERSION" >&2; return 1
  fi
  [[ -x "$config/cua-driver-mcp" ]] || { echo 'error: missing Cua Driver MCP launcher' >&2; return 1; }
  [[ ! -L "$skill" && ! -L "$release" ]] || { echo 'error: refusing unrelated skill or release symlink' >&2; return 1; }
  for file in "${skill_files[@]}"; do
    [[ -f "$skillsrc/$file" ]] || { echo "error: repository Cua Driver skill missing: $file" >&2; return 1; }
    cmp -s "$skillsrc/$file" "$skill/$file" || skill_ready=0
  done
  [[ ! -e "$skill/upstream" && ! -e "$skill/WINDOWS.md" ]] || skill_ready=0

  if (( ! foreign_plan )); then
    for dir in "$base" "$base/packages" "$releases" "$base/skills" "$base/backups" "$backups"; do
      [[ ! -L "$dir" ]] || { echo "error: unexpected symlink in Cua Driver state: $dir" >&2; return 1; }
    done
    preflight=1; cua_driver_links || return; preflight=0
    if (( mac )); then
      cua_driver_macos preflight || return
      cua_driver_macos ready >/dev/null 2>&1 && ready=1
    else
      cua_driver_linux_ready "$release" "$os" && ready=1
    fi
  fi
  if (( ${DRY_RUN:-0} )); then
    if (( ! ready )); then
      log_item "Would download $CUA_DRIVER_RELEASE_BASE_URL/$archive, verify SHA256 $checksum and the exact tag's Sigstore workflow signature"
      (( ! mac )) || log_item 'Would verify and install the original signed /Applications/CuaDriver.app'
    fi
    (( skill_ready )) || log_item "Would install the repository-owned skill from $skillsrc to $skill"
  elif (( ! ready || ! skill_ready )); then
    ensure_dir "$base/packages" || return
    tmp="$(mktemp -d "$base/packages/.install.XXXXXXXX")" || return
    trap 'rm -rf "$tmp"' EXIT
    if (( ! ready )); then
      cua_driver_download "$archive" "$tmp" "$checksum" || return
      cua_driver_extract_runtime_archive "$tmp/$archive" "$tmp/runtime" "$os" || return
      if (( mac )); then
        cua_driver_macos preflight || return
        cua_driver_macos install "$tmp/runtime/CuaDriver.app" || return
      else
        cua_driver_linux_ready "$tmp/runtime" "$os" || { echo 'error: invalid staged Cua Driver runtime' >&2; return 1; }
        ensure_dir "$releases" || return
        if [[ -e "$release" ]]; then
          backup="$(next_backup_path "$release")"; mv "$release" "$backup" || return
          log_item "Previous Cua runtime retained at $backup"
        fi
        mv "$tmp/runtime" "$release" || return
      fi
    fi
    if (( ! skill_ready )); then
      mkdir "$tmp/skill" || return
      for file in "${skill_files[@]}"; do cp "$skillsrc/$file" "$tmp/skill/" || return; done
      if [[ -e "$skill" ]]; then
        ensure_dir "$backups" || return
        backup="$(next_backup_path "$backups/managed")"; mv "$skill" "$backup" || return
        log_item "Previous Cua skill retained at $backup"
      fi
      ensure_dir "$(dirname "$skill")" || return
      mv "$tmp/skill" "$skill" || return
    fi
  fi
  cua_driver_links || return
  if (( mac )); then
    if (( ${DRY_RUN:-0} )); then log_item 'Would configure only the user Aqua Cua Driver LaunchAgent; manual consent remains required'
    else cua_driver_macos service || return; fi
  fi
  log_item 'Cua Driver installed without a compositor plugin, permission changes, external clients, or profile attachment'
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  DRY_RUN=0
  if [[ $# -eq 1 && "$1" == --dry-run ]]; then DRY_RUN=1
  elif [[ $# -ne 0 ]]; then echo 'Usage: bash install/cua-driver.sh [--dry-run]' >&2; exit 1; fi
  apply_cua_driver
fi
