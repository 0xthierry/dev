# Live data and operations

Read when you need to read or change the data or the live servers of a published experience:
- data stores, ordered data stores, memory stores;
- messages to live servers;
- bans;
- experience notifications;
- remote configs and experiments;
- secrets;
- analytics and server logs.

This is real players' data. Every write is a dry run until the user agrees.
- Prefer a separate test experience. Roblox warns against pointing Studio at live data stores (official).
- Take a snapshot before bulk changes (see below).
- MCP `execute_luau` reaches data stores only when "Enable Studio Access to API Services" is on, and only for the open place.

Paths below are relative to `https://apis.roblox.com`; `<u>` = universe ID. All endpoints are official.

## Data stores (v2, stable)
```bash
oc.ts request GET /cloud/v2/universes/<u>/data-stores --query maxPageSize=100
oc.ts request GET /cloud/v2/universes/<u>/data-stores/<store>/entries --query maxPageSize=100 [--query 'filter=id.startsWith("player_")']
oc.ts request GET /cloud/v2/universes/<u>/data-stores/<store>/entries/<key>
oc.ts request GET /cloud/v2/universes/<u>/data-stores/<store>/entries/<key>:listRevisions
oc.ts request GET "/cloud/v2/universes/<u>/data-stores/<store>/entries/<key>@<revisionId>"     # one revision
oc.ts request GET "/cloud/v2/universes/<u>/data-stores/<store>/entries/<key>@latest:2026-10-01T00:00:00Z"   # value at a time
```

Writes (dry run, then `--yes`):
```bash
oc.ts request POST  /cloud/v2/universes/<u>/data-stores/<store>/entries --query id=<key> \
  --json '{"value": {"coins": 0}, "users": ["users/<userId>"], "attributes": {}}'
oc.ts request PATCH /cloud/v2/universes/<u>/data-stores/<store>/entries/<key> --query allowMissing=true \
  --json '{"value": {...}, "users": ["users/<userId>"], "attributes": {...}}'
oc.ts request POST  /cloud/v2/universes/<u>/data-stores/<store>/entries/<key>:increment \
  --json '{"amount": 5, "users": ["users/<userId>"], "attributes": {...}}'
oc.ts request DELETE /cloud/v2/universes/<u>/data-stores/<store>/entries/<key>
```

**PATCH replaces the whole entry (official).** Partial updates are not supported: `value` is required, and `users` or `attributes` you leave out are cleared. `:increment` also clears the users and attributes you don't send. Always GET the entry first and send its `users` and `attributes` back with the new value. The entry's revisions keep the old version.

**Scopes and keys:**
- URL-encode store names and entry keys in paths (`Player%20Data`). `oc.ts` sends the path as given.
- Entries live in the `global` scope unless the game uses scoped keys. The scoped form is `.../data-stores/<store>/scopes/<scope>/entries/...`.
- `users` must be `users/<id>` paths, not bare IDs.
- The optional `etag` gives concurrency control.

**Delete** marks the entry `DELETED`; it is permanently removed after 30 days. `showDeleted=true` lists such entries.

**Snapshot before bulk edits:** `oc.ts request POST /cloud/v2/universes/<u>/data-stores:snapshot --json '{}'`.
- After a snapshot, the next write to each key keeps a versioned backup of the old value for at least 30 days.
- One snapshot per UTC day per experience; a second call that day does nothing.

**Store-level operations (beta):** `DELETE .../data-stores/<store>` deletes a store; `POST .../data-stores/<store>:undelete` restores it.

**v1 endpoints** (`/datastores/v1/...`, `/ordered-data-stores/v1/...`) still exist. Use v2.

**Throttling:** extra limits apply, listed at https://create.roblox.com/docs/cloud/guides/data-stores/throttling. Values with NaN or infinity come back with substitutes, because JSON can't hold them.

## Ordered data stores (v2, stable)
`/cloud/v2/universes/<u>/ordered-data-stores/<store>/scopes/<scope>/entries`:
- list: GET;
- create: POST `?id=<key>` with `{"value": 10}`;
- get, update, delete: GET, PATCH, DELETE `.../entries/<key>`;
- increment: POST `.../entries/<key>:increment` with `{"amount": 1}`.

## Memory stores (v2, stable)
| Action | Endpoint |
|---|---|
| Flush a whole memory store | `POST /cloud/v2/universes/<u>/memory-store:flush` (`--query scope=TEST` for the test scope; default LIVE). Returns an operation |
| Queue: add an item | `POST .../memory-store/queues/<q>/items` with `{"data": ..., "priority": 0, "ttl": "60s"}` |
| Queue: read items | `GET .../items:read --query count=10 --query invisibilityWindow=30s`, up to 200; `allOrNothing`. Reading hides the items from live servers for the window, so `oc.ts` dry-runs it like a write |
| Queue: discard items | `POST .../items:discard` with the `readId` from the read |
| Sorted maps | `.../memory-store/sorted-maps/<map>/items`: list; create with `?id=<key>` and `{"value": ..., "ttl": "3600s", "numericSortKey": 1}`; get/update/delete `.../items/<key>` |

