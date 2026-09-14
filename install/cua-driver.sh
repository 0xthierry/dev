#!/usr/bin/env bash
# Install the pinned, Linux-only Cua Driver runtime and agent skill.
set -euo pipefail
# shellcheck source=install/lib.sh
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"

CUA_DRIVER_VERSION="0.28.1"
CUA_DRIVER_RELEASE_TAG="cua-driver-rs-v${CUA_DRIVER_VERSION}"
CUA_DRIVER_RELEASE_BASE_URL="${CUA_DRIVER_RELEASE_BASE_URL:-https://github.com/trycua/cua/releases/download/${CUA_DRIVER_RELEASE_TAG}}"

cua_driver_platform() {
  local os="${1:-$(uname -s)}"
  local arch="${2:-$(uname -m)}"

  if [[ "$os" != "Linux" ]]; then
    printf 'error: Cua Driver installation is supported on Linux only (detected %s)\n' "$os" >&2
    return 1
  fi

  case "$arch" in
    x86_64|amd64) printf '%s\n' "linux-x86_64 x86_64-unknown-linux-gnu" ;;
    aarch64|arm64) printf '%s\n' "linux-arm64 aarch64-unknown-linux-gnu" ;;
    *)
      printf 'error: unsupported Cua Driver Linux architecture: %s\n' "$arch" >&2
      return 1
      ;;
  esac
}

cua_driver_binary_checksum() {
  case "$1" in
    linux-x86_64) printf '%s\n' '71aa92533de90a68a0a2af930243f1770d23e45b896b57d67a1763da4bfaeaf7' ;;
    linux-arm64) printf '%s\n' '02693499d34d6fe30bef99ef2f3051974ee7989469e3e7a9edc404896bdc6bbd' ;;
    *) return 1 ;;
  esac
}

cua_driver_verify_checksum() {
  local archive="$1"
  local expected="$2"
  local actual=""

  actual="$(python3 - "$archive" <<'PY'
import hashlib
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
with path.open("rb") as stream:
    if hasattr(hashlib, "file_digest"):
        print(hashlib.file_digest(stream, "sha256").hexdigest())
    else:
        print(hashlib.sha256(stream.read()).hexdigest())
PY
)" || return
  if [[ "$actual" != "$expected" ]]; then
    printf 'error: Cua Driver archive SHA256 mismatch for %s\n' "$(basename "$archive")" >&2
    return 1
  fi
}

# Validate every member before extracting the deliberately small Linux runtime subset.
cua_driver_extract_runtime_archive() {
  local archive="$1"
  local destination="$2"

  python3 - "$archive" "$destination" <<'PY'
import pathlib
import shutil
import sys
import tarfile

archive_path = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])

with tarfile.open(archive_path, "r:gz") as archive:
    members = archive.getmembers()
    normalized = []
    seen = set()
    for member in members:
        name = member.name[2:] if member.name.startswith("./") else member.name
        path = pathlib.PurePosixPath(name)
        if not name or path.is_absolute() or ".." in path.parts:
            raise SystemExit("error: Cua Driver archive contains an unsafe path: " + member.name)
        if member.issym() or member.islnk() or member.isdev() or member.isfifo():
            raise SystemExit("error: Cua Driver archive contains a link or special member: " + member.name)
        if not (member.isdir() or member.isfile()):
            raise SystemExit("error: Cua Driver archive contains an unsupported member: " + member.name)
        if name in seen:
            raise SystemExit("error: Cua Driver archive contains a duplicate member: " + name)
        seen.add(name)
        normalized.append((member, name))

    required = {"cua-driver", "cua-cursor-theme"}
    regular = {name for member, name in normalized if member.isfile()}
    if not required.issubset(regular):
        raise SystemExit("error: Cua Driver runtime archive is missing required executables")
    if not any(name == "wayland-helper" or name.startswith("wayland-helper/") for _, name in normalized):
        raise SystemExit("error: Cua Driver runtime archive is missing wayland-helper")

    selected = [
        (member, name)
        for member, name in normalized
        if name in required or name == "wayland-helper" or name.startswith("wayland-helper/")
    ]
    destination.mkdir(parents=True, exist_ok=True)
    for member, relative in selected:
        target = destination / relative
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        source = archive.extractfile(member)
        if source is None:
            raise SystemExit("error: unable to read Cua Driver archive member: " + member.name)
        with source, target.open("wb") as output:
            shutil.copyfileobj(source, output)
        target.chmod(0o755 if member.mode & 0o111 else 0o644)
