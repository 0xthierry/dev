#!/usr/bin/env python3
"""Isolated package integration and real Ghostty config reader; no GUI or live writes."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = Path(os.environ.get("OMARCHY_TEST_UPSTREAM", ROOT.parent / "upstream"))


class Integrations(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="omarchy-integrations-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.env = {**os.environ, "HOME": str(self.home), "XDG_CONFIG_HOME": str(self.home / ".config")}
        self.env.pop("OMARCHY_PATH", None)
        self.env.pop("ZDOTDIR", None)
        self.env.pop("MISE_DATA_DIR", None)
        self.env.pop("XDG_DATA_HOME", None)

    def packaged(self, command, check=True):
        # The real package tree is visible at its production path only inside
        # this private namespace. Only the temporary HOME is writable.
        return subprocess.run(
            ["bwrap", "--ro-bind", "/", "/", "--tmpfs", "/usr/share",
             "--ro-bind", str(UPSTREAM), "/usr/share/omarchy",
             "--bind", str(self.home), str(self.home), "--", *command],
            env=self.env, text=True, capture_output=True, check=check)

    def shell(self, packaged=False):
        command = ["zsh", "-f", "-c", 'source "$1"; print -r -- "${OMARCHY_PATH:-none}"; print -r -- "$PATH"',
                   "fixture", str(ROOT / "configs/shell/path.sh")]
        result = self.packaged(command) if packaged else subprocess.run(
            command, env=self.env, text=True, capture_output=True, check=True)
        return result.stdout.splitlines()

    def test_packaged_shell_uses_bootstrap_and_preserves_shared_paths(self):
        self.env["OMARCHY_PATH"] = "/stale/inherited/path"
        result = self.shell(packaged=True)
        self.assertEqual(result[0], "/usr/share/omarchy")
        self.assertIn("/opt/homebrew/bin", result[1].split(":"))
        self.assertEqual(result[1].split(":")[0], str(self.home / ".local/share/mise/command-wrappers/bin"))

    def test_non_omarchy_shell_keeps_homebrew_paths(self):
        result = self.shell()
        self.assertIn("/opt/homebrew/bin", result[1].split(":"))
        self.assertIn(str(self.home / ".local/bin"), result[1].split(":"))

    def install_ghostty(self, host="omarchy", check=True):
        return self.packaged([
            "bash", "-c", 'source "$1/install/configs.sh"; source "$1/install/setup.sh"; '
            'REPO_ROOT="$1"; SETUP_HOST="$2"; HOST=unrelated-hostname; DRY_RUN=0; '
            'load_host_module "$1" "$2"; HOST_CONFIG_TARGETS=(ghostty); apply_host_configs',
            "fixture", str(ROOT), host], check=check)

    def ghostty(self):
        return self.packaged(["ghostty", "+show-config", "--changes-only=false"]).stdout

    def test_ghostty_inherits_stock_theme_and_keeps_personal_overrides(self):
        theme = self.home / ".local/state/omarchy/current/theme/ghostty.conf"
        theme.parent.mkdir(parents=True)
        theme.write_text("background = #abcdef\ncursor-color = #123456\nclipboard-read = deny\n")
        self.install_ghostty()
        result = self.ghostty()
        self.assertIn("background = #abcdef", result)
        self.assertIn("cursor-color = #123456", result)
        self.assertIn("font-family = JetBrainsMono Nerd Font", result)
        self.assertIn("clipboard-read = allow", result)
        self.assertIn("clipboard-write = allow", result)
        self.assertIn("clipboard-paste-protection = false", result)
        self.assertIn("keybind = shift+enter=csi:13;2u", result)
        self.assertIn("keybind = alt+shift+enter=csi:13;4u", result)
        self.assertIn("keybind = ctrl+alt+shift+h=goto_split:left", result)

    def test_ghostty_materialized_config_is_backed_up_and_second_install_is_noop(self):
        config = self.home / ".config/ghostty/config"
        config.parent.mkdir(parents=True)
        config.write_text("font-size = 17\n")
        overrides = config.parent / "dev-setup"
        overrides.mkdir()
        (overrides / "notes").write_text("Unreviewed personal settings\n")
        self.install_ghostty()
        self.install_ghostty()
        self.assertEqual(config.with_name("config.bak").read_text(), "font-size = 17\n")
        self.assertEqual(config.resolve(), ROOT / "configs/ghostty/omarchy.conf")
        self.assertFalse(config.with_name("config.bak.1").exists())
        self.assertEqual((config.parent / "dev-setup.bak/notes").read_text(), "Unreviewed personal settings\n")
        self.assertFalse((config.parent / "dev-setup.bak.1").exists())
        self.assertIn("font-size = 9", self.ghostty())

    def test_ghostty_migrates_only_the_known_shared_link(self):
        config = self.home / ".config/ghostty/config"
        config.parent.mkdir(parents=True)
        config.symlink_to(ROOT / "configs/ghostty/config")
        self.install_ghostty()
        self.assertEqual(config.resolve(), ROOT / "configs/ghostty/omarchy.conf")
        self.assertEqual(config.with_name("config.bak").resolve(), ROOT / "configs/ghostty/config")
        self.assertIn("font-family = JetBrainsMono Nerd Font", self.ghostty())

    def test_ghostty_refuses_unrelated_symlink_without_losing_user_work(self):
        config = self.home / ".config/ghostty/config"
        config.parent.mkdir(parents=True)
        personal = self.home / "my-ghostty"
        personal.write_text("font-size = 17\n")
        config.symlink_to(personal)
        result = self.install_ghostty(check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated Ghostty symlink", result.stderr)
        self.assertEqual(config.resolve(), personal)
        self.assertEqual(personal.read_text(), "font-size = 17\n")

    def test_macos_deployment_preserves_existing_personal_configuration(self):
        self.install_ghostty(host="macbook")
        result = self.ghostty()
        self.assertEqual((self.home / ".config/ghostty/config").resolve(), ROOT / "configs/ghostty/config")
        self.assertIn("font-family = CaskaydiaMono Nerd Font", result)
        self.assertIn("cursor-color = #7aa2f7", result)
        self.assertIn("font-size = 9", result)
        self.assertIn("window-padding-x = 14", result)


if __name__ == "__main__":
    unittest.main()
