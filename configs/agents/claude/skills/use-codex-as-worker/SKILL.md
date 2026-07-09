---
name: use-codex-as-worker
description: Use only when the user explicitly asks or allows delegating implementation to a Codex worker — launch Pi running openai-codex/gpt-5.6-sol (xhigh) as a visible sidecar implementer that this session orchestrates over AMQ. Write exact task specs, dispatch with --kind todo, validate the results yourself, then iterate, resume, respawn, or launch another worker. Never invoke on your own initiative.
---

# Use Codex As Worker

Delegate implementation to a cheaper harness while you stay in charge. You (Claude, the
flagship model) are the **orchestrator**: you own the plan, write exact task specs, judge the
results, and speak to the user. The **worker** is Pi running `openai-codex/gpt-5.6-sol` at `xhigh`
thinking — a capable implementer that builds precisely what you tell it, runs in a Ghostty
split the user can watch or take over, and coordinates with you over AMQ, a local file-based
message queue.

The economics of the split: your reasoning is expensive, the worker's implementation is cheap.
Spend your tokens on design, exact specification, and validation. Spend the worker's tokens on
writing the code.

Only run this skill when the user explicitly asks or allows it.

## Roles

The relationship is orchestrator/implementer and it must be unambiguous to both sides.

- **Orchestrator (main)** — the Claude session running this skill. Owns the task, the design
  decisions, the review, and the user relationship. Briefs the worker, dispatches tasks,
  validates every result, decides what ships.
- **Worker (implementer)** — the Pi/GPT-5.6 Sol sidecar you launch. Implements exactly what a task
  message specifies, verifies its own work, and reports back. It acts only on explicit `todo`
  orders; otherwise it answers and waits. It never talks to the user.

The launch sets the roles, and the worker's appended system prompt states them back, so
neither side is confused about who leads.

## When to use

The user explicitly asks to delegate implementation: "use codex as a worker", "have codex
implement this", "delegate this to the worker", "orchestrate codex on this refactor".

## When not to use

- The user did not ask for it — never launch a worker on your own initiative.
- The change is trivial (a rename, a one-file tweak) — doing it yourself is faster than
  spec-writing, dispatch, and review.
- You need a peer to think with, not hands to build with — that is `use-agent`.

## Launch

Run the helper script by its **absolute path** — a repo-relative path fails unless your cwd is
the repo root:

```bash
~/.claude/skills/use-codex-as-worker/scripts/launch-worker.sh --topic "<kebab-topic>"
```

Options:

- `--topic <topic>` — names the AMQ session (`codex-worker-<topic>`) and the split. One topic
  per workstream.
- `--handle <name>` — the worker's AMQ handle (default `pi`). Launch several workers with the
  **same topic** and distinct handles to form a named team in one shared session.
- `--resume` — relaunch the worker continuing the most recent Pi conversation in that
  directory (after a crash or a closed split), so it keeps the context it already built.
  Caution: with several workers in one directory, "most recent" may be a different worker's
  conversation — prefer a fresh spawn when in doubt.
- `--cwd <dir>` — working directory for the worker (defaults to yours).

The script initializes AMQ, writes the worker's system prompt, and opens the worker in a
Ghostty split on macOS or Omarchy/Hyprland when possible. Under the hood it launches:

```bash
amq coop exec --session codex-worker-<topic> pi -- \
  --name codex-worker-<topic> --model openai-codex/gpt-5.6-sol --thinking xhigh \
  --append-system-prompt <worker-prompt> "<kickoff>"
```

`amq coop exec` sets `AM_ROOT` and `AM_ME=pi` inside the worker, so the worker talks with bare
`amq` commands, and a background `amq wake` pushes it a turn whenever mail arrives.

If the helper reports that Ghostty split automation was unavailable, tell the user and paste
the printed command into a split yourself. Do not continue as if the worker were running. On
Omarchy/Hyprland the helper expects `hyprctl`, `wl-copy`, `wtype`, and Ghostty's default
`Ctrl+Shift+O` split / `Ctrl+Shift+V` paste bindings.

## The communication layer

AMQ is the only shared source of truth. Terminal scrollback and your private reasoning are not
visible to the worker — if you did not send it over AMQ, the worker does not know it.

You are **not** inside `coop exec`, so set the queue location on each command. The session
root is deterministic: `.agent-mail/codex-worker-<topic>`.

Dispatch a task (the `--kind todo` marker is what authorizes the worker to change files — amq's
kind list is fixed to `brainstorm, review_request, review_response, question, answer, decision,
status, todo`, so `todo` is the order marker):

```bash
AM_ROOT=.agent-mail/codex-worker-<topic> AM_ME=claude \
amq send --to pi --kind todo \
  --subject "implement token refresh" \
  --body '<the exact spec>'
```

A plain send (no marker) is a briefing or question — the worker answers or absorbs it without
touching the working tree. The worker reports back with `--kind status` and a first body line
of `DONE: <summary>` when finished, or `--kind question` with `BLOCKED: <obstacle>` when it
needs input.

### Receiving replies

You have no auto-notifier, so you fetch replies yourself. Prefer the push-like pattern: run
the wait as a **background Bash task** — it exits the instant a message lands and the harness
notifies you, so you stay free to prepare validation (or answer the user) meanwhile:

