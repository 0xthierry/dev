#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

write_ssh_config() {
  local ssh_dir="$HOME/.ssh"
  local config_dir="$ssh_dir/config.d"
  local include_path="$ssh_dir/config"
  local fragment_path="$config_dir/dev-setup.conf"
  local tmp_fragment=""
  local tmp_include=""
  local line=""
  local -a host_ssh_config_lines=()

  log_section "SSH Configuration"
  ensure_dir "$ssh_dir"
  ensure_dir "$config_dir"

  while IFS= read -r line; do
    [[ -n "$line" ]] && host_ssh_config_lines+=("$line")
  done < <(eval "printf '%s\n' \"\${HOST_SSH_CONFIG_LINES[@]-}\"")

  tmp_fragment="$(mktemp)"
  {
    printf 'Host *\n'
    printf '  AddKeysToAgent yes\n'

    for line in "${host_ssh_config_lines[@]}"; do
      printf '%s\n' "$line"
    done
  } > "$tmp_fragment"
  write_if_changed "$tmp_fragment" "$fragment_path"
  log_item "SSH fragment: $fragment_path"

  if [[ -f "$include_path" ]] && grep -Fq 'Include ~/.ssh/config.d/*.conf' "$include_path"; then
    log_item "SSH include: already configured"
    return 0
  fi

  tmp_include="$(mktemp)"
  if [[ -f "$include_path" ]]; then
    cat "$include_path" > "$tmp_include"
    printf '\n' >> "$tmp_include"
  fi

  printf 'Include ~/.ssh/config.d/*.conf\n' >> "$tmp_include"
  write_if_changed "$tmp_include" "$include_path"
  log_item "SSH include: $include_path"
}
