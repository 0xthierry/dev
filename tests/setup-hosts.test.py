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
        self.env = {
            "PATH": os.environ["PATH"],
            "SHELL": os.environ.get("SHELL", "/bin/bash"),
            "USER": os.environ.get("USER", "setup-test"),
            "HOME": str(self.home),
            "XDG_CONFIG_HOME": str(self.home / ".config"),
            "XDG_DATA_HOME": str(self.home / ".local/share"),
            "XDG_CACHE_HOME": str(self.home / ".cache"),
            "XDG_STATE_HOME": str(self.home / ".local/state"),
            "XDG_RUNTIME_DIR": str(self.home / "run"),
            "GIT_CONFIG_GLOBAL": str(self.home / ".gitconfig"),
            "GIT_CONFIG_NOSYSTEM": "1",
        }

    def run_script(self, script, host):
        return subprocess.run(
            ["bash", str(ROOT / script), host, "--dry-run"],
            cwd=ROOT, env=self.env, capture_output=True, text=True, timeout=60,
        )

    def test_omarchy_dry_run_plans_setup_without_network_or_deployment(self):
        result = self.run_dry_run("omarchy")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Host: omarchy", result.stdout)
        self.assertIn("Mode: dry-run", result.stdout)
        self.assertIn("Would resolve Claude Desktop version and SHA-256", result.stdout)
        self.assertIn("ai-memory", result.stdout)
        self.assertEqual(result.stderr, "")
        self.assertFalse((self.home / ".ssh").exists())
        self.assertFalse((self.home / ".zshrc").exists())
        self.assertFalse((self.home / ".config/hypr").exists())
        self.assertFalse((self.home / "forbidden-commands").exists())

    def test_omarchy_real_setup_rejects_uninitialized_home_before_changes(self):
        bin_dir = self.home / "bin"
        bin_dir.mkdir()
        for name in ("curl", "wget", "sudo", "pacman", "yay", "paru", "systemctl"):
            executable = bin_dir / name
            executable.write_text(
                "#!/bin/sh\nprintf '%s\\n' \"$0\" >> \"$HOME/forbidden-commands\"\nexit 99\n"
            )
            executable.chmod(0o755)
        self.env["PATH"] = str(bin_dir) + os.pathsep + os.environ["PATH"]
        result = subprocess.run(
            ["bash", str(ROOT / "setup.sh"), "omarchy"], cwd=ROOT,
            env=self.env, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("Quattro", result.stderr)
        self.assertNotIn("Host Packages", result.stdout)
        self.assertEqual(list(self.home.iterdir()), [bin_dir])

    def test_macbook_dry_run_plans_setup_without_network_or_deployment(self):
        result = self.run_dry_run("macbook")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Host: macbook", result.stdout)
        self.assertIn("Mode: dry-run", result.stdout)
        self.assertIn("claude_desktop_snapshot_install.py pin", result.stdout)
        self.assertIn("ai-memory", result.stdout)
        self.assertEqual(result.stderr, "")
        self.assertFalse((self.home / ".ssh").exists())
        self.assertFalse((self.home / ".zshrc").exists())
        self.assertFalse((self.home / ".config/nvim").exists())
        self.assertFalse((self.home / "forbidden-commands").exists())

    def test_pinned_desktop_can_be_planned_off_platform(self):
        result = subprocess.run(
            ["bash", "-c", 'uname() { printf "Linux\\n"; }; source "$1"; apply_claude_desktop_pinned',
             "bash", str(ROOT / "install/claude-desktop-patch.sh")],
            cwd=ROOT, env={**self.env, "DRY_RUN": "1"}, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("[dry-run] python3", result.stdout)
        self.assertIn("claude_desktop_snapshot_install.py pin", result.stdout)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_pinned_desktop_still_rejects_real_install_off_platform(self):
        result = subprocess.run(
            ["bash", "-c", 'uname() { printf "Linux\\n"; }; source "$1"; apply_claude_desktop_pinned',
             "bash", str(ROOT / "install/claude-desktop-patch.sh")],
            cwd=ROOT, env={**self.env, "DRY_RUN": "0"}, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, "error: Claude Desktop snapshot patch supports macOS only\n")
        self.assertEqual(list(self.home.iterdir()), [])

    def run_dry_run(self, host):
        # Fail closed on network/mutation commands; read-only brew probes see
        # an empty installation rather than the developer's machine state.
        bin_dir = self.home / "bin"
        bin_dir.mkdir()
        for name in ("curl", "wget", "sudo", "brew", "pacman", "yay", "paru"):
            executable = bin_dir / name
            probe = '[ "$1" != list ] || exit 1\n' if name == "brew" else ""
            executable.write_text(
                "#!/bin/sh\n" + probe +
                "printf '%s\\n' \"$0\" >> \"$HOME/forbidden-commands\"\n"
                "echo 'unexpected dry-run command: " + name + "' >&2\nexit 99\n"
            )
            executable.chmod(0o755)
        # Exercise each host's OS/architecture branches on either developer machine.
        system, arch = ("Darwin", "arm64") if host == "macbook" else ("Linux", "x86_64")
        uname = bin_dir / "uname"
        uname.write_text(
            "#!/bin/sh\ncase \"$1\" in\n"
            f"-s) echo {system} ;;\n-m) echo {arch} ;;\n"
            "*) exit 99 ;;\nesac\n"
        )
        uname.chmod(0o755)
        self.env["PATH"] = str(bin_dir) + os.pathsep + os.environ["PATH"]
        return self.run_script("setup.sh", host)

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
