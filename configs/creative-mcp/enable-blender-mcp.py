"""Enable the installed MCP for Blender add-on in the user's preferences.

Run by setup as: blender --background --python-exit-code 1 --python <this>.
Setup only calls it while Blender is closed, because a running Blender would
overwrite the saved preferences on exit. Idempotent: when the add-on is already
enabled with telemetry off, nothing is written. Otherwise the previous
userpref.blend is kept as a numbered backup before saving preferences only
(never a scene or startup file).
"""
import pathlib
import shutil

import addon_utils
import bpy

NAMES = {"MCP for Blender", "Blender MCP"}

# The installer preserves existing module filenames (blender_mcp, addon,
# user_mcp, ...), so find the module by its bl_info name, not a fixed name.
modules = [m.__name__ for m in addon_utils.modules(refresh=True) if m.bl_info.get("name") in NAMES]
if not modules:
    raise RuntimeError("MCP for Blender add-on is not installed; run setup's addon install first")
if len(modules) > 1:
    raise RuntimeError(f"several MCP for Blender modules are installed: {modules}; keep one")
module = modules[0]


def telemetry_off(name: str) -> bool:
    addon = bpy.context.preferences.addons.get(name)
    prefs = getattr(addon, "preferences", None)
    return prefs is None or not getattr(prefs, "telemetry_consent", False)


if module in bpy.context.preferences.addons and telemetry_off(module):
    print(f"Blender MCP already enabled ({module}); preferences unchanged.")
else:
    prefs_file = pathlib.Path(bpy.utils.user_resource("CONFIG")) / "userpref.blend"
    if prefs_file.exists():
        backup = pathlib.Path(str(prefs_file) + ".pre-mcp.bak")
        count = 1
        while backup.exists():
            backup = pathlib.Path(f"{prefs_file}.pre-mcp.bak.{count}")
            count += 1
        shutil.copy2(prefs_file, backup)
        print(f"Preferences backup: {backup}")
    if module not in bpy.context.preferences.addons:
        bpy.ops.preferences.addon_enable(module=module)
    addon = bpy.context.preferences.addons.get(module)
    if addon is None:
        raise RuntimeError(f"Blender MCP add-on did not enable ({module})")
    if getattr(addon, "preferences", None) is not None and hasattr(addon.preferences, "telemetry_consent"):
        addon.preferences.telemetry_consent = False
    bpy.ops.wm.save_userpref()
    print(f"Blender MCP enabled ({module}); telemetry disabled. Its server starts when Blender opens.")
