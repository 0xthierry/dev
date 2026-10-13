#!/usr/bin/env python3
"""Install only the pinned package's bundled addon; never load Blender preferences.

Uses atomic replacement and non-overwriting numbered backups. Existing addon
module filenames stay intact so Blender's saved enablement remains valid.
"""
from __future__ import annotations

import argparse
import ast
from importlib.metadata import PackageNotFoundError, version
import os
from pathlib import Path
import shutil
import sys
import tempfile


def addon_name(path: Path) -> str | None:
    """Read bl_info without executing a user's addon."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "bl_info"
                for target in node.targets
            ):
                info = ast.literal_eval(node.value)
                name = info.get("name") if isinstance(info, dict) else None
                return name if isinstance(name, str) else None
    except (OSError, SyntaxError, ValueError, TypeError):
        pass
    return None


def validate_target(path: Path) -> None:
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError(f"refusing unrelated addon path: {path}")


def copy_with_backup(source: Path, target: Path) -> None:
    validate_target(target)
    if target.is_file() and target.read_bytes() == source.read_bytes():
        print(f"Addon already current: {target}")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        backup = Path(f"{target}.bak")
        index = 1
        while backup.exists() or backup.is_symlink():
            backup = Path(f"{target}.bak.{index}")
            index += 1
        # Exclusive creation preserves old backups, including interrupted runs.
        with backup.open("xb") as stream:
            stream.write(target.read_bytes())
        shutil.copystat(target, backup)
        print(f"Addon backed up: {backup}")
    fd, temporary = tempfile.mkstemp(prefix=".blender-mcp-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(source.read_bytes())
        os.chmod(temporary, 0o644)
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(f"Addon installed: {target}")


def install(expected_version: str, stage: Path, addons_dir: Path) -> None:
    if sys.version_info[:2] != (3, 12):
        raise ValueError("Blender MCP runtime requires Python 3.12; repair its dedicated venv")
    actual_version = version("mcp-for-blender")
    if actual_version != expected_version:
        raise ValueError(f"expected mcp-for-blender {expected_version}, got {actual_version}")
    # addon_manager imports no server/telemetry and this accessor only reads.
    from blender_mcp.addon_manager import get_bundled_addon_path

    source = get_bundled_addon_path()
    if addon_name(source) != "MCP for Blender":
        raise ValueError(f"invalid bundled Blender addon: {source}")
    if addons_dir.is_symlink() or (addons_dir.exists() and not addons_dir.is_dir()):
        raise ValueError(f"refusing unrelated addons directory: {addons_dir}")
    targets: list[Path] = []
    if addons_dir.is_dir():
        for child in sorted(addons_dir.iterdir()):
            if child.suffix == ".py":
                candidate = child
            elif child.is_dir():
                candidate = child / "__init__.py"
            else:
                continue
            if addon_name(candidate) in {"MCP for Blender", "Blender MCP"}:
                if child.is_symlink():
                    raise ValueError(f"refusing linked addon module: {child}")
                targets.append(candidate)
    if not targets:
        target = addons_dir / "blender_mcp.py"
        if target.exists() or target.is_symlink():
            raise ValueError(f"refusing unrelated addon module: {target}")
        targets = [target]
    # Preflight all files before changing any addon or publishing the stage.
    for target in [stage, *targets]:
        validate_target(target)
    copy_with_backup(source, stage)
    for target in targets:
        copy_with_backup(source, target)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--addons-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        install(args.version, args.stage, args.addons_dir)
    except (OSError, ValueError, PackageNotFoundError) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()
