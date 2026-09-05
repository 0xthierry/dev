#!/usr/bin/env bash
# Herdr 0.8.2 / AMQ 0.77.1 sidecar lifecycle. Bash 3.2 compatible.
set -euo pipefail

usage() {
  printf '%s\n' \
    'Usage: bash sidecar.sh init --topic TOPIC --harness pi|claude --workers HANDLE,... [--root ROOT]' \
    '       bash sidecar.sh launch --topic TOPIC --harness pi|claude --handle HANDLE [--root ROOT] [--target PANE] [--direction right|down]' \
    '       bash sidecar.sh retire --topic TOPIC --harness pi|claude --handle HANDLE --pane PANE [--root ROOT]' \
    '' \
    "--harness is MAIN's harness, not the worker's. Worker profiles are inferred from handles:" \
    '  pi-gpt6-astra-N, claude-fable51-xhigh-N, claude-fable51-high-N,' \
    '  pi-gpt56-N, pi-grok45-N, pi-grok46-N (N is a canonical positive integer).' \
    'TOPIC is lowercase kebab-case. Default split: current main pane, right.' \
    'Nonempty inherited AM_ROOT and AM_ME are preserved exactly. --root cannot override AM_ROOT.' \
    "Otherwise room defaults to \$PWD/.agent-mail/use-agent-TOPIC and main handle to --harness." \
    'Requires HERDR_ENV=1. Claude requires >=2.1.255; manually confirm /model entitlement first.' \
    '' \
    'Caller owns the explicit roster, one live process per handle, and the append-only' \
    "handle/pane/task/result/lifecycle record. Only pass --pane from that worker's recorded launch." \
    'Record and verify completion before retirement. No automatic init, dispatch, drain, or polling.' \
    'Launch success means command submitted, not model entitlement or worker readiness.' \
    'Cleanup closes only the pane created by this launch; never reuse a handle until wake cleanup is verified.' \
    'Retire fails closed if the recorded pane cannot be resolved or closed; it does not guess that an error means absent.' \
    'Output is informational KEY=value lines, not shell code: do not eval it.'
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

bad_args() {
  printf 'error: %s\n' "$*" >&2
  usage >&2
  exit 2
}

valid_identifier() {
  [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$ ]]
}

select_profile() {
  local handle="$1" prefix
  [[ "$handle" =~ ^(pi-gpt6-astra|claude-fable51-xhigh|claude-fable51-high|pi-gpt56|pi-grok45|pi-grok46)-[1-9][0-9]*$ ]] \
    || bad_args "unknown worker profile or invalid replica: $handle"
  prefix="${handle%-*}"
  WORKER_HARNESS=pi
  WORKER_EFFORT=high
  WORKER_READONLY=1
  case "$prefix" in
    pi-gpt6-astra) WORKER_MODEL=openai-codex/gpt-6-astra ;;
    pi-gpt56) WORKER_MODEL=openai-codex/gpt-5.6-sol; WORKER_READONLY=0 ;;
    pi-grok45) WORKER_MODEL=xai/grok-4.5 ;;
    pi-grok46) WORKER_MODEL=xai/grok-4.6 ;;
    claude-fable51-xhigh)
      WORKER_HARNESS=claude; WORKER_MODEL=claude-fable-5-1; WORKER_EFFORT=xhigh ;;
    claude-fable51-high)
      WORKER_HARNESS=claude; WORKER_MODEL=claude-fable-5-1 ;;
  esac
}

