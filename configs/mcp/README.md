# Shared MCP services

`catalog.json` is the shared source for Neon, Datadog **US5**, Figma,
ai-memory, Blender, and Roblox Studio. `./setup.sh <host>` merges it after
agent settings and ai-memory hooks have been installed. To refresh just these
registrations on an already provisioned host:

```bash
bash install/mcp.sh omarchy # or macbook / dev
```

Setup installs locked bridge dependencies and writes configuration. It does
**not** perform OAuth login, call service tools, start a tunnel, or authorize
an account connector. Existing unrelated client settings and servers remain
intact. Changed client files receive numbered, owner-only backups. Writes are
atomic per file; an interrupted multi-client update converges on retry.

## Client matrix

| Service | Pi | Claude Code | Codex CLI/app | Claude Desktop | ChatGPT |
|---|---|---|---|---|---|
| Neon | Native HTTP | Native HTTP | Native HTTP | Opt-in stdio bridge | Authorize remote MCP/app in account |
| Datadog US5 | Native HTTP | Native HTTP | Native HTTP | Opt-in stdio bridge | Official Datadog app does **not** support US5; custom MCP support must be verified separately |
| Figma | Native HTTP | Existing enabled/installed plugin, otherwise native HTTP | Native HTTP | Opt-in stdio bridge | Authorize remote MCP/app in account |
| ai-memory | Native HTTP + capture hooks | Native HTTP + capture hooks | Native HTTP + capture hooks | Pinned stdio bridge | Explicit local-server tunnel |
| Blender | Native stdio | Native stdio | Native stdio | Native stdio | Explicit local-server tunnel |
| Roblox Studio | Native stdio | Native stdio | Native stdio | Native stdio | Explicit local-server tunnel |

Blender, Roblox Studio, and Claude Desktop registrations are desktop-host-only
(`macbook` and `omarchy`). `dev` receives the four HTTP services. Existing
out-of-host-scope entries are preserved, not deleted.

The renderer honors `CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `CODEX_HOME`,
and Linux `XDG_CONFIG_HOME`. It uses pinned `tomlkit` rather than `codex mcp add`:
that command can initiate OAuth during setup. Codex CLI and Codex app use the
same `~/.codex/config.toml` registration; account authorization is separate.

## Pi: native ai-memory tools with automatic capture

Pi 1.2 supports `~/.pi/agent/mcp.json`. All six in-scope services use that native
MCP implementation, with deferred tool exposure. In Pi, use `/mcp`; restart Pi
or `/reload` after changing the extension/configuration.

Pi's native MCP server owns all memory tools. The repository-managed
`ai-memory-pi.ts` extension supplies only automatic session capture, capture
exclusions, offline buffering, and startup handoff injection. Its old custom
tool bridge is removed; there are no duplicate tools or legacy fallback.
The vendor patch and tests keep this separation reproducible. Existing stored
memory is unchanged.

Static HTTP does not carry the old bridge's lifecycle actor-session header.
Pass both `workspace` and `project` on project-scoped memory calls; do not rely
on a shared implicit current-project slot across concurrent sessions. This is
the upstream documented static-client pattern.

References:
- [Pi MCP documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)
- [ai-memory MCP vs hooks](https://github.com/akitaonrails/ai-memory/blob/main/docs/mcp-install.md)
- [ai-memory static-client scoping](https://github.com/akitaonrails/ai-memory/blob/main/docs/auto-scope.md)

The ai-memory Pi subsection still claims Pi has no native MCP configuration.
That claim is stale for installed Pi 1.2; its MCP-vs-hooks distinction remains
applicable.

## Official ai-memory skills

The five official ai-memory 2.1.0 skills live under
`configs/agents/skills/ai-memory-*/SKILL.md`. The existing agent installer links
them into Pi, Claude Code, Codex, and the shared `.agents` skill directory.
They cover retrieval, handoffs, durable pages, learning/maintenance, and routing
installation. They guide MCP use; they do not replace tools or capture hooks.

Refresh the checked-in copies with the pinned binary, then review the diff:

```bash
ai-memory install-skills --target-dir "$PWD/configs/agents/skills"
```

No custom copies or client-specific rewrites are needed.

## Claude Desktop: remote services are opt-in

Neon, Datadog, and Figma are **off by default in Claude Desktop**. Their
`mcp-remote` bridges can open OAuth browser tabs when Desktop starts them,
even if you have not chosen to authorize the services. Setup removes existing
repo-managed registrations for these three services unless explicitly opted in.
Pi, Claude Code, Codex, and the other Desktop MCP services are unchanged.
Same-name custom Desktop commands are preserved with a warning; inspect those
separately if they still open login pages. Changed files receive the backups
described above. No credentials or provider authorizations are deleted.

The optional local preference file is
`$XDG_CONFIG_HOME/mcp-services/preferences.json`, or
`~/.config/mcp-services/preferences.json` when `XDG_CONFIG_HOME` is unset
(including on macOS). To opt in, list only the services you want:

```json
{
  "claude_desktop_remote_services": ["neon", "datadog", "figma"]
}
```

An absent file/key or an empty list leaves all three off. This file is a local
user preference, not a generated client configuration; setup reads but does not
write it. Unknown service names or malformed preferences stop configuration
before client files are changed. The `dev` host ignores Desktop preferences.
Run `bash install/mcp.sh macbook` (or `omarchy`) after changing the preference,
then fully quit and reopen Claude Desktop. Opting in permits the bridge to
request authorization; it does not authorize an account during setup.

## Authorization

For Pi, explicitly sign in when ready:

```bash
pi mcp login neon
pi mcp login datadog
pi mcp login figma
```

Use Claude Code's `/mcp` authentication flow and Codex's `codex mcp login NAME`.
Claude Desktop launches the pinned `mcp-remote` bridge through
`~/.local/bin/mcp-service NAME`; its first remote connection may open OAuth.
The bridge installs nothing at launch. Its Node executable is recorded during
setup so GUI clients do not depend on an interactive shell's Node PATH.

Local ai-memory uses `http://127.0.0.1:49374/mcp`. If bearer authentication is
enabled, configure a supported local token reference for each native client;
do not commit tokens. Existing native auth options survive catalog refresh.
The desktop bridge currently assumes the repository's unauthenticated loopback
service; it does not read or export ai-memory token files.

