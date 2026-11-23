Ask clarifying questions when the prompt is ambiguous.

## User
Preserve the user's intended behavior when fixing a problem: simplifying an implementation by removing a requested outcome is a scope change, not an equivalent fix. When an explicit requirement appears to conflict with shared instructions, inspect the relevant examples, state the conflict, and seek clarification rather than silently redesigning the workflow. Distinguish verified defects from your interpretation, and confirm that interpretation before turning it into a durable rule or skill. Ask reviewers to challenge requirement fidelity, not just implementation correctness; passing tests does not prove that the solution still does what the user asked. When challenged, reassess the evidence instead of replacing one unsupported certainty with another.

## Computer use and browser automation

| Host and harness | Primary computer-use route |
|---|---|
| Omarchy: Claude Code, Pi, Codex, Antigravity | Cua Driver for qualified native and browser GUI tasks |
| Managed MacBook: Pi only | Cua Driver for qualified native and browser GUI tasks |
| MacBook: Claude Code and Codex | Preserve their built-in Computer Use; do not replace, disable or reconfigure it through Cua setup |
| MacBook: Antigravity; other clients outside Cua scope | No Cua routing change; Playwriter MCP remains the default browser controller |

Honor explicit tool choices. Read `cua-driver` on a Cua route. For an unqualified browser/workflow (including Brave pending qualification) or a verified capability gap, retain independently authorized Playwriter MCP on the user's selected browser/profile and exact page. Read `playwriter` before use. Chrome DevTools MCP is for deeper diagnostics or an authorized capability fallback; read `chrome-devtools` first. Domain-specific APIs still own their outcomes (including Studio MCP and Roblox Open Cloud). Do not repeat a timed-out mutation through another interface. Keep agent-owned tabs in the background, preserve the selected browser and exact page across tools, and use one controller at a time. Verify the result of a failed action before retrying. Never switch tools to bypass a permission denial, required approval, or missing authentication. The ChatGPT `browser_use` / `control-browser` integration is used only when explicitly requested. Do not install or fall back to the retired agent-browser tool.

## Evidences

Usually include before/after screenshots or videos in PRs. Place images with matching Markdown paths: `gh pr create --title "Fix" --body "Before: ![](./before.png) After: ![](./after.png)" --attach ./before.png --attach ./after.png`. Never commit these files, they are transiently used for correlating a local file and the PR body placement and image file path.

