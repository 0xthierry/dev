#!/usr/bin/env python3
"""Explicit, stopped-session quarantine/restore of paired Quattro workspace state.

Usage: workspace-state.py save|restore ABSOLUTE_SNAPSHOT_DIRECTORY
Only runs after this user's Hyprland has exited. No installer calls this script.
Snapshots must be on the same filesystem as state (exclusive hard-link moves).
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

NAMES = ("monitor-workspaces", "monitor-workspaces-merged")


def digest(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Not a regular non-symlink file: {path}")
    if path.stat().st_uid != os.getuid():
        raise ValueError(f"File is not owned by this user: {path}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_path(path):
    if ".." in path.parts:
        raise ValueError(f"Parent traversal is not allowed: {path}")
    for component in (path, *path.parents):
        if component.is_symlink():
            raise ValueError(f"Symlinked path component: {component}")


def validate_directory(path, private=False):
    validate_path(path)
    if not path.is_dir() or path.stat().st_uid != os.getuid():
        raise ValueError(f"Directory must be owned by this user: {path}")
    forbidden = 0o077 if private else 0o022
    if path.stat().st_mode & forbidden:
        raise ValueError(f"Directory permissions are not {'private (0700)' if private else 'write-protected'}: {path}")


def state_directory():
    return Path(os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local/state")) / "omarchy"


def require_stopped_session():
    result = subprocess.run(["pgrep", "-u", str(os.getuid()), "-x", "Hyprland"],
                            capture_output=True, check=False)
    if result.returncode != 1:
        raise ValueError("Log out of Hyprland and run from a local text console; process check must report no compositor")


def transfer(action, state, snapshot):
    """Move without overwriting; a matching manifest permits crash-safe resumption.

    Files remain on the same filesystem. link() refuses an existing destination;
    unlink() removes only the old name of that same preserved inode.
    """
    state, snapshot = Path(state).absolute(), Path(snapshot).absolute()
    if snapshot == state:
        raise ValueError("State and snapshot must be distinct directories")
    validate_directory(state)
    validate_path(snapshot)
    marker = snapshot / "workspace-state.json"
    if not snapshot.exists():
        if action != "save":
            raise ValueError("Snapshot does not exist")
        files = {name: digest(state / name) if (state / name).exists() or (state / name).is_symlink() else None for name in NAMES}
        snapshot.mkdir(mode=0o700)  # refuses races/collisions; never creates parents
        manifest = {"version": 1, "state_directory": str(state), "files": files}
        with os.fdopen(os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
            json.dump(manifest, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
    validate_directory(snapshot, private=True)
    if marker.is_symlink() or not marker.is_file() or marker.stat().st_uid != os.getuid():
        raise ValueError("Snapshot collision: no owned manifest; use a new snapshot directory")
    manifest = json.loads(marker.read_text())
    if manifest.get("version") != 1 or manifest.get("state_directory") != str(state) or set(manifest.get("files", {})) != set(NAMES):
        raise ValueError("Snapshot manifest does not match this state directory")
    if state.stat().st_dev != snapshot.stat().st_dev:
        raise ValueError("Snapshot must be on the same filesystem as state")
    source, destination = (state, snapshot) if action == "save" else (snapshot, state)
    # Preflight the entire pair before moving either member. A destination is
    # accepted only if its source is already absent, or they are the SAME inode
    # left by an interrupted link/unlink. Equal contents alone are not enough.
    for name, expected in manifest["files"].items():
        src, dst = source / name, destination / name
        present = [p for p in (src, dst) if p.exists() or p.is_symlink()]
        if expected is None:
            if present:
                raise ValueError(f"Snapshot records {name} as absent; refuse conflicting state")
        else:
            if not present or any(digest(p) != expected for p in present):
                raise ValueError(f"Missing or changed state: {name}")
            if len(present) == 2 and not src.samefile(dst):
                raise ValueError(f"Destination collision: {dst}; quarantine the current config's state separately first")
    for name, expected in manifest["files"].items():
        src, dst = source / name, destination / name
        if expected is not None and src.exists():
            if not dst.exists():
                os.link(src, dst)  # atomic no-clobber destination creation
            if not src.samefile(dst):
                raise ValueError(f"Destination changed during transfer: {dst}")
            src.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("save", "restore"))
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    if not args.snapshot.is_absolute():
        parser.error("snapshot must be an explicit absolute path")
    state = state_directory()
    try:
        require_stopped_session()
        transfer(args.action, state, args.snapshot)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Refused: {error}\nNo files are overwritten. Keep this snapshot and inspect both locations before retrying.\n")
    print(f"{args.action} complete: {args.snapshot}; keep it paired with its matching config snapshot")


if __name__ == "__main__":
    main()
