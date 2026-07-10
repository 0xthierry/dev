# Plannotator integration

The standalone Plannotator binary is pinned in `install/ai-cli.sh`. Pi uses the separately pinned `@plannotator/pi-extension` package in `configs/agents/pi-settings.json`.

The core skills in `skills/` are vendored from [Plannotator v0.23.0](https://github.com/backnotprop/plannotator/tree/v0.23.0/apps/skills/core) at commit `69ca6d546cbb790be5fea6fc5ce47da7cd218e9e`. `configs/agents/install.sh` links them into Claude Code and Codex only; Pi gets equivalent commands from its extension package.

When updating Plannotator, update the binary pin, Pi package pin, and these vendored skills together.
