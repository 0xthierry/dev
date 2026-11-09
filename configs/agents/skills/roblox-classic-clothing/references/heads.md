# NPC heads: the head, faces, and pieces made from any reference

A character's head is four layers, each made its own way:

| Layer | How | Tools |
|---|---|---|
| **The head** | Roblox's native classic mesh, retaining the rig's head size and attachments | `H.npcHead` in `scripts/heads/lab/HeadLab.luau` |
| **The face** | A flat image (the features on transparency) projected onto the head's front | `codex-image` with `prompts/face.md` |
| **Pieces** (hair, hats, masks, bands, beards) | Painted onto a render of our head from a reference, made 3D by Tripo, fitted and checked | `npc_head.py render`, `codex-image`, Tripo, `fit_on_head.py` |
| **Catalog items** | Marketplace hair, hats and face pieces by ID, through `HumanoidDescription` | `H.search` in the lab |

All tools run from the game repository's root; outputs go to `build/heads-lab/` (git-ignored). Python tools that need Blender run with `blender -b --factory-startup --python <tool> -- <args>`.

## References and uploads

- Make faces and pieces from the owner's requested references: concept art, sketches, photos, characters, or descriptions.
- Ask before any upload: uploads are permanent.

## The head

Use **Roblox's native classic head with a static face** by default. This is the owner's chosen workflow. The built-in URI is `rbxasset://avatar/heads/head.mesh` (two slashes). Load it with `AssetService:CreateMeshPartAsync(Content.fromUri(...))`, then apply it to the existing `Head` with `ApplyMesh`. The bundled `H.npcHead` does this, removes old face visuals and `FaceControls`, and sets the flat face through `TextureContent`. Keep the original head's size, neck joint and attachments. Read dimensions from the actual rig; the tested default R15 rig had Size approximately 1.159 × 1.182 × 1.161 studs, but that is not a universal size.

**Classic and dynamic are different:** the default R15 head created in our test was dynamic. A dynamic head supports rigged facial movement through `FaceControls`; the classic head uses a static image. Change a classic expression by swapping that image. If the owner requests facial animation, use a compatible dynamic-head workflow explicitly; applying a flat anime texture does not create a facial rig.

For an explicit dynamic-head request, read [dynamic heads](dynamic-heads.md). It covers the Sukuna experiment from automatic-conversion attempts through manual rigging and refinement, including mouth topology, crisp artwork, pose export, Play restoration, and remaining limits. The native classic head with a static face remains the standard path described here.

**Verified evidence (2026-11-09):** native classic heads with Yuji and Sukuna face textures and existing hair rendered in desktop Studio Edit and Play, with the neck and accessory constraints connected. Freezing the tested dynamic head with `StaticFacialAnimation` or removing `FaceControls` left its raised eye geometry visible. An EditableImage-backed Decal stayed blank in this test, while `MeshPart.TextureContent` worked; do not generalize that result to all decals or heads. Mobile, published multiplayer, other character fits and player morphs need their own checks.

Do not silently fall back to the reconstructed head if the native mesh fails to load. Report the failure and investigate it. Roblox's [DevForum report on built-in mesh loading](https://devforum.roblox.com/t/meshcontentprovider-consistently-fails-to-load-core-avatar-meshes-on-some-mobile-devices/4614855) documents the two-slash URI fix. See also [dynamic head components](https://create.roblox.com/docs/avatar/dynamic-heads), [the migration announcement](https://devforum.roblox.com/t/completing-the-dynamic-head-migration/4301387), and [a community classic-head implementation](https://devforum.roblox.com/t/rdh-force-classic-heads-and-faces/4449916). Community examples establish implementation patterns, not the internals of any particular game.

### Blender fitting proxy

`npc_head.py` and `fit_on_head.py` still use a reconstructed shell from Roblox's `BlockyCharacter.fbx`. Keep it only as a provisional reference for painting and fitting hair; it is not the native classic mesh and is not the shipped head. The proxy's intersection check cannot prove a fit on the native head. Check the actual native head from the front, side, back and below in Studio and adjust any clipping or gaps before accepting the piece.

Fetch the reference only when that Blender fitting workflow is needed:

```bash
curl --create-dirs -o build/heads-lab/reference/BlockyCharacter.fbx https://prod.docsiteassets.roblox.com/assets/avatar/dynamic-heads/reference-files/BlockyCharacter.fbx
```

Do not run `npc_head.py export` or pack `npchead.json` for the native-head runtime. Existing reconstructed-head assets remain historical references; do not migrate existing approved characters without checking each fit.

## Faces

