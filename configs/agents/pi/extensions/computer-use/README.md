# Computer Use

Pi extension with a macOS-only control tool based on
[`codex-computer-use-mcp`](https://github.com/tmustier/codex-computer-use-mcp) **v0.5.0** at commit
[`e90efa7`](https://github.com/tmustier/codex-computer-use-mcp/commit/e90efa7bf83cd7a2a8b821c568bf20da4c894c12).
It exposes OpenAI's signed Computer Use surface directly to Pi without a nested model.

The implementation is editable, repo-owned TypeScript. Upstream modules were reorganized under `lib/broker/` and
`lib/code/`; the Pi integration was split into focused registration, content, elicitation, and tool-input modules.
These files are adapted rather than copied unchanged.

## Usage

- `/computer-use-status` shows broker and component availability on macOS, or explains that Computer Use is unavailable
  on the current platform. The command accepts no arguments, so it has no argument completions.
- `computer_use` runs composable JavaScript against the official Computer Use methods on macOS.

## Requirements

- macOS with an unlocked user session
- Node.js 25 (Pi's current runtime; the source-only worker relies on Node's TypeScript execution support)
- the official `/Applications/ChatGPT.app`
- ChatGPT's signed Computer Use component in either the current
  `~/.codex/computer-use/Codex Computer Use.app` layout or the reviewed legacy ChatGPT plugin layout

The shared extension bundle registers `/computer-use-status` on every platform, but exposes `computer_use` only on macOS.

## Security warning

This extension intentionally uses the official broker's Full Access / `danger-full-access` mode with approval policy
`never`. It adds **no wrapper approval prompts, app allowlist, intent allowlist, or action gate**. The calling model can
interact with any application available to the logged-in macOS user. Review the upstream security model before use.

The adapted runtime preserves upstream v0.5.0's security-sensitive behavior:

- fixed reviewed ChatGPT Codex and Computer Use client layouts;
- strict code-signature verification for OpenAI Team ID `2DC432GLL2`;
- an isolated temporary, credential-free app-server `HOME` and `CODEX_HOME`;
- disabled model transport, plugins, remote control, web search, history, memories, hooks, and telemetry;
- rejection of model-turn activity during direct dispatch;
- bounded code, bridge output, calls, screenshots, and worker execution;
- retained-session cleanup and fail-closed process-tree cleanup;
- private metadata-only audit logs with target hashing and symlink rejection.

The only security-adjacent source adaptation is the worker URL: `ComputerUseCodeExecutor` starts the colocated editable
`lib/code/code-worker.ts` directly instead of looking for a generated `dist/code-worker.js`. No generated worker or
compiled vendor tree is required.

## Attribution and license

Upstream source: <https://github.com/tmustier/codex-computer-use-mcp>

- Upstream version: `0.5.0`
- Upstream commit: `e90efa7bf83cd7a2a8b821c568bf20da4c894c12`
- License: MIT; see [`LICENSE`](./LICENSE)
- Detailed source mapping and local deviations: [`UPSTREAM.md`](./UPSTREAM.md)

## Updating from upstream

1. Fetch and check out the intended signed/reviewed upstream release.
2. Review its `SECURITY.md`, release diff, fixed binary paths, signing Team ID, app-server arguments, cleanup, audit,
   worker isolation, and bounds before copying code.
3. Copy the Pi runtime closure (`audit`, `tools`, `direct-broker`, `direct-service`, `session-executor`, `code-executor`,
   `code-worker`, and `version`) into the corresponding `lib/broker/` and `lib/code/` boundaries.
4. Reapply and review the local adaptations: imports, static upstream version, colocated `.ts` worker URL, and the split
   Pi registration/content/elicitation/tool modules. Do not overwrite these with a compiled package or `dist/` tree.
5. Update this file and `LICENSE`, then run the targeted unit, Pi RPC E2E, lint, and typecheck commands.
