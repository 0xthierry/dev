# ai-memory Pi vendor patch

`../ai-memory-pi.ts` is an intentionally single-file vendor integration generated
from **ai-memory 3.1.0** plus `ai-memory-pi-native-mcp.patch`. It is not a new
repository-owned extension framework. Tests remain in `../ai-memory-pi-tests/`.

## Remote clients and local host isolation

A valid `~/.config/ai-memory/client.json` selects the remote 3.1 capture path.
It requires an HTTPS `.ts.net` origin and reads the native machine user key from
`~/.config/ai-memory/api-key`, never `AI_MEMORY_AUTH_TOKEN` from the environment.
Its spool is isolated under `~/.local/share/ai-memory-client/hook-spool`. Missing or
invalid keys/invalid remote configuration fail closed; they do not route locally.

When the marker is absent, `ai-memory-pi-local.ts` retains the exact previous
2.1.0 capture-only code for the unaffected `dev` local-host installation. This is
host isolation, not a compatibility fallback for a configured remote host. Neither
branch registers tools or silently substitutes custom tools for broken native MCP.
The local vendor file is excluded from formatting just like the generated entry.

The replayable 3.1 patch:

- Removes the obsolete MCP tool bridge and startup call.
- Adds only stable explicit-scope guidance to the system prompt.
- Selects the host mode, validates remote configuration/key, and isolates spool.
- Leaves upstream capture policy, event payloads, handoffs, queue draining,
  compaction deduplication, and managed-run behavior intact on the remote path.

Native HTTP tools do not receive a dynamic lifecycle session header. Pass both
`workspace` and `project` on project-scoped native tool calls, explicit scopes or
global for intentional cross-project queries, and `session_id` when supported.
Native Pi MCP authentication is independently configured with the documented
command-derived Authorization header; it reads the same canonical key file.

## Regenerate and verify

Never run `install-hooks --agent pi --apply`: the installed extension directory is
a repository symlink. Generate into a temporary directory and apply the exact
patch without fuzz:

```sh
python3 configs/agents/pi/extensions/vendor/refresh-ai-memory-pi.py --binary /path/to/ai-memory-3.1.0
# Deliberate regeneration after reviewing upstream + patch:
python3 configs/agents/pi/extensions/vendor/refresh-ai-memory-pi.py --binary /path/to/ai-memory-3.1.0 --write
bun run test:pi-extensions ai-memory-pi-tests
bun run test:pi-extensions:e2e ai-memory-pi-tests
```

Do not regenerate the retained dev-only local capture when updating remote
clients. See [`../../../../ai-memory/README.md`](../../../../ai-memory/README.md)
for deployment/client installation details.

Sources:
- [ai-memory 3.1.0 hooks](https://github.com/akitaonrails/ai-memory/blob/v3.1.0/docs/mcp-install.md)
- [ai-memory 3.1.0 static scoping](https://github.com/akitaonrails/ai-memory/blob/v3.1.0/docs/auto-scope.md)
- Pi 1.2.0 installed `docs/mcp.md`: native `mcp.json`, command-derived headers,
  deferred exposure, and project/user configuration precedence.
