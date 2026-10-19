# Places and release

Read when you need to:
- build and publish a place file;
- restart servers after a release;
- change place or universe settings;
- update the store page (icon, thumbnails, localized name and description);
- read version history;
- edit scripts in a cloud place without Studio;
- list live servers and their logs.

Prerequisite: the experience exists. Open Cloud has no endpoint to create an experience or a place, so the user publishes it once from Studio (File → Publish to Roblox). Record its universe and place IDs where the project documents them, and pass them as `--universe` and `--place` or set them as defaults (`01-setup-and-auth.md`).

## Publish a place file (official, beta)
```bash
rojo build <project>.project.json -o build/place.rbxl     # build/ is gitignored
oc.ts publish --file build/place.rbxl                      # dry run: shows the plan and the caveat
oc.ts publish --file build/place.rbxl --yes                # after the user's OK -> {"versionNumber": N}
oc.ts publish --file build/place.rbxl --saved --yes        # versionType=Saved: new version, not live
```

**Published vs Saved:**
- `Published` makes the version live for new servers. Running servers keep the old version until they restart (see below).
- `Saved` stores a version without publishing it. A Luau Execution task can then target it with `--version N` (`04-luau-execution.md`).

**The API does not update some instances (official):**
- The classes are EditableImage, EditableMesh, PartOperation (unions), SurfaceAppearance and BaseWrap (WrapLayer, WrapTarget).
- After changing any of them, the user publishes from Studio.
- A project whose art uses SurfaceAppearance publishes art changes from Studio and keeps the API route for code and other content.
- `oc.ts publish` lists such classes when the file is `.rbxlx`. A binary `.rbxl` can't be scanned, so it always prints the caveat.
- Whether unchanged SurfaceAppearances survive an API publish intact is not stated (verify on the first publish: compare a part with a SurfaceAppearance before and after).

**Limits and what not to use:**
- **Don't use `rojo upload`.** It calls the same endpoint with `versionType=Published` (community; Rojo source). With `--api_key` the key lands on the command line; without it, Rojo looks for the user's Roblox login cookie. `rojo build` + `oc.ts publish` does the same job safely.
- **Limit:** 30 publishes/min per key owner (official). Place file size limit: no source found.

## Release: restart servers (official, stable)
```bash
oc.ts request POST /cloud/v2/universes/<u>:restartServers \
  --json '{"closeAllVersions": false, "bleedOffServers": true, "bleedOffDurationMinutes": 10}'
```

| Field | Meaning |
|---|---|
| `placeIds` | Places to restart (default: all active places) |
| `closeAllVersions` | `false` restarts only servers on old versions; `true` restarts every server |
| `bleedOffServers` + `bleedOffDurationMinutes` (1-60) | Stops matchmaking to old servers and keeps them up that long before shutting down |

- **Rate:** 30/min.
- **Players are kicked or moved:** confirm the timing with the user.
- **Forecast and status:** `oc.ts request GET /server-management/v1/universes/<u>/restarts:forecast` and `GET /server-management/v1/universes/<u>/restarts` (beta).

## Place settings (official, stable)
```bash
oc.ts request GET /cloud/v2/universes/<u>/places/<p>
oc.ts request PATCH /cloud/v2/universes/<u>/places/<p> --query updateMask=displayName,description,serverSize \
  --json '{"displayName": "My Game", "description": "...", "serverSize": 12}'
```
The root place's name and description are the experience's name and description. Updating them is how the universe name changes (official).

## Universe settings (official, stable)
```bash
oc.ts request GET /cloud/v2/universes/<u>
oc.ts request PATCH /cloud/v2/universes/<u> --query updateMask=voiceChatEnabled,mobileEnabled \
  --json '{"voiceChatEnabled": false, "mobileEnabled": true}'
```

**Writable fields:**

