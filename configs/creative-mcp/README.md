# Blender and Roblox MCP

Repository-owned desktop setup for **MacBook and Omarchy**, not the `dev` server.

| Client | Connection |
|---|---|
| Pi | Native `blender` and `Roblox_Studio` stdio servers |
| Claude Code | User-level `blender` and `Roblox_Studio` stdio servers |
| Claude Desktop | The same two servers in its native MCP config (macOS and the existing Linux desktop package) |
| Codex CLI / desktop app | The same two servers in the shared Codex `config.toml` |
| ChatGPT | Explicit-start OpenAI Secure MCP Tunnel; account-side plugin creation is required |

ChatGPT does **not** read Codex's local MCP config. OpenAI documents custom MCP
setup on **ChatGPT web**. Do not assume a native ChatGPT desktop client or a Linux
web wrapper supports the same plugin UI. Use the web UI for setup and verification.

## Install

```bash
./setup.sh macbook
# OR, on the Omarchy desktop:
./setup.sh omarchy
```

Add `--dry-run` to inspect the plan without applying it. Setup installs:

- Blender from Homebrew's `blender` cask or Arch's `blender` package.
  Omarchy also declares `python-cattrs` for Blender's extension manager and
  installs CLI/desktop launchers that put system Python before mise/uv on PATH.
- `mcp-for-blender==2.1.9` in a dedicated Python 3.12 environment. The checked-in
  dependency lock has hashes. Startup does not download packages.
- The matching bundled Blender add-on in the installed Blender version's user
  add-ons directory. Setup enables it and disables telemetry when Blender is
  closed, backing up preferences first. If Blender is running, setup defers
  enablement. Existing recognized MCP add-ons receive numbered backups;
  unrelated modules are preserved.
- `~/.local/bin/blender-mcp` and `~/.local/bin/roblox-studio-mcp`.
- The official OpenAI tunnel client: Homebrew's `openai/tools/tunnel-client` on
  macOS; checksum-verified Linux runtime **v0.0.16** on Omarchy.
- `~/.local/bin/chatgpt-creative-mcp`, but **no running tunnel or background service**.

`install-blender-addon.py` is a repo-owned installation helper, not a vendored
Blender add-on. It copies the upstream package's bundled file unchanged. Unlike
the pinned upstream `install-addon` command, it refuses unrelated destination
files and preserves numbered backups instead of reusing one `.bak` file.

Roblox Studio itself was already declared in the setup: native `robloxstudio` on
MacBook and `org.vinegarhq.Vinegar` on Omarchy. Omarchy setup now checks for updates
to installed Sober/Vinegar apps and their runtimes instead of skipping them. Roblox owns and updates its MCP
binary with Studio. The old standalone `studio-rust-mcp-server` is not installed.

The creative installer owns only the `blender` and `Roblox_Studio` client entries.
The final [shared MCP setup](../mcp/README.md) also registers Neon, Datadog US5,
Figma, and ai-memory across the supported clients. It
preserves other servers and client settings. Modified client configs get numbered,
owner-only backups. Run setup with clients closed to avoid concurrent config writes.
The creative installer uses Codex's native `mcp add` for local stdio entries.
The shared catalog uses pinned `tomlkit` for HTTP entries to avoid automatic OAuth
login during setup.
The existing agent installer preserves these MCP tables on later setup runs.

## Enable the applications once

### Blender

1. Open Blender. Setup normally enables **Interface: MCP for Blender** already.
   If setup deferred enablement because Blender was open, enable it in
   **Preferences → Add-ons**.
2. In the 3D viewport press **N** and open **MCP for Blender**.
3. If the server is not running, click **Connect to MCP server**.
4. Keep **Allow Telemetry** off. The repo's MCP launcher also forces telemetry off.

For explicit command-line enablement on Omarchy, close Blender first, then run:

```bash
"$HOME/.local/bin/blender" --background --python-exit-code 1 \
  --python "$PWD/configs/creative-mcp/enable-blender-mcp.py"
```

This backs up existing preferences, enables the installed add-on, disables its
telemetry, and saves preferences. It never saves a scene or startup file. This is
also the helper used by setup when Blender is closed.
Open Blender afterward so the MCP server can run.

The default socket is localhost port **9876**. No external asset-generation API key
is required for local modeling. API-backed generation features remain optional.
The add-on runs Blender Python: only connect trusted clients and save a copy of
important scenes. Do not expose its socket to the network.

After a Blender major/minor upgrade, rerun setup to copy the add-on into the new
version's directory. After an add-on update, restart Blender or re-enable the
add-on so the running code matches the installed file. Use repository setup for
upgrades, not the add-on's upstream Update button. Preferences are not reset.
Upstream currently recommends one active Blender MCP client at a time. Registering
all clients is supported, but do not run competing sessions against one scene.

### Roblox Studio / Vinegar

1. Launch Roblox Studio normally (through Vinegar on Omarchy) and open a place.
2. Open **Assistant → … → Manage MCP Servers**.
3. Turn on **Enable Studio as MCP server**.
4. Restart the AI client. Studio should show a connected-client indicator.

