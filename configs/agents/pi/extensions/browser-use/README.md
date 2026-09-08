# Browser Use

Pi extension for the user's connected Chrome, Brave, or Edge browser. It uses the ChatGPT/Codex desktop sidecar (`node_repl`, bundled plugins, native messaging host). It is not `agent-browser`, a separate Playwright browser, the Electron in-app browser, or OS Computer Use.

## Requirements and platforms

- ChatGPT/Codex desktop with `cua_node`, its bundled Codex CLI, and browser plugin scripts.
- A ChatGPT OAuth login available to that bundled Codex CLI.
- The ChatGPT browser extension connected in a Chromium-family browser.

Default runtime discovery:

| Platform | Resource directories |
| --- | --- |
| Linux | `/usr/lib/chatgpt/resources` |
| macOS | `/Applications/{ChatGPT,Codex}.app/Contents/Resources`, then `~/Applications/{ChatGPT,Codex}.app/Contents/Resources` |

Set `PI_BROWSER_USE_RESOURCES_ROOT` to the desktop **Resources directory** for a nonstandard installation. An explicit override does not fall back to another installation. Linux live browser discovery is verified on the development host. macOS path discovery and paths containing spaces have tests, but live macOS operation still needs verification on a Mac. Windows has no default discovery.

## Usage

- **Disabled by default.** `browser_use` stays registered and visible while off, but rejects execution without starting a runtime.
- `/browser-use on` enables execution for the current session. It does not connect to the browser or change permissions by itself.
- `/browser-use off` disables execution and closes the runtime. JavaScript bindings are cleared; the tool is not removed.
- `/browser-use status` reports the switch state. `/browser-use-status` reports that state plus runtime file availability, not authentication or a live browser connection.
- `browser_use` runs JavaScript in a session-scoped kernel when enabled. Follow the bundled `control-browser` skill.
- Run `/reload` after updating this extension. Reload and new sessions start disabled again. Enable explicitly and bootstrap again before browser work.

Top-level JavaScript bindings persist across agent turns. At `agent_settled`, the extension sends `turn_ended` instead of killing the kernel. The first-party library closes unmarked temporary tabs at turn end; use its documented handoff/deliverable marks when appropriate. Session shutdown/reload closes the kernel.

Calls are serialized. Aborts, transport failures, and known inner-VM resets invalidate bindings. A later explicit call can start a replacement kernel. Failed code is **never automatically replayed**, because a page action may already have occurred.

## Browser permissions and authentication

The browser-only `codex-browser-cli.sh` launcher selects `model_provider="openai"` for the sidecar's Codex subprocess. This lets the sidecar obtain the existing ChatGPT OAuth login even when ordinary Codex uses a custom model proxy. It does not rewrite Codex configuration or change Pi's model provider. The extension does not copy or log tokens.

Browser permission requests are routed through MCP elicitation to Pi's confirmation UI. The user decides; there is no automatic approval or persistent-permission setting. Without an interactive UI, requests are canceled. URL-mode elicitation, nonempty data-entry forms, and mandatory automated-review requests are unsupported and fail closed. Pi user confirmation is not represented as an automated safety review.

Trust includes the selected client/service script directories and their canonical locations, plus the desktop-equivalent Codex home and module directories. It does not add the entire desktop resources tree to the trusted paths.

The kernel runs with `--disable-sandbox` and `danger-full-access` metadata, matching the desktop sidecar setup. It accesses the real browser profile. Browser security checks and permission decisions remain active.

## Results

Text and image content are preserved in order, including error results when the upstream kernel supplies them. Combined text is limited to Pi's 50 KiB / 2000-line defaults with a truncation notice. Pi's `tool_result` hook marks errors without discarding image content.

The installed upstream kernel discards buffered output when JavaScript throws. Take a diagnostic screenshot in a separate successful tool call before an operation expected to throw; the adapter cannot recover output the kernel never sends.

## Verification

```bash
bun run test:pi-extensions browser-use
bun run test:pi-extensions:e2e browser-use
bun run lint:pi-extensions
bun run typecheck:pi-extensions
shellcheck configs/agents/pi/extensions/browser-use/lib/codex-browser-cli.sh
```

Unit tests cover protocol messages, failures, cancellation, turn cleanup, recovery, permissions, image/error results, truncation, and platform paths. Specs exercise the actual registered tool through Pi with a deterministic local model, the installed kernel, and the connected browser. They do not call a paid model.

`dogfood.spec.ts` serves a generated loopback page and exercises navigation, input, screenshots, cross-turn tab handles, errors, and cleanup. Run it in a terminal: it forwards Pi's permission prompt and asks the human to type `yes`. In an unattended run it does not grant permission. Unavailable security review or unapproved access is a real verification failure, not a skipped test. It never changes existing user tabs. Screenshots go to a printed temporary directory, never into Git.

## Reference

The integration follows [the first-party browser investigation](https://github.com/meistrari/background-coding-agent/blob/172e487db2576558fa99043a4d8d0dba59069d64/docs/investigations/codex-first-party-browser-use.md), not a Codex CLI browser feature flag. The `control-browser` skill is adapted from the bundled `control-chrome` instructions; see `UPSTREAM.md`.
