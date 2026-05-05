#!/bin/sh
set -eu

SCRIPT_DIR=$(unset CDPATH; cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(unset CDPATH; cd "$SCRIPT_DIR/../../../.." && pwd)
TMP_BASE=${TMPDIR:-/tmp}
TMP_ROOT=$TMP_BASE/pi-subagent-smoke.$$
JSON_LOG=${PI_SUBAGENT_SMOKE_JSON_LOG:-$TMP_BASE/pi-subagent-smoke.$$.jsonl}
SUMMARY_LOG=${PI_SUBAGENT_SMOKE_SUMMARY_LOG:-$TMP_BASE/pi-subagent-smoke.$$.log}
PI_BIN=${PI_BIN:-pi}
SUBAGENT_EXTENSION=$REPO_ROOT/configs/agents/pi/extensions/subagent
FAUX_EXTENSION=$REPO_ROOT/configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts
FAUX_PROVIDER=pi-extension-e2e-faux
FAUX_MODEL=pi-extension-e2e-faux-model
FAUX_TOOL_CALLS_ENV=PI_EXTENSION_E2E_FAUX_TOOL_CALLS

cleanup() {
  if [ "${PI_SUBAGENT_SMOKE_KEEP_TMP:-0}" != "1" ]; then
    rm -rf -- "$TMP_ROOT"
  else
    printf 'kept temp dir: %s\n' "$TMP_ROOT"
  fi
}

trap cleanup EXIT INT TERM

log() {
  printf '%s\n' "$*"
  printf '%s\n' "$*" >> "$SUMMARY_LOG"
}

section() {
  log ""
  log "==== $* ===="
}

fail() {
  log "not ok: $*"
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "missing command: $1"
  fi
}

assert_file_contains() {
  if ! grep -F -- "$2" "$1" >/dev/null 2>&1; then
    log "missing expected text: $2"
    log "--- stdout tail ($1) ---"
    tail -80 "$1" 2>/dev/null | tee -a "$SUMMARY_LOG" || true
    fail "$3"
  fi
}

assert_file_not_contains() {
  if grep -F -- "$2" "$1" >/dev/null 2>&1; then
    log "unexpected text: $2"
    log "--- stdout tail ($1) ---"
    tail -80 "$1" 2>/dev/null | tee -a "$SUMMARY_LOG" || true
    fail "$3"
  fi
}

run_checked() {
  section "$*"
  if "$@" 2>&1 | tee -a "$SUMMARY_LOG"; then
    log "ok: $*"
  else
    fail "$*"
  fi
}

write_standard_agents() {
  mkdir -p "$1/agents"
  cat > "$1/agents/echo-agent.md" <<'AGENT'
---
name: echo-agent
description: Deterministic smoke echo subagent.
---
Return the configured deterministic provider response.
AGENT
  cat > "$1/agents/review-agent.md" <<'AGENT'
---
name: review-agent
description: Deterministic smoke review subagent.
---
Return the configured deterministic provider response.
AGENT
}

write_custom_agents() {
  mkdir -p "$1/agents"
  cat > "$1/agents/live-path-finder.md" <<'AGENT'
---
name: live-path-finder
description: Smoke-test subagent that finds exact repository file paths for a requested implementation area.
---
Find exact files requested by the prompt. Return concise repository-relative file paths and one short note per path. Do not edit files.
AGENT
  cat > "$1/agents/live-test-reviewer.md" <<'AGENT'
---
name: live-test-reviewer
description: Smoke-test subagent that reviews whether a validation result proves the requested behavior.
---
Check whether the evidence in the prompt proves the behavior. Return a concise verdict and any missing evidence. Do not edit files.
AGENT
}

link_real_pi_config() {
  for entry in settings.json auth.json APPEND_SYSTEM.md skills prompts extensions AGENTS.md; do
    if [ -e "$HOME/.pi/agent/$entry" ] || [ -L "$HOME/.pi/agent/$entry" ]; then
      ln -s "$HOME/.pi/agent/$entry" "$1/$entry"
    fi
  done
}

check_installed_agents() {
  section "installed Pi agent directory"
  if [ "${PI_SUBAGENT_SMOKE_SKIP_INSTALLED_CHECK:-0}" = "1" ]; then
    log "skip: installed agent check disabled"
    return 0
  fi

  if [ ! -d "$HOME/.pi/agent/agents" ]; then
    fail "missing ~/.pi/agent/agents; run configs/agents/install.sh --yes first"
  fi

  if [ ! -f "$HOME/.pi/agent/agents/codebase-locator.md" ]; then
    fail "missing codebase-locator in ~/.pi/agent/agents"
  fi

  log "ok: ~/.pi/agent/agents exists"
  log "target: $(readlink "$HOME/.pi/agent/agents" 2>/dev/null || printf '%s' "$HOME/.pi/agent/agents")"
}

run_pi_json_smoke() {
  label=$1
  agent_kind=$2
  session_kind=$3
  response_text=$4
  tool_calls=$5
  prompt_text=$6
  expected_text=$7

  agent_dir=$(mktemp -d "$TMP_ROOT/agent-dir.XXXXXX")
  session_dir=$(mktemp -d "$TMP_ROOT/session-dir.XXXXXX")
  stdout_file=$TMP_ROOT/$label.stdout.jsonl
  stderr_file=$TMP_ROOT/$label.stderr.log

  if [ "$agent_kind" = "custom" ]; then
    write_custom_agents "$agent_dir"
  else
    write_standard_agents "$agent_dir"
  fi

  section "Pi JSON smoke: $label"
  log "agent_dir: $agent_dir"

  if [ "$session_kind" = "saved" ]; then
    if ! env \
      PI_CODING_AGENT_DIR="$agent_dir" \
      PI_EXTENSION_E2E_FAUX_API_KEY=test-key \
      PI_EXTENSION_E2E_FAUX_RESPONSE_TEXT="$response_text" \
      PI_EXTENSION_E2E_FAUX_TOOL_CALLS="$tool_calls" \
      PI_SUBAGENT_CHILD_NO_EXTENSIONS=1 \
      PI_SUBAGENT_CHILD_EXTENSIONS="$FAUX_EXTENSION" \
      PI_SUBAGENT_CHILD_UNSET_ENV="$FAUX_TOOL_CALLS_ENV" \
      "$PI_BIN" --mode json --session-dir "$session_dir" \
        --no-extensions --no-skills --no-context-files \
        -e "$SUBAGENT_EXTENSION" \
        -e "$FAUX_EXTENSION" \
        --tools Agent \
        --provider "$FAUX_PROVIDER" \
        --model "$FAUX_MODEL" \
        -p "$prompt_text" > "$stdout_file" 2> "$stderr_file"; then
      tail -80 "$stderr_file" 2>/dev/null | tee -a "$SUMMARY_LOG" || true
      fail "Pi JSON smoke failed: $label"
    fi
  else
    if ! env \
      PI_CODING_AGENT_DIR="$agent_dir" \
      PI_EXTENSION_E2E_FAUX_API_KEY=test-key \
      PI_EXTENSION_E2E_FAUX_RESPONSE_TEXT="$response_text" \
      PI_EXTENSION_E2E_FAUX_TOOL_CALLS="$tool_calls" \
      PI_SUBAGENT_CHILD_NO_EXTENSIONS=1 \
      PI_SUBAGENT_CHILD_EXTENSIONS="$FAUX_EXTENSION" \
      PI_SUBAGENT_CHILD_UNSET_ENV="$FAUX_TOOL_CALLS_ENV" \
      "$PI_BIN" --mode json --session-dir "$session_dir" --no-session \
        --no-extensions --no-skills --no-context-files \
        -e "$SUBAGENT_EXTENSION" \
        -e "$FAUX_EXTENSION" \
        --tools Agent \
        --provider "$FAUX_PROVIDER" \
        --model "$FAUX_MODEL" \
        -p "$prompt_text" > "$stdout_file" 2> "$stderr_file"; then
      tail -80 "$stderr_file" 2>/dev/null | tee -a "$SUMMARY_LOG" || true
      fail "Pi JSON smoke failed: $label"
    fi
  fi

  cat "$stdout_file" >> "$JSON_LOG"
  assert_file_contains "$stdout_file" '"type":"tool_execution_end"' "missing Agent tool end for $label"
  assert_file_contains "$stdout_file" '"toolName":"Agent"' "missing Agent tool name for $label"
  assert_file_contains "$stdout_file" "$expected_text" "missing expected Agent result for $label"
  assert_file_not_contains "$stdout_file" "Unknown subagent" "unknown subagent in $label"
  assert_file_not_contains "$stdout_file" '"isError":true' "Agent tool error in $label"

  if [ -s "$stderr_file" ]; then
    log "stderr for $label:"
    tail -40 "$stderr_file" | tee -a "$SUMMARY_LOG"
  fi

  log "ok: $label"
}

run_optional_live_model_smoke() {
  if [ "${PI_SUBAGENT_SMOKE_LIVE:-0}" != "1" ]; then
    section "optional live model smoke"
    log "skip: set PI_SUBAGENT_SMOKE_LIVE=1 to run a real provider/model Agent call"
    return 0
  fi

  live_model=${PI_SUBAGENT_SMOKE_LIVE_MODEL:-openai-codex/gpt-5.3-codex-spark}
  live_thinking=${PI_SUBAGENT_SMOKE_LIVE_THINKING:-minimal}
  agent_dir=$(mktemp -d "$TMP_ROOT/live-agent-dir.XXXXXX")
  session_dir=$(mktemp -d "$TMP_ROOT/live-session-dir.XXXXXX")
  stdout_file=$TMP_ROOT/live-model.stdout.jsonl
  stderr_file=$TMP_ROOT/live-model.stderr.log

  write_custom_agents "$agent_dir"
  link_real_pi_config "$agent_dir"

  section "optional live model smoke"
  log "model: $live_model"
  log "agent_dir: $agent_dir"

  if ! env \
    PI_CODING_AGENT_DIR="$agent_dir" \
    PI_SUBAGENT_CHILD_NO_EXTENSIONS=1 \
    "$PI_BIN" --mode json --session-dir "$session_dir" --no-session \
      --no-extensions --no-skills --no-context-files \
      -e "$SUBAGENT_EXTENSION" \
      --tools Agent \
      --model "$live_model" \
      --thinking "$live_thinking" \
      -p 'From your system prompt, identify available subagents whose names start with live-. Then use the Agent tool exactly once with subagent_type live-path-finder and prompt: Find files under configs/agents/pi/extensions/subagent that implement agent discovery and child Pi invocation. Return concise file paths only. After the tool result, state whether live-path-finder was found. Do not edit files.' > "$stdout_file" 2> "$stderr_file"; then
    tail -80 "$stderr_file" 2>/dev/null | tee -a "$SUMMARY_LOG" || true
    fail "optional live model smoke failed"
  fi

  cat "$stdout_file" >> "$JSON_LOG"
  assert_file_contains "$stdout_file" '"type":"tool_execution_end"' "live model did not execute Agent"
  assert_file_contains "$stdout_file" '"toolName":"Agent"' "live model Agent tool name missing"
  assert_file_contains "$stdout_file" "live-path-finder" "live model did not find custom agent"
  assert_file_not_contains "$stdout_file" "Unknown subagent" "live model used an unknown subagent"
  log "ok: optional live model smoke"
}

main() {
  mkdir -p "$TMP_ROOT"
  : > "$JSON_LOG"
  : > "$SUMMARY_LOG"

  cd "$REPO_ROOT"
  require_command bun
  require_command "$PI_BIN"
  require_command grep
  require_command mktemp

  section "Pi subagent smoke"
  log "repo: $REPO_ROOT"
  log "json_log: $JSON_LOG"
  log "summary_log: $SUMMARY_LOG"

  check_installed_agents
  run_checked bun run test:pi-extensions subagent
  run_checked bun run test:pi-extensions:e2e subagent

  single_calls='[{"id":"smoke-single-agent","name":"Agent","arguments":{"subagent_type":"echo-agent","prompt":"Return the deterministic child response."}}]'
  parallel_calls='[{"id":"smoke-parallel-agent","name":"Agent","arguments":{"tasks":[{"subagent_type":"echo-agent","prompt":"Return deterministic child response A."},{"subagent_type":"review-agent","prompt":"Return deterministic child response B."}]}}]'
  fork_calls='[{"id":"smoke-fork-agent","name":"Agent","arguments":{"subagent_type":"echo-agent","context":"fork","prompt":"Return the deterministic forked child response."}}]'
  custom_calls='[{"id":"smoke-custom-agent","name":"Agent","arguments":{"subagent_type":"live-path-finder","prompt":"Find files under configs/agents/pi/extensions/subagent that implement agent discovery and child Pi invocation. Return concise file paths only."}}]'

  run_pi_json_smoke "single-fresh" standard ephemeral \
    "Subagent smoke child result: single fresh." \
    "$single_calls" \
    "Delegate one task to echo-agent." \
    "Subagent smoke child result: single fresh."

  run_pi_json_smoke "parallel-fresh" standard ephemeral \
    "Subagent smoke child result: parallel." \
    "$parallel_calls" \
    "Delegate two independent tasks in parallel." \
    "Parallel agents completed: 2/2 succeeded."

  run_pi_json_smoke "single-fork" standard saved \
    "Subagent smoke child result: fork." \
    "$fork_calls" \
    "Delegate one forked task to echo-agent." \
    "Subagent smoke child result: fork."

  run_pi_json_smoke "custom-agent-discovery" custom ephemeral \
    "Subagent smoke child result: custom live-path-finder." \
    "$custom_calls" \
    "Delegate one task to live-path-finder." \
    "Subagent smoke child result: custom live-path-finder."

  run_optional_live_model_smoke

  section "done"
  log "ok: Pi subagent smoke passed"
  log "json_log: $JSON_LOG"
  log "summary_log: $SUMMARY_LOG"
}

main "$@"
