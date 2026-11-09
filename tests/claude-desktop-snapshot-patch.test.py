#!/usr/bin/env python3
"""Offline integration tests: real CLI, Chromium pickles, files, hashes and plist.

Fixture encoding and expected archives are independent of the patcher. No app,
network, signing tool, installed bundle or user settings are used by this suite.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/claude_desktop_snapshot_patch.py"
SPEC = importlib.util.spec_from_file_location("snapshot_patch", SCRIPT)
PATCH = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PATCH
SPEC.loader.exec_module(PATCH)
MEMBER = ".vite/build/index.chunk-Cy6fdnz-.js"
OLD = b"snapshot:W},mt.t($),n.tt($);let Or="
NEW = b'snapshot:W},mt.t($),n.tt($);c.kind==="local"&&!T&&($.systemPrompt.snapshot=!1);let Or='
ORIGINAL_MEMBER = b"prefix/" + OLD + b"/suffix"
PATCHED_MEMBER = b"prefix/" + NEW + b"/suffix"


def digest(value):
    return hashlib.sha256(value).hexdigest()


def encode(header, payload):
    raw = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode()
    padding = bytes((-len(raw)) % 4)
    return struct.pack("<4I", 4, len(raw + padding) + 8, len(raw + padding) + 4, len(raw)) + raw + padding + payload


def decode(blob):
    _, header_size, _, json_size = struct.unpack("<4I", blob[:16])
    header = json.loads(blob[16:16 + json_size])
    return header, blob[8 + header_size:]


def member_entries(header, prefix=""):
    result = {}
    for name, entry in header["files"].items():
        if "files" in entry:
            result.update(member_entries(entry, prefix + name + "/"))
        else:
            result[prefix + name] = entry
    return result


def fixture_archive(target=ORIGINAL_MEMBER, sdk_version="0.3.321", engine_version="2.1.321"):
    header = {"files": {}, "fixtureMetadata": "preserve café"}
    payload = bytearray(b"leading-gap")
    files = [
        ("before.bin", b"\x00\x01before\xff"),
        (MEMBER, target),
        (".vite/build/index.chunk-C6zt5-pc.js",
         ('process.env.CLAUDE_AGENT_SDK_VERSION="' + sdk_version + '";').encode()),
        (".vite/build/index.chunk-BLvDWgqz.js",
         ('function $_(){return JSON.parse(\'{"version":"' + engine_version
          + '","manifest":{"version":"' + engine_version + '","other":true}}\')}').encode()),
        ("package.json", b'{"name":"fixture","version":"4.23118.1"}'),
        ("after.bin", b"unchanged after\x00\xff"),
        ("empty.bin", b""),
    ]
    for name, data in files:
        directory = header
        parts = name.split("/")
        for part in parts[:-1]:
            directory = directory["files"].setdefault(part, {"files": {}, "directoryMetadata": True})
        blocks = [digest(data[i:i + 16]) for i in range(0, len(data), 16)] or [digest(b"")]
        directory["files"][parts[-1]] = {
            "size": len(data), "offset": str(len(payload)), "executable": True,
            "integrity": {"algorithm": "SHA256", "hash": digest(data), "blockSize": 16,
                          "blocks": blocks, "extraMetadata": "keep"},
        }
        payload.extend(data)
        payload.extend(b"gap")
    header["files"]["alias.bin"] = copy.deepcopy(header["files"]["after.bin"])
    header["files"]["native.node"] = {"size": 41, "unpacked": True, "executable": True,
                                      "integrity": {"algorithm": "SHA256", "hash": "a" * 64}}
    header["files"]["symlink"] = {"link": "after.bin", "linkMetadata": "keep"}
    payload.extend(b"trailing-data")
    return encode(header, payload)


def fixture_plist(archive, binary=False):
    _, _, _, json_size = struct.unpack("<4I", archive[:16])
    data = {
        "CFBundleIdentifier": "com.anthropic.claudefordesktop",
        "CFBundleShortVersionString": "4.23118.1", "CFBundleVersion": "4.23118.1",
        "ElectronAsarIntegrity": {
            "Resources/app.asar": {"algorithm": "SHA256", "hash": digest(archive[16:16 + json_size])},
            "Resources/other.asar": {"algorithm": "SHA256", "hash": "f" * 64},
        },
        "unrelated": ["preserve", 123, True],
    }
    return plistlib.dumps(data, fmt=plistlib.FMT_BINARY if binary else plistlib.FMT_XML, sort_keys=False)


def pins(archive, plist):
    header, payload = decode(archive)
    target = member_entries(header)[MEMBER]
    member = payload[int(target["offset"]):int(target["offset"]) + target["size"]]
    json_size = struct.unpack("<I", archive[12:16])[0]
    return {"asar_sha256": digest(archive), "asar_size": len(archive),
            "header_sha256": digest(archive[16:16 + json_size]),
            "member_sha256": digest(member), "member_size": len(member),
            "plist_sha256": digest(plist), "plist_size": len(plist)}


class SnapshotPatchTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="claude-snapshot-patch-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.app = self.root / "Staged.app"
        self.asar = self.app / "Contents/Resources/app.asar"
        self.plist = self.app / "Contents/Info.plist"
        self.asar.parent.mkdir(parents=True)
        self.manifest_path = self.root / "manifest.json"
        self.install_fixture()

    def install_fixture(self, target=ORIGINAL_MEMBER, binary=False, **versions):
        self.original = fixture_archive(target, **versions)
        self.expected = fixture_archive(PATCHED_MEMBER, **versions)
        self.original_plist = fixture_plist(self.original, binary=binary)
        self.expected_plist = fixture_plist(self.expected, binary=binary)
        self.asar.write_bytes(self.original)
        self.plist.write_bytes(self.original_plist)
        self.manifest = {
            "schema_version": 1, "desktop_version": "4.23118.1", "sdk_version": "0.3.321",
            "engine_version": "2.1.321", "bundle_identifier": "com.anthropic.claudefordesktop",
            "patch": {"member": MEMBER, "old": OLD.decode(), "new": NEW.decode()},
            "original": pins(self.original, self.original_plist),
            "patched": pins(self.expected, self.expected_plist),
        }
        self.manifest_path.write_text(json.dumps(self.manifest))

    def repin_original(self, archive, plist=None):
        plist = fixture_plist(archive) if plist is None else plist
        self.asar.write_bytes(archive)
        self.plist.write_bytes(plist)
        self.manifest["original"] = pins(archive, plist)
        self.manifest_path.write_text(json.dumps(self.manifest))

    def cli(self, command, app=None):
        return subprocess.run([sys.executable, str(SCRIPT), command, "--app", str(app or self.app),
                               "--manifest", str(self.manifest_path)], text=True, capture_output=True,
                              timeout=20, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))

    def test_check_reports_original_pins_without_mutating(self):
        result = self.cli("check")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["state"], "original")
        self.assertEqual(json.loads(result.stdout)["signing_performed"], False)
        self.assertEqual(json.loads(result.stdout)["pins"], self.manifest["original"])
        self.assertEqual(self.asar.read_bytes(), self.original)
        self.assertEqual(self.plist.read_bytes(), self.original_plist)

    def test_apply_matches_independently_encoded_archive_and_plist_exactly(self):
        result = self.cli("apply")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["action"], "applied")
        self.assertEqual(self.asar.read_bytes(), self.expected)
        self.assertEqual(self.plist.read_bytes(), self.expected_plist)
        self.assertEqual(json.loads(result.stdout)["pins"], self.manifest["patched"])

    def test_second_apply_is_noop_including_inode_and_mtime(self):
        subprocess.run([sys.executable, str(SCRIPT), "apply", "--app", str(self.app),
                        "--manifest", str(self.manifest_path)], check=True, capture_output=True)
        before = (self.asar.stat(), self.plist.stat())
        result = self.cli("apply")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(json.loads(result.stdout)["action"], "noop")
        self.assertEqual((self.asar.stat(), self.plist.stat()), before)
        self.assertEqual(self.asar.read_bytes(), self.expected)

    def test_check_recognizes_patched_bundle(self):
        self.asar.write_bytes(self.expected)
        self.plist.write_bytes(self.expected_plist)
        result = self.cli("check")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(json.loads(result.stdout)["status"], "patched")

    def test_binary_plist_changes_only_header_digest_bytes(self):
        self.install_fixture(binary=True)
        result = self.cli("apply")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.plist.read_bytes(), self.expected_plist)

    def test_offsets_alignment_blocks_and_alias_metadata_survive_growth(self):
        result = self.cli("apply")
        header, payload = decode(self.asar.read_bytes())
        members = member_entries(header)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(header, decode(self.expected)[0])
        self.assertEqual(payload, decode(self.expected)[1])
        self.assertEqual(members["alias.bin"], members["after.bin"])
        self.assertEqual(members["symlink"], {"link": "after.bin", "linkMetadata": "keep"})
        self.assertEqual(members[MEMBER]["integrity"]["blocks"],
                         [digest(PATCHED_MEMBER[i:i + 16]) for i in range(0, len(PATCHED_MEMBER), 16)])
        self.assertEqual(struct.unpack("<I", self.asar.read_bytes()[4:8])[0] % 4, 0)
        self.assertEqual(plistlib.loads(self.plist.read_bytes())["ElectronAsarIntegrity"]["Resources/app.asar"]["hash"],
                         self.manifest["patched"]["header_sha256"])

    def test_archive_tamper_refuses_and_preserves_files(self):
        damaged = self.original[:-1] + b"!"
        self.asar.write_bytes(damaged)
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("pins do not match", json.loads(result.stdout)["error"])
        self.assertEqual(self.asar.read_bytes(), damaged)
        self.assertEqual(self.plist.read_bytes(), self.original_plist)

    def test_plist_tamper_refuses_even_when_version_and_integrity_still_match(self):
        self.plist.write_bytes(self.original_plist.replace(b"preserve", b"tampered"))
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("pins do not match", json.loads(result.stdout)["error"])
        self.assertEqual(self.asar.read_bytes(), self.original)

    def test_mixed_crash_state_is_refused_not_repaired(self):
        self.asar.write_bytes(self.expected)
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("ElectronAsarIntegrity mismatch", json.loads(result.stdout)["error"])
        self.assertEqual(self.plist.read_bytes(), self.original_plist)

    def test_unsupported_desktop_version_refuses(self):
        self.plist.write_bytes(self.original_plist.replace(b"4.23118.1", b"4.23118.2"))
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unsupported Desktop", json.loads(result.stdout)["error"])
        self.assertEqual(self.asar.read_bytes(), self.original)

    def test_unsupported_sdk_version_refuses_even_with_matching_pins(self):
        self.install_fixture(sdk_version="0.3.322")
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unsupported SDK version", json.loads(result.stdout)["error"])
        self.assertEqual(self.asar.read_bytes(), self.original)

    def test_unsupported_engine_version_refuses_even_with_matching_pins(self):
        self.install_fixture(engine_version="2.1.322")
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unsupported bundled engine", json.loads(result.stdout)["error"])

    def test_zero_anchor_refuses_even_with_matching_pins(self):
        self.install_fixture(target=b"no anchor")
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("exactly one supported source anchor", json.loads(result.stdout)["error"])
        self.assertEqual(self.asar.read_bytes(), self.original)

    def test_multiple_anchors_refuse_even_with_matching_pins(self):
        self.install_fixture(target=OLD + b";" + OLD)
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("exactly one supported source anchor", json.loads(result.stdout)["error"])

    def test_bad_target_block_hash_refuses_even_with_matching_archive_pins(self):
        header, payload = decode(self.original)
        member_entries(header)[MEMBER]["integrity"]["blocks"][0] = "0" * 64
        self.repin_original(encode(header, payload))
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("ASAR file integrity mismatch", json.loads(result.stdout)["error"])

    def test_bad_other_file_hash_refuses_even_with_matching_archive_pins(self):
        header, payload = decode(self.original)
        header["files"]["before.bin"]["integrity"]["hash"] = "0" * 64
        self.repin_original(encode(header, payload))
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("ASAR file integrity mismatch: before.bin", json.loads(result.stdout)["error"])

    def test_wrong_patched_digest_does_not_replace_either_file(self):
        self.manifest["patched"]["asar_sha256"] = "0" * 64
        self.manifest_path.write_text(json.dumps(self.manifest))
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("patched output does not match", json.loads(result.stdout)["error"])
        self.assertEqual(self.asar.read_bytes(), self.original)
        self.assertEqual(self.plist.read_bytes(), self.original_plist)
        self.assertEqual(list(self.app.rglob(".snapshot-patch-*")), [])

    def test_target_alias_is_refused(self):
        header, payload = decode(self.original)
        header["files"]["target-alias"] = copy.deepcopy(member_entries(header)[MEMBER])
        self.asar.write_bytes(encode(header, payload))
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("target ASAR member has an alias", json.loads(result.stdout)["error"])

    def test_partial_overlap_is_refused(self):
        header, payload = decode(self.original)
        header["files"]["alias.bin"]["offset"] = "12"
        self.asar.write_bytes(encode(header, payload))
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("overlapping ASAR payload entries", json.loads(result.stdout)["error"])

    def test_out_of_bounds_offset_is_refused(self):
        header, payload = decode(self.original)
        header["files"]["before.bin"]["offset"] = "999999999"
        self.asar.write_bytes(encode(header, payload))
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("outside payload", json.loads(result.stdout)["error"])

    def test_bad_pickle_lengths_are_refused(self):
        self.asar.write_bytes(struct.pack("<I", 8) + self.original[4:])
        result = self.cli("check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("pickle lengths/alignment", json.loads(result.stdout)["error"])

    def test_truncated_header_is_refused(self):
        self.asar.write_bytes(self.original[:30])
        result = self.cli("check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("truncated ASAR header", json.loads(result.stdout)["error"])

    def test_symlinked_bundle_is_refused(self):
        link = self.root / "Link.app"
        link.symlink_to(self.app, target_is_directory=True)
        result = self.cli("apply", app=link)
        self.assertEqual(result.returncode, 1)
        self.assertIn("real .app directory", json.loads(result.stdout)["error"])
        self.assertEqual(self.asar.read_bytes(), self.original)

    def test_symlinked_archive_is_refused(self):
        external = self.root / "external.asar"
        self.asar.rename(external)
        self.asar.symlink_to(external)
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("target path symlinks", json.loads(result.stdout)["error"])
        self.assertEqual(external.read_bytes(), self.original)

    def test_hardlinked_archive_is_refused(self):
        external = self.root / "external.asar"
        os.link(self.asar, external)
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("non-hardlinked", json.loads(result.stdout)["error"])
        self.assertEqual(external.read_bytes(), self.original)

    def test_installed_applications_path_is_refused_before_reading(self):
        result = self.cli("apply", app=Path("/Applications/Claude.app"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("refuses installed application directories", json.loads(result.stdout)["error"])
        self.assertEqual(self.asar.read_bytes(), self.original)

    def test_unsupported_manifest_schema_is_refused(self):
        self.manifest["schema_version"] = 2
        self.manifest_path.write_text(json.dumps(self.manifest))
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unsupported manifest schema", json.loads(result.stdout)["error"])
        self.assertEqual(self.asar.read_bytes(), self.original)

    def test_nonzero_pickle_padding_is_refused(self):
        header, payload = decode(self.original)
        header["alignment"] = ""
        base = len(json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode())
        header["alignment"] = "x" * ((1 - base) % 4)
        encoded = encode(header, payload)
        header_end = 8 + struct.unpack("<I", encoded[4:8])[0]
        self.asar.write_bytes(encoded[:header_end - 1] + b"!" + encoded[header_end:])
        result = self.cli("check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("nonzero ASAR pickle padding", json.loads(result.stdout)["error"])

    def test_duplicate_header_json_keys_are_refused(self):
        raw = b'{"files":{},"files":{}}'
        padded = raw + bytes(-len(raw) % 4)
        self.asar.write_bytes(struct.pack("<4I", 4, len(padded) + 8, len(padded) + 4, len(raw)) + padded)
        result = self.cli("check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate JSON key", json.loads(result.stdout)["error"])

    def test_unsupported_integrity_algorithm_is_refused(self):
        header, payload = decode(self.original)
        member_entries(header)[MEMBER]["integrity"]["algorithm"] = "SHA512"
        self.repin_original(encode(header, payload))
        result = self.cli("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unsupported ASAR integrity", json.loads(result.stdout)["error"])

    def test_malformed_plist_integrity_returns_json_error(self):
        malformed = plistlib.loads(self.original_plist)
        malformed["ElectronAsarIntegrity"] = []
        self.plist.write_bytes(plistlib.dumps(malformed))
        result = self.cli("check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing/invalid ElectronAsarIntegrity", json.loads(result.stdout)["error"])

    def test_replacement_preserves_target_file_modes(self):
        self.asar.chmod(0o640)
        self.plist.chmod(0o600)
        result = self.cli("apply")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.asar.stat().st_mode & 0o777, 0o640)
        self.assertEqual(self.plist.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.asar.read_bytes(), self.expected)

    def test_missing_explicit_app_argument_is_refused(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "apply", "--manifest", str(self.manifest_path)],
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertIn("--app", result.stderr)
        self.assertEqual(self.asar.read_bytes(), self.original)


if __name__ == "__main__":
    unittest.main(verbosity=2)