On macOS the launcher runs
`/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP`.
On Omarchy it runs Studio's generated `appdata/Roblox/mcp.bat` inside the Vinegar
Flatpak, using the same Wine build and `prefixes/studio` prefix as Studio. This
avoids hard-coded `versions/version-…` paths and mixing host Wine with Vinegar Wine.
Current Vinegar uses `kombucha/bin/wine`; the packaged `wine64` path is supported
for older releases. Missing Studio state produces instructions rather than
launching an arbitrary cached version.

Do not use Studio's Quick Connect to replace the Omarchy entries with Windows
commands. The repo launcher is the Linux compatibility layer. Vinegar's upstream
MCP launcher work is still an open pull request, not an assumed released feature.

## Verify local clients

Restart Claude Code, Claude Desktop, and Codex after setup. Check their MCP tools
(`claude mcp list`, `codex mcp list`, or the desktop client's MCP settings).
The repo includes a read-only stdio transport check:

```bash
python3 configs/creative-mcp/check-connection.py "$HOME/.local/bin/blender-mcp"
python3 configs/creative-mcp/check-connection.py "$HOME/.local/bin/roblox-studio-mcp"
```

This initializes MCP and lists tools. It **does not prove GUI execution**. In a
client, ask Blender to inspect the current scene, or Roblox to list Studio
instances, before trying edits. For Roblox, pass the intended `studio_id` when
using instance-specific tools. Use a disposable scene/place for write tests.

If Roblox initializes but returns no tools and logs a refused connection, open
Studio and enable its MCP server. Authentication, opening a place, and Studio's
setting are user/application actions; setup does not silently change them.

## Connect ChatGPT

For hidden-prompt credential entry and detailed diagnostics, see
[ChatGPT tunnel setup](chatgpt-setup.md).

This is an explicit opt-in connection to OpenAI. The tunnel uses outbound HTTPS;
there is no public local MCP listener, firewall change, or third-party tunnel.
The local health listener binds only to `127.0.0.1` on an OS-selected port.
The selected app's tool inputs/results travel to OpenAI. These tools can edit
scenes/places and run code: review ChatGPT's requested actions.

1. At [OpenAI Platform → Tunnels](https://platform.openai.com/settings/organization/tunnels),
   provision a tunnel. Account/workspace access and permissions are required.
2. Create a **runtime** API key with **Tunnels Read + Use** for that tunnel.
   Do not use an admin key. Supply it through a local secret manager or a hidden
   terminal prompt, not in this repository or a chat message.
3. Set `CONTROL_PLANE_API_KEY` and `CONTROL_PLANE_TUNNEL_ID` in the terminal
   environment. Open the relevant application and enable its MCP integration.
4. Run one of these commands in the foreground:

   ```bash
   chatgpt-creative-mcp blender
   # Or, with the Roblox tunnel's ID:
   chatgpt-creative-mcp roblox
   ```

   Keep the process running. **Ctrl+C** stops it. To use both apps at the same
   time, create separate tunnel IDs and run separate processes. Never use the
   same tunnel ID for different apps or machines simultaneously.
5. In **ChatGPT web → Plugins → Add custom MCP server**, select **Tunnel**, choose
   the matching tunnel, review the risk warning, create and install the plugin.
   UI labels may vary by account rollout; follow OpenAI's current guide below.
6. Select the plugin in a conversation and verify its tools. Start with a read-only
   scene inspection or Studio-instance listing.

Optional local readiness inspection:

```bash
CHATGPT_CREATIVE_MCP_HEALTH_URL_FILE="$HOME/.cache/blender-mcp-health-url" \
  chatgpt-creative-mcp blender
# In another terminal, read that file and GET <its URL>/readyz.
```

Make the parent directory first if it does not exist. The file contains a local
health URL, not an API key. No credentials or tunnel profiles are written by the
repo wrapper. If your account cannot provision/select a Secure MCP Tunnel,
ChatGPT remains **blocked on account access**; installing the desktop app is not
a substitute. Setup does not claim to create or authorize a ChatGPT plugin.

## Maintenance and verification

```bash
python3 tests/creative-mcp.test.py
bash tests/blender-mcp.test.sh
python3 tests/creative-mcp-tunnel.test.py
bash -n setup.sh install/*.sh install/hosts/*.sh
shellcheck setup.sh install/*.sh install/hosts/*.sh configs/creative-mcp/blender-mcp configs/creative-mcp/roblox-studio-mcp configs/creative-mcp/chatgpt-creative-mcp
./setup.sh dev --dry-run
./setup.sh macbook --dry-run
./setup.sh omarchy --dry-run
```

Fixture tests cover config preservation, repeat runs, invalid-config rejection,
path quoting, and runtime argument construction. The Codex-writer test uses the
real installed Codex CLI; it reports a skip if the CLI is unavailable. Other
external binaries in fixtures are replaced, so tests do not install packages,
change a real scene/place, or establish a ChatGPT connection.

### Sources

- [MCP for Blender](https://github.com/ahujasid/blender-mcp) (third-party, not Blender Foundation)
- [Roblox Studio built-in MCP](https://create.roblox.com/docs/studio/mcp)
- [Vinegar MCP request](https://github.com/vinegarhq/vinegar/issues/853)
- [Vinegar MCP launcher PR](https://github.com/vinegarhq/vinegar/pull/900)
- [OpenAI custom MCP setup](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [OpenAI Secure MCP Tunnel onboarding](https://github.com/openai/tunnel-client/blob/main/docs/onboarding.md)
