#!/usr/bin/env python3
"""Inspect or change only the priority field in local CLIProxyAPI auth files."""
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


class PriorityError(Exception):
    """An operator-safe error, never containing auth contents."""


def file_version(metadata):
    return (metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns,
            metadata.st_ctime_ns, metadata.st_mode, metadata.st_uid, metadata.st_gid,
            metadata.st_nlink)


def snapshot(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise PriorityError("Auth files must be regular files with one link.")
        raw = stream.read()
        after = os.fstat(stream.fileno())
    if file_version(metadata) != file_version(after) or file_version(path.lstat()) != file_version(after):
        raise PriorityError("Auth file changed while reading; retry the command.")
    return raw, metadata


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def reject_constant(_value):
    raise ValueError("Non-JSON numeric value")


def parse_auth(raw):
    try:
        auth = json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (ValueError, UnicodeError):
        raise PriorityError("Invalid auth JSON; no files were changed.") from None
    if not isinstance(auth, dict):
        raise PriorityError("Auth JSON must be an object; no files were changed.")
    priority = auth.get("priority", 0)
    if type(priority) is not int or not -(2**63) <= priority < 2**63:
        raise PriorityError("Auth priority must be a signed 64-bit integer.")
    return auth


def row(path, auth):
    provider = auth.get("type", "unknown")
    # Only known provider labels from this repository's account pools may be shown.
    if provider not in ("codex", "claude"):
        provider = "unknown"
    # JSON quoting escapes newlines/control characters in filenames.
    return f"{json.dumps(path.name, ensure_ascii=True)}\t{provider}\t{auth.get('priority', 0)}"


def replace_priority(path, priority):
    raw, metadata = snapshot(path)
    if metadata.st_uid != os.geteuid():
        raise PriorityError("Auth file must be owned by the current user.")
    auth = parse_auth(raw)
    if auth.get("priority") == priority:
        return auth
    auth["priority"] = priority
    # Preserve every unrelated field; reject non-JSON values rather than emitting them.
    try:
        content = (json.dumps(auth, ensure_ascii=True, indent=2, allow_nan=False) + "\n").encode()
    except ValueError:
        raise PriorityError("Invalid auth JSON values; no files were changed.") from None
    fd, temporary = tempfile.mkstemp(prefix=".priority-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(metadata.st_mode))
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        # OAuth refresh does not take our lock: detect its writes before replacing.
        current_raw, current_metadata = snapshot(path)
        if current_raw != raw or file_version(current_metadata) != file_version(metadata):
            raise PriorityError("Auth file changed before update; retry the command.")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return auth


def main(arguments):
    listing = not arguments or arguments == ["list"]
    if not listing:
        if len(arguments) != 2 or not arguments[0] or not re.fullmatch(r"[+-]?[0-9]+", arguments[1]):
            raise PriorityError("Usage: cliproxy priority [list | <unique filename substring> <integer>]")
        try:
            priority = int(arguments[1])
        except ValueError:
            raise PriorityError("Priority must be a signed 64-bit integer.") from None
        if not -(2**63) <= priority < 2**63:
            raise PriorityError("Priority must be a signed 64-bit integer.")
    auth_dir = Path.home() / ".local/share/cliproxyapi/auth"
    if auth_dir.is_symlink():
        raise PriorityError("Auth directory must not be a symlink.")
    if not auth_dir.is_dir():
        raise PriorityError("No auth directory; enroll an account with cliproxy login first.")
    if listing:
        # Validate the entire report before printing any part of it.
        rows = [row(path, parse_auth(snapshot(path)[0])) for path in sorted(auth_dir.glob("*.json"))]
        print("filename\tprovider\tpriority")
        for value in rows:
            print(value)
        return
    # Serialize our own writers without adding lock files to the watched auth directory.
    lock_path = auth_dir.parent / ".priority.lock"
    fd = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(fd, "wb") as lock:
        metadata = os.fstat(lock.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid() or metadata.st_nlink != 1:
            raise PriorityError("Priority lock must be a regular file owned by the current user.")
        fcntl.flock(lock, fcntl.LOCK_EX)
        matches = [path for path in sorted(auth_dir.glob("*.json")) if arguments[0] in path.name]
        if not matches:
            raise PriorityError("No auth filename matches the selector; use cliproxy priority list.")
        if len(matches) != 1:
            raise PriorityError("Selector matches multiple auth filenames; use a unique substring.")
        path = matches[0]
        auth = replace_priority(path, priority)
        print("filename\tprovider\tpriority")
        print(row(path, auth))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except PriorityError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)
    except (OSError, ValueError, RecursionError):
        # Exception repr/tracebacks can include private filenames or JSON fragments.
        print("error: Unable to read or update private auth state; no credentials displayed.", file=sys.stderr)
        sys.exit(1)
