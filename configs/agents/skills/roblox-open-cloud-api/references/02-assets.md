# Assets: upload, update, verify

Read when you need to:
- turn a repo file into a Roblox asset (texture, mesh, audio, video, animation);
- check moderation;
- manage versions;
- download what Roblox stored;
- grant permissions or check quotas;
- record asset IDs.

Studio MCP alternatives:
- `upload_image` only takes an http(s) URL, so a local file must first be served over HTTP.
- The 3D Importer is manual: the user picks the file.

For repo files, prefer `oc.ts upload`. It needs no web server, and the lock records which file became which ID.

## Supported files (official, usage guide)
Each call uploads one file of at most 20 MB.

| `--type` | Files | Limits |
|---|---|---|
| `Image` (use this for textures) / `Decal` | `.png` `.jpg` `.jpeg` `.bmp` `.tga` | Smaller than 8000x8000; content can't be updated |
| `Model` | `.fbx` `.gltf` `.glb` `.rbxm` `.rbxmx` | FBX/glTF/GLB import as a Model container holding MeshParts. Models are stored as **packages**. Only `.fbx` content can be updated. `.rbxm`/`.rbxmx` edited outside Studio may fail |
| `Animation` | `.rbxm` `.rbxmx` | Saved from Studio |
| `Audio` | `.mp3` `.ogg` `.wav` `.flac` | ≤ 7 min. 100 uploads/month if ID-verified, 10 otherwise. Can't be updated |
| `Video` | `.mp4` `.mov` | ≤ 5 min, ≤ 4096x2160, ≤ 3.75 GB. The guide states both this and the 20 MB per-call limit, so `oc.ts` doesn't size-check video. 20/day, only for 13+ ID-verified accounts. Can't be updated |
| `Mesh` | Roblox mesh data | Only content previously downloaded through Asset Delivery. Not a route for new meshes |

Rate limits per key owner (official): create and update 120/min; operation polling 300/min.

## Upload a texture
```bash
oc.ts upload --file assets/textures/sword_color.png --name sword_color \
  --description "Sword, color map"    # illustrative path
```

1. **Dry run first.** The plan shows the request, creator, size, SHA-256 and lock path. Show it to the user. After a clear yes, re-run with `--yes`.
2. **Read the result.** `result.assetId`, `result.rbxassetid` and `result.moderationState`.
3. **Record the ID** where the project keeps asset IDs (a registry file, a doc), keyed by file name unless the project says otherwise (`"sword_color.png": "<assetId>"`). Commit it with `roblox-uploads.lock.json`.
4. **Use the ID.** In Studio set `rbxassetid://<assetId>` on the property (`SurfaceAppearance.ColorMap`, `MaterialVariant.ColorMap`, ...). From Luau, use `Content.fromAssetId(id)` for Content-typed properties (official).

**Image, not Decal.** A `Decal` upload returns the Decal ID, which texture properties can't use; tools such as Tarmac and Asphalt switched to `Image` in 2025 (community). `oc.ts` warns when `--type Decal` is used.

## Upload a mesh (FBX, glTF, GLB) as a Model
Run the **calibration check** below once per project before relying on this route; until it passes, use the 3D Importer in Studio. Facts about this route:
- The request has no importer options (scale unit, axes, pivot, collision). The schema has no such fields (official).
- Asphalt's README advises the 3D Importer for meshes, and one user reported a misaligned collision mesh (2025-10-31, community).
- The result is **one Model asset ID**, stored as a package, with no opt-out yet (staff, 2026-02-09).
- The MeshParts inside get their own MeshIds. No API returns them, and they don't appear in the inventory (community; staff confirmed the workaround below).
- Prefer `.glb` over `.gltf`: `.gltf` references external `.bin` and texture files that are not uploaded.
- Whether embedded FBX textures arrive as SurfaceAppearance/TextureID is unknown (verify in the calibration check).

```bash
oc.ts upload --file assets/export/SM_Sword.fbx --name SM_Sword   # illustrative path; dry run, then --yes
```

Read the MeshIds after the upload. Either:
- **Studio open:** MCP `insert_asset` with `assetId` = the Model ID and `assetType: "Model"`. Insert it under a scratch parent such as `game.ServerStorage`. Then `search_game_tree` + `inspect_instance` on each MeshPart: `MeshId`, `TextureID`, `Size`, `PivotOffset`, children (SurfaceAppearance).
- **No Studio:** the Luau Execution recipe in `04-luau-execution.md` (`InsertService:LoadAsset`, staff-suggested).

Record both IDs where the project keeps asset IDs:
- `"SM_Sword.fbx": "<Model asset ID>"`: the uploaded file, keyed by file name like textures. `update-asset` and `insert_asset` need this ID.
- `"SM_Sword": "<MeshId number>"`: the MeshPart, keyed by object name.

The lock also keeps the Model ID with the file hash, but it is a log: never edit it by hand.

