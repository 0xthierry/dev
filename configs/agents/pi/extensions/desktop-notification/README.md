# Desktop Notification

Pi extension that sends a terminal desktop notification when an agent turn finishes.

## What it does

- Registers an `agent_end` lifecycle handler.
- Extracts the latest assistant text from the messages produced by that turn.
- Converts markdown-ish assistant output to plain text, collapses whitespace, and truncates the body to 200 characters.
- Writes an OSC 777 notification escape sequence to `stdout` when `stdout` is a TTY.

It does not register any LLM tools, slash commands, flags, shortcuts, or custom UI.

## How it works

`index.ts` is the Pi entrypoint and delegates to `lib/register.ts`.

On `agent_end`:

1. `extractLastAssistantText()` scans the turn messages from newest to oldest.
2. `formatNotification()` builds the notification:
   - title `π` with the assistant response as the body when text exists;
   - title `Ready for input` with an empty body when no assistant text exists.
3. `writeOsc777Notification()` writes `ESC ] 777 ; notify ; <title> ; <body> BEL` to the terminal.

The title/body are sanitized before writing: semicolons and control characters are replaced, repeated whitespace is collapsed, and leading/trailing whitespace is removed.

## Requirements

- Pi must load the extension from `desktop-notification/index.ts`.
- `process.stdout.isTTY` must be `true`; otherwise the extension intentionally does nothing.
- The terminal/session must understand OSC 777 notifications. If the terminal ignores OSC 777, Pi still runs normally but no desktop notification is shown.

No external binaries, API keys, browser sessions, or config files are required.

## Configuration

None.

There are currently no environment variables or `settings.json` fields for this extension. To disable it, remove it from the loaded Pi extensions or move the directory out of `~/.pi/agent/extensions`.

## Installation and loading

This repository's agent installer symlinks `configs/agents/pi/extensions` to `~/.pi/agent/extensions`, and Pi auto-discovers directory extensions with an `index.ts` file.

For an ad-hoc run from the repository root:

```bash
pi -e configs/agents/pi/extensions/desktop-notification
```

To install this extension as a Pi package from a local checkout:

```bash
pi install ./configs/agents/pi/extensions/desktop-notification
```

To install the GitHub package that contains this extension:

```bash
pi install git:github.com/0xthierry/dev
# or
pi install https://github.com/0xthierry/dev
```

The GitHub package installs all extensions declared by the repository root. To install only `desktop-notification`, clone the repo and use the local per-extension command above, or install the GitHub package and use `pi config` to disable resources you do not want.

After changing the extension in an interactive Pi session, use `/reload` to reload auto-discovered extensions.

## Behavior notes

- The extension notifies after each completed agent response, not while a response is streaming.
- Only assistant text is used. Tool calls, images, and non-text content are ignored for the notification body.
- Markdown formatting is rendered as plain text before notification formatting.
- The body limit is intentionally small to keep desktop notifications readable.
- In non-TTY modes, redirected output, or CI logs, the OSC sequence is not written.

## Development and validation

From the repository root:

```bash
bun run test:pi-extensions desktop-notification
bun run typecheck:pi-extensions
bun run lint:pi-extensions
```

The E2E spec verifies that Pi emits an OSC 777 notification after a deterministic faux-provider agent turn:

```bash
bun run test:pi-extensions:e2e desktop-notification
```
