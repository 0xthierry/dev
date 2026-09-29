# Multi-account Codex and Claude pools

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) runs locally and translates
OpenAI Responses requests into Codex subscription requests. Each account completes
its own OAuth login; the proxy stores and refreshes those tokens separately. Pi
receives only a local proxy key, not the upstream OAuth credentials. Codex CLI stays
on its direct built-in OpenAI provider.
This is third-party software, not an OpenAI-supported account-pooling feature;
use only accounts you are authorized to use and comply with provider terms.

## Install and start

Included in `./setup.sh <host>` for all three hosts. To deploy just this integration:

```bash
bash install/cliproxyapi.sh
bash configs/agents/install.sh --yes
```

The proxy installer requires Go, Git, and the platform C compiler (`cc`). It builds
CLIProxyAPI from checksum-verified v7.3.12 source with the repo-owned catalog-cache
patch, and builds the model registrar plugin. Both builds use Go 1.26.0 via
`GOTOOLCHAIN` (Go downloads that toolchain if absent). The second command syncs all
repository-managed agent configuration, not just the proxy. It preserves unrelated Pi providers and
Codex MCP entries. Pi defaults to the proxy, while Codex remains direct; enroll
accounts and start the service before using Pi through the pool.

Log in once per **distinct account**, choosing the appropriate account in your browser:

```bash
cliproxy login
cliproxy login
```

The helper uses device OAuth (enable device-code authorization in your ChatGPT
security settings if required). It works on SSH hosts without forwarding a callback
port. Repeating login with the same account refreshes that account, not pool size.
After a successful login, the helper restarts an active repository-managed service so
the plugin refreshes per-account model availability. No credentials are imported from
Pi or Codex CLI, or synchronized across machines.

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
cliproxy usage                  # live quota usage for all local Codex/Claude accounts
cliproxy usage --json           # normalized report for scripts (no tokens)
pi                             # GPT-6.1 Sol high via pool
pi --provider cliproxyapi --model gpt-6.1-sol
codex                          # Direct built-in OpenAI provider
```

In an existing Pi session, use `/model` and select provider `cliproxyapi`. Its entries
are merged into `~/.pi/agent/models.json`; the built-in model catalog remains intact.
Pi reads the key from its private file using command-backed authentication; no
environment export or wrapper is required. `cliproxy pi` remains an explicit proxy
selector. The helper intentionally has no Codex client command.

To bypass the proxy for a new Pi session:

```bash
pi --provider openai-codex --model gpt-6-astra
```

Codex is repository-configured with `model_provider = "openai"` and uses its normal
direct authentication. Existing Pi sessions, project-level Pi settings, and agents
with explicitly pinned `openai-codex` providers do **not** automatically move to the
pool. Select `cliproxyapi` explicitly for those Pi agents when desired.

Pi uses standard `openai-responses` with full conversation history, rather than its
special ChatGPT transport. Consequently the repo's Codex-native compaction extension
does not apply to this provider; normal Pi compaction remains available. The
repo-managed Fast Mode extension explicitly opts eligible proxy-backed Luna payloads
into `service_tier: "priority"`. Pi uses SSE rather than WebSockets to avoid
connection-bound response chaining across accounts. Model access still depends on
account entitlements.
The repo-managed Pi catalog maps these nine Codex chat models:

- `cliproxyapi/gpt-5.3-codex-spark`
- `cliproxyapi/gpt-5.5`
- `cliproxyapi/gpt-5.6-luna`
- `cliproxyapi/gpt-5.6-sol`
- `cliproxyapi/gpt-5.6-terra`
- `cliproxyapi/gpt-6-astra`
- `cliproxyapi/gpt-6-luna`
- `cliproxyapi/gpt-6.1-sol`
- `cliproxyapi/gpt-daybreak-blue-latest`

This is a pinned mapping in `configs/agents/pi/cliproxyapi-models.json`, not automatic
model discovery. Recheck the full Codex catalog when updating Pi. Spark is text-only
with 128K context; the others accept images and use 272K context. All retain the
proxy's conservative 32K output cap. Proxy limits and actual model limits may differ.
Reasoning mappings retain the proxy's disabled off/minimal settings and expose the
extended levels Pi supports. Subscription usage has no per-token cost estimate in
these custom entries.

A Pi mapping does not grant upstream access. CLIProxyAPI's upstream static catalogs
currently omit the three newest IDs. The repo-owned `codex-current-models` plugin
checks each account's live Codex model catalog, registers the union of supported IDs,
and keeps partially rolled-out models on eligible accounts. It uses the real model
IDs without aliases or substitution. Live verification returned successful responses
from all three models; repeated Daybreak requests stayed on the one account that
currently advertises it. Image-generation and internal review IDs advertised by the
proxy are not general Codex chat models and are not included.

## Claude Code subscription pool (opt-in)

The same proxy also accepts Claude OAuth accounts. The pinned v7.3.12 binary
supports `--claude-login`; the helper exposes it separately from Codex login:

```bash
cliproxy login-claude
cliproxy login-claude          # Sign in with the OTHER Claude account
cliproxy models               # Confirm Claude models appear
cliproxy claude               # Claude Code through the local Claude account pool
cliproxy claude --model sonnet
```

Choose the intended account in the browser each time. Repeating the same account
refreshes it, rather than adding a second pool member. Browser OAuth uses callback
port 54545 by default. On an SSH host, use `cliproxy login-claude --no-browser`;
if completing the browser callback on your laptop, forward the callback port with
`ssh -L 54545:127.0.0.1:54545 <host>`. Follow the OAuth flow's prompts and never
paste tokens or callback URLs into chat or commit them.

`cliproxy claude` sets `ANTHROPIC_BASE_URL` to `http://127.0.0.1:8317` and reads the
existing private proxy key into `ANTHROPIC_AUTH_TOKEN` for that process only. It
clears inherited API-key, direct OAuth-token, and cloud-provider environment
selectors so they do not route this launch elsewhere. No global shell exports or
Claude settings changes are needed. Existing Claude skills, hooks, and settings
remain available; ordinary `claude` still uses its existing direct authentication.
Custom settings such as API-key helpers and model overrides may require separate
review if the client does not route as expected.

