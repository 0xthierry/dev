# Shared MCP services

`catalog.json` is the shared source for Neon, Datadog **US5**, Figma,
ai-memory, REA, Playwriter, Chrome DevTools, Blender, and Roblox Studio. `./setup.sh <host>` merges it after
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
| ai-memory | Native HTTP + capture hooks | Native HTTP + capture hooks | Native HTTP + capture hooks | Native ai-memory stdio bridge | Private Tailscale service, not exposed |
| REA | Native stdio | Native stdio | Native stdio | Native stdio | Not configured |
| Playwriter | Native stdio | Native stdio | Native stdio | Native stdio | Explicit local-server tunnel + account authorization |
| Chrome DevTools | Native stdio | Native stdio | Native stdio | Native stdio | Explicit local-server tunnel + account authorization |
| Blender | Native stdio | Native stdio | Native stdio | Native stdio | Explicit local-server tunnel |
| Roblox Studio | Native stdio | Native stdio | Native stdio | Native stdio | Explicit local-server tunnel |

Blender, Roblox Studio, and Claude Desktop registrations are desktop-host-only
(`macbook` and `omarchy`). REA and both browser MCP runtimes are shared across all three hosts; `dev` receives
those three stdio servers plus the four HTTP services. Browser control still needs
a browser on the machine running the server; registration on `dev` does not
connect it to a desktop elsewhere. Existing out-of-host-scope entries are
preserved, not deleted.

The renderer honors `CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `CODEX_HOME`,
and Linux `XDG_CONFIG_HOME`. It uses pinned `tomlkit` rather than `codex mcp add`:
that command can initiate OAuth during setup. Codex CLI and Codex app use the
same `~/.codex/config.toml` registration; account authorization is separate.

## Browser automation: Playwriter + Chrome DevTools

The shared installer first provisions the [pinned browser runtime](../browser-automation/README.md),
then registers `playwriter` and `chrome-devtools`. GUI clients use absolute launchers
and a recorded Node executable; nothing downloads at MCP startup.

- **Playwriter is the default controller.** Install its [browser extension](https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe)
  in the existing browser/profile and enable it on a tab. Existing logins stay in
  that profile. Setup does not silently install/authorize an extension or launch
  a separate browser. Read the shared `playwriter` skill.
- **Chrome DevTools MCP supplies diagnostics and capability fallback.** Its launcher
  attaches to the existing loopback browser at `127.0.0.1:9222`; it never launches
  a fresh profile. Use `new_page` with `background: true` and `select_page` with
  `bringToFront: false`. Verify the same browser/profile and page when handing
  over from Playwriter. Read `chrome-devtools` before use.
- The old diagnostic CLI remains restricted to its diagnostic allowlist. Native
  MCP is a separate surface, not a bypass of that CLI's restrictions. Do not run
  conflicting controllers or captures on one page. Neither tool may bypass a
  permission denial, required approval, or missing authentication.
- Setup no longer installs agent-browser. Its skill/default routing and active
  application dependencies are migrated. Existing binaries, profiles, cookies,
  and session data are not deleted by setup. The separate `create-image` Pi
  extension was removed at the user's request; it is not a browser dependency.

Claude Desktop and ChatGPT do not automatically receive the local skills. Add the
[copyable browser workflow instructions](../browser-automation/client-instructions.md)
to their project/custom instructions. Chrome DevTools' new-tab default is foreground;
background operation requires explicit per-call choices. Its page discovery also
emulates focus for all discovered pages, so selecting one page does not isolate
attention-sensitive website changes.

Fully quit/reopen Claude Desktop and reload/restart CLI clients after rendering.
A server's `tools/list` response proves discovery, not extension connectivity,
website authentication, background behavior, or a completed browser action.

For **ChatGPT**, local registrations are insufficient. The documented custom-MCP
connection uses HTTPS or a Secure MCP Tunnel. Desktop-host setup also provides
`chatgpt-browser-mcp playwriter` and `chatgpt-browser-mcp chrome-devtools`; each
requires a separately authorized tunnel ID/runtime key. See the
[browser connector steps](../creative-mcp/chatgpt-setup.md#browser-mcp-connections).
Until that account step and live discovery succeed, ChatGPT is **prepared, not connected**.

## REA runtime and registration

REA 6.7.0 uses native stdio through the absolute `~/.local/bin/rea-mcp`
launcher, with no arguments. To install only its pinned runtime and prerequisites:

```bash
bash install/rea.sh <host> [--dry-run]
```

This runtime installer does not register clients or invoke upstream `rea setup`.
Run `bash install/mcp.sh <host>` separately for shared client registration;
`./setup.sh <host>` performs both steps. REA is not configured for ChatGPT.
See [REA runtime details](../rea/README.md).

## Pi: native ai-memory tools with automatic capture

Pi 1.2 supports `~/.pi/agent/mcp.json`. All in-scope services use that native
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

On macbook/omarchy, ai-memory uses the private HTTPS Tailscale endpoint with a
per-machine native user API key. CLI, capture hooks, native MCP, and Desktop are
configured together; no localhost fallback or embeddings run. See the
[remote client deployment notes](../ai-memory/README.md) for credential locations,
targeted setup, rotation, and validation. The `dev` host retains its old local
`http://127.0.0.1:49374/mcp` configuration and receives no remote credentials.

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
chatgpt-creative-mcp blender
chatgpt-creative-mcp roblox
# Browser servers use separate tunnel IDs for concurrent connections:
chatgpt-browser-mcp playwriter
chatgpt-browser-mcp chrome-devtools
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
python3 tests/browser-automation.test.py
# After deployment, connects only the two browser MCPs and lists tools:
node scripts/check-browser-mcp.mjs
python3 tests/creative-mcp-tunnel.test.py
```

Configuration tests use temporary homes and never log in. Successful
registration is not proof of OAuth authorization or application connectivity.
