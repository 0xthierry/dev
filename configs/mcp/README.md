# Shared MCP services

`catalog.json` is the shared source for Neon, Datadog **US5**, Figma,
REA, Cua Driver, Playwriter, Chrome DevTools, Blender, and Roblox Studio. `./setup.sh <host>`
merges it after agent settings, then runs upstream ai-memory integration. ai-memory
is deliberately not in this catalog: upstream owns its client registrations. To refresh just these
registrations on an already provisioned host:

```bash
bash install/mcp.sh omarchy # or macbook
```

Setup installs locked bridge dependencies and writes configuration. It does
**not** perform OAuth login, call service tools, start a tunnel, or authorize
an account connector. Existing unrelated client settings and servers remain
intact. Changed client files receive numbered, owner-only backups. Writes are
atomic per file; an interrupted multi-client update converges on retry.

## Client matrix

| Service | Pi | Claude Code | Codex CLI/app | Antigravity CLI | Claude Desktop | ChatGPT |
|---|---|---|---|---|---|---|
| Neon | Native HTTP | Native HTTP | Native HTTP | Native HTTP | Opt-in stdio bridge | Authorize remote MCP/app in account |
| Datadog US5 | Native HTTP | Native HTTP | Native HTTP | Native HTTP | Opt-in stdio bridge | Official Datadog app does **not** support US5; custom MCP support must be verified separately |
| Figma | Native HTTP | Existing enabled/installed plugin, otherwise native HTTP | Native HTTP | Native HTTP | Opt-in stdio bridge | Authorize remote MCP/app in account |
| ai-memory (upstream-owned) | Stock extension tools + capture | Session-aware stdio bridge + capture | Upstream stdio bridge + capture | Upstream HTTP or stdio bridge + lifecycle hooks + skills | Session-less stdio bridge | Not configured |
| Cua Driver | Native stdio, both hosts | Native stdio, Omarchy only | Native stdio, Omarchy only | Native stdio, Omarchy only | Not configured | Not configured |
| REA | Native stdio | Native stdio | Native stdio | Native stdio | Native stdio | Not configured |
| Playwriter | Native stdio | Native stdio | Native stdio | Native stdio | Native stdio | Explicit local-server tunnel + account authorization |
| Chrome DevTools | Native stdio | Native stdio | Native stdio | Native stdio | Native stdio | Explicit local-server tunnel + account authorization |
| Blender | Native stdio | Native stdio | Native stdio | Native stdio | Native stdio | Explicit local-server tunnel |
| Roblox Studio | Native stdio | Native stdio | Native stdio | Native stdio | Native stdio | Explicit local-server tunnel |

Both supported hosts (`macbook` and `omarchy`) receive the shared registrations;
Cua is explicitly restricted by `clients_by_host` to four native Omarchy clients
and **Pi only on MacBook**. Existing user entries on excluded clients are not
removed. Browser control needs a browser on the machine running the server; it does not
connect to a desktop elsewhere. Existing unrelated entries are preserved.

