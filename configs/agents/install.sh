#!/usr/bin/env bash

set -euo pipefail

DRY_RUN=0
AUTO_YES=0
LINKED_COUNT=0
SKIPPED_COUNT=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_AGENTS_DIR="$SCRIPT_DIR/agents"
SOURCE_SKILLS_DIR="$SCRIPT_DIR/skills"
SOURCE_HOOKS_DIR="$SCRIPT_DIR/hooks"
SOURCE_CODEX_CONFIG="$SCRIPT_DIR/codex-config.toml"
SOURCE_CODEX_HOOKS="$SCRIPT_DIR/hooks/codex-hooks.json"
SOURCE_AGENTS_MD="$SCRIPT_DIR/AGENTS.md"
SOURCE_USER_MD="$SCRIPT_DIR/USER.md"

usage() {
  cat <<'EOF'
Usage: ./install.sh [--dry-run] [--yes]

Options:
  -n, --dry-run   Print the actions without creating directories or symlinks.
  -y, --yes       Skip confirmation prompts (install both ~/.claude and ~/.codex).
  -h, --help      Show this help message.
EOF
}

log() {
  printf '%s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

dry_run_cmd() {
  local rendered=""
  local arg

  for arg in "$@"; do
    if [[ -n "$rendered" ]]; then
      rendered+=" "
    fi
    printf -v arg '%q' "$arg"
    rendered+="$arg"
  done

  log "[dry-run] $rendered"
}

run_cmd() {
  if (( DRY_RUN )); then
    dry_run_cmd "$@"
  else
    "$@"
  fi
}

canonicalize_path() {
  local dir base
  dir="$(dirname "$1")"
  base="$(basename "$1")"
  if [[ -d "$dir" ]]; then
    printf '%s/%s\n' "$(cd "$dir" && pwd -P)" "$base"
  else
    printf '%s/%s\n' "$dir" "$base"
  fi
}

resolve_symlink_target() {
  local symlink_path="$1"
  local link_target=""
  local base_dir=""

  link_target="$(readlink "$symlink_path")"
  base_dir="$(dirname "$symlink_path")"

  if [[ "$link_target" = /* ]]; then
    canonicalize_path "$link_target"
  else
    canonicalize_path "$base_dir/$link_target"
  fi
}

ensure_dir() {
  local dir_path="$1"

  if [[ -d "$dir_path" ]]; then
    return 0
  fi

  run_cmd mkdir -p "$dir_path"
}

prompt_yes_no() {
  local prompt="$1"
  local reply=""

  if (( AUTO_YES )); then
    return 0
  fi

  while true; do
    read -r -p "$prompt [y/N] " reply || {
      printf '\n' >&2
      return 1
    }

    case "$reply" in
      [Yy]|[Yy][Ee][Ss])
        return 0
        ;;
      ""|[Nn]|[Nn][Oo])
        return 1
        ;;
      *)
        log "Please answer y or n."
        ;;
    esac
  done
}

link_path() {
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
      log "skip: $label already linked"
      ((SKIPPED_COUNT += 1))
      return 0
    fi

    if [[ ! -e "$target_path" ]]; then
      run_cmd rm -f "$target_path"
      run_cmd ln -s "$source_path" "$target_path"
      log "relinked: $label (replaced stale symlink)"
      ((LINKED_COUNT += 1))
      return 0
    fi

    warn "$label exists as a different symlink: $target_path -> $current_target"
    ((SKIPPED_COUNT += 1))
    return 0
  fi

  if [[ -e "$target_path" ]]; then
    warn "$label already exists and will not be replaced: $target_path"
    ((SKIPPED_COUNT += 1))
    return 0
  fi

  run_cmd ln -s "$source_path" "$target_path"
  log "linked: $label"
  ((LINKED_COUNT += 1))
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

force_link_path() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"
  local current_target=""
  local resolved_source_path=""
  local resolved_current_target=""
  local backup_path=""

  resolved_source_path="$(canonicalize_path "$source_path")"

  if [[ -L "$target_path" ]]; then
    current_target="$(readlink "$target_path")"
    resolved_current_target="$(resolve_symlink_target "$target_path")"

    if [[ "$current_target" == "$source_path" || "$resolved_current_target" == "$resolved_source_path" ]]; then
      log "skip: $label already linked"
      ((SKIPPED_COUNT += 1))
      return 0
    fi
  fi

  if [[ -e "$target_path" || -L "$target_path" ]]; then
    backup_path="$(next_backup_path "$target_path")"
    run_cmd mv "$target_path" "$backup_path"
    log "backed up: $label existing entry -> $backup_path"
  fi

  run_cmd ln -s "$source_path" "$target_path"
  log "linked: $label"
  ((LINKED_COUNT += 1))
}

copy_file_if_needed() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"

  if [[ ! -f "$source_path" ]]; then
    warn "Missing source file for $label: $source_path"
    ((SKIPPED_COUNT += 1))
    return 0
  fi

  if [[ -e "$target_path" && ! -f "$target_path" ]]; then
    warn "$label already exists and is not a regular file: $target_path"
    ((SKIPPED_COUNT += 1))
    return 0
  fi

  if [[ -f "$target_path" ]] && cmp -s "$source_path" "$target_path"; then
    log "skip: $label already up to date"
    ((SKIPPED_COUNT += 1))
    return 0
  fi

  run_cmd cp "$source_path" "$target_path"
  log "copied: $label"
}

link_agent_entries() {
  local target_root="$1"
  local target_agents_dir="$target_root/agents"
  local source_path=""
  local target_path=""
  local name=""

  ensure_dir "$target_agents_dir"

  while IFS= read -r -d '' source_path; do
    name="$(basename "$source_path")"
    target_path="$target_agents_dir/$name"
    link_path "$source_path" "$target_path" "agent $name"
  done < <(find "$SOURCE_AGENTS_DIR" -mindepth 1 -maxdepth 1 \( -type f -o -type d -o -type l \) -print0)
}

strip_model_from_frontmatter() {
  # Reads stdin, removes "model: ..." lines from YAML frontmatter, writes to stdout.
  # Frontmatter is delimited by leading "---" lines.
  awk '
    BEGIN { in_fm = 0; seen_open = 0 }
    /^---[[:space:]]*$/ {
      if (!seen_open) { in_fm = 1; seen_open = 1; print; next }
      else            { in_fm = 0; print; next }
    }
    in_fm && /^model:/ { next }
    { print }
  '
}

copy_agent_stripped() {
  local source_path="$1"
  local target_path="$2"
  local label="$3"
  local tmp_path=""

  tmp_path="$(mktemp)"
  strip_model_from_frontmatter < "$source_path" > "$tmp_path"

  if [[ -f "$target_path" ]] && cmp -s "$tmp_path" "$target_path"; then
    log "skip: $label already up to date"
    rm -f "$tmp_path"
    ((SKIPPED_COUNT += 1))
    return 0
  fi

  if (( DRY_RUN )); then
    log "[dry-run] copy (model stripped): $label"
    rm -f "$tmp_path"
  else
    mv "$tmp_path" "$target_path"
    log "copied (model stripped): $label"
  fi
  ((LINKED_COUNT += 1))
}

copy_agent_entries_stripped() {
  local target_root="$1"
  local target_agents_dir="$target_root/agents"
  local source_path=""
  local target_path=""
  local name=""

  ensure_dir "$target_agents_dir"

  while IFS= read -r -d '' source_path; do
    name="$(basename "$source_path")"
    target_path="$target_agents_dir/$name"

    if [[ -d "$source_path" ]]; then
      link_path "$source_path" "$target_path" "agent $name"
    elif [[ "$name" == *.md ]]; then
      copy_agent_stripped "$source_path" "$target_path" "agent $name"
    else
      link_path "$source_path" "$target_path" "agent $name"
    fi
  done < <(find "$SOURCE_AGENTS_DIR" -mindepth 1 -maxdepth 1 \( -type f -o -type d -o -type l \) -print0)
}

link_skill_entries() {
  local target_root="$1"
  local target_skills_dir="$target_root/skills"
  local source_path=""
  local target_path=""
  local name=""

  ensure_dir "$target_skills_dir"

  while IFS= read -r -d '' source_path; do
    name="$(basename "$source_path")"
    target_path="$target_skills_dir/$name"
    link_path "$source_path" "$target_path" "skill $name"
  done < <(find "$SOURCE_SKILLS_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -print0)
}

install_target() {
  local target_root="$1"
  local label="$2"

  log ""
  log "Installing into $label ($target_root)"
  link_agent_entries "$target_root"
  link_skill_entries "$target_root"
}

install_codex_target() {
  local target_root="$1"

  log ""
  log "Installing into ~/.codex ($target_root)"
  copy_agent_entries_stripped "$target_root"
  link_skill_entries "$target_root"
  force_link_path "$SOURCE_AGENTS_MD" "$target_root/AGENTS.md" "codex AGENTS.md"
  copy_file_if_needed "$SOURCE_CODEX_CONFIG" "$target_root/config.toml" "codex config.toml"
  # Install hooks.json for Codex
  if [[ -f "$SOURCE_CODEX_HOOKS" ]]; then
    copy_file_if_needed "$SOURCE_CODEX_HOOKS" "$target_root/hooks.json" "codex hooks.json"
  fi
}

sync_hooks_to_settings() {
  local hooks_json="$1"
  local settings_path="$2"
  local label="$3"

  if [[ ! -f "$hooks_json" ]]; then
    warn "Missing hooks config: $hooks_json"
    return 0
  fi

  if [[ ! -f "$settings_path" ]]; then
    warn "Missing settings file: $settings_path"
    return 0
  fi

  if ! command -v jq &>/dev/null; then
    warn "jq not found — cannot sync hooks to $label settings.json"
    return 0
  fi

  local current_hooks new_hooks
  current_hooks="$(jq -cS '.hooks // {}' "$settings_path")"
  new_hooks="$(jq -cS '.' "$hooks_json")"

  if [[ "$current_hooks" == "$new_hooks" ]]; then
    log "skip: $label hooks already up to date"
    ((SKIPPED_COUNT += 1))
    return 0
  fi

  if (( DRY_RUN )); then
    log "[dry-run] sync hooks into $label settings.json"
    return 0
  fi

  local tmp_path
  tmp_path="$(mktemp)"
  jq --argjson hooks "$new_hooks" '.hooks = $hooks' "$settings_path" > "$tmp_path"
  mv "$tmp_path" "$settings_path"
  log "synced: $label hooks config"
  ((LINKED_COUNT += 1))
}

install_claude_target() {
  local target_root="$1"
  local claude_hooks_json="$SOURCE_HOOKS_DIR/claude-hooks.json"

  install_target "$target_root" "~/.claude"
  force_link_path "$SOURCE_AGENTS_MD" "$target_root/CLAUDE.md" "claude CLAUDE.md"
  force_link_path "$SOURCE_USER_MD" "$target_root/USER.md" "claude USER.md"
  # Symlink hooks directory
  if [[ -d "$SOURCE_HOOKS_DIR" ]]; then
    force_link_path "$SOURCE_HOOKS_DIR" "$target_root/hooks" "claude hooks"
  fi
  # Symlink bin directory (indexer)
  if [[ -d "$SOURCE_HOOKS_DIR/bin" ]]; then
    force_link_path "$SOURCE_HOOKS_DIR/bin" "$target_root/bin" "claude bin"
  fi
  # Sync hooks config into settings.json
  sync_hooks_to_settings "$claude_hooks_json" "$target_root/settings.json" "claude"
}

main() {
  local install_codex=1
  local install_claude=1

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -n|--dry-run)
        DRY_RUN=1
        ;;
      -y|--yes)
        AUTO_YES=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        warn "Unknown option: $1"
        usage >&2
        exit 1
        ;;
    esac
    shift
  done

  if [[ ! -d "$SOURCE_AGENTS_DIR" ]]; then
    warn "Missing source agents directory: $SOURCE_AGENTS_DIR"
    exit 1
  fi

  if [[ ! -d "$SOURCE_SKILLS_DIR" ]]; then
    warn "Missing source skills directory: $SOURCE_SKILLS_DIR"
    exit 1
  fi

  if [[ ! -f "$SOURCE_CODEX_CONFIG" ]]; then
    warn "Missing source Codex config file: $SOURCE_CODEX_CONFIG"
    exit 1
  fi

  if [[ ! -f "$SOURCE_AGENTS_MD" ]]; then
    warn "Missing source AGENTS.md file: $SOURCE_AGENTS_MD"
    exit 1
  fi

  if [[ ! -f "$SOURCE_USER_MD" ]]; then
    warn "Missing source USER.md file: $SOURCE_USER_MD"
    exit 1
  fi

  if ! prompt_yes_no "Install agents and skills into ~/.codex?"; then
    install_codex=0
  fi

  if ! prompt_yes_no "Install agents and skills into ~/.claude?"; then
    install_claude=0
  fi

  if (( install_codex == 0 && install_claude == 0 )); then
    log "Nothing selected."
    exit 0
  fi

  if (( install_codex )); then
    install_codex_target "$HOME/.codex"
  fi

  if (( install_claude )); then
    install_claude_target "$HOME/.claude"
  fi

  log ""
  log "Summary: linked=$LINKED_COUNT skipped=$SKIPPED_COUNT dry_run=$DRY_RUN"
}

main "$@"
