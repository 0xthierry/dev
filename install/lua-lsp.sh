#!/usr/bin/env bash
# Shared Lua/Luau tooling. LuaLS comes from the declarative OS package lists.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

LUA_LSP_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LUAU_LSP_VERSION="1.70.1"

install_luau_lsp() (
  log_section "Luau language server ($LUAU_LSP_VERSION)"
  local platform archive checksum target temp_dir staged current backup
  target="$HOME/.local/bin/luau-lsp"
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64|Darwin-x86_64)
      platform=macos
      checksum=7d3936e8dec6dc77547abd061d2e950da392562a5f94858b880f23dba50d84cd
      ;;
    Linux-x86_64)
      platform=linux-x86_64
      checksum=1a2ea1ae4f98f8946cefd970a4b54853e11ab4775e6932faa7f60cf920346567
      ;;
    Linux-aarch64|Linux-arm64)
      platform=linux-arm64
      checksum=6062345b95124ca937b8c324b74bc3fddb1d6919ba133c58f8b17945ce1acbc2
      ;;
    *) printf 'error: unsupported Luau LSP platform\n' >&2; return 1 ;;
  esac
  archive="luau-lsp-${platform}.zip"
  if [[ -x "$target" ]]; then
    current="$("$target" --version 2>/dev/null)" || current=""
    if [[ "$current" == "$LUAU_LSP_VERSION" ]]; then
      log_item "luau-lsp: already at $LUAU_LSP_VERSION"
      return 0
    fi
  fi
  if (( ${DRY_RUN:-0} )); then
    log_item "Would download $archive at $LUAU_LSP_VERSION, verify SHA-256 $checksum, and install $target"
    return 0
  fi

  temp_dir="$(mktemp -d)"
  staged=""
  trap 'rm -rf -- "$temp_dir"; if [[ -n "$staged" ]]; then rm -f -- "$staged"; fi' EXIT
  curl -fSL --retry 3 -o "$temp_dir/$archive" \
    "https://github.com/JohnnyMorganz/luau-lsp/releases/download/$LUAU_LSP_VERSION/$archive"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$temp_dir" && printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -)
  else
    (cd "$temp_dir" && printf '%s  %s\n' "$checksum" "$archive" | shasum -a 256 -c -)
  fi
  unzip -q "$temp_dir/$archive" -d "$temp_dir/unpacked"
  chmod +x "$temp_dir/unpacked/luau-lsp"
  current="$("$temp_dir/unpacked/luau-lsp" --version)"
  [[ "$current" == "$LUAU_LSP_VERSION" ]] || {
    printf 'error: unexpected Luau LSP version: %s\n' "$current" >&2
    return 1
  }
  ensure_dir "$(dirname "$target")"
  staged="$(mktemp "$HOME/.local/bin/.luau-lsp.XXXXXX")"
  cp "$temp_dir/unpacked/luau-lsp" "$staged"
  chmod 755 "$staged"
  if [[ -e "$target" || -L "$target" ]]; then
    backup="$(next_backup_path "$target")"
    cp -Pp "$target" "$backup"
    log_item "Previous luau-lsp preserved at $backup"
  fi
  mv -f "$staged" "$target"
  staged=""
  log_item "Installed $target"
)

configure_claude_lua_plugins() {
  log_section "Claude Code Lua/Luau plugins"
  local marketplace="$LUA_LSP_REPO_ROOT/configs/agents/claude/plugins"
  local marketplaces plugins plugin
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd claude plugin marketplace add anthropics/claude-plugins-official
    dry_run_cmd claude plugin marketplace add "$marketplace"
    dry_run_cmd claude plugin install --scope user lua-lsp@claude-plugins-official
    dry_run_cmd claude plugin install --scope user luau-lsp@thierry-local
    return 0
  fi
  if ! command -v claude >/dev/null 2>&1; then
    printf 'error: install Claude Code before configuring Lua/Luau plugins\n' >&2
    return 1
  fi
  marketplaces="$(claude plugin marketplace list --json)"
  if ! jq -e 'any(.[]; .name == "claude-plugins-official")' <<< "$marketplaces" >/dev/null; then
    claude plugin marketplace add anthropics/claude-plugins-official
  fi
  # Re-adding the same source is safe and restores its user-settings declaration.
  claude plugin marketplace add "$marketplace"
  claude plugin install --scope user lua-lsp@claude-plugins-official
  claude plugin install --scope user luau-lsp@thierry-local
  plugins="$(claude plugin list --json)"
  for plugin in lua-lsp@claude-plugins-official luau-lsp@thierry-local; do
    # Claude returns an error when enable is called on an enabled plugin.
    if jq -e --arg id "$plugin" 'any(.[]; .id == $id and .scope == "user" and .enabled == false)' <<< "$plugins" >/dev/null; then
      claude plugin enable --scope user "$plugin"
    fi
  done
}
