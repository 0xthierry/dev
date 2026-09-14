# Plannotator integration

The standalone Plannotator binary is pinned in `install/ai-cli.sh`. Pi uses the separately pinned `@plannotator/pi-extension` package in `configs/agents/pi-settings.json`.

The core skills in `skills/` are vendored from [Plannotator v0.27.14](https://github.com/backnotprop/plannotator/tree/v0.27.14/apps/skills/core) at commit `421c6af4cde06e8c12e75b3c6a86e6765f469009`. `configs/agents/install.sh` links them into Claude Code and Codex only; Pi gets equivalent commands from its extension package.

When updating Plannotator, update the binary pin, Pi package pin, and these vendored skills together.
