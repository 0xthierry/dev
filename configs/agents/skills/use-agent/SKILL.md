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

Run the helper script in this skill's own `scripts/` directory by its **absolute path** — a repo-relative path fails unless your cwd is the repo root:

```bash
# pi:
~/.pi/agent/skills/use-agent/scripts/launch-sidecar.sh --topic "<kebab-topic>"
# claude:
~/.claude/skills/use-agent/scripts/launch-sidecar.sh --topic "<kebab-topic>"
```

It detects which harness you are, reuses your `AM_ROOT` if set (so the worker joins your session), writes the worker's system prompt, and opens the worker in a Ghostty split. Under the hood it launches the Claude worker like this (model-pinned, folder trust pre-accepted, worker protocol passed by file):

```bash
amq coop exec --root "$AM_ROOT" claude -- \
  --model claude-opus-4-8 --effort xhigh --dangerously-skip-permissions \
  --append-system-prompt-file <worker-prompt> "<kickoff>"
```

`amq coop exec` sets `AM_ROOT` and `AM_ME=claude` inside the worker, so the worker talks with bare `amq` commands.

If the helper reports that Ghostty split automation was unavailable, tell the user and paste the printed command into a split yourself. Do not continue as if the worker were running.

## The communication layer

AMQ is the only shared source of truth. Terminal scrollback and your private reasoning are not visible to the worker — if you did not send it over AMQ, the worker does not know it.

You (the main) are **not** inside `coop exec`, so set the queue location on each command. The session root is deterministic: `.agent-mail/use-agent-<topic>`.

Send a message to the worker (plain by default — it advises and won't change anything unless you tell it to):

```bash
AM_ROOT=.agent-mail/use-agent-<topic> AM_ME=pi \
amq send --to claude \
  --subject "auth refactor plan" \
  --body '<your message — e.g. here is the plan, what are the risks?>'
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

### Receiving replies

**If you are pi**, you have the `amq-notify` auto-notifier: do **not** poll. Send your request and **finish your turn** — the reply is delivered to you automatically as a new turn. Running `amq monitor`/`amq drain`/`sleep` to wait races with the notifier and wastes turns.

Red-flag thoughts — if you catch yourself thinking any of these, stop: that thought *is* the signal to end your turn now.

- "I shouldn't end my turn until the reply arrives" — backwards; **ending the turn is how you wait**. You'll be given a new turn when it lands.
- "Let me run `amq monitor`/`amq drain`/`amq watch` to wait for it" — no; that races the notifier.
- "I'll `sleep` until it comes" — no; sleeping only delays the push (you're busy, so it queues behind the sleep).
- "Let me check whether it arrived yet" — no; you'll be told. Don't poll.

Just send, say you're waiting, and stop. Waiting = doing nothing.

**If you are claude** (no auto-notifier), you fetch the reply yourself:

- **Check (non-blocking):** `amq drain --include-body` returns whatever has arrived, or nothing. Prefer this on your next step so you stay responsive.
- **Wait (blocking):** `amq monitor --include-body` blocks until a message lands (or `--timeout`). Good for a deliberate "ask and wait now," but it holds your turn, so the pane looks busy meanwhile.

Read bodies as plain text; never pipe `amq` output through `jq` — message bodies can contain control characters that break it.

The **worker** is different: it runs under `coop exec`, which starts a background `amq wake` that types a notice into the worker's terminal (via TIOCSTI) when mail arrives — so the worker reacts on its own (push). You don't manage that; just send, then pull for the reply.

The worker sends **several messages** per request (a readiness ack, then the result). If you only got the ack, drain or monitor again for the one you asked for — judge by `Kind:`/`Subject:`.

**Artifacts and images travel by path, not inline.** AMQ bodies are text. The worker writes the file (you share a working directory) and sends its path; you read or open that path. Same for a screenshot, diff, or generated file — save it, send the path.

## Asking the worker to act vs. think with you

The worker runs in **advisor mode by default**: it answers, reviews, and reasons, but it will not modify files or run mutating commands unless you explicitly tell it to. So most messages need no ceremony — just write what you want and the worker responds without touching anything.

When you actually want the worker to *do* something — change files, run a task, implement — say so plainly and add `--kind act`. That one marker is what flips it from advising to acting; everything else stays safe by default. The worker reports back with `--kind done` (finished — with what it changed or checked) or `--kind blocked` (it needs input). That is the whole convention: **`act` to escalate, `done`/`blocked` to report.**

```bash
# Think with me (default — no marker): review, question, share context
AM_ROOT=.agent-mail/use-agent-<topic> AM_ME=pi \
amq send --to claude --subject "auth refactor plan" \
  --body 'Here is the plan and where I am unsure: ... What are the risks?'

# Do this (escalate to action)
AM_ROOT=.agent-mail/use-agent-<topic> AM_ME=pi \
amq send --to claude --kind act --subject "implement token refresh" \
  --body 'Implement the refresh flow in src/auth.ts. You own that file; I will stay out of it. Done when the tests in auth.test.ts pass.'
```

If something might read like a request but isn't, say so ("FYI only, no action"). When you hand the worker action work, name the files it owns so you are never editing the same file at the same time.

## Brief before you ask (shared context)

You are pair programming, so the worker needs your mental model before it can help. Before your first real ask, send a briefing: the task, the decisions made so far, the relevant files, the constraints, and what you have already tried. Keep it in sync — when the user decides something or you change direction, forward it. A thin briefing produces thin help; include enough that the worker could act without seeing your screen. No marker needed — a briefing is advisory, so the worker absorbs it and won't act on it.

```bash
AM_ROOT=.agent-mail/use-agent-<topic> AM_ME=pi \
amq send --to claude \
  --subject "task briefing" \
  --body $'Task: <what we are doing>\nDecisions: <what the user chose>\nFiles: <paths that matter>\nTried: <what already failed>'
```

## Common uses

- **Second opinion on a plan** — send your plan, the constraints, and what you are unsure about; ask for risks and alternatives. Default mode: it advises, doesn't edit.
- **Reviewer / auditor** — send a diff or a completion claim with the acceptance criteria and tests run; ask for approve/reject with evidence.
- **Implementation help** — `--kind act` with explicit file ownership and success criteria; avoid editing the same files at the same time.
- **Sounding board** — ask about a design tradeoff, and keep the worker looped in on user decisions as they happen.

## Stop conditions

- You own synthesis and the final user response; relay the worker's findings in your own words.
- Do not claim the worker did or verified something unless its `done` reply says what it checked.
- The worker is a peer, not an oracle. Weigh its output; don't rubber-stamp it.