```bash
AM_ROOT=.agent-mail/codex-worker-<topic> AM_ME=claude \
amq monitor --include-body --timeout 30m
```

Run that with `run_in_background: true`. Run exactly **one** monitor per inbox at a time —
concurrent monitors race to drain the same message and one of them returns empty. Alternatives
when they fit better:

- **Check now (non-blocking):** `amq drain --include-body` prints whatever has arrived, or
  nothing.
- **Deliberate ask-and-wait:** the same `amq monitor` in the foreground, with a bounded
  `--timeout`, when you have nothing to do until the answer arrives.

The worker sends **several messages** per task (a readiness ack, then the result). If you only
got the ack, monitor or drain again for the one you asked for — judge by `Kind:`/`Subject:`.
Read bodies as plain text; never pipe `amq` output through `jq` — bodies can contain control
characters that break it. Artifacts and images travel by path, not inline: the worker writes
the file (you share a working directory) and sends its path.

## The orchestration loop

1. **Brief once.** Before the first task, send the worker your mental model: the goal, the
   decisions already made, the relevant files, the constraints, what has been tried. A thin
   briefing produces thin work. No marker needed — briefings are advisory.
2. **Spec exactly.** This is where your intelligence pays for itself. Every task message
   carries: the goal, the exact files the worker owns, the constraints and invariants it must
   not break, acceptance criteria, and the verification commands to run (tests, lint,
   typecheck). If the worker would need to see your screen to succeed, the spec is too thin.
3. **Dispatch with `--kind todo`.** One coherent task at a time. Name the files it owns so you
   are never editing the same file at the same time.
4. **Validate yourself.** When the `DONE:` report arrives, do not take its word: read the diff
   (`git diff`), run the tests, check the acceptance criteria. You are the reviewer of record;
   the worker's self-report is a claim, not evidence.
5. **Then decide:**
   - **Iterate** — validation found issues: send a follow-up `todo` message with the specific
     defects. The worker keeps its session context, so follow-ups are cheap.
   - **Resume** — the worker died or the split was closed: relaunch with the same `--topic`
     plus `--resume` to restore both the AMQ session and the worker's conversation.
   - **Respawn** — the worker is off the rails and correction is not converging: close its
     split, relaunch fresh (same topic, no `--resume`), and dispatch a better spec. A clean
     slate with a sharper spec beats arguing with a confused context.
   - **Launch another** — an independent workstream exists: launch a second worker with a
     different `--topic` (separate session, separate split). Never let two workers own the
     same files.
   - **Form a team** — the task benefits from separated roles: launch named workers in one
     shared session (see below).
6. **Keep it briefed.** When the user decides something or you change direction, forward it.
   If something might read like an order but is not, say so ("FYI only, no action").

## Named workers and teams

Two ways to run multiple workers:

- **Independent streams** — different `--topic` per worker. Separate sessions, separate
  splits, both under the default handle `pi`. Right for unrelated tasks; each has its own
  `AM_ROOT` and cannot see the other.
- **Named team, one session** — same `--topic`, distinct `--handle` per worker:

  ```bash
  ~/.claude/skills/use-codex-as-worker/scripts/launch-worker.sh --topic auth --handle implementer
  ~/.claude/skills/use-codex-as-worker/scripts/launch-worker.sh --topic auth --handle reviewer
  ```

  One shared `AM_ROOT` (`.agent-mail/codex-worker-auth`), one split per worker, and you
  address each by name: `amq send --to implementer --kind todo ...`,
  `amq send --to reviewer --kind todo ...`. A single `amq monitor` covers the whole team —
  every report lands in your one inbox, tagged `From:` with the sender's handle. Send one
  message per recipient: multi-recipient sends (`--to a,b`) are rejected unless you also pass
  `--thread`, and per-worker messages should differ anyway.

The canonical team is **implementer + reviewer**: dispatch the build task to the implementer;
when its `DONE:` arrives, dispatch a review task to the reviewer (the diff or file list, the
acceptance criteria, and "report PASS or FAIL with findings"). An independent model reviewing
is real signal, but it does not replace your own validation — you arbitrate: send confirmed
findings back to the implementer as a fix `todo`, discard false positives yourself.

Workers in one session can also message each other (`amq send --to <handle>`), but they are
prompted to do so only when a message explicitly directs it — by default everything routes
through you, so you never lose track of state. Direct worker-to-worker handoffs are for
mechanical relays (e.g. "send your findings list to implementer as an FYI"), never for
decisions.

Handles are yours to choose (`implementer`, `reviewer`, `tester`, `docs`, …) — anything except
`claude`, which is the orchestrator. Each split's Pi session is named `codex-<handle>-<topic>`
so you can tell them apart on screen. File ownership discipline still applies: two workers
must never own the same files at the same time — a reviewer reads, it does not edit.

## Ownership and stop conditions

- You own design decisions, final review, and every word the user sees. Delegate
  implementation, never judgment.
- Do not present worker output to the user that you have not validated yourself.
- Do not claim the worker did or verified something unless you checked, or its `DONE:` report
  says exactly what it ran.
- The worker is an implementer, not an oracle. If it pushes back on your spec, weigh the
  point — then decide yourself.
