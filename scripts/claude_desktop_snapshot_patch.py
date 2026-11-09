#!/usr/bin/env python3
"""Pinned, offline Claude Desktop ASAR patch; never signs or launches the app.

Only an explicitly supplied disposable staging bundle may be changed. The two
os.replace operations are individually atomic, not a bundle transaction: after a
crash between them, discard/re-copy the staging bundle. A mixed state is refused.
The caller owns exclusive access to staging and subsequent signing/deployment.
"""
import argparse
import copy
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import struct
import sys
import tempfile

MEMBER = ".vite/build/index.chunk-Cy6fdnz-.js"
OLD = b"snapshot:W},mt.t($),n.tt($);let Or="
NEW = b'snapshot:W},mt.t($),n.tt($);c.kind==="local"&&!T&&($.systemPrompt.snapshot=!1);let Or='
ARCHIVE = Path("Contents/Resources/app.asar")
PLIST = Path("Contents/Info.plist")
INTEGRITY_KEY = "Resources/app.asar"
CHUNK = 1024 * 1024
MAX_HEADER = 16 * CHUNK
MAX_MEMBER = 32 * CHUNK
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class PatchError(ValueError):
    """Unsupported or inconsistent input; nothing should be deployed."""


def require(condition, message):
    if not condition:
        raise PatchError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(CHUNK):
            digest.update(block)
    return digest.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def json_object(data):
    result = json.loads(data, object_pairs_hook=unique_object)
    require(isinstance(result, dict), "expected JSON object")
    return result


def entries(header, prefix=""):
    require(isinstance(header.get("files"), dict), "invalid ASAR directory")
    for name, entry in header["files"].items():
        require(isinstance(name, str) and name not in ("", ".", "..")
                and "/" not in name and "\\" not in name and "\0" not in name,
                "invalid ASAR entry name")
        require(isinstance(entry, dict), "invalid ASAR entry")
        path = prefix + name
        if "files" in entry:
            require(not any(k in entry for k in ("offset", "size", "link")),
                    "ambiguous ASAR directory")
            yield from entries(entry, path + "/")
        else:
            yield path, entry


@dataclass
class Asar:
    path: Path
    header: dict
    raw_header: bytes
    data_offset: int
    size: int
    members: dict

    @classmethod
    def read(cls, path):
        size = path.stat().st_size
        with path.open("rb") as source:
            prefix = source.read(16)
            require(len(prefix) == 16, "truncated ASAR prefix")
            size_payload, header_size, header_payload, json_size = struct.unpack("<4I", prefix)
            require(size_payload == 4 and 8 <= header_size <= MAX_HEADER
                    and header_size % 4 == 0 and header_payload == header_size - 4
                    and header_size == 8 + ((json_size + 3) & ~3),
                    "invalid ASAR pickle lengths/alignment")
            require(8 + header_size <= size, "truncated ASAR header")
            raw = source.read(json_size)
            padding = source.read(header_size - 8 - json_size)
            require(not any(padding), "nonzero ASAR pickle padding")
        header = json_object(raw.decode("utf-8"))
        members = dict(entries(header))
        spans = []
        for name, entry in members.items():
            if "link" in entry:
                require(isinstance(entry["link"], str)
                        and not any(k in entry for k in ("size", "offset", "unpacked")),
                        "invalid ASAR link")
                continue
            require(type(entry.get("size")) is int and entry["size"] >= 0,
                    "invalid ASAR file size")
            if "unpacked" in entry:
                require(type(entry["unpacked"]) is bool, "invalid ASAR unpacked flag")
            if entry.get("unpacked"):
                require("offset" not in entry, "unpacked ASAR file has an offset")
                continue
            offset = entry.get("offset")
            require(isinstance(offset, str) and re.fullmatch(r"0|[1-9][0-9]*", offset),
                    "invalid ASAR payload offset")
            start = int(offset)
            require(start + entry["size"] <= size - 8 - header_size,
                    "ASAR entry outside payload")
            if entry["size"]:
                spans.append((start, start + entry["size"], name))
        previous = None
        for start, stop, name in sorted(spans):
            if previous is not None:
                old_start, old_stop, old_name = previous
                alias = (start, stop) == (old_start, old_stop)
                require(start >= old_stop or alias, "overlapping ASAR payload entries")
                require(not alias or MEMBER not in (name, old_name), "target ASAR member has an alias")
            previous = start, stop, name
        return cls(path, header, raw, 8 + header_size, size, members)

    def member(self, name):
        require(name in self.members, "required ASAR member missing: " + name)
        entry = self.members[name]
        require("offset" in entry and not entry.get("unpacked") and "link" not in entry,
                "required member must be packed: " + name)
        require(entry["size"] <= MAX_MEMBER, "required member exceeds size limit")
        with self.path.open("rb") as source:
            source.seek(self.data_offset + int(entry["offset"]))
            data = source.read(entry["size"])
        require(len(data) == entry["size"], "truncated ASAR member")
        return data

    def verify_integrity(self):
        # The full archive pin covers gaps, trailing data and unpacked/link metadata.
        # Independently verify all packed file hashes and blocks against the header.
        with self.path.open("rb") as source:
            for name, entry in self.members.items():
                if "offset" not in entry:
                    continue
                integrity = entry.get("integrity")
                require(isinstance(integrity, dict) and integrity.get("algorithm") == "SHA256",
                        "missing/unsupported ASAR integrity: " + name)
                block_size = integrity.get("blockSize")
                require(type(block_size) is int and 0 < block_size <= MAX_MEMBER,
                        "invalid ASAR integrity block size")
                source.seek(self.data_offset + int(entry["offset"]))
                remaining = entry["size"]
                digest = hashlib.sha256()
                blocks = []
                while remaining:
                    block = source.read(min(block_size, remaining))
                    require(bool(block), "truncated ASAR payload")
                    digest.update(block)
                    blocks.append(sha256(block))
                    remaining -= len(block)
                # Empty-file writers use either no blocks or one empty block.
                expected_blocks = integrity.get("blocks")
                blocks_match = expected_blocks == blocks or (
                    entry["size"] == 0 and expected_blocks == [sha256(b"")])
                require(integrity.get("hash") == digest.hexdigest() and blocks_match,
                        "ASAR file integrity mismatch: " + name)


