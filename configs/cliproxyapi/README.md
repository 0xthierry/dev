# Multi-account Codex for Pi and Codex

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) runs locally and translates
OpenAI Responses requests into Codex subscription requests. Each account completes
its own OAuth login; the proxy stores and refreshes those tokens separately. Pi
and Codex receive only a local proxy key, not the upstream OAuth credentials.
This is third-party software, not an OpenAI-supported account-pooling feature;
use only accounts you are authorized to use and comply with provider terms.

## Install and start

Included in `./setup.sh <host>` for all three hosts. To deploy just this integration:

```bash
bash install/cliproxyapi.sh
bash configs/agents/install.sh --yes
```

The second command syncs all repository-managed agent configuration, not just the
proxy. It preserves unrelated Pi providers and Codex MCP entries. Both clients
now default to the proxy; enroll accounts and start the service before using them.

Log in once per **distinct account**, choosing the appropriate account in your browser:

```bash
cliproxy login
cliproxy login
```

The helper uses device OAuth (enable device-code authorization in your ChatGPT
security settings if required). It works on SSH hosts without forwarding a callback
port. Repeating login with the same account refreshes that account, not pool size.
No credentials are imported from Pi/Codex or synchronized across machines.

On macOS, setup automatically enables and starts the LaunchAgent, including startup
at future logins. Stop any manually running `cliproxy serve` before running setup so
it can use port 8317. Repeated setup leaves an already loaded service running.

On Linux, start in a separate terminal with `cliproxy serve`, or activate the installed
service. The macOS commands below are only needed for manual activation:

```bash
# Linux (dev / omarchy)
systemctl --user daemon-reload
systemctl --user enable --now cliproxyapi.service

# macOS
launchctl enable "gui/$(id -u)/dev.cliproxyapi"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.cliproxyapi.plist"
```

Linux installation alone does not activate the service. Linux user-service lifetime
depends on the user's login/linger configuration; setup does not change system-wide linger.
After upgrading/reconfiguring an already running service, restart it explicitly.

## Use

```bash
cliproxy check                  # API authentication + model availability, no inference
cliproxy models                 # discover models exposed by logged-in accounts
pi                             # GPT-6 Astra via pool
pi --model gpt-5.6-sol
codex                          # GPT-6 Astra via pool
codex -m gpt-5.6-sol
```

In an existing Pi session, use `/model` and select provider `cliproxyapi`. Its entries
are merged into `~/.pi/agent/models.json`; the built-in model catalog remains intact.
Both clients read the key from its private file using command-backed authentication;
no environment export or wrapper is required. `cliproxy pi` / `cliproxy codex` still
work as explicit proxy selectors.

To bypass the proxy for a new session:

```bash
pi --provider openai-codex --model gpt-6-astra
codex -c 'model_provider="openai"'
# For noninteractive Codex, put the override after the subcommand:
codex exec -c 'model_provider="openai"' 'your prompt'
```

Existing sessions, project-level Pi settings, and agents
with explicitly pinned `openai-codex` providers do **not** automatically move to the
pool. Select `cliproxyapi` explicitly for those agents when desired.

Pi uses standard `openai-responses` with full conversation history, rather than its
special ChatGPT transport. Consequently the repo's Codex-native compaction and
fast-mode extensions do not apply to this provider; normal Pi compaction remains
available. Codex uses SSE rather than WebSockets to avoid connection-bound response
chaining across accounts. Model access still depends on account entitlements.
The two Pi entries use conservative 272K context / 32K output settings; proxy limits
and actual model limits may differ. Subscription usage has no per-token cost estimate
in these custom entries. Pi maps low/medium/high by default, explicitly enables
xhigh/max, and disables unsupported off/minimal; Pi has no ultra level.

## Routing and security

- New sessions are distributed round-robin; subsequent turns stay on the same account
  for cache reuse. Subagents inherit affinity when the client sends parent metadata.
- Unavailable/rate-limited accounts can fail over to another eligible account, keeping
  cooldowns enabled. There is no automatic fallback to a different model.
- Bootstrap buffering allows some failures inside HTTP 200 streams to fail over before
  output begins. Mid-stream failures and account-bound reasoning history are not
  guaranteed to recover transparently. This is not unlimited quota.
- Listener: `127.0.0.1:8317`; authenticated API and WebSockets, management UI/API,
  plugins and profiling disabled. Never expose the listener publicly.
- Private config/key: `~/.config/cliproxyapi/{config.yaml,api-key}` (0600).
- OAuth state: `~/.local/share/cliproxyapi/auth/` (directory 0700, service/helper umask 077).
  Never commit, paste, or share these files. Local processes running as your user can
  access them, just as they can access your direct CLI credentials.
- Request-body logging, including error-only request capture, is disabled via
  `commercial-mode`. Application diagnostics still exist; treat logs as private.
- Official v7.2.151 binaries are pinned with platform SHA256 hashes in
  `install/cliproxyapi.sh`. Review upstream changes before updating the pin.

## Verify / troubleshoot

```bash
bash tests/cliproxyapi.test.sh
bash tests/cliproxy-helper.test.sh
bash tests/agents-install.test.sh
systemctl --user status cliproxyapi.service  # Linux
cliproxy check
```

`check` does not prove inference or failover works. After adding two accounts, test a
short conversation plus a tool call in **both clients**. Controlled account failover
and reasoning/tool-history replay need live verification; don't deliberately exhaust
accounts to test it. An empty model list means no usable account/model is loaded.
A missing key/service is fixed by the targeted installer/start commands above.

To stop pooling, select direct providers as shown above (or change the repo defaults)
and stop the service:
`systemctl --user disable --now cliproxyapi.service` on Linux, or
`launchctl bootout "gui/$(id -u)/dev.cliproxyapi"` followed by
`launchctl disable "gui/$(id -u)/dev.cliproxyapi"` on macOS. Credentials are retained.

Upstream evidence (v7.2.151): `config.example.yaml`, `cmd/server/main.go`,
`sdk/cliproxy/auth/selector.go`, `internal/api/server_routes.go`,
`internal/runtime/executor/codex_executor_stream.go`, and
`internal/api/middleware/request_logging.go`. Client references:
[Codex configuration](https://developers.openai.com/codex/config-reference/) and
Pi's installed `docs/models.md`.