- **One image per expression** with `prompts/face.md`: square, transparent background, only the features.
- **The layout:** the square is the whole front of the head, with eyes at about 42% of its height and the mouth at about 68%.
- **Expression pairs:** a calm and a fierce face of the same character share the eyebrows' shape, so the swap changes the mood, not the character.

```bash
bun ~/.agents/skills/codex-image/scripts/codex-image.ts --prompt-file face.md --out build/heads-lab/faces/<name>.png --transparent
```

- **Transparent pixels show black** when a texture is set through an `EditableImage`. So `HeadLab` bakes the face over the skin colour, and the whole head takes one texture.

## Pieces from any reference

The method that fits best: have an image model paint the piece **onto a head reference render**. Then Tripo makes head and piece into one model, and the fitter cuts the AI's head away and fits the piece around the proxy. A piece generated without a head often has a mismatched hollow. The final native-head fit must be checked in Studio.

1. **The reference render**, the fitting proxy on a short neck with a simple face. The face matters: without it, a band or mask lands off the eyes.

   ```bash
   blender -b --factory-startup --python ~/.agents/skills/roblox-classic-clothing/scripts/heads/npc_head.py -- render build/heads-lab/ref/npc-head.png
   ```

2. **Paint the piece on it** from the reference. Fill [`prompts/piece-on-head.md`](../scripts/heads/prompts/piece-on-head.md) and pass two images, our render first and the reference second:

   ```bash
   bun ~/.agents/skills/codex-image/scripts/codex-image.ts --prompt-file piece.md --ref build/heads-lab/ref/npc-head.png --ref <reference.png> --out build/heads-lab/ref/<piece>-on-head.png
   ```

   **Worked example** ([`examples/heads/topknot`](../examples/heads/topknot/)): from an original concept painting of an old master (`reference.jpg`), the model moved only the hair onto our head (`painted-on-head.jpg`): the tall topknot, its red cord, the jade pin and two side locks. It kept the head and face exactly and left out the person, the beard and the painting style. The filled prompt is `piece-on-head.md`.

   **What helps:**
   - **Keep the head exactly.** Image 2 gives only the piece's design; ignore its person, face and art style.
   - **Say where the piece sits** on this head: the hair down to mid-head at the sides; a band level, covering both eyes.
   - **Name the colours plainly.** Image models drift, for example a lavender turning pink.
   - **Ask for matte, flat colours** on parts meant to be flat (a band, a strap). Highlights and specks get baked into the texture.
   - **Check the image before spending credits:** the head unchanged, the piece where it should be, nothing extra.
   - Without a reference image, the same template works with a description instead of Image 2.

3. **Make it 3D** in Tripo (studio.tripo3d.ai), driven from the owner's browser with the `playwriter` skill:
   - **Settings:** image to 3D, the HD model, **20,000 polygons**. The polygon setting is saved as the account's default, so set it back afterwards.
   - **Cost:** 55 credits, about 3 to 4 minutes.
   - **Export as GLB:** capture the signed `…glb?` URL from the network response and `curl` it.
   - **Clean up:** move any copy the browser saved out of `~/Downloads`, and close only your own tab.

4. **Fit and check:**

   ```bash
   blender -b --factory-startup --python ~/.agents/skills/roblox-classic-clothing/scripts/heads/fit_on_head.py -- $(pwd)/<piece>.glb <Name> HairAttachment $(pwd)/build/heads-lab/pieces.json 8000 512 0 0.008 0.3
   ```

   The arguments, in order: triangles, texture size, brightness bands (0 = none), inverted-hull outline width (0 = none), and `flat` (texels darker than this become one flat colour; 0 = off). These were the best settings for stylized anime hair: 8,000 triangles, a 512 texture, a 0.008 outline. Use `flat` for a piece with a uniform dark part.

   **What the fitter does:**
   1. **Welds** the vertices glTF splits along UV seams. Generators make hundreds of UV islands, and split vertices keep different normals, so smooth shading breaks into facets: streaks on a flat colour, sharded locks, cracks in the outline.
   2. **Splits** the AI's head off by skin colour (each face is classed by the colour at its centre), then drops islands under 1% of the area, such as the face painted on the render.
   3. **Fits** the AI head onto ours by its width, its front, and the level where it first reaches 80% of its width; one uniform scale.
   4. **Pushes out** any vertex inside our head, along the line from its centre, to 2% beyond the surface.
   5. **Keeps colour edges** (vertices between faces of strongly different brightness) out of the decimation, so triangles don't fade a band into the hair.
   6. **Decimates** to the triangle budget.
   7. **Head check:** triangles that dip into the curved head after decimation (a chord inside a curve) move out, so skin can't show through.
   8. **Copies normals** from the full-detail piece onto the decimated one.
   9. **Flattens** dark texels when asked.
   10. **Paint check** (`texture_check.py`):
       - **unpainted faces:** triangles that sample texels outside the piece's own faces, or skin-coloured texels (generators bleed skin into a piece where it meets the head), take a painted neighbour's colour;
       - **specks:** small blobs far off the colour that surrounds them, such as a light dot on a black band, take that colour; corners of real shapes are left alone;
       - **the gutter:** islands are padded 8 texels out, so filtering doesn't bleed unpainted colour in.
   11. **Checks again and reports.** A clean run ends at 0 unpainted faces and 0 specks left; anything else prints `NOT CLEAN`. A picture of every fix goes to `<out>-<Name>-paint.png`.
   12. **Outline (optional):** an inverted-hull piece, `<Name>Outline`.

