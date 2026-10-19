---
name: roblox-open-cloud-api
description: Call the Roblox Open Cloud REST API (apis.roblox.com, API key) for Roblox work outside the open Studio session, which the Studio MCP cannot reach - uploading repo files as assets (PNG/JPG as Image, FBX/glTF/GLB as Model, audio, video) and reading their moderation, versions, content and permissions; saving or publishing .rbxl/.rbxlx place files; running Luau headless on a saved place version (Luau Execution); data stores, memory stores, messages to live servers, server restarts, bans, notifications, secrets and remote configs; place and universe settings, icon and thumbnails, game passes, developer products and badges. Load before any apis.roblox.com call, `rojo upload`, or uploading a file from disk to Roblox.
---

# Roblox Open Cloud API

The Studio MCP works inside the open Studio session. Open Cloud reaches what lies outside it: files on disk, the published experience, live servers and cloud data.

Make every call through `scripts/oc.ts`. It:
- keeps the API key out of output and URLs;
- turns writes into dry runs until `--yes`;
- waits for long operations;
- retries rate limits;
- enforces upload-once.

Tags:
- **(official)**: Roblox docs, spec or staff.
- **(community)**: third party.
- **(verify)**: not confirmed.
- **(tested)**: we ran it.

As of 2026-10-17, `oc.ts` has been tested offline against a mock server, plus one live keyless call (`universe-id`). No call with the API key has run against Roblox yet, so every keyed behaviour below is official or community, not tested.

## How to use this skill
1. Read **MCP or Open Cloud**, **Rules** and **oc.ts** below.
2. Open only the reference the task needs (table **References**).
3. For an endpoint no reference covers, find it in `references/endpoint-catalog.md`. Read its page at https://create.roblox.com/docs/cloud/reference before the first call.
4. The project's own rules stay in force. Before uploading or publishing, read its `AGENTS.md` (or equivalent) for where asset IDs are recorded, naming and commit rules.

## MCP or Open Cloud?
| Task | Use |
|---|---|
| Read or edit the open place (instances, scripts), run Luau there, playtest, screenshots, insert an asset by ID, AI generation | Studio MCP |
| Turn a repo file into an asset; asset versions, metadata, moderation, downloads, permissions | Open Cloud: `references/02-assets.md` |
| Save or publish a place file; restart servers; place and universe settings; icon, thumbnails, localized listing | Open Cloud: `references/03-places-and-release.md` |
| Run Luau on a saved place version without Studio: tests, checks, data jobs | Open Cloud: `references/04-luau-execution.md` |
| Live data and operations: data stores, memory stores, messaging, bans, notifications, configs, secrets, analytics, server logs | Open Cloud: `references/05-live-data-and-ops.md` |
| Game passes, developer products, badges | Open Cloud: `references/06-monetization.md` |
| Create a new experience or place; avatar, genre, playtesters, Studio access to API services; 3D Importer options; create or rotate the API key | Neither. Ask the user to do it in Studio or on Creator Hub |

The MCP `http_get` only reads docs pages; it cannot call the API. Calling Open Cloud from MCP `execute_luau` is untested and would need the key as a Secret (verify). Use the shell.

Typical hand-off: `oc.ts upload` → MCP `insert_asset` with the new ID → `inspect_instance` / `screen_capture` to verify it in Studio.

## Setup (once; the user does steps 1 and 2)
1. **Create the key** at https://create.roblox.com/dashboard/credentials (API Keys → Create API Key):
   - Add only the API systems the job needs (`references/01-setup-and-auth.md`).
   - Turn on **Restrict by Experience** (it has been off by default since 2025-10-15) and pick the experience.
   - IP restriction and expiry are optional.
   - A key that is not used or edited for 60 days auto-expires (official).
2. **Export it in the shell, never in chat.** The user exports `OPEN_CLOUD_API_KEY` from their shell profile, for example from a secrets file the profile sources. `oc.ts` reads it from the environment.
3. **Optional defaults:** `ROBLOX_CREATOR=user:<userId>` (or `group:<groupId>`) in the shell. Universe and place differ per project: pass `--universe` and `--place`, or put `ROBLOX_UNIVERSE_ID` and `ROBLOX_PLACE_ID` in the project's `.env`. Bun loads a `.env` in the folder `oc.ts` runs from for variables the shell does not set; a shell value always wins.
4. **Check:** `oc.ts introspect` shows the key's scopes, experiences and expiry. If it reports `OPEN_CLOUD_API_KEY is not set`, ask the user to export it and open a new shell.

