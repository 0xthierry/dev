#!/usr/bin/env python3
"""Read-only, deliberately incomplete Quattro symlink/write-scope inventory.

Never runs bridge/package commands and never changes HOME. Exit 0 means a report
was produced, NOT that upgrading is safe. See docs/omarchy-quattro-links.md.
"""
import argparse
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

REVIEWED_BRIDGE_SHA256 = "57ec1e8ae249e4e96ec33ddcf5d66cc2216863b62dfc7e9a8d81c53b00eebbd4"
# Conservative scopes, not a claim that every file is written. Dynamic migration,
# theme, package hooks and arbitrary user hooks remain outside static proof.
SCOPES = (
    ".config", ".local/bin", ".local/share/omarchy", ".local/share/applications",
    ".local/share/systemd/user", ".local/share/nautilus-python/extensions",
    ".local/share/keyrings", ".local/state/omarchy", ".cache/omarchy",
    ".agents/skills/omarchy", ".claude/skills/omarchy", ".codex/skills/omarchy",
    ".pi/agent/skills/omarchy", ".bashrc", ".bash_profile", ".gitconfig", ".XCompose",
    "Downloads", "Pictures", "Videos", "Projects", "Templates", "Public", "Desktop",
)
UNKNOWN = (
    "Not an exhaustive shell write analysis: conditionals, globs, variables, helpers and user hooks can write elsewhere.",
    "Package install/remove hooks and system paths (/etc, /usr, /boot, /var, /run) are NOT audited; a filesystem snapshot is still required.",
    "omarchy-migrate selects pending migrations from live state; package/channel contents may differ from this upstream checkout.",
    "Theme helpers, application refresh, bar defaults, AUR/mise updates, git global config and XDG helpers can have dynamic destinations.",
    "Custom XDG_* / OMARCHY_* environment, mount/bind aliases, hard links and concurrent filesystem changes are NOT proved safe.",
    "Links are candidates for review, not an automatic detach list. Some must be replaced/retired, not materialized.",
)


def resolve(path):
    """Resolve all components, including aliases in link targets; never read contents."""
    pending = deque(path.parts[1:])
    current = Path(path.anchor)
    links = []
    hops = 0
    while pending:
        part = pending.popleft()
        if part in ("", "."):
            continue
        if part == "..":
            current = current.parent
            continue
        candidate = current / part
        try:
            mode = candidate.lstat().st_mode
        except FileNotFoundError:
            return links, "missing", str(candidate.joinpath(*pending))
        except OSError as exc:
            return links, "error", str(exc)
        if stat.S_ISLNK(mode):
            target = os.readlink(candidate)
            links.append((str(candidate), target))
            hops += 1
            if hops > 40:
                return links, "cycle-or-too-many-links", str(candidate)
            target_path = Path(target)
            if target_path.is_absolute():
                current = Path(target_path.anchor)
                parts = target_path.parts[1:]
            else:
                parts = target_path.parts
            pending.extendleft(reversed(parts))
        else:
            current = candidate
    return links, "present", str(current)


def footprint(bridge, upstream):
    text = bridge.read_text()
    entries = {}

    def add(path, reason):
        entries.setdefault(path, set()).add(reason)

    for action, relative in re.findall(r"^(refresh|retire)\t([^\t\n]+)\t[0-9a-f]{64}$", text, re.M):
        add(".config/" + relative, "bridge hash-table " + action + " (conditional)")
    always = re.search(r"always_copy_config_files=\(\n(.*?)\n\)", text, re.S)
    if always:
        for relative in always.group(1).split():
            add(".config/" + relative, "bridge always-copy")
    for directory, dirs, files in os.walk(upstream / "config", followlinks=False):
        for name in files + [name for name in dirs if (Path(directory) / name).is_symlink()]:
            relative = (Path(directory) / name).relative_to(upstream / "config").as_posix()
            add(".config/" + relative, "package config default (conditional; systemd/retired exclusions apply)")
    # Literal references are intentionally overinclusive: a read path is NOT
    # necessarily a write. Keep this provenance separate from confirmed writes.
    for relative in re.findall(r'\$(?:HOME|TARGET_HOME)/([^\s"\x27;<>]+)', text):
        if not any(char in relative for char in "$*?{}()[]`\\"):
            add(relative.rstrip("/"), "bridge literal reference (review operation)")
    return [{"path": path, "reasons": sorted(reasons)} for path, reasons in sorted(entries.items())]


def git_identity(path):
    """Read git identity only; version files can be stale in tagged sources."""
    try:
        commit = subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"],
                                capture_output=True, text=True, timeout=5, check=True).stdout.strip()
        tag = subprocess.run(["git", "-C", str(path), "describe", "--tags", "--exact-match"],
                             capture_output=True, text=True, timeout=5).stdout.strip()
        return {"commit": commit, "exact_tag": tag or None}
    except (OSError, subprocess.SubprocessError):
        return {"commit": None, "exact_tag": None}


