# Optional ChatGPT connection for local MCPs

Host setup installs transport support on **macbook and omarchy only**. It does
not configure a ChatGPT connector, create an OpenAI tunnel/key, launch a tunnel,
or enable a public application listener. Blender/Roblox's local integration must
already work through `~/.local/bin/blender-mcp` or
`~/.local/bin/roblox-studio-mcp`. For ai-memory, the shared setup provides
`~/.local/bin/mcp-service ai-memory`; the local memory service must be running.
See the [shared MCP guide](../mcp/README.md) for remote services.

## Browser MCP connections

The same explicit transport supports **Playwriter** and **Chrome DevTools MCP**.
Host setup installs `chatgpt-browser-mcp` as an alias of the fixed-command launcher.
First run `bash install/mcp.sh <host>` to install/register the browser servers,
and install/authorize the Playwriter extension in your intended browser/profile.
On an already provisioned desktop, refresh the alias with
`bash install/creative-mcp-tunnel.sh omarchy` (or `macbook`). Neither command starts a tunnel.

Create **two separate tunnels** if both MCP servers will run concurrently. Follow
the account/key steps below for each, then explicitly start:

```bash
# Terminal 1, with the Playwriter tunnel ID in CONTROL_PLANE_TUNNEL_ID:
chatgpt-browser-mcp playwriter
# Terminal 2, with a different Chrome DevTools tunnel ID:
chatgpt-browser-mcp chrome-devtools
```

In ChatGPT **Plugins → Add custom MCP server** (or the older connector settings),
create one connection for each server, choose **Tunnel**, and select its matching
ID. Review the risk warning and tool access yourself. Confirm tool discovery and
one harmless operation before declaring either connected. Account/workspace
eligibility and authorization cannot be created by writing local client files.

Add the [browser workflow instructions](../browser-automation/client-instructions.md)
to ChatGPT's project/custom instructions and connector descriptions where supported:
Playwriter is primary; Chrome DevTools supplies diagnostics/capability fallback,
with `new_page.background=true` and `select_page.bringToFront=false`. Preserve the
same browser/page and never bypass permission or authentication failures. These
are per-call choices, not server-enforced background defaults. Claude Desktop
needs the same instructions; neither app automatically reads the local agent skills.

Playwriter controls authorized extension tabs in the existing signed-in profile.
Chrome DevTools attaches locally to `127.0.0.1:9222`; verify this is the same browser
before a handover. These servers can read sensitive pages and modify websites.
This tunnel forwards MCP, **not the raw browser debugging port**, and stays off
until you explicitly start it. Do not expose a public unauthenticated MCP endpoint.

