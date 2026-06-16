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
mail arrives (e.g. "AMQ: message from ${main_handle} - ... Drain with: amq drain --include-body").
You are pushed, not polling — do NOT sit in an "amq monitor" loop. Each time such a notice
appears, and once now at startup to catch anything already waiting:
1. Run: amq drain --include-body   (read it as plain text; never pipe amq output through jq)
2. Handle each message per its intent (below), then reply with an explicit send to ${main_handle}.
On your first turn also send a brief readiness ping:
   amq send --to ${main_handle} --subject "[DONE] ${sidecar_handle} ready" --kind status --body \$'Intent: done\n\n${sidecar_handle} worker ready.'
If you ever suspect you missed a message, run "amq drain --include-body" once to catch up.

Each message declares its intent in the subject tag and the first body line. Act accordingly:
- [ACTION]   / kind=todo           / "Intent: action"   -> do the requested work.
- [REVIEW]   / kind=review_request / "Intent: review"   -> critique or give a second opinion;
                                                            do not change files unless asked.
- [QUESTION] / kind=question       / "Intent: question" -> answer.
- [CONTEXT]  / kind=status         / "Intent: context"  -> passive briefing, decision, or
                                                            state. Absorb it; do NOT act on it.

The action-vs-context distinction is load-bearing: only do work when a message asks you to.
If you are unsure whether a message wants action or is just context, ask before acting.

Reply with an explicit send to the main (do NOT use amq reply):
   amq send --to ${main_handle} --subject "Re: <subject>" --kind <status|review_response|answer> --body \$'Intent: <done|blocked|...>\n\n<your reply>'

When the work is substantial, first send a short [DONE]/status acknowledgement with your plan,
then send the result. Never claim completion without stating what you changed or checked. If
you need input to continue, send [BLOCKED] with kind=question. The main owns final synthesis
and all user-facing communication.
EOF
}

open_in_ghostty_split_macos() {
  local command_text="$1"

  if ! command -v osascript >/dev/null 2>&1; then
    return 1
  fi

  /usr/bin/osascript - "$command_text" <<'APPLESCRIPT'
on run argv
  set commandText to item 1 of argv
  tell application "Ghostty" to activate
  delay 0.2
  tell application "System Events"
    keystroke "d" using command down
  end tell
  delay 0.35
  set the clipboard to commandText
  tell application "System Events"
    keystroke "v" using command down
    key code 36
  end tell
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
KICKOFF="You just started as the ${SIDECAR_HANDLE} worker. Run: amq drain --include-body  to handle anything already waiting, send a brief [DONE] readiness ping to ${MAIN_HANDLE}, then wait for notifications (do not loop on amq monitor)."

if [[ "$SIDECAR_HANDLE" == "claude" ]]; then
  ensure_claude_trusts_dir "$CWD"
  SIDECAR_CMD=(amq coop exec --session "$SESSION" claude -- --name "use-agent-${TOPIC_SLUG}" --model claude-opus-4-8 --effort xhigh --dangerously-skip-permissions --append-system-prompt-file "$PROMPT_FILE" "$KICKOFF")
else
  SIDECAR_CMD=(amq coop exec --session "$SESSION" pi -- --name "use-agent-${TOPIC_SLUG}" --model openai-codex/gpt-5.5 --thinking high --append-system-prompt "$PROMPT_FILE" "$KICKOFF")
fi

COMMAND_TEXT="cd $(printf '%q' "$CWD") && exec $(quote_cmd "${SIDECAR_CMD[@]}")"

OPENED=0
if [[ "$(uname -s)" == "Darwin" ]]; then
  if open_in_ghostty_split_macos "$COMMAND_TEXT"; then
    OPENED=1
  fi
fi

ROOT_JSON="$(amq env --session "$SESSION" --me "$MAIN_HANDLE" --json)"
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
  log "  AM_ROOT=$(printf '%q' "$ROOT") AM_ME=$MAIN_HANDLE amq send --to $SIDECAR_HANDLE --subject '[REVIEW] <topic>' --kind review_request --body '<body>'"
else
  log "  AM_ME=$MAIN_HANDLE amq send --session $SESSION --to $SIDECAR_HANDLE --subject '[REVIEW] <topic>' --kind review_request --body '<body>'"
fi