## Rules
1. **Never handle the key.**
   - Don't ask for it in chat, print it, echo its variable, read the file that defines it (shell secrets file, `.env`), write it to a file, or put it in a URL or on a command line. `oc.ts` reads it itself.
   - If a key leaks, the user regenerates it on Creator Hub. GitHub secret scanning does not cover Roblox keys (community).
2. **Writes need the user's OK every time.**
   - Without `--yes`, `oc.ts` prints the plan and exits 3. Show the plan, wait for a clear yes, then re-run with `--yes`.
   - Reads (GET, `introspect`, `download`) run directly. The exception is reading a memory-store queue: it hides the items from live servers, so `oc.ts` dry-runs it too.
   - Writes include: uploads (permanent, moderated, count against quotas), publishing, server restarts, place and universe settings, prices and sale state, badges (cost Robux), bans, notifications, live messages, Luau tasks, and data/memory store writes, deletes and flushes. Secrets are created by the user (`references/05-live-data-and-ops.md`).
3. **Upload once.**
   - `oc.ts upload` records every file by SHA-256 in `roblox-uploads.lock.json` at the root of the git repository it runs in, and refuses a file that is already there. Reuse the recorded ID.
   - The entry is written before the request goes out. If the outcome is unknown (connection lost after sending, 5xx), retries are refused until someone checks Creator Hub for the asset. A request that never reached Roblox, or that Roblox rejected, can simply be retried.
   - Use `--force` only when the user asks for a new asset. Inside a repository the lock can't be switched off or replaced by another file; outside one, pass `--lock PATH`.
   - After an upload, record the IDs where the project keeps them and commit them with `roblox-uploads.lock.json`. Without a project convention, key textures and FBX files by file name and MeshParts by object name (`references/02-assets.md`).