OpenAI's [custom MCP guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
documents HTTPS/Tunnel connections. Its [desktop-only plugin submission guide](https://developers.openai.com/plugins/deploy/desktop-only)
describes a different local-stdio packaging route restricted to approved partners;
setup does not assume that eligibility or pretend Codex config registers a ChatGPT plugin.

## Account setup (manual)

1. Open [Platform Tunnels](https://platform.openai.com/settings/organization/tunnels)
   and create/inspect a tunnel in the intended organization/ChatGPT workspace.
   Preserve the full tunnel ID, including its namespace if present.
2. Create a **runtime** key at [Runtime API keys](https://platform.openai.com/settings/organization/api-keys).
   Its principal needs **Tunnels Read + Use** on the target tunnel. Tunnel managers
   need **Read + Manage**; connector operators also need **Read + Use**.
   Do not supply an admin key to the launcher.
3. Supply `CONTROL_PLANE_API_KEY` and `CONTROL_PLANE_TUNNEL_ID` in the launching
   shell's environment. Keep secrets out of the repository, profiles, command
   arguments, shell history, and logs. For example, in Bash:

   ```bash
   read -r -s -p 'Runtime API key: ' CONTROL_PLANE_API_KEY; printf '\n'
   export CONTROL_PLANE_API_KEY
   read -r -p 'Tunnel ID: ' CONTROL_PLANE_TUNNEL_ID
   export CONTROL_PLANE_TUNNEL_ID
   ```

4. Explicitly start **one** foreground connection, selecting only a fixed local
   stdio launcher:

   ```bash
   chatgpt-creative-mcp blender
   # Or, with a different tunnel ID for an independent concurrent connection:
   chatgpt-creative-mcp roblox
   # Or, to expose the local read/write memory service deliberately:
   chatgpt-creative-mcp ai-memory
   ```

   Keep this terminal attached. Stop with Ctrl+C. **Only one active stdio
   tunnel-client instance per tunnel ID is supported**, including across hosts
   and during replacement. Stop the previous instance before reusing its ID.
   Use separate IDs for concurrent Blender, Roblox, and ai-memory connections.

5. For a discoverable health URL, opt in to a private per-run URL file before
   launching (the file contains a loopback URL, not credentials):

   ```bash
   health_url_file="$(mktemp "${TMPDIR:-/tmp}/creative-mcp-health.XXXXXX")"
   CHATGPT_CREATIVE_MCP_HEALTH_URL_FILE="$health_url_file" chatgpt-creative-mcp blender
   # After stopping:
   rm -f "$health_url_file"
   unset CONTROL_PLANE_API_KEY CONTROL_PLANE_TUNNEL_ID
   ```

   While running, another shell can read that file and request `<URL>/healthz`,
   `<URL>/readyz`, and `<URL>/health/mcp`. The listener is always
   `127.0.0.1:0` (loopback, ephemeral). Readiness alone does not prove MCP tool
   discovery: `/health/mcp` can remain `not_observed` until a caller discovers tools.

6. Once healthy/ready, open [ChatGPT connector settings](https://chatgpt.com/#settings/Connectors),
   choose **Connection: Tunnel**, and select/paste the same tunnel ID. Leave the
   foreground process running for discovery and every subsequent tool call.
   If that option/tunnel is unavailable, account/workspace access and permissions
   still need resolution; installation is **not** proof that ChatGPT is configured.
   A missing tunnel can also indicate incorrect workspace scope or propagation
   delay. Confirm discovery and a harmless tool operation before using editing tools.

The connection forwards requests from OpenAI to the selected application's MCP
tools. These tools may modify projects or execute code with your local user
permissions; connect only when you intend to grant that access.

## Reproducible installation and safety

- Installer contract: source `install/creative-mcp-tunnel.sh`, then call
  `apply_creative_mcp_tunnel "$HOST"` (or omit the argument to use `HOST`).
  Only `macbook` and `omarchy` are accepted. Standalone previews:
  `bash install/creative-mcp-tunnel.sh macbook --dry-run` and
  `bash install/creative-mcp-tunnel.sh omarchy --dry-run`.
- macOS uses the official **`openai/tools/tunnel-client` Homebrew formula** from
  the host package layer. The launcher resolves `brew --prefix
  openai/tools/tunnel-client`, including the standard Apple Silicon/Intel
  Homebrew locations when `PATH` is minimal. Do not download a macOS ZIP or
  bypass Gatekeeper. Brew follows the supported formula; runtime preflight
  rejects a client missing required flags rather than silently falling back.
- Linux installs **v0.0.16 runtime-only** ZIPs, without Cloudflared, into
  `~/.local/share/creative-mcp/tunnel-client/v0.0.16-linux-<arch>` and links
  the private `runtime` entrypoint there. Both `amd64` and `arm64` have
  checked-in SHA256 pins. Download/extraction completes in a same-filesystem
  staging directory before publication. Repeated setup compares all installed
  payload bytes against the verified retained ZIP without downloading again.
  Modified/conflicting payloads fail closed and are not overwritten.
- Public launchers are `~/.local/bin/chatgpt-creative-mcp` and its
  `~/.local/bin/chatgpt-browser-mcp` alias. Both accept only the fixed services
  `blender`, `roblox`, `ai-memory`, `playwriter`, and `chrome-devtools`.
  Existing regular command files are backed up; unrelated symlinks are refused.
- The tunnel installer adds no profile/secret file, service, Cloudflare tunnel, public endpoint,
  automatic browser opening, or automatic startup is added. Native
  `--mcp.command` supplies stdio directly. Ambient tunnel/MCP/Harpoon/Cloudflared,
  health, profile, and logging settings are removed from the tunnel environment
  so they cannot add bindings/listeners or raw/disk logs. Ordinary application
  environment and outbound proxy variables remain available.

## Upstream evidence and verification boundary

Validated release: **v0.0.16**, peeled source commit
`5f99daabd4aa4a77049e6d81d54a0d8c18335397`.

- [README at v0.0.16](https://github.com/openai/tunnel-client/blob/v0.0.16/README.md):
  supported Homebrew installation, runtime-only packaging, foreground operation.
- [Onboarding](https://github.com/openai/tunnel-client/blob/v0.0.16/docs/onboarding.md)
  and [configuration](https://github.com/openai/tunnel-client/blob/v0.0.16/docs/configuration.md):
  runtime environment credentials, native stdio, loopback ephemeral health,
  precedence, one active instance per stdio tunnel ID.
- [Connector setup](https://github.com/openai/tunnel-client/blob/v0.0.16/docs/end-user-guide.md#connect-chatgpt):
  Connection: Tunnel and workspace/permission requirements.
- [Official Homebrew formula](https://github.com/openai/homebrew-tools/blob/main/Formula/tunnel-client.rb)
  was inspected at version 0.0.16 (both macOS architectures supplied).
- [Release checksums](https://github.com/openai/tunnel-client/releases/download/v0.0.16/SHA256SUMS.txt):
  `runtime-linux-amd64.zip` SHA256
  `f8f48017e752810c2c6f02065cdc4ca1ad045b91a6d045cbab144b957fdcbdb1`;
  `runtime-linux-arm64.zip` SHA256
  `ec3bc4815e1b9f7a0773b24de45f64841d9aebe170a58b62742e3f1cef4ac088`.
  Actual downloaded archives matched these pins and GitHub's asset digests.
- Actual Linux amd64 `tunnel-client-runtime --version` reported `0.0.16`, the
  release source SHA, and `flavor=runtime`. Its `run --help` confirmed every
  launcher flag. [Profile resolution](https://github.com/openai/tunnel-client/blob/v0.0.16/pkg/runtimeconfig/profile.go)
  loads no file when selectors are unset; no empty YAML file is passed.
  [Command parser](https://github.com/openai/tunnel-client/blob/v0.0.16/pkg/runtimeconfig/config.go)
  handles quoting/backslashes and launches argv without shell evaluation.

Rerun isolated integration coverage with
`python3 tests/creative-mcp-tunnel.test.py`, plus
`bash -n install/creative-mcp-tunnel.sh configs/creative-mcp/chatgpt-creative-mcp`
and `shellcheck -x install/creative-mcp-tunnel.sh configs/creative-mcp/chatgpt-creative-mcp`.
Tests keep shell/filesystem behavior real and replace only the download and
outer tunnel executable. They do not prove live OpenAI authentication, account
eligibility, ChatGPT connector discovery, application connectivity, or actual
macOS execution. No live install/deployment/tunnel was performed during implementation.