## ChatGPT

ChatGPT Desktop does not read local Pi/Codex/Claude configuration. Setup never
registers or authorizes its account apps, so Neon, Datadog, and Figma remain
opt-in there without a local configuration change. Existing account connections
cannot be disconnected by this installer.

To stop using an existing connection, open ChatGPT **Settings → Apps** (or
**Plugins**, depending on the interface), select Neon, Datadog, or Figma, and
choose **Disconnect** under **Connection** or the connected account's **•••**
menu. Repeat for each connected account if present. Leave unconnected apps
unconnected; do not select Connect/Reconnect just to clear a prompt. This is
account-wide, not a Desktop-only preference, and does not delete existing chats.
See [OpenAI's account connection controls](https://help.openai.com/en/articles/20001494-connecting-and-managing-app-accounts-in-chatgpt).

Add/authorize remote services in the account separately when wanted. The catalog
records these endpoints:

- Neon: `https://mcp.neon.tech/mcp`
- Figma: `https://mcp.figma.com/mcp`
- Datadog US5: `https://mcp.us5.datadoghq.com/v1/mcp`

Datadog's official ChatGPT app is documented for **US1 only**, not US5. Do not
substitute the US1 endpoint or claim the official app works for this account.
A custom MCP connection to US5 is a separate, unverified account-side option.
See [Datadog setup](https://docs.datadoghq.com/bits_ai/mcp_server/setup/).

For local services, follow [the tunnel setup](../creative-mcp/chatgpt-setup.md),
then explicitly run one foreground tunnel per authorized tunnel ID:

```bash
chatgpt-creative-mcp ai-memory
chatgpt-creative-mcp blender
chatgpt-creative-mcp roblox
```

No tunnel starts during setup. ai-memory is a read/write memory service, so
only authorize this connector for an account that should access that memory.
ChatGPT and Claude Desktop are MCP-only clients: they do not capture chat
lifecycles automatically. Use explicit workspace/project arguments and save
handoffs deliberately.

## Tests

```bash
~/.local/share/mcp-services/venv/bin/python tests/mcp-clients.test.py
python3 tests/mcp-runtime.test.py
python3 tests/creative-mcp-tunnel.test.py
```

Configuration tests use temporary homes and never log in. Successful
registration is not proof of OAuth authorization or application connectivity.
