#!/usr/bin/env python3
"""Offline installer integration tests: real files, ZIP extraction and SHA-256.

Only external download/mise/build/JVM boundaries are mocked. Fixture archives
replace the pinned checksum in an isolated copy, never in production or through
an installer override. These tests do not claim live Java/Ghidra compatibility;
the real REA provider must additionally import/decompile an executable.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class ReaGhidraTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rea-ghidra-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.home = self.base / "home with spaces"
        self.home.mkdir()
        self.repo = self.base / "repo with spaces"
        self.install = self.repo / "install"
        self.install.mkdir(parents=True)
        shutil.copy2(ROOT / "install/lib.sh", self.install)
        self.script = self.install / "rea-ghidra.sh"
        self.script.write_text((ROOT / "install/rea-ghidra.sh").read_text())
        self.runtime = self.home / ".local/share/rea"
        self.target = self.runtime / "ghidra/12.1.4"
        self.tools = self.base / "fake tools"
        self.tools.mkdir()
        self.java = self.base / "pinned JDK"
        self.calls = self.base / "calls.jsonl"
        self.archive = self.base / "fixture.zip"
        self.env = {key: value for key, value in os.environ.items()
                    if key not in ("BASH_ENV", "ENV", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS",
                                   "JDK_JAVA_OPTIONS", "JAVA_HOME")}
        self.env.update(HOME=str(self.home), PATH=f"{self.tools}:/usr/bin:/bin",
                        TEST_CALLS=str(self.calls), TEST_JAVA=str(self.java),
                        TEST_ARCHIVE=str(self.archive), TEST_OS="Linux", TEST_ARCH="x86_64",
                        JAVA_HOME="/unrelated/global/java17")
        self.executable(self.tools / "uname", '''import os, sys
print(os.environ["TEST_OS" if sys.argv[1] == "-s" else "TEST_ARCH"])
''')
        self.executable(self.tools / "mise", '''import json, os, sys
with open(os.environ["TEST_CALLS"], "a") as log:
    log.write(json.dumps(["mise", *sys.argv[1:]]) + "\\n")
if os.environ.get("TEST_MISE_FAIL"):
    sys.exit(12)
if sys.argv[1] == "where":
    print(os.environ["TEST_JAVA"])
elif sys.argv[1] != "install":
    sys.exit("unexpected mise operation (global configuration must not change)")
''')
        self.executable(self.tools / "curl", '''import json, os, pathlib, shutil, sys
with open(os.environ["TEST_CALLS"], "a") as log:
    log.write(json.dumps(["curl", *sys.argv[1:]]) + "\\n")
if os.environ.get("TEST_DOWNLOAD_FAIL"):
    sys.exit(22)
destination = pathlib.Path(sys.argv[sys.argv.index("-o") + 1])
shutil.copyfile(os.environ["TEST_ARCHIVE"], destination)
if os.environ.get("TEST_BAD_CHECKSUM"):
    destination.write_bytes(b"corrupt archive")
''')
        self.executable(self.tools / "xcode-select", '''import os, sys
sys.exit(1 if os.environ.get("TEST_XCODE_MISSING") else 0)
''')
        self.executable(self.tools / "xcrun", 'print("/fixture/Xcode/clang++")\n')
        self.executable(self.tools / "make", '''import json, os, pathlib, struct, sys
with open(os.environ["TEST_CALLS"], "a") as log:
    log.write(json.dumps(["make", *sys.argv[1:]]) + "\\n")
if os.environ.get("TEST_BUILD_FAIL"):
    sys.exit(2)
expected = ["CXX=clang++ -std=c++11", "ARCH_TYPE=-arch arm64",
            "ADDITIONAL_FLAGS=-mmacosx-version-min=11.0"]
if sys.argv[5:] != expected:
    sys.exit("incorrect arm64 build overrides")
output = pathlib.Path(sys.argv[2]) / sys.argv[4]
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(struct.pack("<II", 0xfeedfacf, 0x100000c) + b"\\0" * 12)
output.chmod(0o755)
''')
        self.executable(self.java / "bin/java", '''import os, sys
print("    java.version = " + os.environ.get("TEST_JAVA_VERSION", "21.0.13"))
print("    java.home = " + os.environ["TEST_JAVA"])
print("    sun.arch.data.model = 64")
print("    os.arch = " + ("aarch64" if os.environ["TEST_OS"] == "Darwin" else "amd64"))
''')
        self.executable(self.java / "bin/javac", 'print("javac 21.0.13")\n')
        self.create_archive()

    def executable(self, path, body):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"#!{sys.executable}\n{body}")
        path.chmod(0o755)

    def create_archive(self, *, wrong_arch=False, missing_headless=False, version="12.1.4"):
        prefix = "ghidra_12.1.4_PUBLIC/"
        header = b"\x7fELF\x02\x01" + b"\0" * 12 + struct.pack("<H", 183 if wrong_arch else 62)
        entries = {
            "Ghidra/application.properties": (f"application.version={version}\n"
                "application.java.min=21\napplication.java.max=\n").encode(),
            "Ghidra/Features/Decompiler/os/linux_x86_64/decompile": header,
            "Ghidra/Features/Decompiler/os/linux_x86_64/sleigh": header,
            "Ghidra/Features/Decompiler/src/decompile/cpp/Makefile": b"# fixture\n",
        }
        if not missing_headless:
            entries["support/analyzeHeadless"] = b"#!/bin/sh\nexit 0\n"
        with zipfile.ZipFile(self.archive, "w") as archive:
            for name, data in entries.items():
                item = zipfile.ZipInfo(prefix + name)
                item.external_attr = (0o100755 if name.endswith(("decompile", "sleigh", "analyzeHeadless"))
                                      else 0o100644) << 16
                archive.writestr(item, data)
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        production = (ROOT / "install/rea-ghidra.sh").read_text()
        start = production.index('REA_GHIDRA_SHA256="') + len('REA_GHIDRA_SHA256="')
        end = production.index('"', start)
        self.script.write_text(production[:start] + digest + production[end:])

    def run_installer(self, *args):
        return subprocess.run(["/bin/bash", str(self.script), *args], cwd=self.repo,
                              env=self.env, capture_output=True, text=True, timeout=30)

    def read_calls(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def test_all_host_dry_runs_have_no_side_effects(self):
        dev = self.run_installer("dev", "--dry-run")
        mac = self.run_installer("macbook", "--dry-run")
        omarchy = self.run_installer("omarchy", "--dry-run")
        self.assertEqual([dev.returncode, mac.returncode, omarchy.returncode], [0, 0, 0])
        self.assertIn("mise install java@", dev.stdout)
        self.assertIn("Xcode clang++/make", mac.stdout)
        self.assertIn("linux_x86_64", omarchy.stdout)
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse(self.calls.exists())

    def test_linux_install_records_validated_paths_and_preserves_global_java(self):
        global_config = self.home / ".config/mise/config.toml"
        global_config.parent.mkdir(parents=True)
        global_config.write_text('[tools]\njava = "17"\n')
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.runtime / "ghidra-path").read_text(), str(self.target) + "\n")
        self.assertEqual((self.runtime / "java-home").read_text(), str(self.java) + "\n")
        self.assertEqual(global_config.read_text(), '[tools]\njava = "17"\n')
        self.assertTrue(os.access(self.target / "support/analyzeHeadless", os.X_OK))
        self.assertEqual([call[:2] for call in self.read_calls()],
                         [["mise", "install"], ["mise", "where"], ["curl", "--fail"]])
        self.assertEqual(list((self.runtime / "ghidra").iterdir()), [self.target])

    def test_mac_build_installs_both_native_arm64_tools(self):
        self.env.update(TEST_OS="Darwin", TEST_ARCH="arm64")
        result = self.run_installer("macbook")
        self.assertEqual(result.returncode, 0, result.stderr)
        native = self.target / "Ghidra/Features/Decompiler/os/mac_arm_64"
        self.assertEqual((native / "decompile").read_bytes()[:8], bytes.fromhex("cffaedfe0c000001"))
        self.assertEqual((native / "sleigh").read_bytes()[:8], bytes.fromhex("cffaedfe0c000001"))
        self.assertEqual((self.runtime / "ghidra-path").read_text(), str(self.target) + "\n")
        self.assertEqual((self.runtime / "java-home").read_text(), str(self.java) + "\n")

    def test_idempotent_rerun_does_not_download_or_rebuild(self):
        first = self.run_installer("dev")
        stamp = (self.runtime / "ghidra-path").stat().st_mtime_ns
        second = self.run_installer("dev")
        self.assertEqual([first.returncode, second.returncode], [0, 0], second.stderr)
        self.assertIn("installed and validated", second.stdout)
        self.assertEqual((self.runtime / "ghidra-path").stat().st_mtime_ns, stamp)
        self.assertEqual(sum(call[0] == "curl" for call in self.read_calls()), 1)
        self.assertEqual((self.runtime / "ghidra-path").read_text(), str(self.target) + "\n")

    def test_interruption_after_publish_is_reconciled_without_download(self):
        first = self.run_installer("dev")
        (self.runtime / "java-home").unlink()
        (self.runtime / "ghidra-path").unlink()
        second = self.run_installer("dev")
        self.assertEqual([first.returncode, second.returncode], [0, 0], second.stderr)
        self.assertEqual((self.runtime / "java-home").read_text(), str(self.java) + "\n")
        self.assertEqual((self.runtime / "ghidra-path").read_text(), str(self.target) + "\n")
        self.assertEqual(sum(call[0] == "curl" for call in self.read_calls()), 1)

    def test_checksum_mismatch_never_publishes_and_retry_succeeds(self):
        self.env["TEST_BAD_CHECKSUM"] = "1"
        failure = self.run_installer("dev")
        self.assertEqual(failure.returncode, 1)
        self.assertIn("SHA-256 mismatch", failure.stderr)
        self.assertEqual(list((self.runtime / "ghidra").iterdir()), [])
        self.assertFalse((self.runtime / "ghidra-path").exists())
        self.env.pop("TEST_BAD_CHECKSUM")
        retry = self.run_installer("dev")
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertEqual((self.runtime / "ghidra-path").read_text(), str(self.target) + "\n")

    def test_download_failure_leaves_no_records_or_partial_install(self):
        self.env["TEST_DOWNLOAD_FAIL"] = "1"
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 22)
        self.assertEqual(list((self.runtime / "ghidra").iterdir()), [])
        self.assertFalse((self.runtime / "java-home").exists())
        self.assertFalse((self.runtime / "ghidra-path").exists())

    def test_build_failure_leaves_no_records(self):
        self.env.update(TEST_OS="Darwin", TEST_ARCH="arm64", TEST_BUILD_FAIL="1")
        result = self.run_installer("macbook")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(list((self.runtime / "ghidra").iterdir()), [])
        self.assertFalse((self.runtime / "ghidra-path").exists())

    def test_wrong_native_architecture_fails_validation_before_publish(self):
        self.create_archive(wrong_arch=True)
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("wrong native executable architecture", result.stderr)
        self.assertFalse(self.target.exists())
        self.assertFalse((self.runtime / "ghidra-path").exists())

    def test_wrong_java_fails_validation_before_publish(self):
        self.env["TEST_JAVA_VERSION"] = "17.0.19"
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("matching native 64-bit JDK 21.0.13", result.stderr)
        self.assertFalse(self.target.exists())
        self.assertFalse((self.runtime / "java-home").exists())

    def test_incomplete_archive_fails_validation_before_publish(self):
        self.create_archive(missing_headless=True)
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing executable", result.stderr)
        self.assertFalse(self.target.exists())
        self.assertFalse((self.runtime / "ghidra-path").exists())

    def test_wrong_ghidra_version_fails_validation_before_publish(self):
        self.create_archive(version="12.0.4")
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unexpected Ghidra version", result.stderr)
        self.assertFalse(self.target.exists())

    def test_missing_javac_rejects_jre(self):
        (self.java / "bin/javac").unlink()
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("absolute full JDK home", result.stderr)
        self.assertFalse(self.runtime.exists())

    def test_foreign_runtime_symlink_is_preserved(self):
        foreign = self.base / "foreign"
        foreign.mkdir()
        (foreign / "user-data").write_text("preserve me")
        self.runtime.parent.mkdir(parents=True)
        self.runtime.symlink_to(foreign)
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated", result.stderr)
        self.assertEqual(self.runtime.readlink(), foreign)
        self.assertEqual((foreign / "user-data").read_text(), "preserve me")
        self.assertFalse(self.calls.exists())

    def test_foreign_version_directory_is_preserved(self):
        self.target.mkdir(parents=True)
        (self.target / "user-data").write_text("preserve me")
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unowned", result.stderr)
        self.assertEqual((self.target / "user-data").read_text(), "preserve me")
        self.assertFalse(self.calls.exists())

    def test_foreign_record_symlink_is_preserved(self):
        self.runtime.mkdir(parents=True)
        foreign = self.base / "foreign"
        foreign.write_text("preserve me")
        (self.runtime / "java-home").symlink_to(foreign)
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated", result.stderr)
        self.assertEqual(foreign.read_text(), "preserve me")
        self.assertEqual((self.runtime / "java-home").readlink(), foreign)
        self.assertFalse(self.calls.exists())

    def test_foreign_plain_records_are_preserved(self):
        self.runtime.mkdir(parents=True)
        (self.runtime / "ghidra-path").write_text("/foreign/ghidra\n")
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("without an owned installation", result.stderr)
        self.assertEqual((self.runtime / "ghidra-path").read_text(), "/foreign/ghidra\n")
        self.assertFalse(self.calls.exists())

    def test_user_repointed_record_beside_owned_install_is_preserved(self):
        first = self.run_installer("dev")
        (self.runtime / "java-home").write_text("/foreign/java\n")
        result = self.run_installer("dev")
        self.assertEqual([first.returncode, result.returncode], [0, 1])
        self.assertIn("refusing unrelated REA Ghidra record contents", result.stderr)
        self.assertEqual((self.runtime / "java-home").read_text(), "/foreign/java\n")
        self.assertEqual((self.runtime / "ghidra-path").read_text(), str(self.target) + "\n")

    def test_mise_failure_prevents_download_and_records(self):
        self.env["TEST_MISE_FAIL"] = "1"
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 12)
        self.assertEqual([call[:2] for call in self.read_calls()], [["mise", "install"]])
        self.assertFalse(self.runtime.exists())

    def test_corrupt_owned_install_is_not_deleted_or_silently_replaced(self):
        first = self.run_installer("dev")
        headless = self.target / "support/analyzeHeadless"
        headless.unlink()
        result = self.run_installer("dev")
        self.assertEqual([first.returncode, result.returncode], [0, 1])
        self.assertIn("missing executable", result.stderr)
        self.assertTrue((self.target / ".rea-owned").exists())
        self.assertEqual(sum(call[0] == "curl" for call in self.read_calls()), 1)

    def test_unsupported_architecture_fails_before_tools(self):
        self.env["TEST_ARCH"] = "aarch64"
        result = self.run_installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unsupported REA Ghidra host", result.stderr)
        self.assertFalse(self.calls.exists())
        self.assertEqual(list(self.home.iterdir()), [])

    def test_host_os_mismatch_fails_before_tools(self):
        result = self.run_installer("macbook")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unsupported REA Ghidra host", result.stderr)
        self.assertFalse(self.calls.exists())

    def test_missing_xcode_fails_before_download_and_mise(self):
        self.env.update(TEST_OS="Darwin", TEST_ARCH="arm64", TEST_XCODE_MISSING="1")
        result = self.run_installer("macbook")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Xcode Command Line Tools", result.stderr)
        self.assertFalse(self.calls.exists())

    def test_invalid_host_and_flags_fail_before_tools(self):
        host = self.run_installer("unknown")
        flag = self.run_installer("dev", "--force")
        self.assertEqual([host.returncode, flag.returncode], [1, 1])
        self.assertIn("requires dev, omarchy, or macbook", host.stderr)
        self.assertIn("Usage:", flag.stderr)
        self.assertFalse(self.calls.exists())


if __name__ == "__main__":
    unittest.main()
