#!/usr/bin/env python3
"""Installer integration tests: real hashing/tar/files, fixture network and OS.

Only the release checksums are substituted in a temporary installer copy so
small, deterministic archives exercise success as well as failure offline.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "install/antigravity-cli.sh"


class AntigravityInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="antigravity-install-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.target = self.home / ".local/bin/agy"
        self.archive = self.root / "fixture.tar.gz"
        self.installer = self.root / "antigravity-cli.sh"
        shutil.copy(ROOT / "install/lib.sh", self.root / "lib.sh")
        shutil.copy(ROOT / "install/retired-ai-tools.sh", self.root / "retired-ai-tools.sh")
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("MISE_", "XDG_"))}
        self.env.update(HOME=str(self.home), PATH=f"{self.bin}:{os.environ['PATH']}",
                        DRY_RUN="0", FIXTURE=str(self.archive), REQUEST=str(self.root / "request"),
                        MISE_SYSTEM_CONFIG_DIR=str(self.root / "system"), MISE_OFFLINE="1",
                        XDG_CONFIG_HOME=str(self.root / "config"), XDG_DATA_HOME=str(self.root / "data"),
                        XDG_CACHE_HOME=str(self.root / "cache"), XDG_STATE_HOME=str(self.root / "state"))
        self.script("uname", '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n')
        self.script("curl", '''#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then shift; output="$1"; fi
  url="$1"
  shift
done
printf '%s' "$url" > "$REQUEST"
cp "$FIXTURE" "$output"
''')
        self.payload = b'#!/bin/sh\n[ "$1" = --version ] || exit 99\necho 1.5.15\n'
        self.fixture()

    def script(self, name, text):
        path = self.bin / name
        path.write_text(text)
        path.chmod(0o755)

    def fixture(self, payload=None, member="antigravity"):
        content = self.payload if payload is None else payload
        with tarfile.open(self.archive, "w:gz") as archive:
            info = tarfile.TarInfo(member)
            info.size = len(content)
            info.mode = 0o755
            archive.addfile(info, io.BytesIO(content))
        digest = hashlib.sha512(self.archive.read_bytes()).hexdigest()
        self.installer.write_text(re.sub(r"(?<=checksum=)[a-f0-9]{128}", digest, INSTALLER.read_text()))

    def run_installer(self):
        return subprocess.run(["bash", "-c", 'source "$1"; install_antigravity_cli', "_", str(self.installer)],
                              env=self.env, text=True, capture_output=True, timeout=20)

    def disabled_tools(self):
        return json.loads(subprocess.check_output(["mise", "-C", str(self.home), "settings", "get", "disable_tools"],
                                                  env=self.env, cwd=self.home, text=True))

    def previous(self):
        self.target.parent.mkdir(parents=True)
        self.target.write_text("#!/bin/sh\necho 0.0.1\n")
        self.target.chmod(0o755)
        return self.target.read_bytes()

    def test_linux_install_and_rerun_preserve_executable_without_download(self):
        first = self.run_installer()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(self.target.read_bytes(), self.payload)
        self.assertEqual(subprocess.check_output([str(self.target), "--version"], text=True), "1.5.15\n")
        self.assertEqual((self.root / "request").read_text(),
                         "https://storage.googleapis.com/antigravity-public/antigravity-cli/"
                         "1.5.15-5514532022517760/linux-x64/cli_linux_x64.tar.gz")
        self.assertEqual(self.disabled_tools(), ["antigravity-cli"])
        subprocess.run(["mise", "-C", str(self.home), "settings", "set", "--override", "disable_tools", "ruby"],
                       env=self.env, cwd=self.home, check=True)
        self.archive.unlink()  # A download on the second run now fails.
        second = self.run_installer()
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("already at", second.stdout)
        self.assertEqual(self.disabled_tools(), ["antigravity-cli", "ruby"])
        self.assertEqual(self.target.read_bytes(), self.payload)
        self.assertEqual(sorted(str(p.relative_to(self.home)) for p in self.home.rglob("*")),
                         [".local", ".local/bin", ".local/bin/agy"])

    def test_macbook_arm64_selects_official_asset_and_installs(self):
        self.script("uname", '#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; esac\n')
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.target.read_bytes(), self.payload)
        self.assertEqual((self.root / "request").read_text(),
                         "https://storage.googleapis.com/antigravity-public/antigravity-cli/"
                         "1.5.15-5514532022517760/darwin-arm/cli_mac_arm64.tar.gz")

    def test_macbook_intel_selects_official_asset_and_installs(self):
        self.script("uname", '#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo x86_64;; esac\n')
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.target.read_bytes(), self.payload)
        self.assertTrue((self.root / "request").read_text().endswith("/darwin-x64/cli_mac_x64.tar.gz"))

    def test_dry_run_does_not_execute_existing_binary_or_change_home(self):
        self.previous()
        self.target.write_text('#!/bin/sh\ntouch "$HOME/unwanted-execution"\necho 0.0.1\n')
        original = self.target.read_bytes()
        self.env["DRY_RUN"] = "1"
        self.script("curl", "#!/bin/sh\nexit 97\n")
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Would install agy", result.stdout)
        self.assertEqual(self.target.read_bytes(), original)
        self.assertFalse((self.root / "request").exists())
        self.assertFalse((self.home / "unwanted-execution").exists())

    def test_destination_directory_is_preserved_and_rejected(self):
        self.target.mkdir(parents=True)
        (self.target / "user-file").write_text("keep")
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("destination is a directory", result.stderr)
        self.assertEqual((self.target / "user-file").read_text(), "keep")
        self.assertEqual(sorted(p.name for p in self.target.iterdir()), ["user-file"])

    def test_corrupt_download_preserves_previous_executable(self):
        original = self.previous()
        self.archive.write_bytes(b"corrupt download")
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.disabled_tools(), [])
        self.assertIn("FAILED", result.stdout + result.stderr)
        self.assertEqual(self.target.read_bytes(), original)

    def test_failed_download_preserves_previous_executable(self):
        original = self.previous()
        self.script("curl", "#!/bin/sh\nexit 22\n")
        result = self.run_installer()
        self.assertEqual(result.returncode, 22)
        self.assertEqual(self.target.read_bytes(), original)

    def test_wrong_version_preserves_previous_executable(self):
        original = self.previous()
        self.fixture(b"#!/bin/sh\necho 0.0.2\n")
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.disabled_tools(), [])
        self.assertIn("unexpected Antigravity CLI version: 0.0.2", result.stderr)
        self.assertEqual(self.target.read_bytes(), original)

    def test_missing_binary_does_not_create_install(self):
        self.fixture(member="wrong-name")
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.target.exists())

    def test_unsupported_platform_fails_explicitly(self):
        self.script("uname", "#!/bin/sh\necho unsupported\n")
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported Antigravity CLI platform", result.stderr)
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
