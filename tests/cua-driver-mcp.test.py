#!/usr/bin/env python3
"""Exercise the managed stdio launcher. OS detection and Cua executable are fixtures."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

LAUNCHER = Path(__file__).resolve().parents[1] / "configs/cua-driver/cua-driver-mcp"


class CuaMcpLauncherTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="cua mcp-")
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        self.bin = self.home / ".local/bin"
        self.bin.mkdir(parents=True)
        driver = self.bin / "cua-driver"
        driver.write_text(f"#!{sys.executable}\nimport json, os, sys\n"
                          "print(json.dumps([sys.argv, os.environ['CUA_DRIVER_RS_TELEMETRY_ENABLED'], "
                          "os.environ['CUA_DRIVER_RS_UPDATE_CHECK'], sys.stdin.read()]))\n")
        driver.chmod(0o755)

    def launch(self, system, *args):
        uname = self.bin / "uname"
        uname.write_text(f"#!/bin/sh\necho {system}\n")
        uname.chmod(0o755)
        return subprocess.run([LAUNCHER, *args], env={"HOME": str(self.home), "PATH": str(self.bin),
                              "XDG_CACHE_HOME": "/other/cache", "XDG_RUNTIME_DIR": "/other/run",
                              "CUA_DRIVER_RS_TELEMETRY_ENABLED": "true", "CUA_DRIVER_RS_UPDATE_CHECK": "true"},
                              input="stdio input\n", capture_output=True, text=True, timeout=5)

    def test_linux_uses_wayland_daemon_not_x11_or_an_independent_controller(self):
        result = self.launch("Linux")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [[str(self.bin / "cua-driver"), "mcp", "--embedded",
                         "--socket", str(self.home / ".cache/cua-driver/cua-driver.sock")],
                         "false", "false", "stdio input\n"])

    def test_mac_uses_existing_permission_owning_daemon(self):
        result = self.launch("Darwin")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [[str(self.bin / "cua-driver"), "mcp", "--embedded",
                         "--socket", str(self.home / "Library/Caches/cua-driver/cua-driver.sock")],
                         "false", "false", "stdio input\n"])

    def test_rejects_unexpected_grant_or_transport_flags(self):
        result = self.launch("Linux", "--direct")
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (64, "", "usage: cua-driver-mcp (no arguments)\n"))


if __name__ == "__main__":
    unittest.main()
