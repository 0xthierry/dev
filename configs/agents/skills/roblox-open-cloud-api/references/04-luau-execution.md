# Luau Execution: run Luau without Studio

Read when you need Luau to run against the published or saved place with Studio closed or not involved. Typical jobs:
- smoke tests after a publish;
- unit tests in CI;
- checks on what a version really contains;
- reading the MeshIds of an uploaded model;
- one-off data jobs.

## Which one to use
| | MCP `execute_luau` | Open Cloud Luau Execution |
|---|---|---|
| Runs on | The user's Studio, in the open place (Edit, Server or Client DataModel) | A Roblox server, on a saved place version |
| Needs | Studio open with the place | An API key with `universe.place.luau-execution-session:write` and a saved or published version |
| Sees unsaved Studio edits | Yes | No (verify) |
| Keeps changes | Yes, when Studio saves | No by default. The script can call `AssetService:SavePlaceAsync` (see Saving below) |
| Physics, place scripts | Only in a playtest | No physics. Scripts in the place don't auto-run; modules can be required (official) |
| Cloud data | Only with "Enable Studio Access to API Services" (official) | Live DataStores, MemoryStores and HttpService (staff, community) |
| Limits | About 60 s per call (tested) | 5 min; 4 MB script; 4 MB return value (official) |

Use MCP while the user works in Studio. Use Luau Execution for headless, repeatable checks of what is on Roblox.

## Run a task
```bash
oc.ts luau --script-file tests/smoke.luau                  # dry run: URL, calls that change things, the script (head and tail if over 2000 bytes)
oc.ts luau --script-file tests/smoke.luau --yes            # after the user's OK
oc.ts luau --script-file x.luau --version 12 --yes         # a specific version (from oc.ts publish output)
oc.ts luau --script 'return #workspace:GetDescendants()' --task-timeout 60 --yes
```

**What happens:**
- Universe and place come from `--universe`/`--place` or `ROBLOX_UNIVERSE_ID`/`ROBLOX_PLACE_ID`.
- Without `--version` the task runs on the latest version (verify which: saved or published).
- `oc.ts` creates the task, polls it, then fetches the logs. It prints `{path, state, output: {results: [...]}, error, logs: [...]}`.
- Exit 1 on `FAILED` or `CANCELLED`. Exit 5 if it is still running at `--timeout` (default 420 s); resume with `oc.ts operation <path>`.

Every task needs the user's OK (oc.ts dry-runs it): the script can write live data.

## Writing task scripts (official unless tagged)
- **Plain Luau, no wrapper.** `return` values are serialized to JSON; non-serializable values, such as Instances, come back as null.
- **`print` output** becomes the logs. Only the last 450 KB is kept, and logs are readable only after the task ends.
- **Errors:** an unhandled error fails the task. `error.code` is one of `SCRIPT_ERROR`, `DEADLINE_EXCEEDED`, `OUTPUT_SIZE_LIMIT_EXCEEDED` or `INTERNAL_ERROR`.
- **The full DataModel is available:** `require(game.ReplicatedStorage.Module)` works.
- **Environment quirks:**
  - Security level is GameScript (staff). Properties that need plugin security can't be read: for example `SurfaceAppearance.ColorMap`. Read `ColorMapContent` instead (official engine API).
  - `RunService:IsStudio()` returns false (community).
  - `loadstring` and `ScriptEditorService` are unavailable (community).
- **Results** are kept for 24 h.

## Saving changes (official, untested here)
**By default nothing is saved.** The task's DataModel changes are local and are discarded when the task ends (official resource description).

**Saving with `SavePlaceAsync`:** the Luau Execution feature page (updated 2026-10-16) says a script can save the place with `AssetService:SavePlaceAsync`. That method:
- works only on places created by `CreatePlaceAsync` or with its API enabled in the place's settings;
- overwrites the place state;
- is blocked by an active Team Create session (official AssetService doc).

