# Upstream

## Sources

`skills/control-browser/SKILL.md` is adapted from the ChatGPT desktop Chrome plugin's `control-chrome` skill, shipped in package 26.901.51231:

- `/usr/lib/chatgpt/resources/plugins/openai-bundled/plugins/chrome/skills/control-chrome/SKILL.md`
- Selected-browser documentation returned by `nodeRepl.write(await browser.documentation())`: user tab discovery/claiming, session naming, and turn-scoped tab cleanup.
- The bundled `scripts/browser-client.mjs`: `browser.user.openTabs()`, `browser.user.claimTab()`, `browser.nameSession()`, and tab handoff/deliverable methods.
- The bundled browser runtime behavior: throwing JavaScript discards buffered images before Pi receives the result.

The upstream skill is a reference, not a second runtime entrypoint. Import the installed absolute `browser-client` path supplied by the `browser_use` tool description; do not copy the Linux reference path into bootstrap code. Pi discovers installations on Linux and macOS.

## Intentional Pi adaptations

- Use `browser_use`, not `mcp__node_repl__js` or code-mode `exec`.
- Remove Codex plugin mentions and unsupported in-app-browser selection. Do not substitute another browser-control surface.
- Support explicit Chrome, Brave, and Edge selectors. Preserve an explicit family as a hard constraint; use `extension` for the user's browser when no family was named.
- Preserve connector-first routing for semantic work, absolute-path bootstrap, and the complete initial `documentation()` read. Remove the local documentation-skip exception.
- Distinguish `browser.user.openTabs()` (the user's existing tabs) from `browser.tabs.list()` (session-controlled tabs). Claim the exact discovered tab object before controlling it. A title is not evidence of active playback.
- Name the session before opening or claiming tabs. Agent-created tabs close at `turn_ended` unless marked as handoff/deliverable for that turn; claimed user tabs are released, not closed.
- Reuse Pi's persistent bindings across normal turns. Bootstrap again after `/reload`, abort, or crash resets them. Generic execution failures do not imply that the extension needs reinstalling.
- Preserve MCP text and image blocks in Pi results. A separate successful screenshot call is needed when subsequent JavaScript could throw and discard upstream image buffers.
- Route normal origin approvals through Pi confirmation. Strict automatic review is unsupported and fails closed; do not bypass or auto-approve it.

These notes describe integration behavior, not additional user preferences. Read the selected browser's current documentation before its first use rather than treating this source summary as the complete API contract.
