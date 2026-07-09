#!/usr/bin/env bash
set -euo pipefail

WORKER_MODEL="openai-codex/gpt-5.6-sol"
WORKER_THINKING="xhigh"
MAIN_HANDLE="claude"
WORKER_HANDLE="pi"

usage() {
  cat <<'EOF'
Usage: launch-worker.sh [--topic TOPIC] [--handle NAME] [--session SESSION] [--cwd DIR] [--resume]

Launch a Pi (openai-codex/gpt-5.6-sol, xhigh) implementation worker as a visible AMQ
sidecar for a Claude orchestrator session.

The script initializes AMQ, writes the worker's system prompt, and opens the command
in a Ghostty split on macOS or Hyprland/Omarchy when possible. If split automation is
unavailable, it prints the command to paste manually.

Options:
  --topic TOPIC      Name for this workstream; session becomes codex-worker-<topic>.
  --handle NAME      AMQ handle for this worker (default: pi). Launch several workers
                     with the same --topic and distinct handles (e.g. implementer,
                     reviewer) to form a named team in one shared session.
  --session SESSION  Override the derived AMQ session name.
  --cwd DIR          Working directory for the worker (default: current directory).
  --resume           Continue the most recent Pi conversation in this directory.
                     Caution with multiple workers per directory: the most recent
                     conversation may belong to a different worker.
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
    value="task"
  fi
  printf '%s\n' "$value"
}

write_worker_prompt() {
  local prompt_path="$1"

  cat > "$prompt_path" <<EOF
You are the WORKER implementer paired with a ${MAIN_HANDLE} session that is the ORCHESTRATOR
(main). The orchestrator owns the task, the user, the design decisions, and the final review.
You are the implementation engine: you build exactly what it specifies. You never talk to the
user directly. The user may take over this terminal at any time.

Coordination runs over AMQ, a local message queue, and it is the only shared source of truth:
if something was not sent over AMQ, you do not know it. Your handle is ${WORKER_HANDLE}; the
orchestrator is ${MAIN_HANDLE}. AM_ROOT and AM_ME are already set, so use bare amq commands.

You are notified automatically: a background waker types a short notice into THIS terminal when
mail arrives. You are pushed, not polling — do NOT sit in an "amq monitor" loop or run "sleep"
to wait. To wait, simply finish your turn; you are given a turn automatically when mail arrives.
Each time a notice appears, and once now at startup to catch anything already waiting, run:
   amq drain --include-body      (read as plain text; never pipe amq output through jq)
On your first turn, also send a brief "ready" message to ${MAIN_HANDLE}, then wait.

Other named workers may share this session. Messages from them follow the same rules as
messages from the orchestrator, except only the orchestrator can order implementation work.
Send to another worker (amq send --to <their handle>) only when a message explicitly directs
you to; otherwise all your reports go to ${MAIN_HANDLE}.

HOW TO TREAT MESSAGES
- "Kind: todo" -> an implementation order. Do the work exactly as specified: stay inside the
  named files and scope, respect the stated constraints, meet the acceptance criteria, and run
  the verification commands the spec names before reporting. Do not expand scope, refactor
  beyond the ask, or "improve" things you were not asked to touch.
- any other message (no todo marker) -> a briefing, question, or review request. Answer or
  absorb it; leave the working tree untouched.
- Ambiguous spec or a blocker -> send "--kind question" with the first body line
  "BLOCKED: <the specific question or obstacle>", then wait. Never guess at intent and never
  invent requirements.

Reply with an explicit send to the orchestrator (do NOT use amq reply — the main is not a coop
participant, so reply cannot resolve it):
   amq send --to ${MAIN_HANDLE} --subject "Re: <subject>" --body \$'<your reply>'
Report "--kind status" with the first body line "DONE: <one-line summary>" when finished: list
the files you changed, what you verified and how (commands run, tests passed), and anything the
orchestrator should re-check. Never claim completion without having verified. The orchestrator
reviews everything you produce.
EOF
}

