#!/usr/bin/env python3
"""Run real vendor login hooks with isolated HOME; never install or launch apps.

FLATPAK_TEST_PACKAGE_ROOT may point at an extracted, verified target package.
Without it, test the installed package. No network or package installation occurs.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

PACKAGE = Path(os.environ.get("FLATPAK_TEST_PACKAGE_ROOT", "/"))
GENERATOR = PACKAGE / "usr/lib/systemd/user-environment-generators/60-flatpak"
PROFILE = PACKAGE / "etc/profile.d/flatpak.sh"


class VendorEnvironment(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="flatpak-vendor-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.env = {
            "HOME": str(self.home),
            "XDG_DATA_HOME": str(self.home / "data"),
            "XDG_CONFIG_HOME": str(self.home / "config"),
            "XDG_DATA_DIRS": "/fresh/share:/usr/share",
            "FLATPAK_SYSTEM_DIR": str(self.home / "system"),
            "PATH": f"{PACKAGE / 'usr/bin'}:/usr/bin:/bin",
        }
        self.exports = f"{self.home}/data/flatpak/exports/share:{self.home}/system/exports/share"

    def generator(self, env):
        return subprocess.check_output([str(GENERATOR)], env=env, text=True).strip()

    def profile(self, env):
        return subprocess.check_output(
            ["/bin/sh", "-c", '. "$1"; printf "%s\\n" "$XDG_DATA_DIRS"', "vendor", str(PROFILE)],
            env=env, text=True).strip()

    def test_user_generator_preserves_login_paths_and_adds_exports(self):
        result = self.generator(self.env)
        self.assertEqual(result, f"XDG_DATA_DIRS={self.exports}:/fresh/share:/usr/share")

    def test_profile_preserves_login_paths_and_adds_exports(self):
        result = self.profile(self.env)
        self.assertEqual(result, f"{self.exports}:/fresh/share:/usr/share")

    def test_fresh_login_does_not_retain_removed_custom_paths(self):
        previous = self.generator({**self.env, "XDG_DATA_DIRS": "/temporary/old:/usr/share"})
        current = self.generator(self.env)
        self.assertEqual(previous, f"XDG_DATA_DIRS={self.exports}:/temporary/old:/usr/share")
        self.assertEqual(current, f"XDG_DATA_DIRS={self.exports}:/fresh/share:/usr/share")

    def test_repeated_profile_source_does_not_duplicate_exports(self):
        first = self.profile(self.env)
        second = self.profile({**self.env, "XDG_DATA_DIRS": first})
        self.assertEqual(first, f"{self.exports}:/fresh/share:/usr/share")
        self.assertEqual(second, first)

    def test_generator_uses_standard_defaults_when_unset(self):
        env = dict(self.env)
        del env["XDG_DATA_DIRS"]
        result = self.generator(env)
        self.assertEqual(result, f"XDG_DATA_DIRS={self.exports}:/usr/local/share/:/usr/share/")


if __name__ == "__main__":
    unittest.main()