4. **API keys only, and no money.**
   - Never call cookie-only endpoints: `develop.roblox.com` and the other legacy hosts are cookie-only (see the catalog's header).
   - Don't use `rojo upload`. Without `--api_key` it looks for the user's Roblox login cookie on the machine (Rojo 7.7.1 help); with it, the key lands on the command line. Use `rojo build` + `oc.ts publish`.
   - Never touch payments, payment profiles or billing (`service-efficiency-api`, ads billing accounts): `oc.ts` refuses them, and the user handles money on Creator Hub.
5. **Meshes:** in each project, use Open Cloud `Model` uploads for meshes only after the calibration check in `references/02-assets.md` has passed on that route. Until then, use the 3D Importer in Studio.
6. **Changes to SurfaceAppearance, unions, EditableImage/EditableMesh or WrapLayer/WrapTarget are published from Studio,** not through the API. The API does not update those instances (official).
7. **Prefer stable and beta endpoints.** Of the 77 API-key `legacy-*` endpoints, 64 are marked experimental in the spec and the rest state no stability (official).
8. **Report** IDs, version numbers and file paths, and say what was not verified.

## oc.ts
Run it from the project's folder, so the upload lock lands at that repository's root: `bun ~/.agents/skills/roblox-open-cloud-api/scripts/oc.ts <command>` (this skill's `scripts/oc.ts`); it is called `oc.ts` below.
- Needs Bun (tested with 1.4.3), no dependencies. Add `--help` to any command for its options.
- Prints JSON on stdout and diagnostics on stderr.
- Exit codes:

  | Code | Meaning |
  |---|---|
  | 0 | ok |
  | 1 | API or network error |
  | 2 | usage error |
  | 3 | dry run (needs `--yes`) |
  | 4 | refused by the upload lock |
  | 5 | still running when the wait timed out |

| Command | Does |
|---|---|
| `introspect` | Shows the key's scopes, experiences and expiry, and whether this IP may use it |
| `upload --file F --name N [--type T] [--description D] [--creator user:ID]` | Creates an asset, waits for the operation, records the lock, prints `assetId`, `rbxassetid://…` and the moderation state |
| `update-asset --asset-id ID [--file F.fbx] [--name N] [--description D] [--type T]` | New FBX content (new version, same ID) and/or new metadata |
| `operation PATH_OR_ID` | Polls an asset operation (`operations/<id>`), a v2 operation, a memory-store flush (`cloud/v2/...`) or a Luau task path until done; finishes a pending lock entry; exits 1 if it failed |
| `publish --file F.rbxl [--universe U --place P] [--saved]` | Creates a new place version (Published by default; `--saved` saves without publishing) |
| `luau --script-file F [--universe U --place P --version V] [--task-timeout S]` | Runs Luau through Luau Execution; prints state, return values and logs |
| `download --asset-id ID [--version N] --out FILE` | Fetches the content Roblox stores for an asset |
| `universe-id --place P` | Universe ID of a place (public endpoint, no key sent) |
| `request METHOD PATH [--json J \| --json-file F] [--query K=V] [--form K=V] [--form-file K=PATH]` | Any other endpoint in the catalog |

Tests (offline, mock server): `bun test ~/.agents/skills/roblox-open-cloud-api/scripts`. To refresh the catalog from the latest spec: `bun ~/.agents/skills/roblox-open-cloud-api/scripts/gen_catalog.ts`.

## Request basics (official)
- **Base and auth:** base URL `https://apis.roblox.com` (a few endpoints are on `thumbnails.roblox.com`); auth header `x-api-key`.
- **v2 (`/cloud/v2/...`):**
  - resource paths;
  - `maxPageSize` + `pageToken`, where `pageToken` is the previous `nextPageToken` and every other parameter stays identical (otherwise 400);
  - `updateMask` on PATCH, listing the fields you change;
  - long operations come back as `{path, done}`; poll them with `oc.ts operation <path>`.
- **v1 endpoints** differ per API: read the endpoint page.
- **Errors:**
  - Gateway errors look like `{"errors":[{"code","message"}]}` (bad key, routing).
  - v2 errors look like `{"code":"PERMISSION_DENIED","message",...}`.
  - 401/403 means the key lacks the API system, the operation or the experience; check with `introspect`.
- **Rate limits** count per key owner, across all of that owner's keys. On 429, `oc.ts` waits for `retry-after` or backs off. Undocumented limits also exist.
- **IDs:**
  - Universe ID = the experience: Creator Hub → experience ⋯ → Copy Universe ID, or `oc.ts universe-id --place P`.
  - Place ID: in the place's Creator Hub URL.
  - User ID: in the profile URL.
  - Group ID: in the group URL.

## Gotchas
- **Upload images as `Image`, not `Decal`.** A Decal upload returns the Decal ID, not the image ID that texture properties need (community; `Image` is an official type).
- **Images can't be updated:** a change means a new upload and a new ID. FBX Model content can be updated: `update-asset` adds a new version with the same ID (official).
- **FBX/glTF/GLB uploads become a package Model with MeshParts.** There are no importer options, and no API returns the MeshIds. Insert the model (MCP) and read them (`references/02-assets.md`).
- **Export `.glb`, not `.gltf`:** a `.gltf` references external files that are not uploaded.
- **Asset operations can stay pending for a long time** (community). `oc.ts` keeps a pending lock entry; resume it with `oc.ts operation`.
- **Luau Execution acts on live DataStores.** DataModel changes are discarded unless the script calls `AssetService:SavePlaceAsync` (official). It runs on a saved version, so unsaved Studio edits are presumably invisible to it (verify).
- **Secrets resolve only on live servers and in collaborative testing.** Local playtests use Studio's Local Secrets (official).
- **Rate limits per key owner (official):**
  - asset create/update 120/min;
  - place publish 30/min;
  - Luau task create 5/min, with at most 10 unfinished per place;
  - restart servers 30/min.

## References
| File | Read when |
|---|---|
| `references/01-setup-and-auth.md` | Creating or checking a key; which API system and scope a job needs; IDs; group ownership; key statuses |
| `references/02-assets.md` | Uploading textures, meshes, audio, video; versions, moderation, downloads, permissions, quotas; the Model-upload calibration check; recording IDs |
| `references/03-places-and-release.md` | Building and publishing places; restarting servers; place and universe settings; icon, thumbnails, localized listing; version history; editing scripts in the cloud |
| `references/04-luau-execution.md` | Running Luau without Studio: tests, checks, reading the MeshIds of uploaded models, data jobs |
| `references/05-live-data-and-ops.md` | Data stores, ordered data stores, memory stores, messaging, bans, notifications, configs, secrets, analytics, server logs |
| `references/06-monetization.md` | Game passes, developer products, badges, and their localized names and icons |
| `references/endpoint-catalog.md` | Any other endpoint: all 298 operations that accept a key, with scopes, stability and rate limits (generated) |
| `references/official-docs.md` | Every official page this skill is based on |
