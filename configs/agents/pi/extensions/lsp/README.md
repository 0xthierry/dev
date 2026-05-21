# lsp — Pi LSP tools

Repository-owned Pi extension that exposes Language Server Protocol diagnostics and source-code actions to the agent.

Inspired by [`@narumitw/pi-lsp`](https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-lsp). This version keeps the same general tool shape, but defaults are tailored to the LSP servers installed by `configs/agents/bin/install-cr-tools.sh`.

## Tools

- `lsp_diagnostics` — run diagnostics for files/directories through configured LSP servers.
- `lsp_fix` — compute or write source code-action edits for one file.

## Command

```text
/lsp
```

Shows configured server commands, routes, and whether each command is available on `PATH`.

## Default servers

The defaults mirror the CR tool installer script:

| Server | Command | Routes |
|---|---|---|
| `typescript` | `typescript-language-server --stdio` | JS/TS files |
| `json` | `vscode-json-language-server --stdio` | `.json`, `.jsonc` |
| `html` | `vscode-html-language-server --stdio` | `.html`, `.htm` |
| `css` | `vscode-css-language-server --stdio` | `.css`, `.scss`, `.less` |
| `rust` | `rust-analyzer` | `.rs` |
| `go` | `gopls` | `.go` |
| `pyright` | `pyright-langserver --stdio` | `.py`, `.pyi` |
| `bash` | `bash-language-server start` | shell files and common shell rc files |
| `yaml` | `yaml-language-server --stdio` | `.yaml`, `.yml` |
| `taplo` | `taplo lsp stdio` | `.toml` |
| `lua` | `lua-language-server` | `.lua` |
| `clangd` | `clangd` | C/C++ files |
| `tailwindcss` | `tailwindcss-language-server --stdio` | Tailwind-related web files |
| `dockerfile` | `docker-langserver --stdio` | `Dockerfile`, `Containerfile`, `.dockerfile` |
| `marksman` | `marksman server` | `.md`, `.markdown` |

## Configuration

Custom config can be supplied in one of these locations, in precedence order:

1. `PI_LSP_CONFIG` as inline JSON or a path to a JSON file
2. `<workspace>/.pi/lsp.json`
3. `~/.pi/agent/lsp.json`

Plain server map:

```json
{
  "pyright": {
    "command": ["pyright-langserver", "--stdio"],
    "extensions": [".py", ".pyi"]
  },
  "dockerfile": {
    "command": ["docker-langserver", "--stdio"],
    "fileNames": ["Dockerfile", "Containerfile"],
    "extensions": [".dockerfile"]
  }
}
```

Wrapper shape with global timeout:

```json
{
  "timeout": 30000,
  "servers": {
    "typescript": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "initialization": {}
    }
  }
}
```

Each server supports:

- `command`: argv array used to start the language server.
- `extensions`: optional file extensions routed to the server.
- `fileNames`: optional exact basenames routed to the server, useful for `Dockerfile`.
- `env`: extra environment variables for the server process.
- `initialization`: LSP initialization options and workspace configuration values.

Per-server command overrides use the normalized server name:

```bash
PI_PYRIGHT_LSP_COMMAND="uvx pyright-langserver --stdio" pi
PI_TYPESCRIPT_LSP_COMMAND="typescript-language-server --stdio" pi
```

## Install

This extension is included in Thierry's repository-owned Pi extension bundle. For day-to-day use, `configs/agents/install.sh` symlinks `configs/agents/pi/extensions` to `~/.pi/agent/extensions`.

From a local checkout, run only this extension with:

```bash
pi -e configs/agents/pi/extensions/lsp
```
