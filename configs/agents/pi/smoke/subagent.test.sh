#!/bin/sh
set -eu

SCRIPT_DIR=$(unset CDPATH; cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(unset CDPATH; cd "$SCRIPT_DIR/../../../.." && pwd)
TMP_BASE=${TMPDIR:-/tmp}
TMP_ROOT=$TMP_BASE/pi-subagent-smoke.$$
SUMMARY_LOG=${PI_SUBAGENT_SMOKE_SUMMARY_LOG:-$TMP_BASE/pi-subagent-smoke.$$.log}
PI_BIN=${PI_BIN:-pi}
SUBAGENT_EXTENSION=$REPO_ROOT/configs/agents/pi/extensions/subagent
FAUX_EXTENSION=$REPO_ROOT/configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts
FAUX_PROVIDER=pi-extension-e2e-faux
FAUX_MODEL=pi-extension-e2e-faux-model

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

fail() {
  log "not ok: $*"
  exit 1
}

assert_contains() {
  file=$1
  expected=$2
  message=$3
  if ! grep -F -- "$expected" "$file" >/dev/null 2>&1; then
    tail -80 "$file" 2>/dev/null | tee -a "$SUMMARY_LOG" || true
    fail "$message"
  fi
}

assert_not_contains() {
  file=$1
  unexpected=$2
  message=$3
  if grep -F -- "$unexpected" "$file" >/dev/null 2>&1; then
    tail -80 "$file" 2>/dev/null | tee -a "$SUMMARY_LOG" || true
    fail "$message"
  fi
}

run_checked() {
  log "==== $* ===="
  if "$@" 2>&1 | tee -a "$SUMMARY_LOG"; then
    log "ok: $*"
  else
    fail "$*"
  fi
}

create_installed_fixture() {
  AGENT_DIR=$TMP_ROOT/pi-agent
  PROJECT_DIR=$TMP_ROOT/repo
  mkdir -p "$AGENT_DIR/extensions" "$AGENT_DIR/agents" "$PROJECT_DIR/.git"
  ln -s "$SUBAGENT_EXTENSION" "$AGENT_DIR/extensions/subagent"
  ln -s "$FAUX_EXTENSION" "$AGENT_DIR/extensions/faux-provider-extension.ts"

  long_description=$(bun -e 'process.stdout.write("Detailed trusted local role. ".repeat(64))')
  cat > "$AGENT_DIR/agents/smoke-worker.md" <<AGENT
---
name: smoke-worker
description: $long_description
---
Complete the assigned deterministic smoke task.
AGENT

  cat > "$PROJECT_DIR/pi-subagent.json" <<CONFIG
{
  "runtime": {
    "maxActiveAgents": 1,
    "maxResidentAgents": 1,
    "maxDepth": 3
  },
  "agents": {
    "smoke-worker": {
      "execution": {
        "provider": "$FAUX_PROVIDER",
        "model": "$FAUX_MODEL",
        "effort": "off"
      },
      "allowInvocationOverride": {
        "model": false,
        "effort": true
      }
    }
  }
}
CONFIG
}

run_catalog_smoke() {
  output=$TMP_ROOT/catalog.jsonl
  plan='[{"toolCatalogAudit":{"expected":["agent_spawn","agent_send","agent_followup","agent_wait","agent_interrupt","agent_list","agent_close"],"forbidden":["agent"]}}]'

  log "==== installed bundle catalog ===="
  (
    cd "$PROJECT_DIR"
    env \
      PI_CODING_AGENT_DIR="$AGENT_DIR" \
      PI_EXTENSION_E2E_FAUX_API_KEY=test-key \
      PI_EXTENSION_E2E_FAUX_RESPONSE_PLAN="$plan" \
      "$PI_BIN" --mode json --no-session --approve --no-skills --no-context-files \
        --provider "$FAUX_PROVIDER" --model "$FAUX_MODEL" \
        -p 'Audit the installed collaboration tool catalog.'
  ) > "$output" 2>&1 || {
    tail -80 "$output" | tee -a "$SUMMARY_LOG" || true
    fail "installed catalog Pi run"
  }
  cat "$output" >> "$SUMMARY_LOG"
  assert_contains "$output" 'TOOL_CATALOG_AUDIT exact=true' "installed catalog is not exact"
  assert_contains "$output" 'forbidden=none' "legacy agent tool is installed"
  assert_not_contains "$output" 'extension_error' "installed extension failed to load"
  log "ok: installed bundle exposes exactly seven collaboration tools and no agent"
}

run_lifecycle_smoke() {
  output=$TMP_ROOT/lifecycle.jsonl
  root_plan='[
    {"toolCalls":[{"name":"agent_spawn","arguments":{"task_name":"alpha","subagent_type":"smoke-worker","prompt":"Run alpha and accept steering.","fork_turns":"none"}}]},
    {"toolCalls":[{"name":"agent_list","arguments":{}}]},
    {"toolCalls":[{"name":"agent_send","arguments":{"target":"/root/alpha","message":"STEER-SMOKE-SENTINEL"}}]},
    {"toolCalls":[{"name":"agent_wait","arguments":{"targets":["/root/alpha"],"timeout_seconds":30}}]},
    {"toolCalls":[{"name":"agent_followup","arguments":{"target":"/root/alpha","message":"Run alpha follow-up.","execution":{"effort":"off"}}}]},
    {"toolCalls":[{"name":"agent_wait","arguments":{"targets":["/root/alpha"],"timeout_seconds":30}}]},
    {"toolCalls":[{"name":"agent_close","arguments":{"target":"/root/alpha"}}]},
    {"toolCalls":[{"name":"agent_spawn","arguments":{"task_name":"beta","subagent_type":"smoke-worker","prompt":"Run interruptible beta.","fork_turns":"none"}}]},
    {"toolCalls":[{"name":"agent_interrupt","arguments":{"target":"/root/beta"}}]},
    {"toolCalls":[{"name":"agent_close","arguments":{"target":"/root/beta"}}]},
    {"text":"PERSISTENT-SUBAGENT-SMOKE-COMPLETE"}
  ]'
  child_plan='[
    {"text":"SMOKE-STREAM-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"},
    {"contextEcho":{"sentinel":"STEER-SMOKE-SENTINEL","prefix":"STEER-SMOKE-ECHO"}},
    {"text":"SMOKE-FOLLOWUP-COMPLETE"}
  ]'
  plans=$(printf '{"0":%s,"1":%s}' "$root_plan" "$child_plan")

  log "==== installed persistent lifecycle ===="
  (
    cd "$PROJECT_DIR"
    env \
      PI_CODING_AGENT_DIR="$AGENT_DIR" \
      PI_EXTENSION_E2E_FAUX_API_KEY=test-key \
      PI_EXTENSION_E2E_FAUX_RESPONSE_PLANS_BY_DEPTH="$plans" \
      PI_EXTENSION_E2E_FAUX_TOKENS_PER_SECOND_BY_DEPTH='{"0":10000,"1":10}' \
      PI_SUBAGENT_CHILD_NO_EXTENSIONS=1 \
      PI_SUBAGENT_CHILD_EXTENSIONS="$FAUX_EXTENSION" \
      "$PI_BIN" --mode json --no-session --approve --no-skills --no-context-files \
        --provider "$FAUX_PROVIDER" --model "$FAUX_MODEL" \
        -p 'Run the complete deterministic persistent-subagent lifecycle.'
  ) > "$output" 2>&1 || {
    tail -80 "$output" | tee -a "$SUMMARY_LOG" || true
    fail "installed lifecycle Pi run"
  }
  cat "$output" >> "$SUMMARY_LOG"

  for tool in agent_spawn agent_list agent_send agent_wait agent_followup agent_interrupt agent_close; do
    assert_contains "$output" "\"toolName\":\"$tool\"" "missing lifecycle tool execution: $tool"
  done
  assert_contains "$output" 'STEER-SMOKE-ECHO STEER-SMOKE-SENTINEL' "steering did not reach the child context"
  assert_contains "$output" 'SMOKE-FOLLOWUP-COMPLETE' "follow-up did not reuse the child"
  assert_contains "$output" '"status":"interrupted"' "interrupt did not settle as interrupted"
  assert_contains "$output" 'PERSISTENT-SUBAGENT-SMOKE-COMPLETE' "root lifecycle did not complete"
  assert_not_contains "$output" '"toolName":"agent"' "legacy agent tool executed"
  assert_not_contains "$output" '"isError":true' "lifecycle tool returned an error"
  assert_not_contains "$output" 'extension_error' "child extension collision or load failure"
  log "ok: all seven lifecycle tools executed through the installed bundle"
}

main() {
  mkdir -p "$TMP_ROOT"
  : > "$SUMMARY_LOG"
  cd "$REPO_ROOT"

  command -v bun >/dev/null 2>&1 || fail "missing command: bun"
  command -v "$PI_BIN" >/dev/null 2>&1 || fail "missing command: $PI_BIN"

  run_checked bun run test:pi-extensions subagent
  run_checked bun run test:pi-extensions:e2e subagent
  create_installed_fixture
  run_catalog_smoke
  run_lifecycle_smoke

  log "==== done ===="
  log "ok: Pi persistent-subagent smoke passed"
  log "summary_log: $SUMMARY_LOG"
}

main "$@"
