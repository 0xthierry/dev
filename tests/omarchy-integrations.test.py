#!/usr/bin/env python3
"""Isolated shell and real Ghostty config-consumer checks; no GUI is launched."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Integrations(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="omarchy-integrations-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.env = {**os.environ, "HOME": str(self.home), "XDG_CONFIG_HOME": str(self.home / ".config")}
        self.env.pop("OMARCHY_PATH", None)
        self.env.pop("ZDOTDIR", None)

    def shell(self):
        return subprocess.check_output(
            ["zsh", "-f", "-c", 'source "$1"; print -r -- "${OMARCHY_PATH:-none}"; print -r -- "$PATH"',
             "fixture", str(ROOT / "configs/shell/path.sh")], env=self.env, text=True).splitlines()

    def test_legacy_shell_keeps_commands(self):
        if Path("/usr/share/omarchy/default/bash/env-bootstrap").exists():
            self.skipTest("packaged host correctly takes precedence over legacy checkout")
        (self.home / ".local/share/omarchy/bin").mkdir(parents=True)
        result = self.shell()
        self.assertEqual(result[0], str(self.home / ".local/share/omarchy"))
        self.assertEqual(result[1].split(":")[0], str(self.home / ".local/share/omarchy/bin"))

    def test_packaged_shell_ignores_inherited_legacy_commands(self):
        # A private mount namespace presents pristine 4.5.0 at its real package
        # path. The host /usr/share is never written or remounted.
        upstream = ROOT.parent / "upstream"
        legacy = str(self.home / ".local/share/omarchy/bin")
        self.env["PATH"] = legacy + ":" + self.env["PATH"]
        result = subprocess.check_output(
            ["bwrap", "--ro-bind", "/", "/", "--tmpfs", "/usr/share",
             "--ro-bind", str(upstream), "/usr/share/omarchy",
             "--", "/usr/bin/zsh", "-f", "-c",
             'source "$1"; print -r -- "$OMARCHY_PATH"; print -r -- "$PATH"',
             "fixture", str(ROOT / "configs/shell/path.sh")], env=self.env, text=True).splitlines()
        self.assertEqual(result[0], "/usr/share/omarchy")
        self.assertNotIn(legacy, result[1].split(":"))
        self.assertIn("/opt/homebrew/bin", result[1].split(":"))

    def test_non_omarchy_shell_keeps_homebrew_paths(self):
        result = self.shell()
        self.assertIn("/opt/homebrew/bin", result[1].split(":"))
        self.assertNotIn(str(self.home / ".local/share/omarchy/bin"), result[1].split(":"))

    def ghostty(self, legacy=None, current=None):
        config = self.home / ".config/ghostty/config"
        config.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "configs/ghostty/config", config)
        if legacy:
            path = self.home / ".config/omarchy/current/theme/ghostty.conf"
            path.parent.mkdir(parents=True)
            path.write_text(f"background = {legacy}\n")
        if current:
            path = self.home / ".local/state/omarchy/current/theme/ghostty.conf"
            path.parent.mkdir(parents=True)
            path.write_text(f"background = {current}\n")
        return subprocess.check_output(["ghostty", "+show-config"], env=self.env, text=True, stderr=subprocess.PIPE)

    def test_ghostty_keeps_legacy_theme(self):
        result = self.ghostty(legacy="#123456")
        self.assertIn("background = #123456", result)

    def test_ghostty_current_theme_overrides_stale_legacy(self):
        result = self.ghostty(legacy="#123456", current="#abcdef")
        self.assertIn("background = #abcdef", result)
        self.assertNotIn("background = #123456", result)

    def test_ghostty_without_omarchy_preserves_personal_settings(self):
        result = self.ghostty()
        self.assertIn("font-size = 9", result)
        self.assertIn("window-padding-x = 14", result)


if __name__ == "__main__":
    unittest.main()
