# Official documentation used by this skill

Open the page before relying on a number from it; Open Cloud changes often.

Every docs page also exists as Markdown: add `.md` to the URL, for example https://create.roblox.com/docs/cloud/reference/features/assets.md. The index is https://create.roblox.com/docs/cloud/llms.txt. WebFetch can read these, and so can the Studio MCP `http_get` (Roblox docs URLs only).

## Docs pages
| Topic | URL | Use for |
|---|---|---|
| Open Cloud overview | https://create.roblox.com/docs/cloud | API-key vs legacy endpoints, the features/domains reference |
| API keys | https://create.roblox.com/docs/cloud/auth/api-keys | Creating keys, Restrict by Experience, IP, expiry, statuses, introspect |
| OAuth 2.0 | https://create.roblox.com/docs/cloud/auth/oauth2-overview | Third-party apps (not used here) |
| Patterns | https://create.roblox.com/docs/cloud/reference/patterns | Paths, pagination, long-running operations, filters |
| Errors | https://create.roblox.com/docs/cloud/reference/errors | Gateway vs v2 error formats, codes |
| Rate limits | https://create.roblox.com/docs/cloud/reference/rate-limits | Per-owner limits, headers, 429 handling |
| Scopes | https://create.roblox.com/docs/cloud/reference/scopes | Every scope and its endpoints |
| OpenAPI document | https://create.roblox.com/docs/cloud/reference/openapi | `openapi.json` (source of `endpoint-catalog.md`) |
| Assets guide | https://create.roblox.com/docs/cloud/guides/usage-assets | Types, limits, create, update, operations |
| Place publishing | https://create.roblox.com/docs/cloud/guides/usage-place-publishing | Publish `.rbxl`/`.rbxlx`; classes it doesn't update |
| Engine instances | https://create.roblox.com/docs/cloud/guides/instance | Instance API restrictions and polling |
| Luau Execution | https://create.roblox.com/docs/cloud/reference/features/luau-execution | Tasks, limits, SavePlaceAsync, binary I/O |
| Data stores (Open Cloud) | https://create.roblox.com/docs/cloud/guides/data-stores | Usage, throttling |
| Storage reference | https://create.roblox.com/docs/cloud/reference/features/storage | Data, ordered and memory store endpoints |
| Messaging | https://create.roblox.com/docs/cloud/guides/usage-messaging | Publish to live servers; limits |
| Configs | https://create.roblox.com/docs/cloud/guides/configs | Remote config drafts, publish, rollback |
| Experiments | https://create.roblox.com/docs/cloud/guides/experiments | A/B tests |
| Notifications | https://create.roblox.com/docs/cloud/guides/experience-notifications | Templates, payloads |
| Secrets store | https://create.roblox.com/docs/cloud/guides/secrets-store | Sealed-box encryption, create/update/delete |
| Secrets in game | https://create.roblox.com/docs/cloud-services/secrets | `HttpService:GetSecret`, local secrets |
| In-game HTTP | https://create.roblox.com/docs/cloud-services/http-service | Open Cloud endpoints callable from servers; limits |
| Analytics | https://create.roblox.com/docs/cloud/guides/analytics | Metric queries |
| Feature references | https://create.roblox.com/docs/cloud/reference/features/assets (also `places`, `universes`, `storage`, `game-passes`, `developer-products`, `badges`, `configs`, `bans-and-blocks`, `notifications`, `localization`) | Endpoint details |
| Studio MCP | https://create.roblox.com/docs/studio/mcp | What the MCP tools cover |
| Assistant skills | https://create.roblox.com/docs/assistant/skills | The 7 built-in `rbx-` skills |
| AssetService:SavePlaceAsync | https://create.roblox.com/docs/reference/engine/classes/AssetService#SavePlaceAsync | Saving from Luau Execution |
| Packages | https://create.roblox.com/docs/projects/assets/packages | Uploaded models are packages |

## Source repository
github.com/Roblox/creator-docs:
- `content/en-us/reference/cloud/openapi.json`: all operations.
- `content/en-us/cloud/`: guides.

## Staff posts (DevForum)
| Topic | URL |
|---|---|
| Models upload as packages; more asset types (2025-10-23, 2026-02-09) | https://devforum.roblox.com/t/open-cloud-upload-support-for-more-asset-types/4022082 |
| MeshIds of uploaded models via Luau Execution (2024-11-22) | https://devforum.roblox.com/t/how-to-get-meshid-from-model-upload-cloud-assets-api/3226166 |
| Luau Execution launch and updates (2024-09-25, 2025-08-20) | https://devforum.roblox.com/t/beta-open-cloud-engine-api-for-executing-luau/3172185 |
| Open Cloud through HttpService (2025-05-19) | https://devforum.roblox.com/t/use-open-cloud-via-httpservice-without-proxies/3656373 |
| API key changes (2025-10-15) | https://devforum.roblox.com/t/open-cloud-api-key-documentation-improvements/4009194 |
| Group-owned keys deprecation deferred (2025-11-14) | https://devforum.roblox.com/t/deferred-api-key-consolidation-deprecating-group-owned-api-keys/4068530 |

## Community tools (not official)
- Rojo (`rojo build`, `rojo upload --api_key`): https://github.com/rojo-rbx/rojo
- Asphalt (asset sync with a lockfile; MIT): https://github.com/jackTabsCode/asphalt
- jest-roblox-cli (tests through Luau Execution; MIT): https://github.com/christopher-buss/jest-roblox-cli
- Roblox place CI/CD demo (archived): https://github.com/Roblox/place-ci-cd-demo
