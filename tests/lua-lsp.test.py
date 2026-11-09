#!/usr/bin/env python3
"""Installer integration tests. Network/OS probes are fixtures; hashing and files are real."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "install/lua-lsp.sh"


class LuauInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="luau-install-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.target = self.home / ".local/bin/luau-lsp"
        self.env = dict(os.environ, HOME=str(self.home), PATH=f"{self.bin}:{os.environ['PATH']}", DRY_RUN="0")
        self.script("uname", '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n')
        self.script("curl", '''#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then shift; output="$1"; fi
  shift
done
printf 'corrupted download' > "$output"
''')

    def script(self, name, text):
        path = self.bin / name
        path.write_text(text)
        path.chmod(0o755)

    def run_installer(self, prefix=""):
        return subprocess.run(
            ["bash", "-c", f'source "$1"; {prefix}install_luau_lsp', "_", str(INSTALLER)],
            env=self.env, text=True, capture_output=True, timeout=20,
        )

    def test_dry_run_plans_linux_download_without_installing(self):
        result = self.run_installer("DRY_RUN=1; ")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("luau-lsp-linux-x86_64.zip", result.stdout)
        self.assertIn("verify SHA-256", result.stdout)
        self.assertFalse(self.target.exists())

    def test_matching_version_converges_without_download_or_replacement(self):
        version = subprocess.check_output(
            ["bash", "-c", 'source "$1"; printf %s "$LUAU_LSP_VERSION"', "_", str(INSTALLER)],
            env=self.env, text=True,
        )
        self.target.parent.mkdir(parents=True)
        original = f"#!/bin/sh\nprintf '%s\\n' '{version}'\n# Keep this installed executable\n"
        self.target.write_text(original)
        self.target.chmod(0o755)
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("already at", result.stdout)
        self.assertEqual(self.target.read_text(), original)
        self.assertEqual(list(self.target.parent.glob("luau-lsp.bak*")), [])

    def test_bad_checksum_preserves_previous_executable(self):
        self.target.parent.mkdir(parents=True)
        original = "#!/bin/sh\necho previous-version\n"
        self.target.write_text(original)
        self.target.chmod(0o755)
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FAILED", result.stdout + result.stderr)
        self.assertEqual(self.target.read_text(), original)
        self.assertEqual(subprocess.check_output([str(self.target)], text=True), "previous-version\n")

    def test_bad_checksum_does_not_create_a_fresh_install(self):
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FAILED", result.stdout + result.stderr)
        self.assertFalse(self.target.exists())

    def test_unsupported_platform_fails_explicitly(self):
        self.script("uname", "#!/bin/sh\necho unsupported\n")
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported Luau LSP platform", result.stderr)
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
