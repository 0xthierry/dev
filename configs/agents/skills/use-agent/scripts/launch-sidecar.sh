#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: launch-sidecar.sh [--topic TOPIC] [--session SESSION] [--from pi|claude] [--cwd DIR]

Launch the opposite harness as a visible AMQ sidecar:
  from pi     -> claude
  from claude -> pi

The script initializes AMQ, writes a sidecar prompt, and opens the command in a
Ghostty split on macOS when possible. If split automation is unavailable, it
prints the command to paste manually.
EOF
}

log() {
  printf '%s\n' "$*"
}

err() {
  printf 'error: %s\n' "$*" >&2
}

quote_cmd() {
  local rendered=""
  local arg=""

  for arg in "$@"; do
    if [[ -n "$rendered" ]]; then
      rendered+=" "
    fi
    printf -v arg '%q' "$arg"
    rendered+="$arg"
  done

  printf '%s\n' "$rendered"
}

slugify() {
  local value="$1"
  value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  value="$(printf '%s' "$value" | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"
  if [[ -z "$value" ]]; then
    value="pair"
  fi
  printf '%s\n' "$value"
}

detect_from() {
  if [[ -n "${USE_AGENT_FROM:-}" ]]; then
    printf '%s\n' "$USE_AGENT_FROM"
    return 0
  fi

  if [[ "${PI_CODING_AGENT:-}" == "true" || -n "${PI_SESSION_ID:-}" ]]; then
    printf 'pi\n'
    return 0
  fi

  if [[ -n "${CLAUDECODE:-}" || -n "${CLAUDE_PROJECT_DIR:-}" || -n "${CLAUDE_SESSION_ID:-}" ]]; then
    printf 'claude\n'
    return 0
  fi

  return 1
}

write_sidecar_prompt() {
  local prompt_path="$1"
  local main_handle="$2"
  local sidecar_handle="$3"

  cat > "$prompt_path" <<EOF
You are the WORKER sidecar paired with a ${main_handle} session that is the MAIN (master).
The main owns the task, the user, and all final decisions. You assist on request and never
talk to the user directly. The user may take over this terminal at any time.

Coordination runs over AMQ, a local message queue, and it is the only shared source of truth:
if something was not sent over AMQ, you do not know it. Your handle is ${sidecar_handle}; the
main is ${main_handle}. AM_ROOT and AM_ME are already set, so use bare amq commands.

You are notified automatically: a background waker types a short notice into THIS terminal when
mail arrives. You are pushed, not polling — do NOT sit in an "amq monitor" loop or run "sleep"
to wait. To wait, simply finish your turn; you are given a turn automatically when mail arrives.
Each time a notice appears, and once now at startup to catch anything already waiting, run:
   amq drain --include-body      (read as plain text; never pipe amq output through jq)
On your first turn, also send a brief "ready" message to ${main_handle}, then wait.

DEFAULT STANCE — advise, don't act. Treat every message as a request to think with the main,
not to change things: answer, review, reason, flag risks, suggest. Do NOT modify files, run
mutating or stateful commands, or start implementation UNLESS a message explicitly tells you to
act — it will carry "--kind act" or plainly say so. If a message is ambiguous about whether to
act, ask before doing anything. Never edit files the main is actively editing; before changing
shared files, confirm you own them.
   - plain message (no act marker) -> respond/advise only; leave the working tree untouched.
   - --kind act                    -> do the requested work, then report what you did.

Reply with an explicit send to the main (do NOT use amq reply — the main is not a coop
participant, so reply cannot resolve it):
   amq send --to ${main_handle} --subject "Re: <subject>" --body \$'<your reply>'
Mark a reply "--kind done" when you have finished requested work (and state exactly what you
changed or checked), or "--kind blocked" when you need input to continue. Never claim completion
without saying what you did. The main owns final synthesis and all user-facing communication.
EOF
}

open_in_ghostty_split_macos() {
  local command_text="$1"

  if ! command -v osascript >/dev/null 2>&1; then
    return 1
  fi

  # Paste a SHORT launcher command, not the full ~280-char command. A long clipboard
  # paste often has not finished landing when Return fires, leaving the split as a bare
  # shell with the worker never started. Writing the command to a temp script and pasting
  # "exec bash <file>" keeps the keystroke payload tiny and reliable.
  local launcher
  launcher="$(mktemp "${TMPDIR:-/tmp}/use-agent-launch.XXXXXX")" || return 1
  printf '%s\n' "$command_text" > "$launcher"
  chmod +x "$launcher"
  local run_text
  run_text="exec bash $(printf '%q' "$launcher")"

  /usr/bin/osascript - "$run_text" <<'APPLESCRIPT'
on run argv
  set runText to item 1 of argv
  tell application "Ghostty" to activate
  delay 0.35
  tell application "System Events" to keystroke "d" using command down
  delay 0.8
  set the clipboard to runText
  delay 0.25
  tell application "System Events" to keystroke "v" using command down
  delay 0.45
  tell application "System Events" to key code 36
end run
APPLESCRIPT
}

# Claude Code shows a one-time "trust this folder" dialog per directory, separate
# from --dangerously-skip-permissions. An unattended split would stall on it, so
# pre-accept trust for the worker's directory in ~/.claude.json before launching.
ensure_claude_trusts_dir() {
  local dir="$1"
  local cfg="$HOME/.claude.json"
  local abs tmp

  command -v jq >/dev/null 2>&1 || return 0
  abs="$(cd "$dir" 2>/dev/null && pwd -P)" || abs="$dir"
  [[ -f "$cfg" ]] || printf '{}\n' > "$cfg"
  tmp="$(mktemp)"
  if jq --arg d "$abs" '.projects[$d] = ((.projects[$d] // {}) + {hasTrustDialogAccepted: true})' "$cfg" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$cfg"
  else
    rm -f "$tmp"
  fi
}