That makes the task a write to the place. Treat it like publishing: confirm first, and remember that SurfaceAppearance and other caveats of non-Studio publishing may apply (verify).

## Limits (official)
| Limit | Value |
|---|---|
| Script | 4 MB |
| Run time | 5 min (`--task-timeout` 1-300 s) |
| Return values | 4 MB as JSON |
| Logs kept | 450 KB |
| Unfinished tasks per place | 10 (more → HTTP 429) |
| Create tasks | 5/min per key owner, across all their universes |
| Get task | 200/min |
| Logs | 45/min |
| Binary input | ≤ 100 MiB, valid 15 min |
| Binary output | ≤ 256 MiB |

## Recipe: MeshIds of an uploaded Model
`02-assets.md` explains why this is needed. Replace `ASSET_ID` with the Model asset ID from `oc.ts upload`.
- `InsertService:LoadAsset` in a task is the route staff suggested (official, 2024-11-22). That it can load an asset the experience owner owns is assumed (verify).
- `MeshId`, `TextureID` and `SurfaceAppearance.ColorMapContent` are readable from game scripts. `SurfaceAppearance.ColorMap` is plugin-only and would fail the task (official engine API).

```lua
local model = game:GetService("InsertService"):LoadAsset(ASSET_ID)
local meshes = {}
for _, d in model:GetDescendants() do
	if d:IsA("MeshPart") then
		local sa = d:FindFirstChildWhichIsA("SurfaceAppearance")
		table.insert(meshes, {
			name = d.Name,
			meshId = d.MeshId,
			textureId = d.TextureID,
			size = { d.Size.X, d.Size.Y, d.Size.Z },
			pivotOffset = { d.PivotOffset:GetComponents() },
			colorMap = sa and sa.ColorMapContent.Uri or nil,
		})
	end
end
return meshes
```

## Recipe: smoke test of a version
```lua
local ok, err = pcall(function()
	require(game.ReplicatedStorage:WaitForChild("Shared", 5))  -- adjust to the real module tree
end)
local counts = {}
for _, d in game.Workspace:GetDescendants() do
	counts[d.ClassName] = (counts[d.ClassName] or 0) + 1
end
return { modulesLoad = ok, error = err and tostring(err), meshParts = counts.MeshPart or 0, parts = counts.Part or 0 }
```
Run it after `oc.ts publish --saved`, with `--version <versionNumber>`, before publishing for real.

## Binary input and output (official)
- **Input:** `POST /cloud/v2/universes/<u>/luau-execution-session-task-binary-inputs` with `{"size": N}` returns an `uploadUri`. Upload the bytes there (method not stated; verify), then pass the input's `path` as `binaryInput` in the task body. Use `oc.ts request ... --json` with the full task body. The script reads `({...})[1].BinaryInput` (a buffer).
- **Output:** set `enableBinaryOutput: true` and return `{BinaryOutput = buf, ReturnValues = {...}}`. The task's `binaryOutputUri` is then downloadable for 15 min after the task completes (official).

## CI
- **jest-roblox-cli** (community, MIT, v0.4.7 2026-10-13): publishes the place, then runs Jest tests as tasks.
- **Roblox/place-ci-cd-demo:** Rojo + Luau Execution. It is archived, but the docs link to it as the reference implementation.

Either needs a key with `universe-places:write` and `universe.place.luau-execution-session:write`, kept in the CI's secret store, never in the repo.

## Official links
- Luau Execution reference: https://create.roblox.com/docs/cloud/reference/features/luau-execution
- AssetService:SavePlaceAsync: https://create.roblox.com/docs/reference/engine/classes/AssetService#SavePlaceAsync
- Staff launch thread: https://devforum.roblox.com/t/beta-open-cloud-engine-api-for-executing-luau/3172185
- Reference implementation: https://github.com/Roblox/place-ci-cd-demo
