# Plannotator integration

The standalone Plannotator binary is pinned in `install/ai-cli.sh`. Pi uses the separately pinned `@plannotator/pi-extension` package in `configs/agents/pi-settings.json`.

The core skills in `skills/` are vendored from [Plannotator v0.24.2](https://github.com/backnotprop/plannotator/tree/v0.24.2/apps/skills/core) at commit `9bf46e11f30755b60c0eb392362fce3eaaa1966c`. `configs/agents/install.sh` links them into Claude Code and Codex only; Pi gets equivalent commands from its extension package.

When updating Plannotator, update the binary pin, Pi package pin, and these vendored skills together.