write_launcher_script() {
  local command_text="$1"
  local launcher

  launcher="$(mktemp "${TMPDIR:-/tmp}/codex-worker-launch.XXXXXX")" || return 1
  printf '%s\n' "$command_text" > "$launcher"
  chmod +x "$launcher"
  printf '%s\n' "$launcher"
}

open_in_ghostty_split_macos() {
  local command_text="$1"
  local win_match="$2"

  if ! command -v osascript >/dev/null 2>&1; then
    return 1
  fi

  # Paste a SHORT launcher command, not the full ~280-char command. A long clipboard
  # paste often has not finished landing when Return fires, leaving the split as a bare
  # shell with the worker never started. Writing the command to a temp script and pasting
  # "exec bash <file>" keeps the keystroke payload tiny and reliable.
  local launcher
  launcher="$(write_launcher_script "$command_text")" || return 1
  local run_text
  run_text="exec bash $(printf '%q' "$launcher")"

  # ⌘D splits whatever Ghostty window is focused, which may not be the one running
  # the orchestrator. Raise a window matching the invoking directory's basename first,
  # so the split lands next to the orchestrator. If no window matches, fall back to
  # the focused window.
  /usr/bin/osascript - "$run_text" "$win_match" <<'APPLESCRIPT'
on run argv
  set runText to item 1 of argv
  set winMatch to item 2 of argv
  tell application "Ghostty" to activate
  delay 0.25
  if winMatch is not "" then
    try
      tell application "System Events" to tell process "Ghostty"
        set matches to (every window whose name contains winMatch)
        if (count of matches) > 0 then
          perform action "AXRaise" of item 1 of matches
          set frontmost to true
          delay 0.25
        end if
      end tell
    end try
  end if
  delay 0.2
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

open_in_ghostty_split_hyprland() {
  local command_text="$1"
  local win_match="$2"

  if ! command -v hyprctl >/dev/null 2>&1 || \
    ! command -v jq >/dev/null 2>&1 || \
    ! command -v wl-copy >/dev/null 2>&1 || \
    ! command -v wtype >/dev/null 2>&1; then
    return 1
  fi

  if [[ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]]; then
    return 1
  fi

  local launcher
  launcher="$(write_launcher_script "$command_text")" || return 1
  local run_text
  run_text="exec bash $(printf '%q' "$launcher")"

  # Prefer a Ghostty window whose title mentions the project; otherwise the most
  # recently focused Ghostty window (focusHistoryID 0 = focused now). Claude Code
  # retitles its window to the session summary, not the directory, so the title
  # match usually misses and the focus-history fallback is what finds the
  # orchestrator's own window.
  local window_address
  window_address="$(hyprctl clients -j 2>/dev/null | jq -r --arg m "$win_match" '
    [ .[] | select(
      .class == "com.mitchellh.ghostty" or
      .initialClass == "com.mitchellh.ghostty" or
      .class == "ghostty" or
      .initialClass == "ghostty"
    ) ] as $ghostty
    | (
        ($ghostty | map(select((.title // "") | contains($m))) | .[0].address) //
        ($ghostty | sort_by(.focusHistoryID) | .[0].address) //
        ""
      )
  ')"

  if [[ -z "$window_address" || "$window_address" == "null" ]]; then
    return 1
  fi

  hyprctl dispatch focuswindow "address:$window_address" >/dev/null || return 1
  sleep 0.2

  # Omarchy/Ghostty binds Ctrl+Shift+O to split right and Ctrl+Shift+V to paste.
  # Keep the pasted payload short and paste a launcher script path rather than the
  # full worker command, mirroring the macOS reliability workaround above.
  wl-copy --type text/plain "$run_text" || return 1
  wtype -M ctrl -M shift -k o -m shift -m ctrl || return 1
  sleep 0.8
  wtype -M ctrl -M shift -k v -m shift -m ctrl || return 1
  sleep 0.2
  wtype -k Return || return 1
}

TOPIC="task"
SESSION=""
CWD="$PWD"
RESUME=0

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
    --cwd)
      CWD="${2:-}"
      shift 2
      ;;
    --handle)
      WORKER_HANDLE="${2:-}"
      shift 2
      ;;
    --resume)
      RESUME=1
      shift
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
  exit 1
fi

if ! command -v pi >/dev/null 2>&1; then
  err "pi is not installed or not in PATH"
  exit 1
fi

WORKER_HANDLE="$(slugify "$WORKER_HANDLE")"
if [[ -z "$WORKER_HANDLE" || "$WORKER_HANDLE" == "$MAIN_HANDLE" ]]; then
  err "--handle must be a non-empty name other than '$MAIN_HANDLE'"
  exit 2
fi

TOPIC_SLUG="$(slugify "$TOPIC")"
if [[ -z "$SESSION" ]]; then
  SESSION="codex-worker-${TOPIC_SLUG}"
fi

# If the orchestrator already has an AMQ binding (e.g. it was itself launched under
# coop exec), reuse that session so replies route back to it. Otherwise use the
# topic-named session under the default root.
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

amq coop init --agents "$MAIN_HANDLE,$WORKER_HANDLE" >/dev/null

PROMPT_DIR="$CWD/.agent-mail/codex-worker/prompts"
mkdir -p "$PROMPT_DIR"
PROMPT_FILE="$PROMPT_DIR/${SESSION}-${WORKER_HANDLE}.md"
write_worker_prompt "$PROMPT_FILE"

# Interactive agents only act when given a turn. This initial message gives the worker its
# first turn (drain anything already queued + announce readiness); afterward it idles and
# amq wake pushes a turn for each new message.
KICKOFF="You just started as the ${WORKER_HANDLE} implementation worker for a ${MAIN_HANDLE} orchestrator. Run: amq drain --include-body  to handle anything already waiting, send a brief 'ready' message to ${MAIN_HANDLE}, then wait for notifications (do not loop on amq monitor)."

PI_ARGS=(--name "codex-${WORKER_HANDLE}-${TOPIC_SLUG}" --model "$WORKER_MODEL" --thinking "$WORKER_THINKING" --append-system-prompt "$PROMPT_FILE")
if (( RESUME )); then
  PI_ARGS+=(--continue)
fi

WORKER_CMD=(amq coop exec "${SESSION_ARG[@]}" --me "$WORKER_HANDLE" pi -- "${PI_ARGS[@]}" "$KICKOFF")

COMMAND_TEXT="cd $(printf '%q' "$CWD") && exec $(quote_cmd "${WORKER_CMD[@]}")"

OPENED=0
case "$(uname -s)" in
  Darwin)
    if open_in_ghostty_split_macos "$COMMAND_TEXT" "$(basename "$CWD")"; then
      OPENED=1
    fi
    ;;
  Linux)
    if open_in_ghostty_split_hyprland "$COMMAND_TEXT" "$(basename "$CWD")"; then
      OPENED=1
    fi
    ;;
