#!/usr/bin/env python3
"""Use Codex's own TOML writer; preserve unrelated user settings and servers."""
import os
from pathlib import Path
import shutil
import subprocess
import tomllib


def configure():
    home = Path.home()
    config_dir = Path(os.environ.get("CODEX_HOME", home / ".codex"))
    path = config_dir / "config.toml"
    if path.is_symlink():
        raise ValueError(f"refusing to replace symlink config: {path}")
    original = path.read_bytes() if path.exists() else b""
    config = tomllib.loads(original.decode())
    servers = config.get("mcp_servers", {})
    wanted = {
        "blender": str(home / ".local/bin/blender-mcp"),
        "Roblox_Studio": str(home / ".local/bin/roblox-studio-mcp"),
    }
    changes = [(name, command) for name, command in wanted.items()
               if servers.get(name, {}).get("command") != command
               or servers.get(name, {}).get("args", [])]
    if not changes:
        print(f"unchanged: {path}")
        return
    codex = shutil.which("codex")
    if not codex:
        raise ValueError("codex is required; install the shared CLI packages first")
    config_dir.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = Path(str(path) + ".bak")
        counter = 1
        while backup.exists() or backup.is_symlink():
            backup = Path(f"{path}.bak.{counter}")
            counter += 1
        descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(original)
    # The native writer supports updating an existing name; no remove/add gap.
    # It also preserves comments, nested TOML tables, and unrelated entries.
    for name, command in changes:
        subprocess.run([codex, "mcp", "add", name, "--", command], check=True,
                       env={**os.environ, "CODEX_HOME": str(config_dir)})
    print(f"configured: {path}")


if __name__ == "__main__":
    try:
        configure()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"error: {error}") from error
