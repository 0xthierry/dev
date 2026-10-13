#!/usr/bin/env python3
"""Merge only the two repo-owned MCP entries into Claude client configs."""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile


def read_config(path):
    if path.is_symlink():
        raise ValueError(f"refusing to replace symlink config: {path}")
    if not path.exists():
        return {}
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object in {path}")
    if not isinstance(value.get("mcpServers", {}), dict):
        raise ValueError(f"expected an mcpServers object in {path}")
    return value


def save_config(path, value):
    content = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()
    if path.exists() and json.loads(path.read_text()) == value:
        print(f"unchanged: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = Path(str(path) + ".bak")
        counter = 1
        while backup.exists() or backup.is_symlink():
            backup = Path(f"{path}.bak.{counter}")
            counter += 1
        # Backups may contain credentials; never broaden their permissions.
        descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as target, path.open("rb") as source:
            shutil.copyfileobj(source, target)
    descriptor, staged = tempfile.mkstemp(prefix=".creative-mcp-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
        os.replace(staged, path)
    finally:
        if os.path.exists(staged):
            os.unlink(staged)
    print(f"configured: {path}")


def configure(host):
    home = Path.home()
    claude_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR", home / ".claude"))
    # Claude Code's default user config is ~/.claude.json. With an explicit
    # CLAUDE_CONFIG_DIR it lives inside that directory instead.
    code = claude_dir / ".claude.json" if "CLAUDE_CONFIG_DIR" in os.environ else home / ".claude.json"
    desktop = (home / "Library/Application Support/Claude" if host == "macbook"
               else Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "Claude")
    paths = [code, desktop / "claude_desktop_config.json"]
    # Validate all inputs before changing either file.
    configs = [read_config(path) for path in paths]
    servers = {
        "blender": {"command": str(home / ".local/bin/blender-mcp"), "args": []},
        "Roblox_Studio": {"command": str(home / ".local/bin/roblox-studio-mcp"), "args": []},
    }
    for path, config in zip(paths, configs):
        config.setdefault("mcpServers", {}).update(servers)
        save_config(path, config)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host", choices=("macbook", "omarchy"))
    try:
        configure(parser.parse_args().host)
    except (OSError, ValueError) as error:
        parser.exit(1, f"error: {error}\n")
