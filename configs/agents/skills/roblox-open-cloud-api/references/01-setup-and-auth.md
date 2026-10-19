# Setup and auth

Read when you need to:
- create or check an API key;
- decide which API system or scope a job needs;
- find a universe, place, user or group ID;
- work with group-owned experiences;
- understand why a key stopped working.

## The key belongs to the user
The user creates, stores and rotates the key. An agent never sees its value. Creating keys is an account action on Creator Hub, so the agent only explains the steps.

To create a key (official, https://create.roblox.com/docs/cloud/auth/api-keys):
1. Go to Creator Hub → **API Keys** (https://create.roblox.com/dashboard/credentials) → **Create API Key**, and give it a purpose name (`MYGAME_ASSETS`, `MYGAME_PUBLISH`).
2. **Access Permissions:**
   - Add each **API system** the job needs (table below) and select its **operations** (read, write, ...).
   - Turn on **Restrict by Experience** and pick the experience. It has been off by default since 2025-10-15 (staff post). Off means every current and future experience of the account, including group experiences where the user has the role (official).
3. **Security** (optional): restrict accepted IPs with CIDR. Leave this off for keys used from Roblox servers (in-game HttpService) (official).
4. **Expiration** (optional). Without one, the key still auto-expires after 60 days without use or edits (official).
5. **Save & Generate key**, then copy it once.

Roblox recommends one key per application, minimum permissions, IP restriction where possible, and never committing keys (official).

## Storing it
`oc.ts` reads the key from the `OPEN_CLOUD_API_KEY` environment variable and nowhere else of its own accord. The user exports it in their shell profile, typically from a secrets file the profile sources (`export OPEN_CLOUD_API_KEY=...`), so every new shell has it. For one session only, without leaving it in history: `read -rs OPEN_CLOUD_API_KEY && export OPEN_CLOUD_API_KEY`.

Bun, which runs `oc.ts`, also loads a `.env` in the current folder for variables the shell does not set; a shell value always wins. A project can use that for non-secret defaults (comments on their own lines):

```
# the experience and its start place
ROBLOX_UNIVERSE_ID=1234567890
ROBLOX_PLACE_ID=9876543210
```

`ROBLOX_CREATOR` (`user:<userId>` or `group:<groupId>`) usually belongs in the shell, because the same account owns uploads across projects. Flags (`--creator`, `--universe`, `--place`) override all of these.

Agents must not read the secrets file or a `.env` with `cat`, `grep` or an editor, and must not echo the variable: either may hold the key.

## API systems and scopes per job
**Scopes** come from `openapi.json` (official). Creator Hub groups scopes into **API systems**. Only the system names marked (official) appear in a guide. For the others, pick the system whose operation list shows the scope (verify).

| Job | API system (Creator Hub) | Scopes the endpoints require |
|---|---|---|
| Upload, update, version, archive assets | `assets` (official) | `asset:read`, `asset:write` |
| Download stored asset content | (verify) | `legacy-asset:manage`. Not usable for group assets (community) |
| Grant asset permissions | (verify) | `asset-permissions:write` |
| Save or publish place files | `universe-places` (official) | `universe-places:write` |
| Luau Execution | (verify) | `universe.place.luau-execution-session:write` (create), `:read` (results, logs) |
| Edit scripts in the cloud (Instance API) | `universe-place-instances` (official) | `universe.place.instance:read`, `:write` |
| Place settings, place version history | (verify) | `universe.place:write`, `universe.place:read` |
| Universe settings, restart servers, configs, experiments, server logs | (verify) | `universe:write`, `universe:read` |
| Store page media and localization | (verify) | `legacy-universe:manage` |
| Data stores | (verify) | `universe-datastores.control:*`, `universe-datastores.objects:*`, `universe-datastores.versions:*` |
| Ordered data stores | (verify) | `universe.ordered-data-store.scope.entry:read`, `:write` |
| Memory stores | (verify) | `memory-store.queue:*`, `memory-store.sorted-map:*`, `memory-store:flush` |
| Messaging to live servers | (verify) | `universe-messaging-service:publish` |
| Bans | (verify) | `universe.user-restriction:read`, `:write` |
| Experience notifications | (verify) | `user.user-notification:write` |
| Secrets store | `secret-store` (official) | `universe.secret:read`, `:write` |
| Game passes, developer products | (verify) | `game-pass:read/write`, `developer-product:read/write` |
| Badges | (verify) | `legacy-universe.badge:manage-and-spend-robux` (create), `legacy-universe.badge:write`, `legacy-badge:manage` |

For any other endpoint, the scope is in `endpoint-catalog.md`. One key with every system is convenient but risky: prefer separate keys for asset uploads and for publishing or live data.

## Check a key
`oc.ts introspect` calls `POST https://apis.roblox.com/api-keys/v1/introspect` with the key in the body (official). The response holds:
- `name` and `authorizedUserId`;
- `scopes[]`, each with `name`, `operations` and the resources it covers (`universeIds`, `userIds`, `groupIds`, `universeDatastores`; `*` means all);
- `enabled`, `expired` and `expirationTimeUtc`.

The call also checks whether the key can be used from the current IP and whether the key or its owner is moderated (official). Run it first whenever a call returns 401 or 403.

## Key statuses (official)
| Status | Cause | Fix (user) |
|---|---|---|
| Active | — | — |
| Disabled | Enable Key toggled off | Toggle it on |
| Expired | Expiration date passed | Remove or move the date |
| Auto-Expired | Not used or updated for 60 days | Toggle Enable Key off and on, or edit any property |
| Revoked | Group keys: the creator lost permission to manage the group's keys | Regenerate |
| Moderated | Roblox changed the secret for security reasons | Regenerate |
| User Moderated | The owning account is under moderation | Resolve the moderation |

## Group-owned experiences
- **Use a dedicated account (official).** An API key can reach everything its owner can. For group automation, Roblox recommends a separate account invited to the group with a role that has only the needed permissions; that account creates the key.
- **Group-owned key deprecation** was announced on 2025-11-13 and deferred the next day, so no dates apply (staff).
- **Service accounts and locks:** service accounts holding keys were reported locked for "suspicious activity" (community, 2026-04). Staff said on 2026-06-24 that API-key requests keep working during such a lock.
- **Asset ownership:** assets uploaded with `--creator group:<id>` belong to the group. The key owner needs the group permission to create assets (official).

## Finding IDs
| ID | Where |
|---|---|
| Universe (experience) | Creator Hub → Creations → experience tile ⋯ → **Copy Universe ID** (official); or `oc.ts universe-id --place <placeId>` (public endpoint; not in openapi.json; tested 2026-10-17) |
| Place | Creator Hub → experience → Places → place → the number after `/places/` in the URL (official); start place: tile ⋯ → Copy Start Place ID |
| User | `https://www.roblox.com/users/<userId>/profile` (official) |
| Group | `https://www.roblox.com/groups/<groupId>/...` (official) |
| Asset | Creator Hub → Development Items → tile ⋯ → Copy Asset ID; or `oc.ts upload` output |

Open Cloud cannot create an experience or a place. The first publish is done by the user in Studio (File → Publish to Roblox).

## OAuth 2.0
OAuth 2.0 apps act for other Roblox users who grant access. They are not needed for this project's own automation. Docs: https://create.roblox.com/docs/cloud/auth/oauth2-overview

## Official links
- API keys: https://create.roblox.com/docs/cloud/auth/api-keys
- Scopes: https://create.roblox.com/docs/cloud/reference/scopes
- Rate limits: https://create.roblox.com/docs/cloud/reference/rate-limits
- Group API keys staff thread: https://devforum.roblox.com/t/deferred-api-key-consolidation-deprecating-group-owned-api-keys/4068530
