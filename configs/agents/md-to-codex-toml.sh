#!/usr/bin/env bash
# Convert .md agent definitions to Codex-compatible .toml files.
#
# Usage: md-to-codex-toml.sh <source_agents_dir> <target_agents_dir>
#
# Reads each .md file from source, extracts YAML frontmatter (name,
# description, model) and body, then writes a .toml file with:
#   name, description, model, sandbox_mode, model_reasoning_effort,
#   developer_instructions (= body after frontmatter)
#
# Agents listed in SKIP_AGENTS are excluded (e.g. oracle, which is
# Claude Code-specific).

set -euo pipefail

SKIP_AGENTS=(oracle)
CODEX_MODEL="gpt-5.4"

usage() {
  printf 'Usage: %s <source_agents_dir> <target_agents_dir>\n' "$(basename "$0")" >&2
  exit 1
}

should_skip() {
  local name="$1"
  local skip
  for skip in "${SKIP_AGENTS[@]}"; do
    if [[ "$name" == "$skip" ]]; then
      return 0
    fi
  done
  return 1
}

reasoning_effort_for_model() {
  local model="$1"
  case "$model" in
    sonnet|haiku) echo "medium" ;;
    *)            echo "high" ;;
  esac
}

escape_toml_multiline() {
  # For TOML multiline basic strings ("""), we only need to escape
  # sequences of 3+ consecutive quotes and backslashes.
  sed -e 's/\\/\\\\/g' -e 's/"""/""\\"/g'
}

convert_md_to_toml() {
  local source_path="$1"
  local target_path="$2"

  local in_frontmatter=0
  local seen_open=0
  local fm_name="" fm_description="" fm_model=""
  local body=""
  local line=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^---[[:space:]]*$ ]]; then
      if (( ! seen_open )); then
        in_frontmatter=1
        seen_open=1
        continue
      else
        in_frontmatter=0
        continue
      fi
    fi

    if (( in_frontmatter )); then
      if [[ "$line" =~ ^name:[[:space:]]*(.*) ]]; then
        fm_name="${BASH_REMATCH[1]}"
        # Strip surrounding quotes
        fm_name="${fm_name#\"}"
        fm_name="${fm_name%\"}"
      elif [[ "$line" =~ ^description:[[:space:]]*(.*) ]]; then
        fm_description="${BASH_REMATCH[1]}"
        fm_description="${fm_description#\"}"
        fm_description="${fm_description%\"}"
      elif [[ "$line" =~ ^model:[[:space:]]*(.*) ]]; then
        fm_model="${BASH_REMATCH[1]}"
        fm_model="${fm_model#\"}"
        fm_model="${fm_model%\"}"
      fi
    else
      body+="$line"$'\n'
    fi
  done < "$source_path"

  if [[ -z "$fm_name" ]]; then
    printf 'warning: no name in frontmatter of %s, skipping\n' "$source_path" >&2
    return 1
  fi

  if should_skip "$fm_name"; then
    return 0
  fi

  local effort
  effort="$(reasoning_effort_for_model "$fm_model")"

  # Strip leading blank lines, then trailing blank lines (portable)
  body="$(printf '%s' "$body" | sed '/./,$!d')"
  body="$(printf '%s\n' "$body" | awk '
    { lines[NR] = $0 }
    END {
      last = NR
      while (last > 0 && lines[last] ~ /^[[:space:]]*$/) last--
      for (i = 1; i <= last; i++) print lines[i]
    }
  ')"

  local escaped_body
  escaped_body="$(printf '%s' "$body" | escape_toml_multiline)"

  local escaped_description
  escaped_description="$(printf '%s' "$fm_description" | sed 's/\\/\\\\/g; s/"/\\"/g')"

  cat > "$target_path" <<TOML
name = "$fm_name"
description = "$escaped_description"
model = "$CODEX_MODEL"
sandbox_mode = "workspace-write"
model_reasoning_effort = "$effort"
developer_instructions = """
$escaped_body
"""
TOML
}

main() {
  if [[ $# -ne 2 ]]; then
    usage
  fi

  local source_dir="$1"
  local target_dir="$2"
  local source_path toml_name converted=0 skipped=0

  mkdir -p "$target_dir"

  for source_path in "$source_dir"/*.md; do
    [[ -f "$source_path" ]] || continue

    local basename_no_ext
    basename_no_ext="$(basename "$source_path" .md)"
    toml_name="${basename_no_ext}.toml"

    if convert_md_to_toml "$source_path" "$target_dir/$toml_name"; then
      if [[ -f "$target_dir/$toml_name" ]]; then
        ((converted += 1))
      else
        ((skipped += 1))
      fi
    else
      ((skipped += 1))
    fi
  done

  printf 'codex agents: converted=%d skipped=%d\n' "$converted" "$skipped"
}

main "$@"