The renderer honors `CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `CODEX_HOME`,
and Linux `XDG_CONFIG_HOME`. It uses pinned `tomlkit` rather than `codex mcp add`:
that command can initiate OAuth during setup. Codex CLI and Codex app use the
same `~/.codex/config.toml` registration; account authorization is separate.

[Antigravity CLI (`agy`)](https://antigravity.google/docs/mcp) reads the global
`~/.gemini/config/mcp_config.json`, also used by the Antigravity IDE. Setup
merges the catalog there, not into workspace `.agents/mcp_config.json` files.
Remote entries use `serverUrl` for Streamable HTTP; local entries use absolute
`command` paths and `args`. Existing `disabled` settings, tool restrictions,
and authentication options are preserved only for the same endpoint or exact
launcher and arguments. If a catalog name already has a different, mixed, or
missing transport (even a disabled placeholder), setup stops before any client
writes. Rename the custom entry or reconcile its destination and credentials
explicitly before retrying. Open `/mcp` in agy to reload or
inspect connections when ready; rendering does not start or authenticate agy.
To refresh only this client after provisioning, from the repository root:

```bash
~/.local/share/mcp-services/venv/bin/python configs/mcp/configure-clients.py omarchy --client antigravity
# Use macbook instead of omarchy on the Mac.
```

## Cua Driver: host- and client-scoped computer use

`cua-driver-mcp` is a fixed stdio proxy to the managed daemon. It does not start
an independent runtime when the endpoint is missing, enable browser debugging,
grant permissions, or install anything at tool invocation. Omarchy uses the
native Wayland endpoint; its private X11 endpoint remains separate. macOS uses
the signed app's daemon, with manual owner permissions. Install the runtime with
normal host setup before refreshing registrations.

The `clients_by_host` catalog field prevents accidental Claude Desktop or
non-Pi macOS exposure. A conflicting existing Cua command, endpoint or argument
list fails before writing; matching registrations retain tool restrictions and
disabled state. Scoped refresh supports `--client claude`, `pi`, `codex`, or
`antigravity` so another client's configuration need not be touched.

Read `configs/cua-driver/skill/SKILL.md` for the exact-target and session rules.
Cua is primary for qualified native/browser GUI work in its scoped clients;
Brave and specialist workflows retain verified alternatives until qualified.
No automatic foreground takeover, personal-profile attachment, or recording is
part of registration. `python3 scripts/check-cua-mcp.py` checks the real proxy,
daemon discovery and a read-only guide call, not GUI acceptance.

## Browser automation: Cua scope, Playwriter + Chrome DevTools

The shared installer first provisions the [pinned browser runtime](../browser-automation/README.md),
then registers `playwriter` and `chrome-devtools`. GUI clients use absolute launchers
and a recorded Node executable; nothing downloads at MCP startup.

- **Playwriter is the default outside Cua scope and a verified browser fallback
  within it.** Keep the selected browser/profile and complete workflow; Cua's
  presence does not qualify Brave or replace network-based diagnostic/download
  operations. Install its [browser extension](https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe)
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

## ai-memory ownership and Pi migration

The upstream ai-memory installers own Claude Code, Codex, Antigravity CLI, and
Claude Desktop memory registration. The shared renderer preserves their transport, auth,
approval, and other options unchanged. A fresh renderer run alone emits no
memory registration. Normal host setup runs the renderer first (including Pi's
legacy-entry cleanup), then upstream integration. The standalone
`install/ai-memory.sh` refresh runs upstream integration and then re-merges the
catalog; both orders preserve upstream-owned memory entries.

Antigravity's memory registration is generated by upstream into a private staging
file, then checked and merged by `configs/ai-memory/antigravity-client.py`. A
same-transport existing entry stays intact, including `disabled`, tool
restrictions and authentication; a conflicting destination stops setup rather
than forwarding credentials or resetting restrictions. Upstream chooses HTTP
for inline credentials or its stdio bridge for file-backed credentials. The
upstream Antigravity hook and skill installers still own their content.

Pi uses the **stock** `ai-memory-pi.ts` extension for both custom memory tools
(`memory_search`, `memory_read_page`, and the other upstream `memory_*` names)
and automatic capture/handoff injection. Memory is not a native Pi MCP server.
Other catalog services still use `~/.pi/agent/mcp.json` with deferred exposure;
use `/mcp` for those services and restart Pi or `/reload` after configuration
changes. Existing stored memory is unchanged.

The renderer removes only the previous repo-managed Pi `ai-memory` entry:
- `~/.local/bin/ai-memory` with exactly `mcp-bridge --server-url http://127.0.0.1:49374 --no-session-id`;
- native HTTP at `http://127.0.0.1:49374/mcp`;
- the retired private endpoint `https://ai-memory-cloud.tail4e339.ts.net/mcp`.

A custom same-name entry fails preflight before any client writes. Inspect it
and explicitly remove that native `mcpServers.ai-memory` entry before rerunning
setup, so it cannot duplicate the stock extension's tools. Unrelated Pi servers
(including `ai_memory`, which no longer collides with a catalog name) remain
untouched. Changed files get the owner-only backups described above.

References:
- [Pi MCP documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)
- [ai-memory integrations](https://github.com/akitaonrails/ai-memory/blob/main/docs/mcp-install.md)
- [ai-memory scoping](https://github.com/akitaonrails/ai-memory/blob/main/docs/auto-scope.md)

## Official ai-memory skills

The six official ai-memory 3.5.1 skills live under
`configs/agents/skills/ai-memory-*/SKILL.md`. The existing agent installer links
them into Pi, Claude Code, Codex, and the shared `.agents` skill directory.
They cover retrieval, handoffs, messaging, durable pages, learning/maintenance,
and routing installation. They guide MCP use; they do not replace tools or capture hooks.

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
before client files are changed.
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

Mobbin (`https://api.mobbin.com/mcp`) is registered only for Pi and Codex on both
hosts. To authorize it, run `pi mcp login mobbin` and `codex mcp login mobbin`.
Setup does not copy credentials or change an existing Claude Code registration.

Use Claude Code's `/mcp` authentication flow and Codex's `codex mcp login NAME`.
Claude Desktop launches the pinned `mcp-remote` bridge through
`~/.local/bin/mcp-service NAME`; its first remote connection may open OAuth.
The bridge installs nothing at launch. Its Node executable is recorded during
setup so GUI clients do not depend on an interactive shell's Node PATH.

On both hosts, ai-memory runs locally at `http://127.0.0.1:49374`. Claude Code's
upstream bridge is session-aware; Claude Desktop's bridge is session-less.
Codex uses upstream `ai-memory mcp-bridge` (the same transport as the official
plugin) so GUI launches can read file-backed local auth without shell token
environment variables. Upstream tool approval settings are preserved, not
replaced by this renderer. Pi uses its stock extension tool bridge instead.
CLI, capture hooks, and tools use the same local store and built-in CPU
embeddings. See the [local setup notes](../ai-memory/README.md) for migration,
backups, and validation. Each machine keeps its own memory; there is no cloud
connection or cross-machine synchronization.

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

No tunnel starts during setup. ai-memory is not exposed to ChatGPT by default;
its optional explicit-start tunnel remains available as documented in the tunnel guide.
Claude Desktop's ai-memory integration is MCP-only: it does not capture chat
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