def encode_header(header):
    raw = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    padded = raw + b"\0" * (-len(raw) % 4)
    return struct.pack("<4I", 4, len(padded) + 8, len(padded) + 4, len(raw)) + padded, raw


def patched_header(archive, replacement):
    header = copy.deepcopy(archive.header)
    members = dict(entries(header))
    target = members[MEMBER]
    old_end = int(target["offset"]) + target["size"]
    growth = len(replacement) - target["size"]
    for name, entry in members.items():
        if name != MEMBER and "offset" in entry and int(entry["offset"]) >= old_end:
            entry["offset"] = str(int(entry["offset"]) + growth)
    target["size"] = len(replacement)
    integrity = target["integrity"]
    integrity["hash"] = sha256(replacement)
    size = integrity["blockSize"]
    integrity["blocks"] = [sha256(replacement[i:i + size])
                           for i in range(0, len(replacement), size)] or [sha256(b"")]
    return encode_header(header)


def patched_plist(raw, old_hash, new_hash):
    require(raw.count(old_hash.encode("ascii")) == 1, "plist header hash is not unique")
    result = raw.replace(old_hash.encode("ascii"), new_hash.encode("ascii"))
    expected = plistlib.loads(raw)
    expected["ElectronAsarIntegrity"][INTEGRITY_KEY]["hash"] = new_hash
    require(plistlib.loads(result) == expected, "plist patch changed unrelated values")
    return result


def load_manifest(path):
    manifest = json_object(path.read_text())
    require(type(manifest.get("schema_version")) is int and manifest["schema_version"] == 1,
            "unsupported manifest schema")
    require(manifest.get("patch") == {"member": MEMBER, "old": OLD.decode(), "new": NEW.decode()},
            "unsupported patch contract")
    for version in ("desktop_version", "sdk_version", "engine_version"):
        require(isinstance(manifest.get(version), str)
                and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", manifest[version]),
                "invalid manifest version")
    require(isinstance(manifest.get("bundle_identifier"), str), "missing bundle identifier")
    for state in ("original", "patched"):
        pins = manifest.get(state)
        require(isinstance(pins, dict) and set(pins) == {
            "asar_sha256", "asar_size", "header_sha256", "member_sha256", "member_size",
            "plist_sha256", "plist_size"}, "invalid manifest pins: " + state)
        for key, value in pins.items():
            require((isinstance(value, str) and SHA256.fullmatch(value)) if key.endswith("sha256")
                    else (type(value) is int and value > 0), "invalid manifest pin: " + key)
    return manifest


def observe(archive, plist_raw):
    member = archive.member(MEMBER)
    return {
        "asar_sha256": file_hash(archive.path), "asar_size": archive.size,
        "header_sha256": sha256(archive.raw_header),
        "member_sha256": sha256(member), "member_size": len(member),
        "plist_sha256": sha256(plist_raw), "plist_size": len(plist_raw),
    }