def report(home, bridge, upstream, limit):
    entries = footprint(bridge, upstream)
    links = {}
    incomplete = []

    def inspect(path, scope):
        chain, status, resolved = resolve(path)
        for link_path, target in chain:
            record = links.setdefault(link_path, {"path": link_path, "target": target, "observed_via": set(), "scopes": set()})
            record["observed_via"].add(str(path))
            record["scopes"].add(scope)
        if status not in ("present", "missing"):
            incomplete.append({"path": str(path), "reason": status, "detail": resolved})
        return status, resolved

    # Inspect explicit paths before any bounded subtree enumeration, so a huge
    # browser profile cannot hide a known Hypr/Ghostty parent or leaf alias.
    for entry in entries:
        inspect(home / entry["path"], "footprint:" + entry["path"])

    def scan(root, scope):
        stack = [(root, frozenset(), 0)]
        count = 0
        while stack:
            path, ancestors, depth = stack.pop()
            count += 1
            if count > limit:
                incomplete.append({"path": str(root), "reason": "entry-limit", "limit": limit})
                return
            status, resolved = inspect(path, scope)
            if status != "present":
                continue
            try:
                info = path.stat()
                if not stat.S_ISDIR(info.st_mode):
                    continue
                key = (info.st_dev, info.st_ino)
                if key in ancestors or depth >= 40:
                    incomplete.append({"path": str(path), "reason": "directory-cycle-or-depth-limit"})
                    continue
                with os.scandir(path) as children:
                    names = sorted(child.name for child in children)
                stack.extend((path / name, ancestors | {key}, depth + 1) for name in reversed(names))
            except OSError as exc:
                incomplete.append({"path": str(path), "reason": "unreadable", "detail": str(exc)})

    for scope in SCOPES:
        # Discover every .config child first, with a separate bounded walk per
        # child. Directory links are followed read-only, including nested links.
        root = home / scope
        inspect(root, "scope:" + scope)
        if scope == ".config" and root.is_dir():
            try:
                for child in sorted(root.iterdir()):
                    scan(child, "scope:.config/" + child.name)
            except OSError as exc:
                incomplete.append({"path": str(root), "reason": "unreadable", "detail": str(exc)})
        else:
            scan(root, "scope:" + scope)
    rendered = []
    for item in sorted(links.values(), key=lambda item: item["path"]):
        _, status, destination = resolve(Path(item["path"]))
        rendered.append({**item, "observed_via": sorted(item["observed_via"]), "scopes": sorted(item["scopes"]),
                         "target_status": status, "resolved": destination})
    digest = hashlib.sha256(bridge.read_bytes()).hexdigest()
    return {
        "status": "manual-review-required", "safe_to_upgrade": False,
        "home": str(home), "bridge": str(bridge), "bridge_sha256": digest,
        "reviewed_bridge_matches": digest == REVIEWED_BRIDGE_SHA256,
        "upstream": str(upstream), "upstream_version_file": (upstream / "version").read_text().strip(),
        "upstream_git": git_identity(upstream),
        "footprint": entries, "links": rendered, "incomplete": incomplete,
        "unknown": list(UNKNOWN) + ([] if digest == REVIEWED_BRIDGE_SHA256 else ["Bridge differs from reviewed 3.8.5 source: re-review ALL operations; extracted references do not establish coverage."]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--bridge", type=Path, help="default: HOME/.local/share/omarchy/bin/omarchy-upgrade-to-quattro")
    parser.add_argument("--upstream", type=Path, default=Path(__file__).resolve().parents[2] / "upstream")
    parser.add_argument("--max-entries", type=int, default=20000, help="per subtree; truncation is explicitly reported")
    parser.add_argument("--json", action="store_true", help="full machine-readable report including candidate footprint")
    args = parser.parse_args()
    if not args.home.is_absolute() or not args.upstream.is_absolute() or args.max_entries < 1:
        parser.error("home/upstream must be absolute; max-entries must be positive")
    bridge = args.bridge or args.home / ".local/share/omarchy/bin/omarchy-upgrade-to-quattro"
    if not bridge.is_absolute():
        parser.error("bridge must be absolute")
    if not args.home.is_dir() or not (args.upstream / "config").is_dir():
        parser.error("home and upstream/config must exist")
    try:
        result = report(args.home, bridge, args.upstream, args.max_entries)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"Cannot produce preflight: {exc}\n")
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("MANUAL REVIEW REQUIRED — read-only inventory, NOT upgrade clearance")
        print(f"Bridge SHA-256: {result['bridge_sha256']} (reviewed match: {result['reviewed_bridge_matches']})")
        print(f"Package source: {result['upstream']} {result['upstream_git']}")
        print(f"Version file (not package identity): {result['upstream_version_file']}")
        print(f"Candidate paths: {len(result['footprint'])}; links: {len(result['links'])}")
        for link in result["links"]:
            print(f"LINK {link['path']} -> {link['target']} [{link['target_status']}]")
        for issue in result["incomplete"]:
            print("INCOMPLETE " + json.dumps(issue))
        for unknown in result["unknown"]:
            print("UNKNOWN " + unknown)
        print("No files changed. Use --json for path provenance; read docs/omarchy-quattro-links.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
