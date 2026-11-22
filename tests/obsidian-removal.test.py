#!/usr/bin/env python3
"""Exercise retired note-app selection and system-default document opening."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ObsidianRemovalTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="obsidian-removal-")
        self.addCleanup(self.fixture.cleanup)
        self.home = Path(self.fixture.name)
        self.env = {**os.environ, "HOME": str(self.home), "DRY_RUN": "1", "REPO_ROOT": str(ROOT)}

    def shell(self, script):
        return subprocess.run(["/bin/bash", "-c", script], cwd=ROOT, env=self.env,
                              capture_output=True, text=True, timeout=30)

    def test_default_mac_cask_plan_preserves_apps_without_retired_app(self):
        result = self.shell('source install/brew.sh; install_brew_casks')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("brew install --cask --adopt slack spotify signal obs orbstack", result.stdout)
        self.assertNotIn("obsidian", result.stdout.lower())

    def test_mac_host_cask_plan_preserves_apps_without_retired_app(self):
        result = self.shell('source install/brew.sh; source install/hosts/macbook.sh; install_brew_casks "${HOST_BREW_CASKS[@]}"')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("brew install --cask --adopt", result.stdout)
        self.assertIn("bitwarden", result.stdout)
        self.assertNotIn("obsidian", result.stdout.lower())

    def test_linux_host_package_plan_preserves_apps_without_retired_app(self):
        result = self.shell('source install/pacman.sh; source install/hosts/omarchy.sh; install_pacman_packages "${HOST_PACMAN_PACKAGES[@]}"')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("pacman -S --needed --noconfirm", result.stdout)
        self.assertIn("bitwarden", result.stdout)
        self.assertNotIn("obsidian", result.stdout.lower())

    def opener_fixture(self, system):
        bin_dir = self.home / "bin"
        bin_dir.mkdir()
        for name, body in {
            "uname": f"printf '%s\\n' {system}",
            "open": 'printf "open:%s\\n" "$@" > "$HOME/opened"',
            "xdg-open": 'printf "xdg-open:%s\\n" "$@" > "$HOME/opened"',
            "obsidian": 'printf "retired-app-called\\n" > "$HOME/opened"',
        }.items():
            path = bin_dir / name
            path.write_text("#!/bin/sh\n" + body + "\n")
            path.chmod(0o755)
        self.env["PATH"] = str(bin_dir)
        document = self.home / "a note.md"
        document.write_text("preserved note\n")
        return document

    def test_mac_opens_document_with_system_default(self):
        document = self.opener_fixture("Darwin")
        result = self.shell(f'/bin/bash configs/agents/bin/open-doc.sh "{document}"')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.home / "opened").read_text(), f"open:{document}\n")
        self.assertEqual(document.read_text(), "preserved note\n")

    def test_linux_uses_system_default_even_when_retired_binary_exists(self):
        document = self.opener_fixture("Linux")
        # Wait for the existing asynchronous opener contract inside this shell;
        # sourcing keeps its background child in the shell's job table.
        result = self.shell(f'source configs/agents/bin/open-doc.sh "{document}"; wait')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.home / "opened").read_text(), f"xdg-open:{document}\n")
        self.assertEqual(document.read_text(), "preserved note\n")

    def test_linux_reports_missing_system_viewer(self):
        document = self.opener_fixture("Linux")
        (self.home / "bin/xdg-open").unlink()
        result = self.shell(f'/bin/bash configs/agents/bin/open-doc.sh "{document}"')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, f"No suitable viewer found. File: {document}\n")
        self.assertFalse((self.home / "opened").exists())
        self.assertEqual(document.read_text(), "preserved note\n")

    def test_missing_document_is_rejected_without_launch(self):
        self.opener_fixture("Linux")
        result = self.shell('/bin/bash configs/agents/bin/open-doc.sh missing.md')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, "File not found: missing.md\n")
        self.assertFalse((self.home / "opened").exists())


if __name__ == "__main__":
    unittest.main()
