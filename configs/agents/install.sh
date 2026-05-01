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
SOURCE_BIN_DIR="$SCRIPT_DIR/bin"
SOURCE_CODEX_CONFIG="$SCRIPT_DIR/codex-config.toml"
SOURCE_CODEX_HOOKS="$SCRIPT_DIR/hooks/codex-hooks.json"
MD_TO_CODEX_TOML="$SCRIPT_DIR/md-to-codex-toml.sh"
SOURCE_CLAUDE_SETTINGS="$SCRIPT_DIR/claude-settings.json"
SOURCE_PI_SETTINGS="$SCRIPT_DIR/pi-settings.json"
SOURCE_PI_DIR="$SCRIPT_DIR/pi"
SOURCE_PI_AGENTS_DIR="$SOURCE_PI_DIR/agents"
SOURCE_PI_SKILLS_DIR="$SOURCE_PI_DIR/skills"
SOURCE_PI_PROMPTS_DIR="$SOURCE_PI_DIR/prompts"
SOURCE_PI_EXTENSIONS_DIR="$SOURCE_PI_DIR/extensions"
SOURCE_PI_APPEND_SYSTEM="$SOURCE_PI_DIR/APPEND_SYSTEM.md"
SOURCE_STATUSLINE="$SCRIPT_DIR/statusline.ts"
SOURCE_AGENTS_MD="$SCRIPT_DIR/AGENTS.md"
SOURCE_DEV_INSTRUCTIONS="$SCRIPT_DIR/developer-instructions.txt"

usage() {
  cat <<'EOF'
Usage: ./install.sh [--dry-run] [--yes]

Options:
  -n, --dry-run   Print the actions without creating directories or symlinks.
  -y, --yes       Skip confirmation prompts (install ~/.claude, ~/.codex, and ~/.pi/agent).
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

detect_host_config() {
  local os arch cores ram cpu disk shell_name hostname_short
  os="$(uname -s)"
  arch="$(uname -m)"
  shell_name="$(basename "${SHELL:-unknown}")"
  hostname_short="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo "unknown")"

  case "$os" in
    Darwin)
      cores="$(sysctl -n hw.ncpu 2>/dev/null || echo "unknown")"
      ram="$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 ))GB RAM"
      cpu="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown")"
      disk="$(df -h / 2>/dev/null | awk 'NR==2 { print $2 " total, " $4 " free" }' || echo "unknown")"
      printf '%s\n' "macOS $(sw_vers -productVersion 2>/dev/null || echo "unknown") ($arch)"
      printf '%s\n' "- CPU: $cpu ($cores cores)"
      printf '%s\n' "- Memory: $ram"
      printf '%s\n' "- Disk: $disk"
      printf '%s\n' "- Shell: $shell_name"
      printf '%s' "- Hostname: $hostname_short"
      ;;
    Linux)
      cores="$(nproc 2>/dev/null || echo "unknown")"
      ram="$(awk '/MemTotal/ { printf "%dGB RAM", $2/1048576 }' /proc/meminfo 2>/dev/null || echo "unknown")"
      cpu="$(awk -F': ' '/model name/ { print $2; exit }' /proc/cpuinfo 2>/dev/null || echo "unknown")"
      disk="$(df -h / 2>/dev/null | awk 'NR==2 { print $2 " total, " $4 " free" }' || echo "unknown")"
      local os_line
      if [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        os_line="$(. /etc/os-release && echo "${PRETTY_NAME:-$ID}")"
      else
        os_line="Linux"
      fi
      printf '%s\n' "$os_line ($arch)"
      printf '%s\n' "- CPU: $cpu ($cores cores)"
      printf '%s\n' "- Memory: $ram"
      printf '%s\n' "- Disk: $disk"
      printf '%s\n' "- Shell: $shell_name"
      printf '%s' "- Hostname: $hostname_short"
      ;;
    *)
      printf '%s (%s)' "$os" "$arch"
      ;;
  esac
}

render_agents_md() {
  local target_path="$1"
  local label="$2"
  local host_config
  host_config="$(detect_host_config)"

  local rendered before after
  before="$(sed -n '/{{HOST_CONFIG}}/q;p' "$SOURCE_AGENTS_MD")"
  after="$(sed -n '/{{HOST_CONFIG}}/,$ { /{{HOST_CONFIG}}/d; p; }' "$SOURCE_AGENTS_MD")"
  rendered="${before}

${host_config}"
  if [[ -n "$after" ]]; then
    rendered="${rendered}
${after}"
  fi

  # Remove stale symlink from previous installs before writing
  if [[ -L "$target_path" ]]; then
    if (( DRY_RUN )); then
      log "[dry-run] remove symlink $target_path before rendering"
    else
      rm -f "$target_path"
    fi
  fi

  if [[ -f "$target_path" ]] && [[ "$(cat "$target_path")" == "$rendered" ]]; then
    log "skip: $label already up to date"
    ((SKIPPED_COUNT += 1))
    return 0
  fi

  if (( DRY_RUN )); then
    log "[dry-run] render $label with host config"
    return 0
  fi

  printf '%s\n' "$rendered" > "$target_path"
  log "rendered: $label"
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
  ((LINKED_COUNT += 1))
}