build_worker_prompt() {
  printf '%s' "You are the disposable WORKER sidecar $WORKER_HANDLE paired with MAIN $MAIN_HANDLE. AMQ is the only shared source of truth. Immediately send readiness with amq send --strict --to $MAIN_HANDLE --kind status --labels ready --subject ready --body 'ready'. If any AMQ command fails, stop and report its exact error in your terminal response; never remove --strict, change room/session bindings, inspect mailbox files, or run speculative transport repairs. MAIN owns transport diagnosis. Accept one bounded primary contract and at most one immediate follow-up on the same artifact: a failing test from your patch, review feedback on that patch, or a clarification about your assigned artifact. Do not accept a new module, different investigation, widened ownership, or unrelated third task; answer the received message with kind status and labels blocked,rotate instead. A full injected AMQ notice already includes From, ID, Context, and Body; handle it directly and do not drain again. If a terminal wake only says to check AMQ, run amq drain --strict --include-body once. Preserve the ID of each message you handle and answer it with amq reply --strict --id <message-id>, which automatically preserves its thread and refs. Use amq send --strict only for readiness or a genuinely new conversation. Send retirement-safe completion only after all assigned work and validation finish, using reply kind status and labels done,retire. If one immediate answer would unblock the same task, reply with labels blocked,awaiting-input; if fresh context is better, use blocked,rotate. Include changed paths and validation for action work. For multiline reports, feed stdin or a heredoc to amq reply with --body -; for a saved file use --body @path. The --body-file option does not exist. Do not self-close the pane: MAIN records and verifies your result before retirement. Do not poll or sleep while waiting: finish your turn and let AMQ notify you."
  if [[ "$WORKER_READONLY" == 1 ]]; then
    printf '%s' ' This profile is strictly read-only. Never edit, create, delete, rename, or format files; never change git state, packages, processes, services, or external systems. Bash is available only because AMQ is the transport: beyond amq commands, use it only for non-mutating inspection and validation. Report findings and proposed changes; MAIN or a writing worker applies them.'
  fi
  case "$WORKER_HANDLE" in
    pi-gpt6-astra-*)
      printf '%s' ' You are the planning and orchestration advisor, not an executor. Return actionable plans, task dependencies, exact proposed ownership, debugging hypotheses and discriminating checks, risks, and validation gates as relevant to your bounded task. Do not launch or control other workers; MAIN dispatches and integrates.' ;;
    claude-fable51-xhigh-*)
      printf '%s' " You are Astra's independent second-opinion partner, not an oracle or final adjudicator. Challenge assumptions and return evidence, counterarguments, and alternatives. Astra is the most powerful reasoning lead; MAIN retains final acceptance." ;;
  esac
}

# AMQ 0.77.1 send/reply authorize named sessions against their base roster,
# whereas init and doctor without --base-root inspect the exact session root.
# Resolve through AMQ, never guess the base from a directory naming convention.
resolve_config_authority() {
  local route source_root session
  route="$(amq route explain --root "$ROOM_ROOT" --me "$MAIN_HANDLE" --to "$MAIN_HANDLE" --json)" \
    || fail 'cannot resolve AMQ configuration authority; do not launch workers'
  source_root="$(printf '%s' "$route" | jq -er '.source_root | select(type == "string" and length > 0)')" \
    || fail 'route has no source root'
  session="$(printf '%s' "$route" | jq -er '.source_session | select(type == "string")')" \
    || fail 'route has no session identity'
  CONFIG_ROOT="$source_root"
  if [[ -n "$session" ]]; then
    valid_identifier "$session" || fail 'route has an invalid session identity'
    [[ "${source_root##*/}" == "$session" ]] || fail 'route session/root mismatch'
    CONFIG_ROOT="${source_root%/*}"
    [[ -n "$CONFIG_ROOT" && "$CONFIG_ROOT" != "$source_root" ]] || fail 'route has no session base'
  fi
}

configured_agents() {
  local diagnostics
  diagnostics="$(amq doctor --root "$ROOM_ROOT" --base-root "$CONFIG_ROOT" --json --json-schema 2)" \
    || fail 'cannot inspect authoritative AMQ roster; no roster overwrite authorized'
  printf '%s' "$diagnostics" | jq -er '
    select([.checks[] | select(.name == "Config" and .status == "ok")] | length == 1) | .mailboxes |
    select(type == "array") |
    [.[] | select(.provenance == "configured_and_discovered" or .provenance == "configured") | .handle] |
    select(length > 0 and all(.[]; type == "string" and test("^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$"))) | join(",")' \
    || fail 'invalid authoritative AMQ roster diagnostics; refusing overwrite'
}

