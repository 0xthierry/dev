# codex-multi-auth

Routes Pi's built-in `openai-codex` models through the account pool managed by [`codex-multi-auth`](https://github.com/ndycode/codex-multi-auth).

When at least one managed account exists, the extension replaces Pi's Codex transport with an authenticated, loopback-only chain:

```text
Pi → ephemeral local bridge → ephemeral rotation proxy → ChatGPT Codex
```

Both local bearer tokens are random and process-local. Both servers bind only to `127.0.0.1`, start on `session_start`, and close on `session_shutdown`. The bridge uses the standard Responses API so Pi's account-bound opaque Codex compaction is not reused across accounts. The repository overrides the upstream Hono dependency to patched version `4.12.34`.

If the account pool is empty, the extension does nothing and Pi keeps its native `openai-codex` provider and login.

## Account setup

Add each personal ChatGPT account once:

```bash
codex-multi-auth login --device-auth
codex-multi-auth login --device-auth
codex-multi-auth list
```

After adding or changing accounts, start a new Pi session or run `/reload`. Existing model names remain unchanged, including `openai-codex/gpt-5.6-sol`. Run `/codex-multi-auth-status` in Pi to confirm whether routing is inactive, ready, or active.

For the official Codex CLI, this setup's shell wrapper routes `codex` through `codex-multi-auth-codex`. Use `codex-multi-auth` for account status, policies, health checks, and manual selection.

## Installation

The repository installer symlinks the complete Pi extension bundle. To install only this extension from a checkout:

```bash
pi install ./configs/agents/pi/extensions/codex-multi-auth
```
