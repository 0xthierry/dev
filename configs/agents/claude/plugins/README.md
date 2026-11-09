# Lua / Luau tooling

Shared setup provisions these tools on `macbook`, `dev`, and `omarchy`:

| Tool | Installation | Use |
| --- | --- | --- |
| `lua-language-server` (LuaLS) | Shared Homebrew/pacman package lists | Standard `.lua` files |
| `luau-lsp` | Pinned, SHA-256-verified upstream release via `install/lua-lsp.sh` | `.luau` files |
| `luacheck` | Shared Homebrew/pacman package lists | Standard Lua linting, not Luau |

Run `./setup.sh <host>` from the repository root on that host. Setup installs
Claude Code before registering its plugins. It installs/enables the official
`lua-lsp@claude-plugins-official` and this repo's `luau-lsp@thierry-local` plugin
at user scope. Existing unrelated plugins are preserved.

To reinstall only the Luau plugin after provisioning the server:

```sh
claude plugin install luau-lsp --marketplace "$PWD/configs/agents/claude/plugins" --scope user
```

The local marketplace loads directly from this repo. Its Luau launcher calls
`~/.local/bin/luau-lsp` explicitly so a Rokit shim earlier on PATH cannot prevent
it from starting outside a Rokit project. No server is downloaded at launch.
Existing project-managed Rokit tools remain untouched.

Restart Claude Code or use `/reload-plugins` after setup. Claude authentication
is separate (`claude auth login` when the session has expired). Luacheck is a
CLI, not an LSP plugin; Claude can run `luacheck path/to/file.lua` through Bash.

Neovim uses the same server installations and Luacheck. See
[`configs/nvim/README.md`](../../../nvim/README.md) for filetype routing and checks.

## Roblox scope

Luau uses the `standard` platform globally. Roblox projects need project-specific
Roblox definitions and usually a Rojo `sourcemap.json` for DataModel completion.
This setup does not reinterpret every `.lua` file as Luau or install a Studio
companion plugin. Luacheck cannot parse Luau type annotations; use Luau LSP's
built-in diagnostics for `.luau` files.

## Verification

From the repository root:

```sh
python3 tests/lua-lsp.test.py
nvim --headless -u NONE -l tests/neovim-lua-lsp.lua
nvim --headless -u NONE -l tests/neovim-lua-lint.lua
claude plugin validate --strict configs/agents/claude/plugins
claude plugin validate --strict configs/agents/claude/plugins/luau-lsp
claude plugin list --json
```

The installer tests use isolated homes and corrupt network fixtures to check
failure safety. They do not claim to execute a Linux binary on macOS. The Neovim
check uses real installed servers and verifies attachment and hover responses.
Claude plugin validation and listing prove registration, not an authenticated
Claude LSP tool request.

Sources:
- [LuaLS](https://luals.github.io/)
- [Luau LSP clients and Roblox configuration](https://github.com/JohnnyMorganz/luau-lsp/blob/main/editors/README.md)
- [Luau LSP releases](https://github.com/JohnnyMorganz/luau-lsp/releases)
- [Claude plugin manifest / LSP configuration](https://code.claude.com/docs/en/plugins/manifest-reference#lspservers)
- [Luacheck](https://github.com/lunarmodules/luacheck)
