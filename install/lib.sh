#!/usr/bin/env bash
# Shared functions for install scripts

log_section() {
  echo ""
  echo "=== $1 ==="
}

log_item() {
  echo "  $1"
}

check_installed() {
  command -v "$1" &> /dev/null
}

dry_run_cmd() {
  local rendered=""
  local arg=""

  for arg in "$@"; do
    if [[ -n "$rendered" ]]; then
      rendered+=" "
    fi
    printf -v arg '%q' "$arg"
    rendered+="$arg"
  done

  echo "[dry-run] $rendered"
}

run_cmd() {
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd "$@"
    return 0
  fi

  "$@"
}

ensure_dir() {
  local dir_path="$1"

  if [[ -d "$dir_path" ]]; then
    return 0
  fi

  run_cmd mkdir -p "$dir_path"
}

canonicalize_path() {
  local dir_path=""
  local base_name=""

  dir_path="$(dirname "$1")"
  base_name="$(basename "$1")"

  if [[ -d "$dir_path" ]]; then
    printf '%s/%s\n' "$(cd "$dir_path" && pwd -P)" "$base_name"
    return 0
  fi

  printf '%s/%s\n' "$dir_path" "$base_name"
}

resolve_symlink_target() {
  local symlink_path="$1"
  local link_target=""
  local base_dir=""

  link_target="$(readlink "$symlink_path")"
  base_dir="$(dirname "$symlink_path")"

  if [[ "$link_target" = /* ]]; then
    canonicalize_path "$link_target"
    return 0
  fi

  canonicalize_path "$base_dir/$link_target"
}

next_backup_path() {
  local target_path="$1"
  local candidate="${target_path}.bak"
  local counter=1

  while [[ -e "$candidate" || -L "$candidate" ]]; do
    candidate="${target_path}.bak.$counter"
    ((counter += 1))
  done

  printf '%s\n' "$candidate"
}

safe_link_path() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"
  local current_target=""
  local resolved_source_path=""
  local resolved_current_target=""

  resolved_source_path="$(canonicalize_path "$source_path")"

  if [[ -L "$target_path" ]]; then
    current_target="$(readlink "$target_path")"
    resolved_current_target="$(resolve_symlink_target "$target_path")"

    if [[ "$current_target" == "$source_path" || "$resolved_current_target" == "$resolved_source_path" ]]; then
      log_item "$label: already linked"
      return 0
    fi

    printf 'warning: %s exists as a different symlink: %s -> %s\n' "$label" "$target_path" "$current_target" >&2
    return 0
  fi

  if [[ -e "$target_path" ]]; then
    printf 'warning: %s already exists and will not be replaced: %s\n' "$label" "$target_path" >&2
    return 0
  fi

  run_cmd ln -s "$source_path" "$target_path"
  log_item "$label: linked"
}

write_if_changed() {
  local source_path="$1"
  local target_path="$2"

  if [[ -f "$target_path" ]] && cmp -s "$source_path" "$target_path"; then
    rm -f "$source_path"
    return 0
  fi

  run_cmd mv "$source_path" "$target_path"
  rm -f "$source_path"
}

install_if_missing() {
  local name="$1"
  local cmd="$2"
  local install_cmd="$3"

  if check_installed "$cmd"; then
    log_item "$name: installed"
    return 0
  else
    log_item "Installing $name..."
    eval "$install_cmd"
  fi
}

get_aur_helper() {
  if command -v paru &> /dev/null; then
    echo "paru"
  elif command -v yay &> /dev/null; then
    echo "yay"
  else
    echo ""
  fi
}

set_default_shell() {
  local target_shell="$1"
  local shell_path
  shell_path=$(command -v "$target_shell" 2>/dev/null)

  if [ -z "$shell_path" ]; then
    log_item "Shell $target_shell not found, skipping"
    return 1
  fi

  if [ "$SHELL" = "$shell_path" ]; then
    log_item "Default shell: already $target_shell"
    return 0
  fi

  # Add to /etc/shells if not already listed (required for chsh)
  if ! grep -qx "$shell_path" /etc/shells 2>/dev/null; then
    log_item "Adding $shell_path to /etc/shells..."
    if (( ${DRY_RUN:-0} )); then
      dry_run_cmd sudo sh -c "printf '%s\n' '$shell_path' >> /etc/shells"
    else
      printf '%s\n' "$shell_path" | sudo tee -a /etc/shells > /dev/null
    fi
  fi

  log_item "Setting default shell to $target_shell..."
  run_cmd chsh -s "$shell_path"
}