def inspect_bundle(app, manifest):
    archive = Asar.read(app / ARCHIVE)
    plist_raw = (app / PLIST).read_bytes()
    plist = plistlib.loads(plist_raw)
    require(isinstance(plist, dict), "expected Info.plist dictionary")
    require(plist.get("CFBundleIdentifier") == manifest["bundle_identifier"]
            and plist.get("CFBundleShortVersionString") == manifest["desktop_version"]
            and plist.get("CFBundleVersion") == manifest["desktop_version"],
            "unsupported Desktop bundle/version")
    pins = observe(archive, plist_raw)
    archives = plist.get("ElectronAsarIntegrity")
    require(isinstance(archives, dict), "missing/invalid ElectronAsarIntegrity")
    integrity = archives.get(INTEGRITY_KEY)
    require(isinstance(integrity, dict), "missing/invalid app.asar ElectronAsarIntegrity")
    require(integrity.get("algorithm") == "SHA256" and integrity.get("hash") == pins["header_sha256"],
            "Info.plist ElectronAsarIntegrity mismatch")
    state = next((name for name in ("original", "patched") if pins == manifest[name]), None)
    require(state is not None, "unknown/tampered ASAR or Info.plist: pins do not match")
    package = json_object(archive.member("package.json"))
    require(package.get("version") == manifest["desktop_version"], "unsupported package version")
    sdk = archive.member(".vite/build/index.chunk-C6zt5-pc.js")
    sdk_marker = ('process.env.CLAUDE_AGENT_SDK_VERSION="' + manifest["sdk_version"] + '"').encode()
    require(sdk.count(sdk_marker) == 1, "unsupported SDK version")
    engine = archive.member(".vite/build/index.chunk-BLvDWgqz.js")
    version = manifest["engine_version"]
    engine_marker = ('function $_(){return JSON.parse(\'{"version":"' + version
                     + '","manifest":{"version":"' + version + '",').encode()
    require(engine.count(engine_marker) == 1, "unsupported bundled engine manifest version")
    member = archive.member(MEMBER)
    require(member.count(OLD) == (1 if state == "original" else 0)
            and member.count(NEW) == (1 if state == "patched" else 0),
            "expected exactly one supported source anchor")
    archive.verify_integrity()
    return state, archive, plist_raw, pins


def ensure_staging(app):
    resolved = app.resolve()
    protected = (Path("/Applications"), Path("/System/Applications"), Path.home() / "Applications")
    require(not any(resolved == root.resolve() or root.resolve() in resolved.parents for root in protected),
            "apply refuses installed application directories; supply a disposable staging bundle")
    require(app.suffix == ".app" and app.is_dir() and not app.is_symlink(),
            "staging path must be a real .app directory")
    for relative in (ARCHIVE, PLIST):
        current = app
        for part in relative.parts:
            current = current / part
            require(not current.is_symlink(), "staging bundle must not contain target path symlinks")
        info = current.stat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                "staging target must be a regular, non-hardlinked file")


def copy_bytes(source, destination, length):
    while length:
        block = source.read(min(CHUNK, length))
        require(bool(block), "archive changed/truncated during staging")
        destination.write(block)
        length -= len(block)


def write_archive(archive, destination, header, replacement):
    target = archive.members[MEMBER]
    with archive.path.open("rb") as source:
        destination.write(header)
        source.seek(archive.data_offset)
        copy_bytes(source, destination, int(target["offset"]))
        destination.write(replacement)
        source.seek(archive.data_offset + int(target["offset"]) + target["size"])
        copy_bytes(source, destination, archive.size - source.tell())


def apply_patch(app, manifest, archive, plist_raw):
    replacement = archive.member(MEMBER).replace(OLD, NEW)
    header, raw_header = patched_header(archive, replacement)
    new_plist = patched_plist(plist_raw, sha256(archive.raw_header), sha256(raw_header))
    temporary = []
    try:
        for path, writer in (
            (app / ARCHIVE, lambda f: write_archive(archive, f, header, replacement)),
            (app / PLIST, lambda f: f.write(new_plist)),
        ):
            fd, name = tempfile.mkstemp(prefix=".snapshot-patch-", dir=path.parent)
            temporary.append(Path(name))
            with os.fdopen(fd, "wb") as output:
                os.fchmod(output.fileno(), stat.S_IMODE(path.stat().st_mode))
                writer(output)
                output.flush()
                os.fsync(output.fileno())
        staged = Asar.read(temporary[0])
        require(observe(staged, temporary[1].read_bytes()) == manifest["patched"],
                "deterministic patched output does not match manifest")
        staged.verify_integrity()
        ensure_staging(app)
        require(file_hash(app / ARCHIVE) == manifest["original"]["asar_sha256"]
                and file_hash(app / PLIST) == manifest["original"]["plist_sha256"],
                "staging input changed during patch; discard and re-stage")
        os.replace(temporary[0], app / ARCHIVE)
        os.replace(temporary[1], app / PLIST)
    finally:
        for path in temporary:
            path.unlink(missing_ok=True)


def run(command, app, manifest):
    if command == "apply":
        ensure_staging(app)
    state, archive, plist_raw, pins = inspect_bundle(app, manifest)
    action = "check" if command == "check" else "noop"
    if command == "apply" and state == "original":
        apply_patch(app, manifest, archive, plist_raw)
        state, _, _, pins = inspect_bundle(app, manifest)
        action = "applied"
    return {"state": state, "status": state, "action": action, "app": str(app.resolve()), "pins": pins,
            "desktop_version": manifest["desktop_version"], "sdk_version": manifest["sdk_version"],
            "engine_version": manifest["engine_version"], "signing_performed": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "apply"))
    parser.add_argument("--app", required=True, type=Path, help="explicit bundle; apply requires disposable staging")
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = run(args.command, args.app, load_manifest(args.manifest))
    except (PatchError, OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, sort_keys=True))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