esac

ROOT_JSON="$(amq env "${SESSION_ARG[@]}" --me "$MAIN_HANDLE" --json)"
ROOT="$(printf '%s' "$ROOT_JSON" | jq -r .root 2>/dev/null || true)"

log "codex worker"
log "  orchestrator: $MAIN_HANDLE"
log "  worker:       $WORKER_HANDLE ($WORKER_MODEL, thinking=$WORKER_THINKING)"
log "  session:      $SESSION"
if [[ -n "$ROOT" && "$ROOT" != "null" ]]; then
  log "  am_root:      $ROOT"
fi
log "  prompt:       $PROMPT_FILE"

if (( OPENED )); then
  log "  ghostty:      opened split"
else
  log "  ghostty:      split automation unavailable; open a Ghostty split and run:"
  log ""
  log "$COMMAND_TEXT"
fi

log ""
log "Dispatch a task with:"
if [[ -n "$ROOT" && "$ROOT" != "null" ]]; then
  log "  AM_ROOT=$(printf '%q' "$ROOT") AM_ME=$MAIN_HANDLE amq send --to $WORKER_HANDLE --kind todo --subject '<task>' --body '<spec>'"
else
  log "  AM_ME=$MAIN_HANDLE amq send --session $SESSION --to $WORKER_HANDLE --kind todo --subject '<task>' --body '<spec>'"
fi
