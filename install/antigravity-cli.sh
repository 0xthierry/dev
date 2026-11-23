#!/usr/bin/env bash
# Google Antigravity CLI (agy), not the Antigravity editor or Gemini CLI.
# Official docs: https://antigravity.google/docs/getting-started?tab=cli
# Pins captured from the manifests used by https://antigravity.google/cli/install.sh
# at https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/.
# Do not run upstream's `agy install`: it modifies shell startup files. The repo
# already puts ~/.local/bin on PATH. Authentication stays an explicit user action.
# This pins setup's installation; upstream may self-update during ordinary use.
set -euo pipefail
# shellcheck source=install/retired-ai-tools.sh
source "$(dirname "${BASH_SOURCE[0]}")/retired-ai-tools.sh"

ANTIGRAVITY_CLI_VERSION="1.5.15"
ANTIGRAVITY_CLI_RELEASE="1.5.15-5514532022517760"

install_antigravity_cli() (
  log_section "Antigravity CLI ($ANTIGRAVITY_CLI_VERSION)"
  local asset checksum target current temp_dir staged=""
  target="$HOME/.local/bin/agy"
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
      asset=linux-x64/cli_linux_x64.tar.gz
      checksum=af3f0be58b8475940d79f9abea19e762ecc3d265ea9f56cff8dd805e27ba299b44a305a79504a7ffe6ebdfa29a294c56edc4caed1875990bfaf2fef1508ec8b0
      ;;
    Linux-aarch64|Linux-arm64)
      asset=linux-arm/cli_linux_arm64.tar.gz
      checksum=d64ad759781b50dfacfa7d9826c0ad469959d01bdf5a170acd4c83472eba31c677baf0052ac8ab48eef40f0d3f0e26057e752aabd24331c79f4c881d4b872125
      ;;
    Darwin-x86_64)
      asset=darwin-x64/cli_mac_x64.tar.gz
      checksum=2276e0f189a917e7eaa4b00ece59fe6a1062914472e13247f402b56fe26c9afacd0af494476e31a5610fb0b273400ca4013f273d56d69c6fdd7e2d0ec933f596
      ;;
    Darwin-arm64)
      asset=darwin-arm/cli_mac_arm64.tar.gz
      checksum=b03a841eb3a29be918a66960b775f68ed4f3bcc02f33962131bbbc26c46ea983ceac6c832ad46efd11d73d9a2cb97df4ab24d4bc92ee47d3d5ece7b8d8b61235
      ;;
    *) printf 'error: unsupported Antigravity CLI platform\n' >&2; return 1 ;;
  esac
  if [[ -d "$target" ]]; then
    printf 'error: Antigravity CLI destination is a directory: %s\n' "$target" >&2
    return 1
  fi
  if (( ${DRY_RUN:-0} )); then
    log_item "Would install agy $ANTIGRAVITY_CLI_VERSION from $asset, verify SHA-512 $checksum, into $target, then disable mise management of antigravity-cli (no authentication or shell changes)"
    return 0
  fi
  if [[ -x "$target" ]]; then
    current="$("$target" --version 2>/dev/null)" || current=""
    if [[ "$current" == "$ANTIGRAVITY_CLI_VERSION" ]]; then
      log_item "agy: already at $ANTIGRAVITY_CLI_VERSION"
      disable_mise_antigravity_cli
      return $?
    fi
  fi

  temp_dir="$(mktemp -d)"
  trap 'rm -rf -- "$temp_dir"; if [[ -n "$staged" ]]; then rm -f -- "$staged"; fi' EXIT
  curl -fSL --retry 3 -o "$temp_dir/cli.tar.gz" \
    "https://storage.googleapis.com/antigravity-public/antigravity-cli/$ANTIGRAVITY_CLI_RELEASE/$asset"
  if command -v sha512sum >/dev/null 2>&1; then
    (cd "$temp_dir" && printf '%s  cli.tar.gz\n' "$checksum" | sha512sum -c -)
  else
    (cd "$temp_dir" && printf '%s  cli.tar.gz\n' "$checksum" | shasum -a 512 -c -)
  fi
  tar -xzf "$temp_dir/cli.tar.gz" -C "$temp_dir" antigravity
  chmod +x "$temp_dir/antigravity"
  current="$("$temp_dir/antigravity" --version)"
  [[ "$current" == "$ANTIGRAVITY_CLI_VERSION" ]] || {
    printf 'error: unexpected Antigravity CLI version: %s\n' "$current" >&2
    return 1
  }
  # Stage on the destination filesystem, then atomically replace the executable.
  # Failed downloads/checks never remove the user's working version.
  mkdir -p "$(dirname "$target")"
  staged="$(mktemp "$HOME/.local/bin/.agy.XXXXXX")"
  install -m 755 "$temp_dir/antigravity" "$staged"
  mv -f "$staged" "$target"
  staged=""
  log_item "Installed $target"
  disable_mise_antigravity_cli
)
