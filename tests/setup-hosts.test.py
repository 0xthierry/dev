#!/usr/bin/env python3
"""Exercise the supported-host contract at the public shell entrypoints."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class SetupHostsTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="setup-hosts-")
        self.addCleanup(self.fixture.cleanup)
        self.home = Path(self.fixture.name)
        self.env = {**os.environ, "HOME": str(self.home)}

    def run_script(self, script, host):
        return subprocess.run(
            ["bash", str(ROOT / script), host, "--dry-run"],
            cwd=ROOT, env=self.env, capture_output=True, text=True, timeout=60,
        )

    def test_setup_rejects_retired_dev_host(self):
        result = self.run_script("setup.sh", "dev")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, "Unknown argument: dev\nUsage: ./setup.sh [--dry-run] [--skip-git-repo-sync] <omarchy|macbook>\n")
        self.assertEqual(result.stdout, "")
        self.assertEqual(list(self.home.iterdir()), [])

    def test_browser_installer_rejects_retired_dev_host(self):
        result = self.run_script("install/browser-automation.sh", "dev")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, "error: browser automation requires omarchy or macbook\n")
        self.assertEqual(result.stdout, "")
        self.assertEqual(list(self.home.iterdir()), [])

    def test_rea_installer_rejects_retired_dev_host(self):
        result = self.run_script("install/rea.sh", "dev")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, "error: REA setup requires omarchy or macbook\n")
        self.assertEqual(result.stdout, "")
        self.assertEqual(list(self.home.iterdir()), [])

    def test_rea_prereqs_reject_retired_dev_host(self):
        result = self.run_script("install/rea-prereqs.sh", "dev")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, "error: REA prerequisites require omarchy or macbook\n")
        self.assertEqual(result.stdout, "")
        self.assertEqual(list(self.home.iterdir()), [])

    def test_rea_ghidra_rejects_retired_dev_host(self):
        result = self.run_script("install/rea-ghidra.sh", "dev")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, "error: REA Ghidra requires omarchy or macbook\n")
        self.assertEqual(result.stdout, "")
        self.assertEqual(list(self.home.iterdir()), [])

    def test_mcp_installer_rejects_retired_dev_host(self):
        result = self.run_script("install/mcp.sh", "dev")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, "error: shared MCP setup requires macbook or omarchy\n")
        self.assertEqual(result.stdout, "")
        self.assertEqual(list(self.home.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
