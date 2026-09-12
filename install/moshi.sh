#!/usr/bin/env bash
# Install and configure Moshi host integration without storing phone-specific secrets.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck source=install/herdr.sh
if ! declare -F resolve_herdr_bin >/dev/null; then
  source "$(dirname "${BASH_SOURCE[0]}")/herdr.sh"
fi

MOSHI_HOOK_VERSION="v0.3.19"
MOSHI_HOOK_BIN=""
MOSHI_HOOK_CHANGED=0

resolve_moshi_hook_bin() {
  if [[ -n "$MOSHI_HOOK_BIN" && -x "$MOSHI_HOOK_BIN" ]]; then
    printf '%s\n' "$MOSHI_HOOK_BIN"
    return 0
  fi

  if [[ -x "$HOME/.local/bin/moshi-hook" ]]; then
    printf '%s\n' "$HOME/.local/bin/moshi-hook"
    return 0
  fi

  if command -v moshi-hook >/dev/null 2>&1; then
    command -v moshi-hook
    return 0
  fi

  if [[ -x /opt/homebrew/bin/moshi-hook ]]; then
    printf '%s\n' /opt/homebrew/bin/moshi-hook
    return 0
  fi

  if [[ -x /usr/local/bin/moshi-hook ]]; then
    printf '%s\n' /usr/local/bin/moshi-hook
    return 0
  fi

  return 1
}

installed_moshi_hook_version() {
  local moshi_hook_bin="$1"

  "$moshi_hook_bin" version 2>/dev/null \
    | head -1 \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' \
    | head -1
}

install_moshi_hook_binary() {
  local moshi_hook_bin=""
  local installed_version=""

  if moshi_hook_bin="$(resolve_moshi_hook_bin 2>/dev/null)"; then
    installed_version="$(installed_moshi_hook_version "$moshi_hook_bin" || true)"
    if [[ "$installed_version" == "${MOSHI_HOOK_VERSION#v}" && "$moshi_hook_bin" == "$HOME/.local/bin/moshi-hook" ]]; then
      MOSHI_HOOK_BIN="$moshi_hook_bin"
      log_item "moshi-hook: already at $MOSHI_HOOK_VERSION ($moshi_hook_bin)"
      return 0
    fi
    if [[ "$installed_version" == "${MOSHI_HOOK_VERSION#v}" ]]; then
      log_item "Migrating moshi-hook $MOSHI_HOOK_VERSION to $HOME/.local/bin..."
    else
      log_item "Upgrading moshi-hook from ${installed_version:-unknown} to $MOSHI_HOOK_VERSION..."
    fi
  else
    log_item "Installing moshi-hook @ $MOSHI_HOOK_VERSION..."
  fi
  MOSHI_HOOK_CHANGED=1

  # The official installer supports Linux and macOS and honors the exact release
  # pin. Homebrew exposes only the tap's current formula, which cannot reproduce
  # an older repository pin after a newer formula is published.
  run_cmd env "MOSHI_HOOK_VERSION=$MOSHI_HOOK_VERSION" MOSHI_HOOK_SKIP_FIRST_RUN=1 \
    bash -c 'curl -fsSL https://getmoshi.app/install.sh | sh'
  MOSHI_HOOK_BIN="$HOME/.local/bin/moshi-hook"

  if (( ! ${DRY_RUN:-0} )); then
    installed_version="$(installed_moshi_hook_version "$MOSHI_HOOK_BIN" || true)"
    if [[ "$installed_version" != "${MOSHI_HOOK_VERSION#v}" ]]; then
      printf 'error: moshi-hook reports %s after installing %s\n' \
        "${installed_version:-an unknown version}" "$MOSHI_HOOK_VERSION" >&2
      return 1
    fi
  fi
}

moshi_hook_pairing_state() {
  local moshi_hook_bin=""
  local status_json=""

  if ! moshi_hook_bin="$(resolve_moshi_hook_bin 2>/dev/null)"; then
    if (( ${DRY_RUN:-0} )); then
      printf 'unpaired\n'
      return 0
    fi
    return 1
  fi
  status_json="$("$moshi_hook_bin" status --json 2>/dev/null)" || return 1
  jq -er '
    if .paired == true then "paired"
    elif .paired == false then "unpaired"
    else error("missing boolean paired status")
    end
  ' <<< "$status_json"
}