verify_roster() {
  local agents handle
  resolve_config_authority
  agents="$(configured_agents)" || fail 'AMQ roster inspection failed'
  for handle in "$MAIN_HANDLE" "$WORKER_HANDLE"; do
    [[ ",$agents," == *",$handle,"* ]] \
      || fail "handle $handle absent from authority $CONFIG_ROOT; run helper init before launch, never bypass strict"
  done
}

pane_id_from_json() {
  # Slurp rejects extra JSON documents; only a nonempty string is an ID.
  jq -ers 'if length == 1 then .[0].result.pane.pane_id else null end |
    select(type == "string" and length > 0)'
}

resolve_main() {
  local current_json
  current_json="$(herdr pane current --current)" \
    || fail 'cannot resolve the calling main Herdr pane; no focused-pane fallback'
  MAIN_PANE_ID="$(printf '%s' "$current_json" | pane_id_from_json)" \
    || fail 'current-pane response has no valid pane ID'
  valid_identifier "$MAIN_PANE_ID" || fail 'current-pane response contains an invalid pane ID'
  readonly MAIN_PANE_ID
}

verify_worker_cli() {
  local catalog provider model rest found version major minor patch
  command -v "$WORKER_HARNESS" >/dev/null || fail "required CLI not found: $WORKER_HARNESS"
  if [[ "$WORKER_HARNESS" == pi ]]; then
    catalog="$(pi --list-models "${WORKER_MODEL#*/}")" \
      || fail "Pi model discovery failed for $WORKER_MODEL; no fallback"
    found=0
    # Pi's installed list-models table has provider and model as its first two columns.
    while read -r provider model rest; do
      if [[ "$provider" == "${WORKER_MODEL%%/*}" && "$model" == "${WORKER_MODEL#*/}" ]]; then
        found=1
      fi
    done <<< "$catalog"
    [[ "$found" == 1 ]] || fail "Pi catalog lacks exact provider/model $WORKER_MODEL; no fallback"
  else
    version="$(claude --version)" || fail 'Claude version discovery failed; no fallback'
    [[ "$version" =~ ^([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})([[:space:]]|$) ]] \
      || fail 'unrecognized Claude version output; require Claude Code >=2.1.255'
    major=$((10#${BASH_REMATCH[1]}))
    minor=$((10#${BASH_REMATCH[2]}))
    patch=$((10#${BASH_REMATCH[3]}))
    ((major > 2 || (major == 2 && minor > 1) || (major == 2 && minor == 1 && patch >= 255))) \
      || fail 'Claude Code >=2.1.255 is required; no fallback'
    printf 'Manual prerequisite: confirm /model entitlement to claude-fable-5-1; CLI version is not entitlement.\n' >&2
  fi
}

cleanup_launch() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n "$CREATED_PANE_ID" && "$LAUNCH_COMMITTED" == 0 ]]; then
    printf 'Cleaning up created pane %s after failed launch.\n' "$CREATED_PANE_ID" >&2
    if ! herdr pane close "$CREATED_PANE_ID" >/dev/null; then
      printf 'error: cleanup failed for created pane %s; record it and inspect before reuse\n' "$CREATED_PANE_ID" >&2
      status=1
    else
      printf 'Closed created pane %s; wake cleanup has NOT been verified.\n' "$CREATED_PANE_ID" >&2
    fi
  fi
  exit "$status"
}

launch_worker() {
  local split_json pane_id process_json title prompt command
  local -a argv
  verify_roster
  verify_worker_cli
  resolve_main
  if [[ -z "$TARGET_PANE" ]]; then TARGET_PANE="$MAIN_PANE_ID"; fi
  title="use-agent-$TOPIC-$WORKER_HANDLE"
  prompt="$(build_worker_prompt)"
  if [[ "$WORKER_HARNESS" == pi ]]; then
    argv=(env AMQ_NOTIFY_ROLE=worker amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE"
      --require-wake --wake-inject-mode none --named=false pi --
      --name "$title" --model "$WORKER_MODEL" --thinking "$WORKER_EFFORT")
    if [[ "$WORKER_READONLY" == 1 ]]; then argv+=(--tools "read,bash,grep,find,ls"); fi
    argv+=(--approve "$prompt")
  else
    argv=(amq coop exec --root "$ROOM_ROOT" --me "$WORKER_HANDLE" --require-wake --named=false claude --
      --name "$title" --model "$WORKER_MODEL" --effort "$WORKER_EFFORT"
      --tools "Bash,Read,Grep,Glob" --dangerously-skip-permissions "$prompt")
  fi
  printf -v command '%q ' "${argv[@]}"

  CREATED_PANE_ID=''
  LAUNCH_COMMITTED=0
  trap cleanup_launch EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if ! split_json="$(herdr pane split --pane "$TARGET_PANE" --direction "$DIRECTION" \
    --ratio 0.45 --cwd "$PWD" --no-focus)"; then
    printf 'Herdr split response (creation may be ambiguous):\n%s\n' "$split_json" >&2
    fail 'pane split failed; no pane ownership established, inspect before retrying'
  fi
  if ! pane_id="$(printf '%s' "$split_json" | pane_id_from_json)"; then
    printf 'Herdr split response (creation may be ambiguous):\n%s\n' "$split_json" >&2
    fail 'split response has no valid created pane ID; refusing speculative cleanup'
  fi
  valid_identifier "$pane_id" || fail 'split response contains an invalid pane ID; refusing speculative cleanup'
  [[ "$pane_id" != "$MAIN_PANE_ID" && "$pane_id" != "$TARGET_PANE" ]] \
    || fail 'split returned the main or target pane ID; refusing mutation or cleanup'
  CREATED_PANE_ID="$pane_id"
  printf 'CREATED_PANE_ID=%s\n' "$CREATED_PANE_ID" >&2
  herdr pane rename "$pane_id" "$title" >/dev/null || fail "cannot name created pane $pane_id"
  herdr pane report-metadata "$pane_id" --source user:use-agent-session \
    --title "$title" --token "summary=$title" >/dev/null || fail "cannot set metadata on created pane $pane_id"
  herdr pane wait-output "$pane_id" --regex '.+' --source visible --timeout 10000 >/dev/null \
    || fail "created pane $pane_id did not produce shell output"
  process_json="$(herdr pane process-info --pane "$pane_id")" \
    || fail "cannot inspect foreground process in created pane $pane_id"
  printf '%s' "$process_json" | jq -es 'length == 1 and (.[0].result.process_info |
    (.shell_pid | type == "number" and . > 0) and
    (.foreground_processes | type == "array") and
    (.shell_pid as $shell | any(.foreground_processes[]; .pid == $shell)))' >/dev/null \
    || fail "created pane $pane_id has no verified foreground shell"
  herdr pane run "$pane_id" "$command" >/dev/null || fail "cannot submit worker command in pane $pane_id"
  printf 'WORKER_HANDLE=%s\nWORKER_PANE_ID=%s\nROOM_ROOT=%s\nMAIN_HANDLE=%s\n' \
    "$WORKER_HANDLE" "$pane_id" "$ROOM_ROOT" "$MAIN_HANDLE"
  LAUNCH_COMMITTED=1
  trap - EXIT HUP INT TERM
}

retire_worker() {
  local pane_json resolved_pane ops_json
  resolve_main
  [[ "$WORKER_PANE" != "$MAIN_PANE_ID" ]] || fail 'refusing to retire the current main pane'
  # Do not turn a transport/server failure into "already absent". Require an exact
  # recorded ID, not a UI alias that could resolve to the main or another pane.
  pane_json="$(herdr pane get "$WORKER_PANE")" \
    || fail 'cannot resolve recorded worker pane; no closure or reuse authorized'
  resolved_pane="$(printf '%s' "$pane_json" | pane_id_from_json)" \
    || fail 'worker-pane response has no valid pane ID'
  [[ "$resolved_pane" == "$WORKER_PANE" && "$resolved_pane" != "$MAIN_PANE_ID" ]] \
    || fail 'worker pane is an alias, mismatched ID, or current main; refusing closure'
  herdr pane close "$WORKER_PANE" >/dev/null || fail "cannot close recorded worker pane $WORKER_PANE"
  printf 'Closed recorded worker pane %s; checking wake cleanup once.\n' "$WORKER_PANE" >&2
  ops_json="$(amq doctor --ops --json)" \
    || fail "could not verify AMQ wake cleanup for $WORKER_HANDLE; do not reuse the handle"
  # Missing or malformed ops is not proof of cleanup. Never poll or delete locks.
  printf '%s' "$ops_json" | jq -es 'length == 1 and
    (.[0].ops | type == "object") and (.[0].ops.wake_locks | type == "array") and
    all(.[0].ops.wake_locks[]; type == "object" and (.agent | type == "string"))' >/dev/null \
    || fail 'invalid AMQ wake-lock diagnostics; do not reuse the handle'
  if ! printf '%s' "$ops_json" | jq -e --arg handle "$WORKER_HANDLE" \
    'all(.ops.wake_locks[]; .agent != $handle)' >/dev/null; then
    fail "worker $WORKER_HANDLE still has a wake claim or verification failed; choose an unused handle, do not poll"
  fi
  printf 'WORKER_HANDLE=%s\nWORKER_PANE_ID=%s\nROOM_ROOT=%s\nMAIN_HANDLE=%s\nRETIRED=true\n' \
    "$WORKER_HANDLE" "$WORKER_PANE" "$ROOM_ROOT" "$MAIN_HANDLE"
}

[[ $# -gt 0 ]] || bad_args 'a subcommand is required'
case "$1" in
  -h|--help) [[ $# == 1 ]] || bad_args 'help accepts no arguments'; usage; exit 0 ;;
  init|launch|retire) ACTION="$1"; shift ;;
  *) bad_args "unknown subcommand: $1" ;;
esac
TOPIC='' CURRENT_HARNESS='' WORKER_HANDLES='' WORKER_HANDLE=''
ROOT_ARG='' TARGET_PANE='' WORKER_PANE='' DIRECTION=right
SEEN=' '
while [[ $# -gt 0 ]]; do
  OPTION="$1"
  case "$OPTION" in
    --topic|--harness|--root) ;;
    --workers) [[ "$ACTION" == init ]] || bad_args '--workers is init-only' ;;
    --handle) [[ "$ACTION" != init ]] || bad_args '--handle is launch/retire-only' ;;
    --target|--direction) [[ "$ACTION" == launch ]] || bad_args "$OPTION is launch-only" ;;
    --pane) [[ "$ACTION" == retire ]] || bad_args '--pane is retire-only' ;;
    *) bad_args "unknown argument: $OPTION" ;;
  esac
  [[ "$SEEN" != *" $OPTION "* ]] || bad_args "duplicate argument: $OPTION"
  SEEN="$SEEN$OPTION "
  [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || bad_args "missing value for $OPTION"
  case "$OPTION" in
    --topic) TOPIC="$2" ;;
    --harness) CURRENT_HARNESS="$2" ;;
    --root) ROOT_ARG="$2" ;;
    --workers) WORKER_HANDLES="$2" ;;
    --handle) WORKER_HANDLE="$2" ;;
    --target) TARGET_PANE="$2" ;;
    --direction) DIRECTION="$2" ;;
    --pane) WORKER_PANE="$2" ;;
  esac
  shift 2