5. **Look at it in Studio** (below), close up, from the front, side, back and below. When something shows, find which layer it's in before fixing it:
   - **Texture or shading?** Set the piece's `TextureContent` to none and paint it a plain colour. If the flaw goes away, it's in the texture (use `flat`, or the paint check). If it stays, it's the shape or the normals.
   - **Which object?** Hide one object at a time (`Transparency = 1`) to see which one the flaw belongs to.
   - **A thin white line** across a piece is a specular glint on the outline's folds. Outlines are black `Neon`, which draws unlit.

## Preview in Studio without uploading

The Studio MCP's code runner can't reach localhost, so the data travels inside the place: `pack.py` writes it for a Rojo project, and the place carries the `HeadLab` module.

1. Copy [`scripts/heads/lab/`](../scripts/heads/lab/) to `tools/heads-lab/` in the game repository. Its project file reads data from `../../build/heads-lab/data`.
2. Pack the data and build the place:

   ```bash
   uv run --no-project --with pillow --with numpy python -I ~/.agents/skills/roblox-classic-clothing/scripts/heads/pack.py build/heads-lab/pieces.json build/heads-lab/faces/*.png
   ```

   ```bash
   rojo build tools/heads-lab/heads-lab.project.json -o build/heads-lab/HeadsLab.rbxl && open build/heads-lab/HeadsLab.rbxl
   ```

3. Build NPCs in edit mode:

   ```lua
   local H = require(game.ReplicatedStorage.HeadLab)
   H.npc("Master", CFrame.new(0, 4, 0) * CFrame.Angles(0, math.pi, 0), {
   	skin = Color3.fromRGB(232, 190, 160),
       face = "<face name>",            -- native classic head with this static face
   	pieces = { "<Name>", "<Name>Outline" }, -- fitted pieces; pieceTexture = false for their own textures
   	hair = "<catalog id>",           -- or catalog items
   	shirt = <template image id>, pants = <template image id>,
   })
   ```

**What the lab handles:**
- **Accessory scaling:** the Humanoid scales every accessory by the head's `Size / OriginalSize`. Pieces fitted to the head as it is would come out about 3% small, so `HeadLab` authors them for the unscaled head and lets that scaling bring them back.
- **Play:** the native head mesh uses a built-in URI and does not need EditableMesh reconstruction. Preview faces and generated hair still use session-local EditableImage/EditableMesh objects. `HeadLabClient` restores them from packed data on each client, including attributes that arrive after the instance. A remote object's `SourceType == Object` alone does not prove that its mesh/image is usable locally. Recheck native head, face and hair after appearance loading, respawn and morphing; do not claim those paths work from an NPC screenshot alone.
- **Turning into an NPC:** `HeadLabMorph` puts a pad in front of each NPC, and a click on the NPC works too. Either one respawns the player in place with the NPC's description (`Player:LoadCharacterWithHumanoidDescription`), then copies its clothes, pieces and face. The "Me" pad gives the player's own avatar back.
- **The Studio MCP** connects at most about eight places. Close old lab places, and run Play tests in the newest one.

## Into the game

A lab NPC is built from data inside the place. A game needs real assets:
- **Faces and textures:** upload them as `Image` assets (the `roblox-open-cloud-api` skill, with the owner's OK) and set them as the head's and pieces' texture IDs.
- **The native head:** use the bundled URI; no reconstructed-head upload is needed.
- **Custom pieces:** upload them as meshes through Studio's 3D Importer, or as Open Cloud `Model` uploads once that route is calibrated (that skill's rule). Wear them with the standard accessory system: `Accessory` + `Handle` + the attachment the piece was fitted to.
- **Record every ID** where the game keeps asset IDs, and commit the upload lock.