| Field | Notes |
|---|---|
| `voiceChatEnabled` | Doesn't affect active servers |
| `desktopEnabled`, `mobileEnabled`, `tabletEnabled`, `consoleEnabled`, `vrEnabled` | |
| `privateServerPriceRobux` | Changing it **cancels all private-server subscriptions**; null disables private servers. Confirm explicitly |
| `facebookSocialLink`, `twitterSocialLink`, `youtubeSocialLink`, `twitchSocialLink`, `discordSocialLink`, `robloxGroupSocialLink`, `guildedSocialLink` | Each `{"title": ..., "uri": ...}` |

**Read-only:** `displayName`, `description`, `visibility`, `ageRating`.

**No API-key route** (develop.roblox.com is cookie-only): avatar type and scaling, genre, playtesters, "Enable Studio Access to API Services", maturity questionnaire. The user changes these in Studio Game Settings or on Creator Hub.

## Store page: icon, thumbnails, localized listing (official, experimental)
These are `legacy-game-internationalization` endpoints. `gameId` is the universe ID (verify), and `languageCode` is for example `en`.

| Change | Endpoint |
|---|---|
| Icon | `POST /legacy-game-internationalization/v1/game-icon/games/<gameId>/language-codes/<lang>` |
| Thumbnail upload | `POST .../game-thumbnails/games/<gameId>/language-codes/<lang>/image` |
| Thumbnail order, delete, alt text | `.../images/order`, `.../images/<imageId>`, `.../alt-text` |
| Name and description in several languages | `PATCH /legacy-game-internationalization/v1/name-description/games/<gameId>` with `{"data": [...]}` |
| Supported languages, auto-translation | `.../supported-languages/games/<gameId>...` |
| Localization tables | `GET/PATCH /legacy-localization-tables/v1/localization-table/tables/<tableId>` (+ `/entries`) |

The spec gives no multipart field name for the icon and thumbnail uploads; the legacy APIs used `request.files` (verify). Read the endpoint page before the first call, and send uploads with `oc.ts request POST ... --form-file request.files=icon.png` (a write, so dry run first). All of these need `legacy-universe:manage`.

## Version history (official, experimental)
```bash
oc.ts request GET /place-version-history-api/v1/<placeId>/history
oc.ts request POST /place-version-history-api/v1/<placeId>/version/<n>/notes --json '{...}'   # verify the body on the endpoint page
```
To roll back, publish an older build, or restore the version in Studio's Version History (user).

## Edit scripts in a cloud place without Studio (official, beta)
Prefer Rojo or MCP `multi_edit`. Use the Instance API only when Studio is closed.

**Restrictions:**
- It handles Script, LocalScript and ModuleScript only.
- Team Create (collaborative editing) must be on.
- The script can't be open in Studio (error `Live scripting session is active`) or be part of a package.
- Body ≤ 200 KB; 45 requests/min.

```bash
oc.ts request GET /cloud/v2/universes/<u>/places/<p>/instances/root:listChildren   # returns an operation
oc.ts operation <path from the response>                                           # the children, with instance IDs
oc.ts request GET /cloud/v2/universes/<u>/places/<p>/instances/<id>                # then operation again
oc.ts request PATCH /cloud/v2/universes/<u>/places/<p>/instances/<id> \
  --json '{"engineInstance": {"Details": {"ModuleScript": {"Source": "return {}"}}}}'   # write; then oc.ts operation <path>
```

## Live servers and logs (official, beta)
```bash
oc.ts request GET /server-management/v1/universes/<u>/places/<p>/versions/<v>/game-servers
oc.ts request GET /server-management/v1/universes/<u>/places/<p>/versions/<v>/game-servers/<jobId>/logs
```

## Official links
- Place publishing: https://create.roblox.com/docs/cloud/guides/usage-place-publishing
- Universes and places reference: https://create.roblox.com/docs/cloud/reference/features/universes, https://create.roblox.com/docs/cloud/reference/features/places
- Engine instances (Instance API): https://create.roblox.com/docs/cloud/guides/instance
- Publishing from Studio: https://create.roblox.com/docs/production/publishing/publish-games-and-places