done
[[ "$TOPIC" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || bad_args '--topic must be nonempty lowercase kebab-case'
case "$CURRENT_HARNESS" in pi|claude) ;; *) bad_args '--harness must be pi or claude (the main harness)' ;; esac
case "$DIRECTION" in right|down) ;; *) bad_args '--direction must be right or down' ;; esac
[[ -z "$TARGET_PANE" ]] || valid_identifier "$TARGET_PANE" || bad_args 'invalid --target pane ID'
MAIN_HANDLE="${AM_ME:-$CURRENT_HARNESS}"
valid_identifier "$MAIN_HANDLE" || bad_args 'inherited AM_ME is not a valid identifier; refusing to replace it'
ROOM_ROOT="${AM_ROOT:-${ROOT_ARG:-$PWD/.agent-mail/use-agent-$TOPIC}}"
if [[ -n "${AM_ROOT:-}" && -n "$ROOT_ARG" && "$ROOT_ARG" != "$AM_ROOT" ]]; then
  bad_args 'refusing --root override of inherited AM_ROOT; preserve its exact value'
fi
[[ "$ROOM_ROOT" != *$'\n'* && "$ROOM_ROOT" != *$'\r'* ]] || bad_args 'room root must be single-line'
readonly TOPIC CURRENT_HARNESS MAIN_HANDLE ROOM_ROOT
if [[ "$ACTION" == init ]]; then
  [[ -n "$WORKER_HANDLES" && "$WORKER_HANDLES" != ,* && "$WORKER_HANDLES" != *, && "$WORKER_HANDLES" != *,,* ]] \
    || bad_args '--workers must be an explicit nonempty comma-separated roster'
  IFS=, read -r -a ROSTER <<< "$WORKER_HANDLES"
  ROSTER_SEEN=",$MAIN_HANDLE,"
  for HANDLE in "${ROSTER[@]}"; do
    select_profile "$HANDLE"
    [[ "$ROSTER_SEEN" != *",$HANDLE,"* ]] || bad_args "duplicate worker or main-handle collision: $HANDLE"
    ROSTER_SEEN="$ROSTER_SEEN$HANDLE,"
  done
  # read consumes one line only: validate the original roster as well.
  [[ "$WORKER_HANDLES" != *$'\n'* && "$WORKER_HANDLES" != *$'\r'* ]] || bad_args 'worker roster must be single-line'
