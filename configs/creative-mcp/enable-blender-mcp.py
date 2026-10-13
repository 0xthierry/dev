"""Run explicitly with Blender --background --python to enable local MCP.

Close Blender first. Saves preferences only, never a scene or startup file.
"""
import pathlib
import shutil

import bpy

module = "blender_mcp"
# Preserve previous preferences before this opt-in write.
prefs = pathlib.Path(bpy.utils.user_resource("CONFIG")) / "userpref.blend"
if prefs.exists():
    backup = pathlib.Path(str(prefs) + ".pre-mcp.bak")
    count = 1
    while backup.exists():
        backup = pathlib.Path(f"{prefs}.pre-mcp.bak.{count}")
        count += 1
    shutil.copy2(prefs, backup)
    print(f"Preferences backup: {backup}")
if module not in bpy.context.preferences.addons:
    bpy.ops.preferences.addon_enable(module=module)
addon = bpy.context.preferences.addons.get(module)
if addon is None:
    raise RuntimeError("Blender MCP add-on did not enable")
addon.preferences.telemetry_consent = False
bpy.ops.wm.save_userpref()
print("Blender MCP enabled; telemetry disabled. Open Blender to start its local server.")