## Messages to live servers (stable)
```bash
oc.ts request POST /cloud/v2/universes/<u>:publishMessage --json '{"topic": "announcements", "message": "{\"text\":\"New items!\"}"}'
```
- Servers receive it through `MessagingService:SubscribeAsync(topic)`. Topic ≤ 80 characters; message ≤ 1 KiB.
- Limits are shared with in-game MessagingService, for example `(40 + 80 × servers)` messages received per topic per minute.

## Bans: user restrictions (beta)
```bash
oc.ts request GET /cloud/v2/universes/<u>/user-restrictions
oc.ts request PATCH /cloud/v2/universes/<u>/user-restrictions/<userId> --query updateMask=gameJoinRestriction \
  --json '{"gameJoinRestriction": {"active": true, "duration": "86400s", "privateReason": "...", "displayReason": "...", "excludeAltAccounts": false}}'
oc.ts request GET /cloud/v2/universes/<u>/user-restrictions:listLogs
```

| Field | Meaning |
|---|---|
| `duration` | Omitted = permanent ban |
| `displayReason` | Shown to the user (≤ 400 characters) |
| `privateReason` | Not shown (≤ 1000 characters) |
| `active: false` | Lifts the ban |

- The restriction ID is the user ID (verify).
- A place-level variant exists: `.../places/<p>/user-restrictions/...`.
- Updates are limited to 2 per minute for the same user.

## Experience notifications (stable)
Create the message template on Creator Hub first (the user). Then:
```bash
oc.ts request POST /cloud/v2/users/<userId>/notifications --json '{
  "source": {"universe": "universes/<u>"},
  "payload": {"type": "MOMENT", "messageId": "<template id>", "parameters": {"item": {"string_value": "sword"}},
              "joinExperience": {"launchData": "open=shop"}, "analyticsData": {"category": "new item"}}}'
```
- Parameter values use the shape of the official example, `{"string_value": ...}`.
- `launchData` ≤ 200 bytes.

## Remote configs and experiments (beta / experimental)
In-experience configs use the repository `InExperienceConfig`, and servers read them with `ConfigService:GetConfigAsync()` (official guide).

**Publishing:**
- It needs the `draftHash` returned by the last draft change.
- `deploymentStrategy` is `Immediate`, or `GradualRollout`, which rolls out over 15 minutes (official guide).

```bash
B=/creator-configs-public-api/v1/configs/universes/<u>/repositories/InExperienceConfig
oc.ts request GET   $B                     # published values
oc.ts request GET   $B/draft               # current draft and its draftHash
oc.ts request PATCH $B/draft --json '{"entries": {"swordPrice": 25}}'      # partial; null deletes a key; returns draftHash
oc.ts request PUT   $B/draft:overwrite --json '{"entries": {...}}'              # full replace; returns draftHash
oc.ts request POST  $B/publish --json '{"draftHash": "<draftHash>", "message": "raise sword price", "deploymentStrategy": "Immediate"}'
oc.ts request GET   $B/revisions
oc.ts request POST  $B/revisions/<revisionId>/restore    # stages a revert (returns a draftHash); publish it to apply
```
Experiments (A/B tests) live under `/creator-configs-public-api/v1/experimentation/universes/<u>/experiments`; see the catalog.

## Secrets store (beta)
- **What secrets are for:** server scripts read them with `HttpService:GetSecret(name)`, for example to call another web service.
- **The user handles the value.**
  - The value must be sealed with libsodium to the universe public key (`GET /cloud/v2/universes/<u>/secrets/public-key`), then sent as `{"id", "secret", "key_id"}` to `POST /cloud/v2/universes/<u>/secrets`.
  - The value is a credential, so the user runs that step and the agent never sees it.
  - It needs PyNaCl (`pip install pynacl`), outside the standard library. Install it only in a venv, after the user agrees.
- **Read and delete (fine for agents):** list with `GET .../secrets`; delete with `DELETE .../secrets/<id>` (a write).
- **Where secrets resolve:** only on live servers and in collaborative testing. Local playtests use Studio → File → Experience Settings → Security → Local Secrets (official).

## Analytics, logs, servers (beta / experimental)
- **Metrics:** `POST /analytics-query-api/v1/universes/<u>/metrics` returns an operation (30/min); poll `.../operations/metrics/<id>`. Guide: https://create.roblox.com/docs/cloud/guides/analytics
- **Error logs:** `GET /universe-performance-raqi/v1/events/logging/universe/<u>/log-details`.
- **Game servers and their logs:** see `03-places-and-release.md`.

## Official links
- Data stores (Open Cloud): https://create.roblox.com/docs/cloud/guides/data-stores
- Data store snapshots: https://create.roblox.com/docs/cloud-services/data-stores#snapshots
- Storage reference (data and memory stores): https://create.roblox.com/docs/cloud/reference/features/storage
- Messaging: https://create.roblox.com/docs/cloud/guides/usage-messaging
- Bans and blocks: https://create.roblox.com/docs/cloud/reference/features/bans-and-blocks
- Notifications: https://create.roblox.com/docs/cloud/guides/experience-notifications
- Configs: https://create.roblox.com/docs/cloud/guides/configs
- Secrets store: https://create.roblox.com/docs/cloud/guides/secrets-store, https://create.roblox.com/docs/cloud-services/secrets