### Calibration check for the Open Cloud Model route
Run it once per project, and again after the exporter or its settings change. It needs the user's OK: it creates a permanent test asset.
1. **Get a test FBX that shows the axes.** Export, with the project's normal settings, a 1x1x1 cube with its -Y face marked (for example recessed) and small marker plates outside -Y, +Z and +X, all in one file. A lone cube can't show the axes. If the project already calibrated the 3D Importer with such a file, reuse that file so both routes see the same input.
2. **Upload it:** `oc.ts upload --file <test>.fbx --name SM_Calib_opencloud`, then `--yes` once the user agrees. One upload, one test asset.
3. **Insert and compare.** Insert it with MCP `insert_asset` and compare against the same file brought in through the 3D Importer (or the project's recorded Importer results):
   - `Size` (1, 1, 1 when 1 Blender unit = 1 stud);
   - which Blender axes became Roblox X, Y and Z, and which marked face `LookVector` points out of;
   - `PivotOffset` against the Blender origin;
   - the Model's `WorldPivot`;
   - whether textures came through;
   - `CollisionFidelity`, `RenderFidelity` and MeshPart names.
4. **Record the outcome** where the project documents its asset pipeline; it is a convention change. If anything differs from the Importer, keep the 3D Importer route, or adjust the export and check again.

## Update an asset
- **New FBX content, same ID:** `oc.ts update-asset --asset-id <modelId> --file new.fbx`. This creates a new version (official). The lock refuses an identical file. Places that use the package see the new version according to their package settings (verify). Whether the MeshIds inside stay the same is unknown (verify): re-read them.
- **Metadata only:** `oc.ts update-asset --asset-id <id> --type Image --name new_name --description "..."`. This sends `updateMask=displayName,description`. Icons and previews must be Image assets, and icons must be square (official).
- **Images, audio and video can't take new content:** upload a new file, which gets a new ID. Update the recorded ID, and keep the old one until nothing references it.

## Moderation and status
- **Moderation state:** the finished operation carries `moderationResult.moderationState` (`MODERATION_STATE_APPROVED`, `..._REVIEWING`, `..._REJECTED`). Re-check later with `oc.ts request GET /assets/v1/assets/<id>`.
- **Lock entry states.** Each lock entry moves through these states:

  | State | Meaning | Blocks a re-upload? |
  |---|---|---|
  | `sending` | Written before the request goes out | Yes |
  | `pending` | Operation accepted, not finished | Yes |
  | `done` | Finished, with `assetId`, `revisionId`, `moderationState` | Yes |
  | `unknown` | Connection lost or timed out after the request was sent, or a 5xx: Roblox may have created the asset anyway | Yes |
  | `failed` | Nothing was created: a 4xx rejection, a connection that never got through (offline, DNS, TLS, refused), or an operation error | No |

  - **`unknown`:** ask the user to check the creator's Development Items on Creator Hub. If the asset exists, record its ID. If it doesn't, re-run with `--force`.
  - **`pending` at the timeout:** resume with `oc.ts operation operations/<id>`; that also finishes the lock entry. Uploads of about 20 MB FBX were reported stuck for hours (community).
- **Concurrent runs:** each change re-reads the lock file while holding a mutex file next to it (`roblox-uploads.lock.json.mutex.tmp`), so runs in parallel merge instead of overwriting each other. A mutex left by a run whose process is gone is taken over.
- **One lock per project:** inside a git repository, `--lock` and `ROBLOX_UPLOAD_LOCK` can't point anywhere but `roblox-uploads.lock.json` at its root, and `--no-lock` is refused. Outside a repository, pass `--lock PATH`, or `--no-lock` for a throwaway upload.
- **Check the project's own records too:** an ID recorded before the lock existed (an earlier 3D Importer or `upload_image` upload) is not in the lock. Look the file name up where the project keeps asset IDs before uploading, and reuse that ID unless the file really changed.
- **No server-side dedupe:** Roblox does not deduplicate identical uploads (no source says it does), hence the lock.

## Versions, archive, restore (official, beta)
```bash
oc.ts request GET /assets/v1/assets/<id>/versions --query maxPageSize=50
oc.ts request GET /assets/v1/assets/<id>/versions/<n>
oc.ts request POST /assets/v1/assets/<id>/versions:rollback --form assetVersion=assets/<id>/versions/<n>   # write: dry run, then --yes
oc.ts request POST /assets/v1/assets/<id>:archive    # write; reverse with :restore
```

## Download what Roblox stored (official)
```bash
oc.ts download --asset-id <id> [--version <n>] --out build/assets/<id>.bin
```
- The scope is `legacy-asset:manage`; community reports it can't be used for group assets.
- The API returns a temporary CDN `location`. `oc.ts` fetches it **without** the key and un-gzips it.
- Use it to diff versions, inspect a processed mesh, or re-upload as `Mesh`.

## Permissions, quotas, 3D thumbnails
Let another universe use an asset (for example audio or a model shared across experiences). This is a write: dry run first.
```bash
oc.ts request PATCH /asset-permissions-api/v1/assets/permissions \
  --json '{"subjectType":"Universe","subjectId":"<universeId>","action":"Use","requests":[{"assetId":<id>,"grantToDependencies":true}]}'
```
- `subjectType` is one of `User`, `Group`, `GroupRoleset`, `All`, `Universe`.
- `action` is one of `Use`, `Edit`, `Download`, ... (official, beta).

**Remaining upload quotas:** `oc.ts request GET /cloud/v2/users/<userId>/asset-quotas` (official, beta).

**3D thumbnail of an asset:** `oc.ts request GET https://thumbnails.roblox.com/v1/assets-thumbnail-3d --query assetId=<id> --query useGltf=true` (official, beta). Useful to look at the processed model outside Studio (verify the response format).

## Official links
- Usage guide for assets: https://create.roblox.com/docs/cloud/guides/usage-assets
- Assets API reference: https://create.roblox.com/docs/cloud/reference/features/assets
- Packages: https://create.roblox.com/docs/projects/assets/packages
- Asset IDs (`rbxassetid`): https://create.roblox.com/docs/projects/assets
- Staff, models upload as packages: https://devforum.roblox.com/t/open-cloud-upload-support-for-more-asset-types/4022082
- MeshIds of uploaded models: https://devforum.roblox.com/t/how-to-get-meshid-from-model-upload-cloud-assets-api/3226166