PY
}

cua_driver_installed_version() {
  local binary="$1"
  local line=""

  [[ -x "$binary" ]] || return 1
  line="$("$binary" --version 2>/dev/null | head -1)" || return 1
  [[ "$line" == "cua-driver "* ]] || return 1
  printf '%s\n' "${line#cua-driver }"
}

cua_driver_skill_version() {
  local skill_file="$1"
  [[ -f "$skill_file" ]] || return 1
  awk '$1 == "version:" { print $2; exit }' "$skill_file"
}

cua_driver_link_is_correct() {
  local source_path="$1"
  local target_path="$2"
  [[ -L "$target_path" ]] || return 1
  [[ "$(resolve_symlink_target "$target_path")" == "$(canonicalize_path "$source_path")" ]]
}

cua_driver_link_resolves_within() {
  local target_path="$1"
  local managed_root="$2"
  local resolved_target=""
  local resolved_root=""

  [[ -L "$target_path" && -n "$managed_root" ]] || return 1
  resolved_target="$(resolve_symlink_target "$target_path")"
  resolved_root="$(canonicalize_path "$managed_root")"
  [[ "$resolved_target" == "$resolved_root"/* ]]
}

# Unlike lib.sh's general safe_link_path, this installer fails closed on unrelated links.
# A caller may name a managed root when the link is an update pointer expected to move
# between versioned children of that root.
cua_driver_safe_link() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"
  local managed_root="${4:-}"
  local backup_path=""
  local temporary_link=""
  local replace_managed_link=0

  if cua_driver_link_is_correct "$source_path" "$target_path"; then
    log_item "$label: already linked"
    return 0
  fi
  if [[ -L "$target_path" ]]; then
    if cua_driver_link_resolves_within "$target_path" "$managed_root"; then
      replace_managed_link=1
      log_item "$label: updating managed release link"
    else
      printf 'error: refusing to replace an unrelated Cua Driver symlink: %s -> %s\n' \
        "$target_path" "$(readlink "$target_path")" >&2
      return 1
    fi
  fi
  if (( ! replace_managed_link )) && [[ -e "$target_path" ]]; then
    backup_path="$(next_backup_path "$target_path")"
    run_cmd mv "$target_path" "$backup_path" || return
    log_item "$label: backed up to $backup_path"
  fi

  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd ln -s "$source_path" "$target_path"
  else
    temporary_link="${target_path}.tmp.$$"
    rm -f "$temporary_link"
    ln -s "$source_path" "$temporary_link" || return
    mv -Tf "$temporary_link" "$target_path" || return
  fi
  log_item "$label: linked"
}

cua_driver_runtime_ready() {
  local release_dir="$1"
  [[ "$(cua_driver_installed_version "$release_dir/cua-driver" 2>/dev/null || true)" == "$CUA_DRIVER_VERSION" ]] \
    && [[ -x "$release_dir/cua-cursor-theme" ]] \
    && [[ -f "$release_dir/wayland-helper/install.sh" ]] \
    && [[ -f "$release_dir/wayland-helper/README.md" ]] \
    && [[ -f "$release_dir/wayland-helper/winrects@cua/metadata.json" ]] \
    && [[ -f "$release_dir/wayland-helper/winrects@cua/extension.js" ]]
}

cua_driver_local_skill_ready() {
  local skill_dir="$1"
  local config_dir=""
  config_dir="$(dirname "$skill_dir")"
  [[ "$(cua_driver_skill_version "$skill_dir/SKILL.md" 2>/dev/null || true)" == "$CUA_DRIVER_VERSION" ]] \
    && [[ -f "$skill_dir/BROWSER.md" ]] \
    && [[ -f "$skill_dir/OMARCHY.md" ]] \
    && [[ -x "$config_dir/cua-omarchy-display" ]] \
    && [[ -x "$config_dir/cua-omarchy-window" ]]
}

cua_driver_skill_ready() {
  local skill_dir="$1"
  local local_skill_dir="$2"
  [[ "$(cua_driver_skill_version "$skill_dir/SKILL.md" 2>/dev/null || true)" == "$CUA_DRIVER_VERSION" ]] \
    && cmp -s "$skill_dir/SKILL.md" "$local_skill_dir/SKILL.md" \
    && cmp -s "$skill_dir/BROWSER.md" "$local_skill_dir/BROWSER.md" \
    && cmp -s "$skill_dir/OMARCHY.md" "$local_skill_dir/OMARCHY.md" \
    && [[ ! -e "$skill_dir/upstream" ]] \
    && [[ ! -e "$skill_dir/MACOS.md" ]] \
    && [[ ! -e "$skill_dir/WINDOWS.md" ]]
}

apply_cua_driver() (
  local platform_info="" asset_platform="" rust_target="" binary_checksum=""
  local binary_archive_name="" binary_url=""
  local packages_dir="$HOME/.cua-driver/packages"
  local releases_dir="$packages_dir/releases"
  local release_dir=""
  local local_skill_dir="$REPO_ROOT/configs/cua-driver/skill"
  local omarchy_display_helper_source="$REPO_ROOT/configs/cua-driver/cua-omarchy-display"
  local omarchy_window_helper_source="$REPO_ROOT/configs/cua-driver/cua-omarchy-window"
  local current_link="$packages_dir/current"
  local bin_link="$HOME/.local/bin/cua-driver"
  local omarchy_display_helper_link="$HOME/.local/bin/cua-omarchy-display"
  local omarchy_window_helper_link="$HOME/.local/bin/cua-omarchy-window"
  local skill_dir="$HOME/.cua-driver/skills/cua-driver"
  local tmp="" staged_runtime="" staged_skill="" backup_path=""
  local runtime_ready=0 skill_ready=0
  local skill_surface=""

  platform_info="$(cua_driver_platform)" || return
  read -r asset_platform rust_target <<< "$platform_info"
  binary_checksum="$(cua_driver_binary_checksum "$asset_platform")" || return
  binary_archive_name="cua-driver-rs-${CUA_DRIVER_VERSION}-${asset_platform}-binary.tar.gz"
  binary_url="${CUA_DRIVER_RELEASE_BASE_URL}/${binary_archive_name}"
  release_dir="$releases_dir/${CUA_DRIVER_VERSION}-${rust_target}"

  log_section "Cua Driver (pinned v${CUA_DRIVER_VERSION}, Linux only)"

  if ! cua_driver_local_skill_ready "$local_skill_dir"; then
    printf 'error: repository Cua Driver skill is missing or does not match runtime version %s: %s\n' \
      "$CUA_DRIVER_VERSION" "$local_skill_dir" >&2
    return 1
  fi

  cua_driver_runtime_ready "$release_dir" && runtime_ready=1
  cua_driver_skill_ready "$skill_dir" "$local_skill_dir" && skill_ready=1

  if (( ${DRY_RUN:-0} )); then
    if (( ! runtime_ready )); then
      dry_run_cmd curl --fail --silent --show-error --location --retry 3 --output "$binary_archive_name" "$binary_url"
      log_item "Would SHA256-verify $binary_archive_name: $binary_checksum"
      log_item "Would safely extract runtime to $release_dir"
    else
      log_item "Cua Driver runtime $CUA_DRIVER_VERSION: already installed"
    fi
    if (( ! skill_ready )); then
      log_item "Would install the repository-owned Linux skill from $local_skill_dir to $skill_dir"
    else
      log_item "Cua Driver skill $CUA_DRIVER_VERSION: already installed"
    fi
  elif (( ! runtime_ready || ! skill_ready )); then
    ensure_dir "$releases_dir" || return
    ensure_dir "$(dirname "$skill_dir")" || return
    tmp="$(mktemp -d "$packages_dir/.install.XXXXXXXX")" || return
    trap 'rm -rf "$tmp"' EXIT

    if (( ! runtime_ready )); then
      log_item "Downloading $binary_url"
      curl --fail --silent --show-error --location --retry 3 --output "$tmp/$binary_archive_name" "$binary_url" || return
      cua_driver_verify_checksum "$tmp/$binary_archive_name" "$binary_checksum" || return
      staged_runtime="$tmp/runtime"
      cua_driver_extract_runtime_archive "$tmp/$binary_archive_name" "$staged_runtime" || return
      chmod 0755 "$staged_runtime/cua-driver" "$staged_runtime/cua-cursor-theme" || return
      if [[ -L "$release_dir" ]]; then
        printf 'error: refusing to replace an unrelated Cua Driver release symlink: %s\n' "$release_dir" >&2
        return 1
      fi
      if [[ -e "$release_dir" ]]; then
        backup_path="$(next_backup_path "$release_dir")"
        mv "$release_dir" "$backup_path" || return
        log_item "Cua Driver release: backed up to $backup_path"
      fi
      mv "$staged_runtime" "$release_dir" || return
      log_item "Cua Driver runtime $CUA_DRIVER_VERSION: installed to $release_dir"
    else
      log_item "Cua Driver runtime $CUA_DRIVER_VERSION: already installed"
    fi

    if (( ! skill_ready )); then
      staged_skill="$tmp/skill"
      ensure_dir "$staged_skill" || return
      cp "$local_skill_dir/SKILL.md" "$local_skill_dir/BROWSER.md" \
        "$local_skill_dir/OMARCHY.md" "$staged_skill/" || return
      if [[ -e "$skill_dir" || -L "$skill_dir" ]]; then
        if [[ -L "$skill_dir" ]]; then
          printf 'error: refusing to replace an unrelated Cua Driver skill symlink: %s\n' "$skill_dir" >&2
          return 1
        fi
        backup_path="$(next_backup_path "$skill_dir")"
        mv "$skill_dir" "$backup_path" || return
        log_item "Cua Driver skill: backed up to $backup_path"
      fi
      mv "$staged_skill" "$skill_dir" || return
      log_item "Repository-owned Cua Driver Linux skill $CUA_DRIVER_VERSION: installed"
    else
      log_item "Cua Driver skill $CUA_DRIVER_VERSION: already installed"
    fi
  else
    log_item "Cua Driver runtime $CUA_DRIVER_VERSION: already installed"
    log_item "Cua Driver skill $CUA_DRIVER_VERSION: already installed"
  fi

  ensure_dir "$HOME/.local/bin" || return
  cua_driver_safe_link "$release_dir" "$current_link" "Cua Driver current release" "$releases_dir" || return
  cua_driver_safe_link "$current_link/cua-driver" "$bin_link" "cua-driver command" || return
  if [[ "${SETUP_HOST:-}" == "omarchy" ]]; then
    cua_driver_safe_link \
      "$omarchy_display_helper_source" "$omarchy_display_helper_link" \
      "cua-omarchy-display command" || return
    cua_driver_safe_link \
      "$omarchy_window_helper_source" "$omarchy_window_helper_link" \
      "cua-omarchy-window command" || return
  else
    log_item "Cua Driver Omarchy helper commands: skipped outside the Omarchy host"
  fi

  for skill_surface in \
    "$HOME/.agents/skills/cua-driver" \
    "$HOME/.claude/skills/cua-driver" \
    "$HOME/.codex/skills/cua-driver" \
    "$HOME/.pi/agent/skills/cua-driver"; do
    ensure_dir "$(dirname "$skill_surface")" || return
    cua_driver_safe_link "$skill_dir" "$skill_surface" "$(dirname "$skill_surface") Cua Driver skill" || return
  done

  log_item "Cua Driver installed without starting a daemon, installing a compositor plugin, registering MCP, or changing telemetry"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  DRY_RUN=0
  if [[ $# -eq 1 && "$1" == "--dry-run" ]]; then
    DRY_RUN=1
  elif [[ $# -ne 0 ]]; then
    printf 'Usage: bash install/cua-driver.sh [--dry-run]\n' >&2
    exit 1
  fi
  apply_cua_driver
fi
