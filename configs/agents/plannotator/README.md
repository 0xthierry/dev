# Plannotator integration

The standalone Plannotator binary is pinned to **v0.28.23** in `install/ai-cli.sh`. Its `--minimal` installation installs only the binary; this repo owns the agent hooks and skills. Pi uses the separately pinned `@plannotator/pi-extension@0.28.23` package in `configs/agents/pi-settings.json`.

The core skills in `skills/` are vendored unchanged from [Plannotator v0.28.23](https://github.com/backnotprop/plannotator/tree/v0.28.23/apps/skills/core) at commit `e5c03f9968fb97b69986f13290ccf44f10c2d899`. `configs/agents/install.sh` links them into Claude Code and Codex only; Pi gets equivalent commands from its extension package. The upstream `plannotator` reference skill is model-invocable; the three `plannotator-*` action skills remain user-invoked only.

## Workflows

### Claude Code: manual classic hook

`configs/agents/hooks/claude-hooks.json` supplies a `PermissionRequest` hook matching `ExitPlanMode`, running `plannotator` with a `345600`-second timeout. The installer merges it into Claude settings. Plan mode must remain available in `configs/agents/claude-settings.json`: do not deny `EnterPlanMode` or `ExitPlanMode`.

Enter plan mode and ask Claude to produce a plan. When it calls `ExitPlanMode`, the browser review opens and Claude waits. **Approve** permits implementation; **Send Feedback** denies the plan with annotations so Claude can revise and resubmit. Use feedback rather than approval when annotations need to be incorporated. Restart Claude after changing hooks.

This repo uses the manual hook, **not** the marketplace plugin or its asynchronous Claude mod. The vendored skills provide `/plannotator-review [DIRECTORY | PR_URL]`, `/plannotator-annotate <file | URL | folder>`, and `/plannotator-last`.

### Codex: experimental Stop hook

`configs/agents/codex-config.toml` enables `[features] hooks = true`; `configs/agents/hooks/codex-hooks.json` defines the `Stop` hook. The agent installer renders an absolute binary path in the deployed hook so Codex Desktop does not depend on a shell's `PATH`. Restart Codex Desktop after hook changes.

Plan review opens after Codex finishes rendering a plan turn. Approval leaves the turn completed; feedback returns a Stop continuation reason so Codex revises the plan. This is experimental, post-render review, **not** Claude's `ExitPlanMode` interception. Direct commands remain available: `!plannotator review`, `!plannotator annotate file.md`, and `!plannotator last`.

### Pi: extension commands

Start with `pi --plan`, or toggle plan mode with `/plannotator-plan-mode` or `Ctrl+Alt+P`. The agent writes a plan file and calls `plannotator_submit_plan`. Review opens asynchronously: the tool returns, the agent ends its turn, and approval or feedback arrives later as a message. Approval starts execution; feedback requests revision. Leaving plan mode closes the open review; Esc does not cancel it.

Use `/plannotator-review [DIRECTORY | PR_URL]`, `/plannotator-annotate <file>`, or `/plannotator-last` for other reviews. Restart Pi after updating the pinned package. The optional agent-facing `plannotator` tool is off by default in Pi; these commands and plan mode do not require enabling it.

## Updating and provenance

Update the binary pin, Pi package pin, and vendored skills together through this repo, then apply the host setup. Do not use upstream self-update or full-install commands to bypass these pins or install duplicate integrations.

After deploying a changed Pi pin, materialize that exact package with `pi install npm:@plannotator/pi-extension@0.28.23`, then restart Pi. `pi update` can skip pinned packages even after the settings pin changes; verify the installed package's `package.json` version, not only `pi list` (which lists the declaration).

Fetch the exact release tag and copy `apps/skills/core/`, not the upstream checkout's current branch. Compare the complete vendored tree with the tag before deployment. The upstream installer verifies binary SHA256 sidecars automatically; optional SLSA attestation verification is separate from source-tree equality.

Release-specific references:

- [Claude hook and manual installation](https://github.com/backnotprop/plannotator/blob/v0.28.23/apps/hook/README.md)
- [Codex experimental hooks](https://github.com/backnotprop/plannotator/blob/v0.28.23/apps/codex/README.md)
- [Pi extension commands and behavior](https://github.com/backnotprop/plannotator/blob/v0.28.23/apps/pi-extension/README.md)
- [Installation, version pinning, and binary-only mode](https://github.com/backnotprop/plannotator/blob/v0.28.23/apps/marketing/src/content/docs/getting-started/installation.md)
- [Binary checksum and provenance verification](https://github.com/backnotprop/plannotator/blob/v0.28.23/apps/marketing/src/content/docs/reference/verifying-your-install.md)