The existing round-robin/session-affinity configuration is shared by both providers;
Claude requests use Claude credentials, while Codex requests use Codex credentials.
The repo-owned Codex model plugin declines Claude scheduling requests. There is no
new Claude model mapping in Pi: this addition targets the Claude Code client.

This is third-party subscription routing, not an Anthropic-supported pooling
feature. Published community reports conflict on compatibility, and Anthropic
restricts subscription OAuth credential use. Review
[Anthropic's authentication rules](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).
An API key is a separate, metered billing path, not use of your subscription pool.
Successful login and model discovery do not establish working inference, policy
compliance, or automatic failover.

After enrolling both accounts, verify a short response with
`cliproxy claude --model sonnet -p 'Reply with OK only'`, then an interactive tool
call. Live inference and account failover require verification with your own
accounts; do not deliberately exhaust quotas to test failover. Use ordinary
`claude` to bypass the pool. Stopping the shared proxy also stops Pi's Codex pool.

## Routing and security

- New sessions are distributed round-robin; subsequent turns stay on the same account
  for cache reuse. Subagents inherit affinity when the client sends parent metadata.
- Unavailable/rate-limited accounts can fail over to another eligible account, keeping
  cooldowns enabled. There is no automatic fallback to a different model.
- Bootstrap buffering allows some failures inside HTTP 200 streams to fail over before
  output begins. Mid-stream failures and account-bound reasoning history are not
  guaranteed to recover transparently. This is not unlimited quota.
- Listener: `127.0.0.1:8317`; authenticated API and WebSockets; management UI/API
  and profiling disabled. The only enabled plugin is the repo-owned model registrar
  and scheduler. It reads existing Codex auth through CLIProxyAPI's host API, checks
  model availability against the Codex endpoint, and has no executor or authentication
  capability. Never expose the listener publicly.
- Private config/key: `~/.config/cliproxyapi/{config.yaml,api-key}` (0600).
- OAuth state: `~/.local/share/cliproxyapi/auth/` (directory 0700, service/helper umask 077).
  Never commit, paste, or share these files. Local processes running as your user can
  access them, just as they can access your direct CLI credentials.
- Request-body logging, including error-only request capture, is disabled via
  `commercial-mode`. Application diagnostics still exist; treat logs as private.
- v7.3.12 source is pinned by full commit and archive SHA256 in
  `install/cliproxyapi.sh`. The catalog-cache patch is repo-owned at
  `configs/cliproxyapi/patches/0001-persist-model-catalog.patch`. The build marker
  includes the source commit, patch digest, platform, and pinned Go toolchain.
  Review upstream changes before updating these pins.

## Durable model catalog and recovery

The patched proxy saves successfully validated remote model definitions to
`~/.local/share/cliproxyapi/models.json`, using private permissions and atomic
replacement. The helper and both service definitions set `CLIPROXYAPI_MODEL_CACHE`
to this path. This file contains model metadata, not account credentials.

On startup, the proxy restores a valid cached catalog before fetching updates.
Missing or corrupt caches fall back to the embedded catalog. Failed downloads
retain the working catalog and retry with capped exponential backoff and jitter,
rather than waiting three hours. Successful refreshes return to the normal
three-hour schedule and update model registrations without restarting the service.

An offline first install still only knows the embedded models until a fetch
succeeds. Cached model registration is not proof of account entitlement, and
inference still requires access to the provider. This patch covers the shared
`models.json` updater; the separate Codex-client and Devin catalogs are unchanged.

## Account quota usage

`cliproxy usage` queries the Codex and Claude usage endpoints for every supported
account in `~/.local/share/cliproxyapi/auth/`. It shows provider-reported percent
**used**, reset times, and Claude extra-usage enablement. Codex window names follow
the durations returned by the provider: a primary window is not necessarily five
hours. Missing windows are not reported as zero usage.

The Bun helper reads existing OAuth access tokens privately, never prints them,
and does not refresh or modify credentials, run inference, restart the service,
or change billing settings. It works with the proxy stopped. Quotas include usage
from other clients on the same accounts; they are not just this proxy's traffic.
The report is not an invoice or a guarantee of model access.

`--json` emits a normalized report without raw provider payloads or credentials.
Account errors remain visible alongside successful results; failed lookups exit
nonzero. If a token has expired, allow the running proxy to refresh it or enroll
that account again with `cliproxy login` / `cliproxy login-claude`. These are
provider-specific subscription endpoints and their formats may change.

Verify the helper with `bun test configs/cliproxyapi/usage.test.ts` and
`bunx --no-install tsc -p configs/cliproxyapi/tsconfig.json`.

## Usage statistics and management

Usage statistics remain enabled, but the management API and UI are disabled
(empty management secret and disabled control panel). Statistics do not
reconstruct past usage or represent total subscription quota remaining across
other clients, and no management dashboard is available while management is disabled.
Previously generated management-key files are retained but unused; fresh installs
do not generate a management key unless the template requests one.

## Verify / troubleshoot

```bash
bash tests/cliproxyapi.test.sh
bash tests/cliproxy-helper.test.sh
bash tests/agents-install.test.sh
bash tests/ai-memory.test.sh
systemctl --user status cliproxyapi.service  # Linux
cliproxy check
```

`check` does not prove inference or failover works. After adding two accounts, test a
short conversation plus a tool call in Pi. Controlled account failover
and reasoning/tool-history replay need live verification; don't deliberately exhaust
accounts to test it. An empty model list means no usable account/model is loaded.
A missing key/service is fixed by the targeted installer/start commands above.

To stop pooling, select Pi's direct provider as shown above (or change the repo default)
and stop the service:
`systemctl --user disable --now cliproxyapi.service` on Linux, or
`launchctl bootout "gui/$(id -u)/dev.cliproxyapi"` followed by
`launchctl disable "gui/$(id -u)/dev.cliproxyapi"` on macOS. Credentials are retained.

Upstream evidence (v7.3.12): `config.example.yaml`, `cmd/server/main.go`,
`sdk/cliproxy/auth/selector.go`, `internal/api/server_routes.go`,
`internal/runtime/executor/codex_executor_stream.go`, and
`internal/api/middleware/request_logging.go`. Client references:
[Codex configuration](https://developers.openai.com/codex/config-reference/) and
Pi's installed `docs/models.md`.
