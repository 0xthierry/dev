# Preview in Studio, upload, and use in a game

Read this for the `preview` and `upload` stages and for wiring the outfit into a game.

## Preview without uploading

Uploads are permanent, so look at the outfit on the real body first. Studio can't composite a local Shirt image: `Shirt.ShirtTemplateContent` accepts an `EditableImage` but doesn't render it. The preview therefore textures each body part directly, with the textures Roblox's compositor would make. It matches the compositor on the Blocky, Man and Woman bodies.

1. `clothing.py preview <outfit>` writes `<outfit>/preview/<Part>.png` (the torso composite 388×272, the limb composite 264×284; shirt over pants over the skin colour). It prints the next two commands.
2. **Start the relay** (localhost only), serving the folder that holds the outfit folders:

   ```bash
   uv run --no-project --with pillow python -I <skill>/scripts/relay.py <outfits_parent> 8767
   ```

   Run it in the background; stop it when done.
3. **Pick the place.** The preview adds a `workspace.ClassicPreview` folder to whatever place is open. Use a scratch place, or ask the owner before adding rigs to their game's place, and delete the folder afterwards.
4. **Run [`scripts/ClassicPreview.luau`](../scripts/ClassicPreview.luau) once** in edit mode (command bar, or the Studio MCP's `execute_luau`), then:

   ```lua
   local P = _G.ClassicPreview
   P.dress(P.rig("hoodie", CFrame.new(0, 5, 0)), "hoodie/preview")
   P.lineup({ "hoodie/preview", "knight/preview" }, Vector3.new(10, 0, 0), 5)  -- many outfits in a row
   ```

   `P.fetch` turns `HttpService.HttpEnabled` on only while it fetches, then restores it.

**What to look at** (screenshots through the Studio MCP's `screen_capture`, or the viewport):
- **The four sides with a near-orthographic camera** (Camera `FieldOfView` 8, far away): every band and seam meets at the corners, nothing is cut at a face edge.
- **A pose that opens the limbs:** `P.pose(model, "rbxassetid://<animation id>", t)` or with an `AnimationClip`. The inner sides, the armpits and the inside of the legs show then.
- **20 studs with the default 70° camera:** the character is ~200 px tall, as on a phone. The outfit must still read by its colour blocks.

## Upload (the owner's OK first)

Each image becomes a permanent, moderated asset on the owner's Roblox account or group.

1. `clothing.py upload <outfit> --creator user:<id>` (or `group:<id>`, or `ROBLOX_CREATOR` in the environment) prints the `oc.ts upload` commands as dry runs. `oc.ts` is the `roblox-open-cloud-api` skill's script.
2. Show them to the owner. After they agree, run each from the **game's repository** with `--yes`. `oc.ts` records the file's hash in that repository's `roblox-uploads.lock.json` and refuses a second upload of the same file. The API key (`OPEN_CLOUD_API_KEY`) is the owner's to set in the shell; never ask for it in chat.
3. Upload as type `Image` (a `Decal` upload returns the decal's ID, not the image's).
4. Record the two IDs where the game keeps its asset IDs, e.g. a Luau module keyed by outfit:

   ```lua
   Hoodie = { Shirt = "rbxassetid://<shirt image id>", Pants = "rbxassetid://<pants image id>" },
   ```

5. Check them on a rig: `P.wear(P.rig("check", CFrame.new(0, 5, 0)), <shirt id>, <pants id>)` uses Roblox's own compositor. A texture that shows grey after an upload can be Studio caching an earlier failed load; restart Studio.

## Use in the game

- **Dress a character** (player or NPC) with `Shirt` and `Pants` instances: remove the character's existing `Shirt`/`Pants`, then parent a `Shirt` with `ShirtTemplate = "rbxassetid://<image id>"` and a `Pants` with `PantsTemplate`. For players, do it on spawn (`CharacterAdded`), on the server.
- **`HumanoidDescription.Shirt` and `.Pants` take catalog clothing asset IDs, not image IDs.** An uploaded image can't go there; use the instances above.
- **Bodies that show nothing** (UGC and some Rthro bodies, see [template and body](template-and-body.md#bodies-that-show-classic-clothing)): decide in the game's avatar settings, or with a `StarterCharacter`, which bodies players have.
  - Another way to dress those bodies is a *layered carrier*: the same art projected onto a layered garment's UVs. It is a separate pipeline, not part of this skill.