link_or_replace_path() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"
  local resolved_source_path=""
  local resolved_target_path=""
  local backup_path=""

  resolved_source_path="$(canonicalize_path "$source_path")"

  if [[ -L "$target_path" ]]; then
    resolved_target_path="$(resolve_symlink_target "$target_path")"
    if [[ "$resolved_target_path" == "$resolved_source_path" ]]; then
      log_item "$label: already linked"
      return 0
    fi

    run_cmd rm -f -- "$target_path"
  elif [[ -e "$target_path" ]]; then
    backup_path="$(next_backup_path "$target_path")"
    run_cmd mv "$target_path" "$backup_path"
    log_item "$label: backed up to $backup_path"
  fi

  ensure_dir "$(dirname "$target_path")"
  run_cmd ln -s "$source_path" "$target_path"
  log_item "$label: linked"
}

expose_herdr_for_moshi_probe() {
  local herdr_bin=""

  if ! herdr_bin="$(resolve_herdr_bin 2>/dev/null)"; then
    log_item "herdr: not installed yet, skipping Moshi probe symlink"
    return 0
  fi

  # Moshi's non-interactive SSH probe checks ~/.local/bin before shell startup files.
  # Link the real mise-installed Herdr binary there so Herdr session detection works.
  link_or_replace_path "$herdr_bin" "$HOME/.local/bin/herdr" "herdr Moshi probe binary"
}

configure_moshi_tailscale_incoming() {
  if ! check_installed tailscale; then
    log_item "Tailscale not available, skipping inbound connection setting"
    return 0
  fi

  run_cmd tailscale set --shields-up=false
  if (( ! ${DRY_RUN:-0} )) \
    && ! tailscale debug prefs 2>/dev/null | jq -e '.ShieldsUp == false' >/dev/null; then
    printf 'error: Tailscale still blocks incoming connections after disabling Shields Up\n' >&2
    return 1
  fi
  log_item "Tailscale incoming connections: enabled"
}

configure_mosh_firewall() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    return 0
  fi

  if ! check_installed ufw; then
    log_item "ufw not available, skipping mosh firewall rule"
    return 0
  fi

  if grep -Eq -- '-A ufw-user-input -i tailscale0 .*--dports 60000:61000 -j ACCEPT' /etc/ufw/user.rules 2>/dev/null; then
    log_item "mosh firewall rule: already configured"
    return 0
  fi

  log_item "Allowing mosh UDP range on tailscale0"
  run_cmd sudo ufw allow in on tailscale0 proto udp to any port 60000:61000 comment 'mosh over Tailscale'
}

configure_moshi_agent_hooks() {
  local moshi_hook_bin=""
  local target_command=""
  local target=""
  local command_name=""
  local configured_targets=""
  local status_json=""
  local -a existing_targets=()
  local -a target_commands=(
    claude:claude
    codex:codex
    opencode:opencode
    gemini:gemini
    antigravity:antigravity
    cursor:cursor-agent
    kimi:kimi
    qwen:qwen
    grok:grok
    omp:omp
    hermes:hermes
  )

  if ! moshi_hook_bin="$(resolve_moshi_hook_bin 2>/dev/null)"; then
    log_item "moshi-hook not available, skipping agent hook setup"
    return 0
  fi

  status_json="$("$moshi_hook_bin" status --json 2>/dev/null || true)"
  if (( ! ${DRY_RUN:-0} )) && ! jq -e \
    '.hooks[]? | select(.target == "pi" and .status == "current")' \
    >/dev/null <<< "$status_json"; then
    log_item "Moshi Pi integration is not current; refresh configs/agents/pi/extensions/moshi-hooks.ts from the pinned moshi-hook release"
  fi

  # Refresh every existing non-Pi hook, even when its agent binary is currently
  # absent. Pi is repository-owned and regenerated separately at the pinned version.
  configured_targets="$(
    jq -r '.hooks[]? | select(.target != "pi" and .status != "not_found") | .target' \
      <<< "$status_json" \
      | paste -sd' ' - \
      || true
  )"
  IFS=' ' read -r -a existing_targets <<< "$configured_targets"
  for target in "${existing_targets[@]}"; do
    run_cmd "$moshi_hook_bin" install --target "$target"
  done

  # Add hooks for installed agents that do not have a config yet.
  for target_command in "${target_commands[@]}"; do
    target="${target_command%%:*}"
    command_name="${target_command#*:}"
    if check_installed "$command_name" && [[ " $configured_targets " != *" $target "* ]]; then
      run_cmd "$moshi_hook_bin" install --target "$target"
    fi
  done
}

