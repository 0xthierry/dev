---
name: use-agent
description: Use only when the user explicitly asks to pair with a second agent harness — launch a sidecar, get a second opinion from another agent, have one harness drive another, or review work with another agent over AMQ. Never invoke proactively.
---

# Use Agent

Pair two agent harnesses on one task. The **main** session launches the other harness as a visible **worker** sidecar, and they coordinate over AMQ, a local file-based message queue. You are the main: you own the plan, the synthesis, and every word the user sees. The worker assists — reviews, second opinions, implementation help, audits — and never talks to the user directly.

Only run this skill when the user explicitly asks to involve another agent.

## Roles

The relationship is master/worker and it must be unambiguous to both sides.

- **Main (master)** — the session running this skill. Owns the task, the user relationship, and final decisions. Briefs the worker, sends requests, and decides what to do with the results.
- **Worker (sidecar)** — the harness you launch. Runs in a Ghostty split so the user can watch or take over. Acts only on explicit requests; otherwise it waits.

Default pairing: **Pi launches Claude Code.** Whoever runs the skill is the main; the launched harness is the worker. The launch sets the roles, and the worker's appended system prompt states them back, so neither side is confused about who leads.

## When to use

The user explicitly asks for a second agent: "use claude as a sidecar", "get a second opinion from the other agent", "have claude review this with me", "pair with claude on this plan".

## When not to use

- The user did not ask to involve another agent — never launch a sidecar on your own initiative.
- A one-shot, headless subtask is enough — use the Agent tool for that. Use this skill only when the user wants a **persistent, visible peer** they can also take over.

## Launch

Run the helper from the project root. It detects which harness you are, initializes AMQ, writes the worker's system prompt, and opens the worker in a Ghostty split:

```bash
configs/agents/skills/use-agent/scripts/launch-sidecar.sh --topic "<kebab-topic>"
```

The helper starts the worker with this command — always `--dangerously-skip-permissions` for Claude, with the relationship carried in `--append-system-prompt`:

```bash
amq coop exec --session use-agent-<topic> claude -- \
  --dangerously-skip-permissions \
  --name use-agent-<topic> \
  --append-system-prompt "<worker protocol>"
```

`amq coop exec` sets `AM_ROOT=.agent-mail/use-agent-<topic>` and `AM_ME=claude` inside the worker, so the worker talks with bare `amq` commands.

If the helper reports that Ghostty split automation was unavailable, tell the user and paste the printed command into a split yourself. Do not continue as if the worker were running.

## The communication layer

AMQ is the only shared source of truth. Terminal scrollback and your private reasoning are not visible to the worker — if you did not send it over AMQ, the worker does not know it.

You (the main) are **not** inside `coop exec`, so set the queue location on each command. The session root is deterministic: `.agent-mail/use-agent-<topic>`.

Send a message to the worker:

```bash
AM_ROOT=.agent-mail/use-agent-<topic> AM_ME=pi \
amq send --to claude \
  --subject "[REVIEW] auth refactor plan" \
  --kind review_request \
  --body $'Intent: review\n\n<your message>'
```

Read what the worker has sent (non-blocking — prints whatever has arrived, as plain text):

```bash
AM_ROOT=.agent-mail/use-agent-<topic> AM_ME=pi \
amq drain --include-body
```

Block and wait for the reply (returns the instant a message lands, bounded by `--timeout`):

```bash
AM_ROOT=.agent-mail/use-agent-<topic> AM_ME=pi \
amq monitor --include-body --timeout 10m
```

Use `amq send --to <handle>` for every message, including replies. Do **not** use `amq reply`: the main is not a registered coop participant, so reply cannot resolve it. Inside the worker the same commands are bare — `amq send --to pi ...`, `amq drain --include-body` — because its env is preset.

That is the whole surface you need: **send** to talk, **drain** to read, **monitor** to wait.

### Receiving replies (you pull; the worker is pushed)

You run in your normal session, **not** under `coop exec`, so nothing auto-notifies you — you fetch the reply yourself:

- **Check (non-blocking):** `amq drain --include-body` returns whatever has arrived, or nothing. Prefer this on your next step so you stay responsive.
- **Wait (blocking):** `amq monitor --include-body` blocks until a message lands (or `--timeout`). Good for a deliberate "ask and wait now," but it holds your turn, so the pane looks busy meanwhile.

Read bodies as plain text; never pipe `amq` output through `jq` — message bodies can contain control characters that break it.

The **worker** is different: it runs under `coop exec`, which starts a background `amq wake` that types a notice into the worker's terminal (via TIOCSTI) when mail arrives — so the worker reacts on its own (push). You don't manage that; just send, then pull for the reply.

The worker sends **several messages** per request (a readiness ack, then the result). If you only got the ack, drain or monitor again for the one you asked for — judge by `Kind:`/`Subject:`.

**Artifacts and images travel by path, not inline.** AMQ bodies are text. The worker writes the file (you share a working directory) and sends its path; you read or open that path. Same for a screenshot, diff, or generated file — save it, send the path.

## Say what you want: action vs. context

Every message must declare its intent so the worker knows whether to act or just listen. Put a tag in the subject and an `Intent:` line as the first line of the body.

| Intent | Subject tag | `--kind` | Worker does |
|---|---|---|---|
| action | `[ACTION]` | `todo` | Do the requested work. |
| review | `[REVIEW]` | `review_request` | Critique / second opinion. Does not edit unless asked. |
| question | `[QUESTION]` | `question` | Answer. |
| context | `[CONTEXT]` | `status` | Absorb it. **Does not act.** |
| done | `[DONE]` | `status` | Reports finished, with evidence. |
| blocked | `[BLOCKED]` | `question` | Reports it needs input to continue. |

The load-bearing distinction is **action vs. context**. If you want the worker to do or change something, send `[ACTION]`, `[REVIEW]`, or `[QUESTION]`. If you are only sharing state — a user decision, a new constraint, what you just tried — send `[CONTEXT]`, and the worker must not start work from it. Be explicit every time; never leave the worker guessing whether a message is a request or background.

## Brief before you ask (shared context)

You are pair programming, so the worker needs your mental model before it can help. Before your first `[ACTION]` or `[REVIEW]`, send a `[CONTEXT]` briefing: the task, the decisions made so far, the relevant files, the constraints, and what you have already tried. Then keep it in sync — when the user decides something or you change direction, forward it as `[CONTEXT]`. A thin briefing produces thin help; include enough that the worker could act without seeing your screen.

```bash
AM_ROOT=.agent-mail/use-agent-<topic> AM_ME=pi \
amq send --to claude \
  --subject "[CONTEXT] task briefing" \
  --kind status \
  --body $'Intent: context\n\nTask: <what we are doing>\nDecisions: <what the user chose>\nFiles: <paths that matter>\nTried: <what already failed>\nNo action needed yet.'
```

## Common uses

- **Second opinion on a plan** — `[REVIEW]` your plan plus the constraints and what you are unsure about; ask for risks and alternatives.
- **Reviewer / auditor** — `[REVIEW]` a diff or a completion claim with the acceptance criteria and tests run; ask for approve/reject with evidence.
- **Implementation help** — `[ACTION]` with explicit file ownership and success criteria; avoid editing the same files at the same time.
- **Sounding board** — `[QUESTION]` a design tradeoff, and `[CONTEXT]` to keep the worker looped in on user decisions as they happen.

## Stop conditions

- You own synthesis and the final user response; relay the worker's findings in your own words.
- Do not claim the worker did or verified something unless its `[DONE]` message says what it checked.
- The worker is a peer, not an oracle. Weigh its output; don't rubber-stamp it.
