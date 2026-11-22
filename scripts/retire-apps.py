#!/usr/bin/env python3
"""Quarantine recognized user-installed AI CLI programs, never their data.

Preview: python3 scripts/retire-apps.py
Apply:   python3 scripts/retire-apps.py --apply
Fixtures/other home: add --home /absolute/home

Stop the affected CLIs/installers before applying. This is an offline maintenance
helper, not protection against concurrent hostile writers running as your user.
No package managers, shell files, Cursor editor, settings, histories, or caches
are modified. Unknown candidates block the entire plan. Review JSON output.
Quarantine paths preserve paths relative to HOME; restore manually after review.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

VERSION = re.compile(r"\d{4}\.\d{2}\.\d{2}-[0-9a-f]{7,40}")
NATIVE_MAGIC = {b"\x7fELF", b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe",
                b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe",
                b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"}
CURSOR_FILES = {
    "cursor-agent", "node", "index.js", "package.json", ".npmrc", "crepectl",
    "cursorsandbox", "rg", "cursor-askpass", "cursor-agent-svc",
    "cursor-agent-sea", "cursor-agent-worker-sea", "mac-webp-runtime.cjs",
    "cursor-askpass.js", "cursor-agent-svc.js", "diff-patch-worker.js",
    "diff-worker.js", "pdf-worker.js", "unified-diff-worker.js", "connect-pool-worker.js",
}


class Unsafe(ValueError):
    pass


def ancestors(path):
    """Never traverse a symlink, including an ancestor of the supplied home."""
    for parent in reversed(path.parents):
        try:
            mode = parent.lstat().st_mode
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(mode):
            raise Unsafe(f"not a real directory: {parent}")


def present(path):
    ancestors(path)
    return os.path.lexists(path)


def regular(path):
    ancestors(path)
    if not stat.S_ISREG(path.lstat().st_mode):
        raise Unsafe(f"not a regular file: {path}")


def native(path):
    regular(path)
    with path.open("rb") as stream:
        magic = stream.read(4)
    if magic not in NATIVE_MAGIC or not path.stat().st_mode & 0o111:
        raise Unsafe(f"not an executable ELF/Mach-O program: {path}")


def text(path, limit=16384):
    regular(path)
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise Unsafe(f"unexpected large metadata/launcher: {path}")
    return data.decode("utf-8")


def link_target(path):
    if not path.is_symlink():
        raise Unsafe(f"not an expected symlink: {path}")
    return Path(os.path.abspath(path.parent / os.readlink(path)))


def cursor_payload(path):
    if not stat.S_ISDIR(path.lstat().st_mode) or not VERSION.fullmatch(path.name):
        raise Unsafe(f"unknown Cursor version object: {path}")
    metadata = json.loads(text(path / "package.json"))
    if (not isinstance(metadata, dict) or metadata.get("name") != "@anysphere/agent-cli-runtime"
            or metadata.get("private") is not True):
        raise Unsafe(f"unknown Cursor runtime package: {path}")
    launcher = text(path / "cursor-agent")
    if not (launcher.startswith("#!/") and 'CURSOR_INVOKED_AS=' in launcher
            and '$SCRIPT_DIR/node' in launcher and '$SCRIPT_DIR/index.js' in launcher):
        raise Unsafe(f"unknown Cursor launcher: {path}")
    native(path / "node")
    regular(path / "index.js")
    # Only known payload names at the version root; never sweep arbitrary data.
    for item in path.iterdir():
        name = item.name.removesuffix(".LICENSE.txt")
        if item.name in {"node_modules", ".running"}:
            if not stat.S_ISDIR(item.lstat().st_mode):
                raise Unsafe(f"unknown payload directory: {item}")
        elif (name in CURSOR_FILES or re.fullmatch(r"[0-9a-f]+(?:\.index)?\.js", name)
              or re.fullmatch(r"[\w.-]+\.node", name)
              or re.fullmatch(r"[0-9a-f]{20}\.mp4", name)):
            regular(item)
        else:
            raise Unsafe(f"unknown file inside Cursor payload: {item}")
    # Reject links/special files anywhere in dependencies, rather than following them.
    for root, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            item = Path(root) / name
            mode = item.lstat().st_mode
            if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise Unsafe(f"unknown object inside Cursor payload: {item}")
    running = path / ".running"
    if running.exists():
        for marker in running.iterdir():
            if not marker.name.isdecimal() or not marker.is_file() or marker.stat().st_size:
                raise Unsafe(f"unknown Cursor running marker: {marker}")


def plan(home):
    moves = []
    versions = home / ".local/share/cursor-agent/versions"
    payloads = set()
    if present(versions):
        if not stat.S_ISDIR(versions.lstat().st_mode):
            raise Unsafe(f"not a real versions directory: {versions}")
        for version in sorted(versions.iterdir()):
            cursor_payload(version)
            payloads.add(version / "cursor-agent")
            moves.append(version)

    for relative in (".amp/bin/amp", ".opencode/bin/opencode", ".grok/bin/grok"):
        path = home / relative
        if present(path):
            native(path)
            moves.append(path)

    repo_grok = Path(__file__).absolute().parent / "grok"
    targets = {
        "amp": {home / ".amp/bin/amp"},
        "opencode": {home / ".opencode/bin/opencode"},
        "grok": {home / ".grok/bin/grok", repo_grok},
        "cursor-agent": payloads,
        "agent": {home / ".local/bin/cursor-agent"} if payloads else set(),
    }
    for name, allowed in targets.items():
        path = home / ".local/bin" / name
        if not present(path):
            continue
        if path.is_symlink():
            target = link_target(path)
            ancestors(target)
            if target not in allowed:
                raise Unsafe(f"foreign symlink: {path} -> {target}")
            if name == "agent":
                cursor_link = home / ".local/bin/cursor-agent"
                if not cursor_link.is_symlink() or link_target(cursor_link) not in payloads:
                    raise Unsafe(f"agent alias does not lead to verified Cursor payload: {path}")
        elif name == "opencode":
            wrapper = text(path)
            if not (wrapper.startswith(("#!/bin/bash\n", "#!/usr/bin/env bash\n"))
                    and '\npackage="opencode-ai"\n' in wrapper
                    and '\ncommand="opencode"\n' in wrapper
                    and 'mise where node@latest' in wrapper
                    and 'exec_package_bin' in wrapper
                    and '"$node_bin" "$npx_bin"' in wrapper):
                raise Unsafe(f"unknown OpenCode wrapper: {path}")
        else:
            raise Unsafe(f"unknown command object: {path}")
        moves.append(path)

    mise_targets = {Path("/usr/bin/mise"), Path("/opt/homebrew/bin/mise"),
                    Path("/usr/local/bin/mise"), home / ".local/bin/mise",
                    home / ".local/share/mise/bin/mise"}
    for directory in (".local/share/mise/shims", ".local/share/mise/command-wrappers/bin"):
        for name in ("amp", "cursor-agent", "grok", "opencode"):
            path = home / directory / name
            if present(path):
                if link_target(path) not in mise_targets:
                    raise Unsafe(f"not a recognized mise shim: {path}")
                moves.append(path)
    # Move aliases before payloads, making an interrupted run safely resumable.
    return sorted(moves, key=lambda p: (p in {x.parent for x in payloads}, str(p)))


def apply(home, moves):
    if not moves:
        return None
    quarantine = home / ".retired-apps"
    ancestors(quarantine)
    if os.path.lexists(quarantine):
        info = quarantine.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise Unsafe(f"quarantine must be an owned private directory: {quarantine}")
    else:
        quarantine.mkdir(mode=0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ-")
    destination = Path(tempfile.mkdtemp(prefix=stamp, dir=quarantine))
    manifest = {"home": str(home), "paths": [str(p.relative_to(home)) for p in moves]}
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    try:
        for path in moves:
            ancestors(path)
            target = destination / path.relative_to(home)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if os.path.lexists(target):
                raise Unsafe(f"quarantine collision: {target}")
            # Same-filesystem rename only: never copy/delete through a mount or link.
            path.rename(target)
    except (OSError, Unsafe) as error:
        raise Unsafe(f"partial quarantine retained at {destination}: {error}") from error
    return str(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--apply", action="store_true", help="move the verified plan; default is read-only preview")
    args = parser.parse_args()
    home = Path(os.path.abspath(args.home.expanduser()))
    try:
        ancestors(home)
        if not stat.S_ISDIR(home.lstat().st_mode):
            raise Unsafe(f"home is not a real directory: {home}")
        moves = plan(home)
        result = {"mode": "apply" if args.apply else "preview", "home": str(home),
                  "paths": [str(p.relative_to(home)) for p in moves]}
        if args.apply:
            result["quarantine"] = apply(home, moves)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError) as error:
        print(f"Refusing retirement: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
