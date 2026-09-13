#!/usr/bin/env bash
# Install a pinned GitHub CLI release for Linux and macOS.
set -euo pipefail
# shellcheck source=install/lib.sh
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

GITHUB_CLI_VERSION="2.100.0"

installed_github_cli_version() {
  local binary="$1"
  local version_line=""

  [[ -x "$binary" ]] || return 1
  version_line="$("$binary" --version 2>/dev/null | head -1)" || return 1
  # "gh version 2.100.0 (2026-09-03)" -> "2.100.0"
  printf '%s\n' "$version_line" | awk '{print $3}'
}

github_cli_platform() {
  local os="$1"
  local arch="$2"
  local platform_os=""
  local platform_arch=""

  case "$os" in
    Linux) platform_os="linux" ;;
    Darwin) platform_os="macOS" ;;
    *)
      printf 'error: unsupported GitHub CLI OS: %s\n' "$os" >&2
      return 1
      ;;
  esac

  case "$arch" in
    x86_64|amd64) platform_arch="amd64" ;;
    arm64|aarch64) platform_arch="arm64" ;;
    *)
      printf 'error: unsupported GitHub CLI architecture: %s\n' "$arch" >&2
      return 1
      ;;
  esac

  printf '%s_%s\n' "$platform_os" "$platform_arch"
}

github_cli_checksum() {
  case "$1" in
    linux_amd64) printf '%s\n' "e4d4bb4498e8d007abe545b6568926793ace1b6447da598294a610018cb164be" ;;
    linux_arm64) printf '%s\n' "ea4e7a581a32ccad6cc7923cb1576ac5859ba4b9a16ab22eb8f8a96e78e2e961" ;;
    macOS_amd64) printf '%s\n' "fcd7799e85eb575f3c7d2b1679bfbfedaefa1269d4bc7d096b51e10939b4812b" ;;
    macOS_arm64) printf '%s\n' "45f9a62da2f6e641a7fad57e2ce39656dfd7ef331372d80a2a2aed65abb01642" ;;
    *) return 1 ;;
  esac
}

verify_github_cli_checksum() {
  local archive="$1"
  local checksum="$2"

  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
    return
  fi

  printf '%s  %s\n' "$checksum" "$archive" | shasum -a 256 --check --status
}

install_github_cli() (
  local platform=""
  local checksum=""
  local extension="tar.gz"
  local archive_name=""
  local release_dir=""
  local url=""
  local install_dir="$HOME/.local/bin"
  local binary="$install_dir/gh"
  local marker_dir="$HOME/.local/share/dev-setup/github-cli"
  local marker="$marker_dir/version"
  local expected_marker=""
  local installed_version=""
  local tmp_dir=""
  local backup_path=""

  platform="$(github_cli_platform "$(uname -s)" "$(uname -m)")" || return
  checksum="$(github_cli_checksum "$platform")" || return
  [[ "$platform" == macOS_* ]] && extension="zip"
  archive_name="gh_${GITHUB_CLI_VERSION}_${platform}.${extension}"
  release_dir="gh_${GITHUB_CLI_VERSION}_${platform}"
  url="https://github.com/cli/cli/releases/download/v${GITHUB_CLI_VERSION}/${archive_name}"
  expected_marker="${GITHUB_CLI_VERSION} ${platform}"

  log_section "GitHub CLI (pinned v${GITHUB_CLI_VERSION})"

  installed_version="$(installed_github_cli_version "$binary" 2>/dev/null || true)"
  if [[ "$installed_version" == "$GITHUB_CLI_VERSION" ]]; then
    ensure_dir "$marker_dir"
    if (( ! ${DRY_RUN:-0} )); then
      printf '%s\n' "$expected_marker" > "$marker"
    fi
    log_item "GitHub CLI $GITHUB_CLI_VERSION: already installed"
    return 0
  fi

  if [[ -n "$installed_version" ]]; then
    log_item "GitHub CLI: upgrading $installed_version -> $GITHUB_CLI_VERSION"
  fi

  if (( ${DRY_RUN:-0} )); then
    ensure_dir "$install_dir"
    ensure_dir "$marker_dir"
    dry_run_cmd curl --fail --location --retry 3 --output "$archive_name" "$url"
    log_item "Would verify SHA-256: $checksum"
    dry_run_cmd install -m 0755 "$release_dir/bin/gh" "$binary"
    log_item "GitHub CLI $GITHUB_CLI_VERSION: would install"
    return 0
  fi

  ensure_dir "$install_dir"
  ensure_dir "$marker_dir"
  tmp_dir="$(mktemp -d "$install_dir/.gh.XXXXXXXX")"
  trap 'rm -rf "$tmp_dir"' EXIT

  log_item "Downloading $url"
  curl --fail --silent --show-error --location --retry 3 \
    --output "$tmp_dir/$archive_name" "$url"
  verify_github_cli_checksum "$tmp_dir/$archive_name" "$checksum"

  if [[ "$extension" == "zip" ]]; then
    unzip -q "$tmp_dir/$archive_name" -d "$tmp_dir"
  else
    tar -xzf "$tmp_dir/$archive_name" -C "$tmp_dir"
  fi

  install -m 0755 "$tmp_dir/$release_dir/bin/gh" "$tmp_dir/gh"

  if [[ ( -e "$binary" || -L "$binary" ) && ! -f "$marker" ]]; then
    backup_path="$(next_backup_path "$binary")"
    mv "$binary" "$backup_path"
    log_item "Preserved unmanaged GitHub CLI at $backup_path"
  fi

  mv -f "$tmp_dir/gh" "$binary"
  printf '%s\n' "$expected_marker" > "$marker"

  installed_version="$(installed_github_cli_version "$binary")"
  if [[ "$installed_version" != "$GITHUB_CLI_VERSION" ]]; then
    printf 'error: expected GitHub CLI %s, got %s\n' "$GITHUB_CLI_VERSION" "$installed_version" >&2
    return 1
  fi

  log_item "GitHub CLI $GITHUB_CLI_VERSION: installed to $binary"
)

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  install_github_cli
fi