TOPIC="pair"
SESSION=""
FROM=""
CWD="$PWD"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --topic)
      TOPIC="${2:-}"
      shift 2
      ;;
    --session)
      SESSION="${2:-}"
      shift 2
      ;;
    --from)
      FROM="${2:-}"
      shift 2
      ;;
    --cwd)
      CWD="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      err "unknown argument: $1"
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v amq >/dev/null 2>&1; then
  err "amq is not installed or not in PATH"
  err "run the repo setup after AMQ support is installed, or install the pinned AMQ source build first"
  exit 1
fi

if [[ -z "$FROM" ]]; then
  if ! FROM="$(detect_from)"; then
    err "could not detect current harness; pass --from pi or --from claude"
    exit 1
  fi
fi

case "$FROM" in
  pi)
    MAIN_HANDLE="pi"
    SIDECAR_HANDLE="claude"
    ;;
  claude)
    MAIN_HANDLE="claude"
    SIDECAR_HANDLE="pi"
    ;;
  *)
    err "--from must be pi or claude"
    exit 2
    ;;
esac

TOPIC_SLUG="$(slugify "$TOPIC")"
if [[ -z "$SESSION" ]]; then
  SESSION="use-agent-${TOPIC_SLUG}"
fi

# If the main session already has an AMQ binding (e.g. the amq-notify pi extension set
# AM_ROOT to a per-process session), launch the worker into that same session so the
# main is notified of replies. Otherwise use a topic-named session under the default root.
if [[ -n "${AM_ROOT:-}" ]]; then
  SESSION="$(basename "$AM_ROOT")"
  SESSION_ARG=(--root "$AM_ROOT")
else
  SESSION_ARG=(--session "$SESSION")
fi

if [[ ! -d "$CWD" ]]; then
  err "cwd does not exist: $CWD"
  exit 1
fi

amq coop init --agents pi,claude >/dev/null

PROMPT_DIR="$CWD/.agent-mail/use-agent/prompts"
mkdir -p "$PROMPT_DIR"
PROMPT_FILE="$PROMPT_DIR/${SESSION}-${SIDECAR_HANDLE}.md"
write_sidecar_prompt "$PROMPT_FILE" "$MAIN_HANDLE" "$SIDECAR_HANDLE"

# Interactive agents only act when given a turn. This initial message gives the worker its first
# turn (drain anything already queued + announce readiness); afterward it idles and amq wake
# pushes a turn for each new message.
KICKOFF="You just started as the ${SIDECAR_HANDLE} worker. Run: amq drain --include-body  to handle anything already waiting, send a brief 'ready' message to ${MAIN_HANDLE}, then wait for notifications (do not loop on amq monitor)."

if [[ "$SIDECAR_HANDLE" == "claude" ]]; then
  ensure_claude_trusts_dir "$CWD"
  SIDECAR_CMD=(amq coop exec "${SESSION_ARG[@]}" claude -- --name "use-agent-${TOPIC_SLUG}" --model claude-opus-4-8 --effort xhigh --dangerously-skip-permissions --append-system-prompt-file "$PROMPT_FILE" "$KICKOFF")
else
  SIDECAR_CMD=(amq coop exec "${SESSION_ARG[@]}" pi -- --name "use-agent-${TOPIC_SLUG}" --model openai-codex/gpt-5.5 --thinking high --append-system-prompt "$PROMPT_FILE" "$KICKOFF")
fi

COMMAND_TEXT="cd $(printf '%q' "$CWD") && exec $(quote_cmd "${SIDECAR_CMD[@]}")"

OPENED=0
if [[ "$(uname -s)" == "Darwin" ]]; then
  if open_in_ghostty_split_macos "$COMMAND_TEXT"; then
    OPENED=1
  fi
fi

ROOT_JSON="$(amq env "${SESSION_ARG[@]}" --me "$MAIN_HANDLE" --json)"
ROOT="$(printf '%s' "$ROOT_JSON" | jq -r .root 2>/dev/null || true)"

log "use-agent sidecar"
log "  main:    $MAIN_HANDLE"
log "  sidecar: $SIDECAR_HANDLE"
log "  session: $SESSION"
if [[ -n "$ROOT" && "$ROOT" != "null" ]]; then
  log "  am_root: $ROOT"
fi
log "  prompt:  $PROMPT_FILE"

if (( OPENED )); then
  log "  ghostty: opened split"
else
  log "  ghostty: split automation unavailable; open a Ghostty split and run:"
  log ""
  log "$COMMAND_TEXT"
fi

log ""
log "Send messages with:"
if [[ -n "$ROOT" && "$ROOT" != "null" ]]; then
  log "  AM_ROOT=$(printf '%q' "$ROOT") AM_ME=$MAIN_HANDLE amq send --to $SIDECAR_HANDLE --subject '<topic>' --body '<ask>'   (add --kind act to have it change files)"
else
  log "  AM_ME=$MAIN_HANDLE amq send --session $SESSION --to $SIDECAR_HANDLE --subject '<topic>' --body '<ask>'   (add --kind act to have it change files)"
fi