else
  select_profile "$WORKER_HANDLE"
  [[ "$WORKER_HANDLE" != "$MAIN_HANDLE" ]] || bad_args 'worker handle collides with the inherited main handle'
fi
if [[ "$ACTION" == retire ]]; then
  valid_identifier "$WORKER_PANE" || bad_args '--pane must be the recorded worker pane ID'
fi

# No external command, including CLI discovery, may precede this binding guard.
[[ "${HERDR_ENV:-}" == 1 ]] || fail 'HERDR_ENV=1 is required; refusing to inspect or control another Herdr client'
command -v amq >/dev/null || fail 'required CLI not found: amq'
command -v jq >/dev/null || fail 'required CLI not found: jq'
if [[ "$ACTION" != init ]]; then
  command -v herdr >/dev/null || fail 'required CLI not found: herdr'
fi
# Main-side AMQ commands use this exact binding; coop exec overrides it for workers.
export AM_ROOT="$ROOM_ROOT" AM_ME="$MAIN_HANDLE"
case "$ACTION" in
  init)
    amq init --root "$ROOM_ROOT" --agents "$MAIN_HANDLE,$WORKER_HANDLES" --force >&2 \
      || fail 'AMQ roster initialization failed'
    resolve_config_authority
    if [[ "$CONFIG_ROOT" != "$ROOM_ROOT" ]]; then
      # Preserve every existing base registration, including other sessions.
      # Only MAIN may provision; concurrent roster writers are not supported.
      EXISTING_AGENTS="$(configured_agents)" || fail 'cannot preserve base registrations'
      amq init --root "$CONFIG_ROOT" --agents "$EXISTING_AGENTS,$MAIN_HANDLE,$WORKER_HANDLES" --force >&2 \
        || fail 'AMQ base roster initialization failed'
    fi
    amq doctor --root "$ROOM_ROOT" --base-root "$CONFIG_ROOT" --fix-mailboxes >&2 \
      || fail 'AMQ authoritative mailbox provisioning failed'
    amq doctor --root "$ROOM_ROOT" --base-root "$CONFIG_ROOT" --ops >&2 || fail 'AMQ doctor failed after initialization'
    printf 'ROOM_ROOT=%s\nCONFIG_ROOT=%s\nMAIN_HANDLE=%s\nWORKER_HANDLES=%s\n' "$ROOM_ROOT" "$CONFIG_ROOT" "$MAIN_HANDLE" "$WORKER_HANDLES"
    ;;
  launch) launch_worker ;;
  retire) retire_worker ;;
esac
