# Oracle

Pi extension that registers an `oracle` tool: a separate, state-of-the-art reasoning intelligence the agent can consult for hard problems. The backend is ChatGPT Web (GPT-5.6 Sol Pro) reached through direct HTTP impersonation, but that is an operator-only detail — to the agent it is simply "the Oracle."

## What it registers

| Tool | Purpose |
| --- | --- |
| `oracle` | Consult the Oracle (backed by ChatGPT Web / GPT-5.6 Sol Pro) for state-of-the-art reasoning, debugging, design, and second opinions. |

It does not register slash commands, keyboard shortcuts, flags, or custom UI.

## How the agent sees it

To the agent, the tool is simply **the Oracle**. The agent-facing prompts never mention ChatGPT, GPT-5.6 Sol Pro, accounts, or cookies — the backend is an operator detail configured in `~/.pi/oracle.json` (see below). Keeping the abstraction provider-agnostic means the agent's mental model stays stable even if the backend changes.

## When the agent should consult it

The Oracle is an **exceptional escalation tool**, not a default step in implementation, debugging, code review, refactoring, test-failure investigation, or design. The agent should use it only when the user explicitly requests the Oracle or a second opinion, or after concrete investigation leaves a consequential decision unresolved and a wrong answer would carry substantial security, data-loss, concurrency, or costly long-lived architectural risk. Ordinary uncertainty does not qualify.

Before invoking it, the agent must **do its own reasoning and arrive at a concrete proposed fix or decision**, then ask the Oracle to challenge that position. If repository evidence, tests, documentation, or ordinary engineering judgment are enough to proceed confidently, the agent should proceed without the Oracle.

## How the agent should prompt it

The Oracle is **blind and stateless** — it cannot see the repo, files, terminal, diffs, or the Pi conversation; it knows only what is in the prompt. The tool prompt therefore tells the agent to send a self-contained prompt: the actual code (full functions or files, not summaries), exact errors and stack traces, constraints, versions and environment, what it already tried, **its own proposed solution and reasoning**, the goal and success criteria, and the precise output it wants back (e.g. a critique of its proposed fix). The agent is told never to send secrets, credentials, tokens, or sensitive data.

## Parameters and conversation behavior

The tool accepts only two parameters:

- `prompt` (required) — the self-contained question for the Oracle.
- `context` (optional, default `resume`) — `resume` continues the current Oracle thread in this Pi session branch so the agent can iterate and discuss across turns; `fresh` starts a new, independent Oracle conversation for an unrelated problem.

Browser, profile, model, project, and account details are never passed in the tool call; they come from config. Resumed threads stay within the active Pi session branch and are scoped to the configured project — a thread is only continued when its stored project id matches the current `chatgpt.projectId`, otherwise the Oracle starts fresh.

## Configuration file

Configuration lives at:

```text
~/.pi/oracle.json
```

Example:

```json
{
  "$schema": "./agent/extensions/oracle/oracle.schema.json",
  "chatgpt": {
    "browser": "Chrome",
    "profile": "Default",
    "model": "gpt-5-6-pro",
    "projectId": "g-p-69ab61612c908191a5a197743a08cb71",
    "timeoutMs": 1800000,
    "pollIntervalMs": 3000
  }
}
```

### Config fields

| Field | Default | Used for |
| --- | --- | --- |
| `$schema` | unset | Optional editor schema reference. From `~/.pi/oracle.json`, use `./agent/extensions/oracle/oracle.schema.json`. |
| `chatgpt.browser` | `Chrome` | Local browser whose `chatgpt.com` cookies should be used. Supported: `Brave`, `Chromium`, `Chrome`. |
| `chatgpt.profile` | `Default` | Browser profile signed into `https://chatgpt.com`. |
| `chatgpt.model` | `gpt-5-6-pro` | ChatGPT Web model id used by the Oracle. Legacy `gpt-5-5-pro` and `gpt-5-6-sol-pro` defaults are upgraded automatically. |
| `chatgpt.projectId` | unset | Optional ChatGPT project id. When set, Oracle conversations are created inside this project. |
| `chatgpt.timeoutMs` | `1800000` | Overall timeout for one Oracle request (30 minutes). |
| `chatgpt.pollIntervalMs` | `3000` | Poll interval while waiting for the ChatGPT conversation answer. |

Each answer is accepted only when the polled ChatGPT conversation reports the configured `metadata.model_slug`; a missing or different server-reported model fails the Oracle request instead of silently accepting a fallback.

For Pro turns, the initial HTTP stream can end after handing generation to another transport, and intermediate commentary can itself be marked `finished_successfully`. The extension therefore captures the handoff's `turn_exchange_id` and keeps polling that exact conversation turn until a completed `reasoning_recap` is followed by its final answer on the active branch. Intermediate commentary, previous-turn answers, partial completions, hidden messages, and stream `[DONE]` markers are not treated as completed Oracle answers.

A `429` response while polling is treated as backpressure, not as a failed Oracle turn. The extension honors `Retry-After` when present, otherwise applies bounded exponential backoff, and then continues polling the same conversation and turn until the normal request timeout.

## Requirements

- Sign into `https://chatgpt.com` in the configured local browser profile.
- The configured account/subscription must have access to the configured model.
- The extension uses `impit` for Chrome-impersonated HTTP requests and local browser cookies for authentication.
- No headless browser, CDP session, or `agent-browser` fallback is used.

Cookie values are read locally and used only for ChatGPT Web authentication. They are not printed, stored in tool results, or written to session-visible details.

## Development and validation

From the repository root:

```bash
bun run test:pi-extensions oracle
bun run typecheck:pi-extensions
bun run lint:pi-extensions
bun run test:pi-extensions:e2e oracle
```

The E2E spec sends a real Oracle request through Pi RPC and requires the configured browser profile to be signed into ChatGPT Web.