configure_moshi_macos_service() {
  local moshi_hook_bin="$1"
  local domain=""
  local service=""
  domain="gui/$(id -u)"
  service="$domain/app.getmoshi.moshi-hook"
  local plist="$HOME/Library/LaunchAgents/app.getmoshi.moshi-hook.plist"

  # Retain any legacy Homebrew package, but stop its service so only the
  # repository-pinned ~/.local binary owns the daemon.
  if check_installed brew \
    && brew list --formula --versions moshi-hook >/dev/null 2>&1 \
    && brew services list 2>/dev/null | awk '$1 == "moshi-hook" && $2 != "none" { found = 1 } END { exit !found }'; then
    run_cmd brew services stop moshi-hook
  fi

  if (( ${DRY_RUN:-0} )); then
    log_item "[dry-run] Install and start pinned Moshi macOS LaunchAgent: $plist"
    return 0
  fi

  python3 - "$HOME" "$moshi_hook_bin" <<'PY'
import os
import pathlib
import plistlib
import sys
import tempfile

home = pathlib.Path(sys.argv[1]).absolute()
binary = sys.argv[2]
support = home / "Library/Application Support/Moshi"
plist = home / "Library/LaunchAgents/app.getmoshi.moshi-hook.plist"
support.mkdir(parents=True, exist_ok=True)
plist.parent.mkdir(parents=True, exist_ok=True)

service = {
    "Label": "app.getmoshi.moshi-hook",
    "ProgramArguments": [binary, "serve"],
    "WorkingDirectory": str(support),
    "EnvironmentVariables": {
        "HOME": str(home),
        "PATH": ":".join([
            str(home / ".local/bin"),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]),
    },
    "Disabled": False,
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 5,
    "StandardOutPath": str(support / "launchd.log"),
    "StandardErrorPath": str(support / "launchd.log"),
}
content = plistlib.dumps(service)
if not plist.is_symlink() and plist.is_file() and plist.read_bytes() == content:
    plist.chmod(0o600)
else:
    if plist.exists() and plist.is_dir() and not plist.is_symlink():
        sys.exit("error: Moshi LaunchAgent destination is a directory: " + str(plist))
    fd, temporary = tempfile.mkstemp(prefix=".moshi-hook-", dir=plist.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            os.fchmod(stream.fileno(), 0o600)
        os.replace(temporary, plist)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
PY

  launchctl enable "$service"
  if launchctl print "$service" >/dev/null 2>&1; then
    launchctl kickstart -k "$service"
    log_item "moshi-hook: macOS LaunchAgent restarted"
  else
    launchctl bootstrap "$domain" "$plist"
    log_item "moshi-hook: macOS LaunchAgent installed and started"
  fi
}

wait_for_moshi_hook_service() {
  local moshi_hook_bin="$1"
  local status_json=""
  local attempt=0

  if (( ${DRY_RUN:-0} )); then
    return 0
  fi

  for (( attempt = 0; attempt < 20; attempt += 1 )); do
    status_json="$("$moshi_hook_bin" probe --json 2>/dev/null || true)"
    if jq -e '.running == true and .gateway == true' >/dev/null 2>&1 <<< "$status_json"; then
      log_item "moshi-hook: daemon and gateway are ready"
      return 0
    fi
    sleep 0.25
  done

  printf 'error: moshi-hook service did not become ready: %s\n' "${status_json:-no probe response}" >&2
  return 1
}

configure_moshi_hook_service() {
  local moshi_hook_bin=""

  if ! moshi_hook_bin="$(resolve_moshi_hook_bin 2>/dev/null)"; then
    log_item "moshi-hook not available, skipping service setup"
    return 0
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    configure_moshi_macos_service "$moshi_hook_bin"
    wait_for_moshi_hook_service "$moshi_hook_bin"
    return 0
  fi

  if ! check_installed systemctl; then
    log_item "systemctl not available, skipping moshi-hook service setup"
    return 0
  fi

  run_cmd "$moshi_hook_bin" service install
  if (( MOSHI_HOOK_CHANGED )); then
    run_cmd systemctl --user restart moshi-hook.service
  fi
  wait_for_moshi_hook_service "$moshi_hook_bin"
}

apply_moshi() {
  local pairing_state=""

  log_section "Moshi"
  install_moshi_hook_binary
  expose_herdr_for_moshi_probe
  configure_moshi_tailscale_incoming
  configure_mosh_firewall

  if ! pairing_state="$(moshi_hook_pairing_state)"; then
    printf 'error: could not determine Moshi pairing state from moshi-hook status --json\n' >&2
    return 1
  fi
  if [[ "$pairing_state" == "unpaired" ]]; then
    log_item "Moshi is not paired; skipping agent hooks and service startup"
    log_item "Pair manually: moshi-hook pair --token <token-from-Moshi>"
    log_item "Or use Easy Pair: moshi-hook host setup --host <tailscale-ip> --name <name> --user $USER"
    log_item "Rerun setup after pairing to install hooks and start the service"
    return 0
  fi

  configure_moshi_agent_hooks
  configure_moshi_hook_service
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  apply_moshi
fi
