# Create and refine a dynamic NPC head

Use this workflow only when the owner explicitly requests facial animation. Deliver a head that preserves the approved character design and visibly deforms through `FaceControls` in Studio Play. Keep **Roblox's native classic head with a static face as the default** for ordinary NPC work; [heads.md](heads.md) owns that workflow.

A face texture does not create a facial rig. This dynamic path uses a compatible rigged mesh, skin weights, and mapped poses. Do not run `H.npcHead` on it: that helper applies the classic mesh and removes `FaceControls`.

## Scope and evidence

The worked example is the Sukuna experiment completed on 2026-11-09 with Blender 5.2.2 and desktop Roblox Studio. It retained the approved hair and face artwork, rebuilt the wide grin, and verified five facial controls in Play. These are observations from that experiment, not universal head dimensions, importer behavior, or certification for other platforms.

Read the sections relevant to the work:

- [Prepare the comparison](#prepare-the-comparison): preserve the reference and choose expressions.
- [Choose the conversion route](#choose-the-conversion-route): automatic processing versus manual rigging.
- [Build the face around its artwork](#build-the-face-around-its-artwork): mouth, eyes, markings, and weights.
- [Map and export poses](#map-and-export-poses): the working five-control FBX setup.
- [Integrate in Studio](#integrate-in-studio): scale, neck, textures, and Play.
- [Refinement history and gotchas](#refinement-history-and-gotchas): verified failures and fixes.
- [Verify and deliver](#verify-and-deliver): visual, runtime, and persistence evidence.

Roblox's [dynamic-head overview](https://create.roblox.com/docs/avatar/dynamic-heads) explains the mesh, animation data, cages, and attachments. Its [basic-head tutorial](https://create.roblox.com/docs/art/characters/facial-animation/create-basic-heads) describes joints, weights, pose mapping, and a five-pose educational example. A limited NPC experiment is not automatically a full facial-capture or Marketplace-ready head. Marketplace publishing remains outside this skill.

## Prepare the comparison

1. Keep the approved static character intact and create a separate dynamic test rig/place. Record its `Head.Size`, `CFrame`, skin color, neck connection, attachments, hair, and face source image. Measure the actual rig rather than guessing from the viewport or using a nominal 2 × 1 × 1 box.
2. Define the requested expressions and the default appearance. Sukuna's default was his wide toothy grin; zero control values must preserve that design. The five controls were each eye closing, jaw opening, and each lip corner pulling. His small secondary eyes remained painted markings, not independently animated eyes.
3. Keep the static and dynamic versions under the same lighting, camera, and skin color. Compare recognition, silhouette, feature positions, and sharpness before judging animation.
4. Retain editable source and each tested import separately. A newer export is not a verified replacement until it has passed the Studio checks.

The tested heads both measured approximately **1.158978 × 1.182013 × 1.160638 studs**. Those values belong to the tested rig. Read the next rig's dimensions again. Matching `Size` alone does not establish matching silhouettes or accessory fit.

## Choose the conversion route

If the owner wants to try Avatar Setup's automatic conversion, inspect the current supported inputs and monitor its job status. Avoid starting another conversion while the first job's state is unresolved. Record the last observed stage, percentage, timestamp, returned model, and any failure.

In the Sukuna experiment, an MCP request timed out after 300 seconds without returning a model. Later logs showed backend activity. A native-UI retry advanced from 30% Queueing to 42% Rigging body, then produced no model during roughly 20 minutes of waiting and was canceled. This did not establish that automatic conversion can never work. It established that this attempt did not complete.

**Recent logs prove recent activity, not continuous progress or eventual completion.** Describe a stalled or unknown job state honestly. Agree on or state a bounded retry/wait plan appropriate to the task; cancel the owned job before moving on when its UI supports cancellation. Do not replace the requested animated outcome with a static face and call the task complete.

The working route was manual: inspect Roblox's reference facial rig, then author a compact custom rig around the approved artwork. The first prototype adapted the official BlockyCharacter facial rig; the refinement used a new mouth opening and a 26-bone facial skeleton on the fitting shell. Using that reconstructed shell as a custom dynamic mesh is specific to this explicitly requested experiment. It does not change the rule against shipping the proxy in the native static-head path.

## Build the face around its artwork

### Preserve the approved image

Use the original face image as the UV source when it already has the correct expression and detail. Sukuna's source was a 1254 × 1254 transparent image. The early atlas reduced the effective resolution of his features; the refined head sampled the original image directly instead.

Separate the animated main eyes and mouth from stationary markings. In this example, thin mesh patches conformed to the shell and sampled the untouched original UVs. The neutral head, eye patches, markings, and tooth rows shared that image. In Studio the lab composited transparency over the matching skin color using `H.face(faceName, skin)`.

For image-derived geometry, inspect the source and trace its actual feature boundaries. Connected-component IDs, pixel coordinates, sampled dark texels, and mouth curves belong to one image; recompute them for another character. Treat small components as possible intentional details before discarding them. Artwork generation or repainting follows the image skill; geometric tracing does not require repainting approved pixels.

### Construct a mouth that can open

1. Trace the outer grin and the dark separator between the upper and lower teeth. The grin's width and corners are part of the character's identity.
2. Cut a physical opening through the front shell. Give it a dark interior so opening the jaw reveals a mouth cavity rather than skin or the back of the head.
3. Make separate upper and lower tooth-row surfaces that reproduce the original artwork at rest. Keep the upper row largely fixed; weight the lower row and lower lip toward the jaw.
4. Add corner controls with local falloff. Move neighboring skin and chin markings consistently with the mouth so they do not float or tear.
5. Inspect the grin at zero, intermediate, and full jaw values. Adjust weights and topology before reducing the intended mouth width. In the tested refinement, excluding the upper quarter of the mouth region from jaw influence removed a small upper-lip fold.

Do not simply stretch the native rig's small mouth and assume it recreates a wide anime grin. The first Sukuna prototype animated successfully but failed this visual requirement; rebuilding the opening and tooth rows corrected it.

### Make the eyes close without raised eye geometry

The tested approach used a conforming silhouette patch for each main eye, with five upper and five lower joints along its width. Interpolated vertex weights moved the artwork toward a closing line. Translate the joints in their actual local axes; check the result after FBX import, not just in Blender.

A thin dark eyelid strip sat behind the shell at rest and moved outward at full closure to cover flattened white pixels. Its depth and thickness were tuned to this head. Inspect half-blinks for exposed strips, overlap, and flicker. This is a stylized flattening of artwork, not an anatomically complete eyelid rig.

Bone scaling in the earlier blink trial did not survive the tested Studio import as intended; translation-based eye poses did. That is a reason to prefer the proven translation approach here, not a claim that Roblox rejects every possible scale animation.

### Keep weights and normals stable

Triangulate the mouth cut before assigning/interpolating weights so the surfaces used for deformation remain stable. Project nearby markings onto the final shell and interpolate the underlying skin weights, rather than giving the markings unrelated movement.

One verified bug caused chin/cheek spikes: a weight-completion helper replaced an existing root weight with only the tiny floating-point remainder. Add the remainder to the existing root weight instead. For nonnegative weights, the tested correction was:

```python
total = sum(weights.values())
if total < 1:
    weights["DynamicHead"] = weights.get("DynamicHead", 0) + 1 - total
elif total > 1:
    weights = {name: value / total for name, value in weights.items()}
```

Inspect extreme poses for bad assignments before smoothing or hiding the affected geometry. Transfer smooth exterior normals from the shell where the Boolean cut or thin patches introduce unwanted shading relief; inspect the mouth interior separately. A texture change cannot fix a deformation spike.

## Map and export poses

Join the facial surfaces into the exported `Head_Geo` mesh while retaining their vertex groups and UVs. Attach the armature modifier and keep a facial root. The refined skeleton contained the root, jaw, two corners, twenty eye joints, and two eyelid-strip joints. This is an example layout, not a required joint count.

The following custom properties were placed on `Head_Geo` in Blender:

| Property | Value | Appearance |
| --- | --- | --- |
| `RootFaceJoint` | `DynamicHead` | Existing facial-root bone name |
| `Frame0` | `Neutral` | Approved wide grin, all controls zero |
| `Frame1` | `LeftEyeClosed` | Wearer's left eye closed |
| `Frame2` | `RightEyeClosed` | Wearer's right eye closed |
| `Frame3` | `JawDrop` | Jaw open |
| `Frame4` | `LeftLipCornerPuller` | Wearer's left corner pulled |
| `Frame5` | `RightLipCornerPuller` | Wearer's right corner pulled |

Reset all facial joints before authoring each pose, and key their neutral values as well as their changed values. Otherwise an earlier pose can leak into a later one. Determine left/right from the character's perspective.

The working Blender FBX export selected only the head and facial armature, with:

```python
bpy.ops.export_scene.fbx(
    filepath=output_path,
    use_selection=True,
    object_types={"MESH", "ARMATURE"},
    use_custom_props=True,
    add_leaf_bones=False,
    bake_anim=True,
    bake_anim_use_nla_strips=False,
    bake_anim_use_all_actions=False,
    bake_anim_force_startend_keying=False,
    bake_anim_simplify_factor=0,
    path_mode="COPY",
    embed_textures=True,
    axis_forward="-Z",
    axis_up="Y",
)
```

Set the scene frame range to the authored pose frames before exporting. Keep unrelated body bones, cameras, lights, and hair out of a head-only export. Hair stays a separate accessory. The refined Blender shader mixed original image alpha over skin; that shader was not reproduced automatically by the importer. The Studio texture application below is therefore part of this recipe, even with `embed_textures=True`.

## Integrate in Studio

1. Import the FBX through Studio's [Importer](https://create.roblox.com/docs/studio/importer) into the isolated lab, within the owner's existing authorization. Inspect warnings and confirm that the imported head contains `FaceControls`. The five-base-pose warning was expected for this deliberately limited experiment; it does not establish full avatar compliance.
2. Inspect the imported dimensions before attaching the head. The tested export arrived at 100× scale. Scaling the imported model by 0.01 corrected that import, then the head's exact size was matched to the static rig. Compute the correction from observed dimensions for each new export rather than applying 0.01 unconditionally.
3. Archive the previous head, insert the new head at the original transform, and reconnect the neck, attachments, and accessory welds to the new instance. Retain the imported bones and `FaceControls`. Check hair fit and the neck in Play. The isolated test rig used `Humanoid.AutomaticScalingEnabled = false`; do not impose that choice on player avatars without evaluating their scaling requirements.
4. Apply the same original artwork and skin color as the static reference. Set `Head.Color` to white when the texture already contains the composited skin, to avoid multiplying it by another tint.
5. Restore session-local image content on the client. The tested helper is [DynamicFace.client.luau](../examples/heads/dynamic-sukuna/DynamicFace.client.luau); it depends on the bundled lab's `ReplicatedStorage.HeadLab` and packed face data. Copy it to `StarterPlayerScripts` only for this dynamic workflow. Set `DynamicFaceTexture` to the packed face name and `DynamicFaceSkin` to its skin `Color3` on the dynamic head.

**Do not set `HeadLabFace` on the dynamic head.** The static lab uses that attribute to restore the native classic mesh and remove facial controls. Use the separate dynamic attributes. Keep the normal static/hair restoration script for the other objects.

The dynamic helper watches for attributes arriving after the instance and for `TextureContent` changes. It caches locally created images and compares the actual image object before assigning again, avoiding a property-change loop. A remote `ContentSourceType.Object` alone does not prove that the image exists on the client. This lab helper is a demonstrated preview example, not a production streaming/lifecycle manager.

Use [Expressions.luau](../examples/heads/dynamic-sukuna/Expressions.luau) to reset all five controls and select a pose. The demonstrated open-mouth preset is `JawDrop = 0.65`, and the smirk uses corner values 0.8 and 0.3. Apply/tween on the client for the local preview. The [FaceControls API](https://create.roblox.com/docs/reference/engine/classes/FaceControls) marks these properties as not replicated; a server-side property write is not proof of multiplayer facial playback. Validate the game's intended animation/replication route separately.

In the observed import, disabling **Upload to Roblox** still produced backend mesh asset references. Do not describe that toggle as a guarantee of zero uploads. Record resulting IDs and distinguish importing an asset from publishing an experience. Follow the main skill's upload authorization rules; the experiment does not grant future upload permission.

## Refinement history and gotchas

| Iteration or symptom | Evidence and action |
| --- | --- |
| Freeze the default dynamic head to use a flat face | Raised eye geometry remained in the static-path test. The static solution was the native classic mesh. For dynamic work, change the facial geometry instead of treating a texture as a rig. |
| Automatic conversion stalls | No model returned from the attempts described above. Report the observed stage and lack of output; continue with manual rigging within the requested scope. |
| First manual prototype animates but has a tiny mouth | Five controls worked in Play, but the native mouth did not match the approved grin. Retain the animation outcome and rebuild the mouth around the original drawing. |
| Face artwork looks soft | The early atlas lost effective detail. Direct original-image UVs restored sharp features in the refined version. |
| Blink deforms in Blender but not correctly in Studio | Translation-based eye poses survived the tested import; the earlier scaling approach did not behave as intended. Verify the exported deformation. |
| Chin or cheeks spike when opening the jaw | Fix the root-weight remainder bug before changing the visible design. |
| Upper lip folds with the lower jaw | Reduce upper-lip jaw influence; preserve the stationary upper tooth row. |
| Markings detach from moving skin | Interpolate shell weights onto the projected markings. |
| Face vanishes in Play or loses animation | Restore the image locally using the dynamic attributes; keep the static mesh-replacement path away from this head. |
| Lower eye strokes appear after blinking | In Sukuna, inspection traced these to intentional cheek tattoos/secondary-eye artwork. A proposed patch subdivision produced no geometry change and was not evidence of a fix. Preserve the design unless a defect is verified. |
| New export exists but has not been imported | Keep the tested version as the deliverable. The optional refined v2 preview was canceled; the first refined import was the tested mesh. |
| Save shortcut appears to do nothing | In the tested native UI, focusing/raising Studio and using File → Save to File As produced an observed saved-path notification. Verify the actual file, rather than treating the keystroke as success. |

## Verify and deliver

Check the default expression and each supported control in Blender, then in Studio Edit and Play. Compare the static reference and inspect:

- Recognizable grin width, eye shape, tattoos, skin color, and original texture detail.
- Neck alignment, head dimensions, silhouette, and hair fit from front and oblique views.
- Both eyes closing, independent winks, jaw opening, and corner motion. Inspect intermediate values and requested combined expressions for clipping or tearing; individual endpoint screenshots do not prove all combinations.
- Texture restoration after entering Play and retention of the facial rig. Test respawn, morphing, multiple clients, mobile, or face tracking only when those outcomes are in scope, and report them as untested otherwise.
- Actual UI buttons if the deliverable includes a preview UI, plus console errors attributable to the new scripts.

Reset the head to the approved default, save a separate `.rbxl`, and verify the saved file exists and contains the intended mesh/scripts. Reopen and retest when persistence remains uncertain. Keep the original static scene. Deliver the tested place, packed Blender source, tested FBX, original texture, relevant scripts, and actual Studio evidence. Explain that the FBX alone does not contain the lab's texture-restoration setup. Label a montage of pose captures as a montage, not a recording of animation transitions.

The refined Sukuna evidence is bundled as [grin](../examples/heads/dynamic-sukuna/grin-in-studio.png) and [open mouth](../examples/heads/dynamic-sukuna/open-mouth-in-studio.png). The experiment verified six displayed presets driven by five controls in desktop Play. Full facial tracking, independent secondary-eye animation, player morphing, published multiplayer, mobile behavior, and Marketplace readiness were not established. Preserve those limits when reusing the example.