force_link_agent_entries() {
  local target_root="$1"
  local target_agents_dir="$target_root/agents"
  local source_path=""
  local target_path=""
  local name=""

  ensure_dir "$target_agents_dir"

  while IFS= read -r -d '' source_path; do
    name="$(basename "$source_path")"
    target_path="$target_agents_dir/$name"
    force_link_path "$source_path" "$target_path" "agent $name"
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
      force_link_path "$source_path" "$target_path" "agent $name"
    elif [[ "$name" == *.md ]]; then
      copy_agent_stripped "$source_path" "$target_path" "agent $name"
    else
      force_link_path "$source_path" "$target_path" "agent $name"
    fi
  done < <(find "$SOURCE_AGENTS_DIR" -mindepth 1 -maxdepth 1 \( -type f -o -type d -o -type l \) -print0)
}

force_link_skill_entries() {
  local target_root="$1"
  local target_skills_dir="$target_root/skills"
  local source_path=""
  local target_path=""
  local name=""

  ensure_dir "$target_skills_dir"

  while IFS= read -r -d '' source_path; do
    name="$(basename "$source_path")"
    target_path="$target_skills_dir/$name"
    force_link_path "$source_path" "$target_path" "skill $name"
  done < <(find "$SOURCE_SKILLS_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -print0)
}

skill_disables_model_invocation() {
  local skill_md="$1"

  awk '
    BEGIN { in_fm = 0; seen_open = 0; found = 0 }
    /^---[[:space:]]*$/ {
      if (!seen_open) { in_fm = 1; seen_open = 1; next }
      exit
    }
    in_fm && /^[[:space:]]*disable_model_invocation:[[:space:]]*true[[:space:]]*$/ { found = 1; exit }
    END { exit found ? 0 : 1 }
  ' "$skill_md"
}

prune_pi_skills_disabled_for_model_invocation() {
  local skill_entry=""
  local skill_md=""
  local skill_name=""
  local resolved_entry=""

  for skill_entry in "$SOURCE_PI_SKILLS_DIR"/*; do
    [[ -e "$skill_entry" || -L "$skill_entry" ]] || continue

    if [[ -d "$skill_entry" || -L "$skill_entry" ]]; then
      skill_md="$skill_entry/SKILL.md"
      skill_name="$(basename "$skill_entry")"
    elif [[ -f "$skill_entry" && "$skill_entry" == *.md ]]; then
      skill_md="$skill_entry"
      skill_name="$(basename "$skill_entry" .md)"
    else
      continue
    fi

    if [[ ! -f "$skill_md" ]]; then
      continue
    fi

    if skill_disables_model_invocation "$skill_md"; then
      if [[ -L "$skill_entry" ]]; then
        resolved_entry="$(resolve_symlink_target "$skill_entry")"
      else
        resolved_entry="$(canonicalize_path "$skill_entry")"
      fi
      run_cmd rm -rf -- "$skill_entry"
      log "removed: Pi skill $skill_name disables model invocation ($resolved_entry)"
    fi
  done
}

install_target() {
  local target_root="$1"
  local label="$2"

  log ""
  log "Installing into $label ($target_root)"
  force_link_agent_entries "$target_root"
  force_link_skill_entries "$target_root"
}

install_agents_home_target() {
  local target_root="$1"

  log ""
  log "Installing into $HOME/.agents ($target_root)"
  force_link_agent_entries "$target_root"
  force_link_skill_entries "$target_root"
  force_link_path "$SOURCE_HOOKS_DIR" "$target_root/hooks" ".agents hooks"
  force_link_path "$SOURCE_BIN_DIR" "$target_root/bin" ".agents bin"
  render_agents_md "$target_root/AGENTS.md" ".agents AGENTS.md"
  force_link_path "$SOURCE_DEV_INSTRUCTIONS" "$target_root/developer-instructions.txt" ".agents developer-instructions.txt"
  force_link_path "$SOURCE_STATUSLINE" "$target_root/statusline.ts" ".agents statusline.ts"
}

generate_codex_agent_tomls() {
  local target_root="$1"
  local target_agents_dir="$target_root/agents"

  ensure_dir "$target_agents_dir"

  if (( DRY_RUN )); then
    log "[dry-run] generate codex .toml agents from .md sources"
    return 0
  fi

  "$MD_TO_CODEX_TOML" "$SOURCE_AGENTS_DIR" "$target_agents_dir"

  # Clean up stale .md files from the previous install method.
  local md_file basename_no_ext
  for md_file in "$target_agents_dir"/*.md; do
    [[ -f "$md_file" ]] || continue
    basename_no_ext="$(basename "$md_file" .md)"
    if [[ -f "$target_agents_dir/${basename_no_ext}.toml" ]] || [[ "$basename_no_ext" == "oracle" ]]; then
      rm -f "$md_file"
      log "removed stale: agent ${basename_no_ext}.md"
    fi
  done
}

render_codex_config() {
  local target_path="$1"
  local label="codex config.toml"
  local instructions rendered

  instructions="$(cat "$SOURCE_DEV_INSTRUCTIONS")"
  rendered="$(INSTR="$instructions" awk '{ gsub(/\{\{DEVELOPER_INSTRUCTIONS\}\}/, ENVIRON["INSTR"]); print }' "$SOURCE_CODEX_CONFIG")"

  if [[ -f "$target_path" ]] && [[ "$(cat "$target_path")" == "$rendered" ]]; then
    log "skip: $label already up to date"
    ((SKIPPED_COUNT += 1))
    return 0
  fi

  if (( DRY_RUN )); then
    log "[dry-run] render $label with developer instructions"
    return 0
  fi

  printf '%s\n' "$rendered" > "$target_path"
  log "rendered: $label"
  ((LINKED_COUNT += 1))
}

install_codex_target() {
  local target_root="$1"

  log ""
  log "Installing into ~/.codex ($target_root)"
  generate_codex_agent_tomls "$target_root"
  force_link_skill_entries "$target_root"
  force_link_path "$HOME/.agents/AGENTS.md" "$target_root/AGENTS.md" "codex AGENTS.md"
  render_codex_config "$target_root/config.toml"
  # Install hooks.json for Codex
  if [[ -f "$SOURCE_CODEX_HOOKS" ]]; then
    copy_file_if_needed "$SOURCE_CODEX_HOOKS" "$target_root/hooks.json" "codex hooks.json"
  fi
}

sync_claude_settings() {
  local base_settings="$1"
  local hooks_json="$2"
  local settings_path="$3"

  if [[ ! -f "$base_settings" ]]; then
    warn "Missing base settings: $base_settings"
    return 0
  fi

  if [[ ! -f "$hooks_json" ]]; then
    warn "Missing hooks config: $hooks_json"
    return 0
  fi

  if ! command -v jq &>/dev/null; then
    warn "jq not found — cannot sync claude settings"
    return 0
  fi

  # Build the desired settings: base settings + hooks merged in
  local desired
  desired="$(jq -cS --argjson hooks "$(jq -cS '.' "$hooks_json")" '. + {hooks: $hooks}' "$base_settings")"

  # Repo is authoritative: replace the target with desired, dropping any local-only keys
  if [[ -f "$settings_path" ]]; then
    local current_sorted
    current_sorted="$(jq -cS '.' "$settings_path")"
    if [[ "$current_sorted" == "$desired" ]]; then
      log "skip: claude settings already up to date"
      ((SKIPPED_COUNT += 1))
      return 0
    fi
  fi

  if (( DRY_RUN )); then
    log "[dry-run] replace claude settings at $settings_path"
    return 0
  fi

  local tmp_path
  tmp_path="$(mktemp)"
  printf '%s\n' "$desired" | jq '.' > "$tmp_path"
  mv "$tmp_path" "$settings_path"
  log "synced: claude settings"
  ((LINKED_COUNT += 1))
}

install_claude_target() {
  local target_root="$1"
  local claude_hooks_json="$SOURCE_HOOKS_DIR/claude-hooks.json"

  install_target "$target_root" "$HOME/.claude"
  force_link_path "$HOME/.agents/AGENTS.md" "$target_root/CLAUDE.md" "claude CLAUDE.md"
  # Symlink hooks directory
  if [[ -d "$SOURCE_HOOKS_DIR" ]]; then
    force_link_path "$SOURCE_HOOKS_DIR" "$target_root/hooks" "claude hooks"
  fi
  # Symlink bin directory (indexer)
  if [[ -d "$SOURCE_HOOKS_DIR/bin" ]]; then
    force_link_path "$SOURCE_HOOKS_DIR/bin" "$target_root/bin" "claude bin"
  fi
  # Sync settings (env, permissions, model, plugins, etc.) + hooks into settings.json
  sync_claude_settings "$SOURCE_CLAUDE_SETTINGS" "$claude_hooks_json" "$target_root/settings.json"
}

install_pi_target() {
  local target_root="$1"

  log ""
  log "Installing into ~/.pi/agent ($target_root)"
  ensure_dir "$target_root"
  render_agents_md "$target_root/AGENTS.md" "pi AGENTS.md"
  copy_file_if_needed "$SOURCE_PI_SETTINGS" "$target_root/settings.json" "pi settings.json"
  force_link_path "$SOURCE_PI_APPEND_SYSTEM" "$target_root/APPEND_SYSTEM.md" "pi APPEND_SYSTEM.md"
  force_link_path "$SOURCE_PI_AGENTS_DIR" "$target_root/agents" "pi agents"
  force_link_path "$SOURCE_PI_SKILLS_DIR" "$target_root/skills" "pi skills"
  force_link_path "$SOURCE_PI_PROMPTS_DIR" "$target_root/prompts" "pi prompts"
  force_link_path "$SOURCE_PI_EXTENSIONS_DIR" "$target_root/extensions" "pi extensions"
}

main() {
  local install_codex=1
  local install_claude=1
  local install_pi=1

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

  if [[ ! -d "$SOURCE_HOOKS_DIR" ]]; then
    warn "Missing source hooks directory: $SOURCE_HOOKS_DIR"
    exit 1
  fi

  if [[ ! -d "$SOURCE_BIN_DIR" ]]; then
    warn "Missing source bin directory: $SOURCE_BIN_DIR"
    exit 1
  fi

  if [[ ! -x "$MD_TO_CODEX_TOML" ]]; then
    warn "Missing or non-executable md-to-codex-toml script: $MD_TO_CODEX_TOML"
    exit 1
  fi

  if [[ ! -f "$SOURCE_CODEX_CONFIG" ]]; then
    warn "Missing source Codex config file: $SOURCE_CODEX_CONFIG"
    exit 1
  fi

  if [[ ! -f "$SOURCE_CLAUDE_SETTINGS" ]]; then
    warn "Missing source Claude settings file: $SOURCE_CLAUDE_SETTINGS"
    exit 1
  fi

  if [[ ! -f "$SOURCE_PI_SETTINGS" ]]; then
    warn "Missing source Pi settings file: $SOURCE_PI_SETTINGS"
    exit 1
  fi

  if [[ ! -d "$SOURCE_PI_AGENTS_DIR" ]]; then
    warn "Missing source Pi agents directory: $SOURCE_PI_AGENTS_DIR"
    exit 1
  fi

  if [[ ! -d "$SOURCE_PI_SKILLS_DIR" ]]; then
    warn "Missing source Pi skills directory: $SOURCE_PI_SKILLS_DIR"
    exit 1
  fi

  if [[ ! -d "$SOURCE_PI_PROMPTS_DIR" ]]; then
    warn "Missing source Pi prompts directory: $SOURCE_PI_PROMPTS_DIR"
    exit 1
  fi

  if [[ ! -d "$SOURCE_PI_EXTENSIONS_DIR" ]]; then
    warn "Missing source Pi extensions directory: $SOURCE_PI_EXTENSIONS_DIR"
    exit 1
  fi

  if [[ ! -f "$SOURCE_PI_APPEND_SYSTEM" ]]; then
    warn "Missing source Pi append-system file: $SOURCE_PI_APPEND_SYSTEM"
    exit 1
  fi

  if [[ ! -f "$SOURCE_STATUSLINE" ]]; then
    warn "Missing source statusline file: $SOURCE_STATUSLINE"
    exit 1
  fi

  if [[ ! -f "$SOURCE_AGENTS_MD" ]]; then
    warn "Missing source AGENTS.md file: $SOURCE_AGENTS_MD"
    exit 1
  fi

  if [[ ! -f "$SOURCE_DEV_INSTRUCTIONS" ]]; then
    warn "Missing source developer-instructions file: $SOURCE_DEV_INSTRUCTIONS"
    exit 1
  fi

  if ! prompt_yes_no "Install agents and skills into ~/.codex?"; then
    install_codex=0
  fi

  if ! prompt_yes_no "Install agents and skills into ~/.claude?"; then
    install_claude=0
  fi

  if ! prompt_yes_no "Install Pi config into ~/.pi/agent?"; then
    install_pi=0
  fi

  if (( install_codex == 0 && install_claude == 0 && install_pi == 0 )); then
    log "Nothing selected."
    exit 0
  fi

  install_agents_home_target "$HOME/.agents"

  if (( install_codex )); then
    install_codex_target "$HOME/.codex"
  fi

  if (( install_claude )); then
    install_claude_target "$HOME/.claude"
  fi

  if (( install_pi )); then
    prune_pi_skills_disabled_for_model_invocation
    install_pi_target "$HOME/.pi/agent"
  fi

  log ""
  log "Summary: linked=$LINKED_COUNT skipped=$SKIPPED_COUNT dry_run=$DRY_RUN"
}

main "$@"
