#!/usr/bin/env python3
"""Offline Quattro overlay checks. Never contacts/reloads the live compositor.

Run: python3 tests/hypr-quattro.test.py [--upstream /path/to/omarchy-v4.5.0]
The default upstream is the pristine sibling ../upstream migration checkout.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
OVERLAY = ROOT / "configs/hypr-quattro"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--upstream", type=Path, default=ROOT.parent / "upstream")
args, remaining = parser.parse_known_args()
UPSTREAM = args.upstream.resolve()


class HyprQuattroTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="hypr-quattro-test-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.config = self.home / ".config/hypr"
        self.config.mkdir(parents=True)
        (self.config / "dev-setup").symlink_to(OVERLAY, target_is_directory=True)
        (self.home / ".local/state/omarchy").mkdir(parents=True)
        (self.home / "runtime").mkdir(mode=0o700)
        # Use an explicit allowlist: no real session socket, DBus, XDG or display.
        self.env = {
            "PATH": "/usr/bin:/bin", "HOME": str(self.home), "LANG": "C.UTF-8",
            "XDG_CONFIG_HOME": str(self.home / ".config"),
            "XDG_STATE_HOME": str(self.home / ".local/state"),
            "XDG_RUNTIME_DIR": str(self.home / "runtime"),
            "OMARCHY_PATH": str(UPSTREAM),
        }
        self.assertTrue((UPSTREAM / "default/hypr/monitor-workspaces.lua").is_file(),
                        "Supply the pristine Omarchy v4.5.0 source with --upstream")
        version = subprocess.run(["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"],
                                 text=True, capture_output=True, check=True)
        self.assertEqual(version.stdout.strip(), "ac2690cd7be4f47e4a255f5e2e78d904d436b068")

    def run_command(self, command):
        return subprocess.run(command, cwd=self.home, env=self.env, text=True,
                              capture_output=True, timeout=30)

    def prepare_dictation_fixture(self, selected=None):
        # Only the package probe and runtime installer are external stand-ins.
        # Backend lookup, migrations, first-run and Lua bindings stay upstream.
        fake_bin = self.home / "bin"
        fake_bin.mkdir()
        scripts = {
            "superwhisper": "#!/bin/sh\nexit 0\n",
            "voxtype": "#!/bin/sh\nexit 0\n",
            "lazydocker": "#!/bin/sh\nexit 0\n",
            "omarchy-pkg-present": "#!/bin/sh\nexit 0\n",
            "omarchy-install-dictation-superwhisper":
                '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOME/installer-calls"\n',
        }
        for name, content in scripts.items():
            executable = fake_bin / name
            executable.write_text(content)
            executable.chmod(0o755)
        self.env["PATH"] = f"{fake_bin}:{UPSTREAM / 'bin'}:/usr/bin:/bin"
        self.env["XDG_DATA_HOME"] = str(self.home / ".local/share")
        shutil.copy(UPSTREAM / "config/hypr/hyprland.lua", self.config / "hyprland.lua")
        shutil.copy(UPSTREAM / "config/hypr/bindings.lua", self.config / "bindings.lua")
        if selected is not None:
            backend = self.home / ".config/omarchy/defaults/dictation"
            backend.parent.mkdir(parents=True)
            backend.write_text(selected)

    def deploy_overlay(self, packaged=True):
        sandbox = ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--tmpfs", "/usr/share"]
        if packaged:
            sandbox += ["--ro-bind", str(UPSTREAM), "/usr/share/omarchy"]
        return self.run_command(sandbox + [
            "--bind", str(self.home), str(self.home), "--unshare-net", "--",
            "bash", "-c", 'source "$1/install/configs.sh"; apply_hypr',
            "bash", str(ROOT),
        ])

    def test_stock_config_without_installed_quattro_is_refused(self):
        self.prepare_dictation_fixture()
        before = (self.config / "hyprland.lua").read_bytes()
        (self.config / "dev-setup").unlink()
        result = self.deploy_overlay(packaged=False)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("requires initialized stock Quattro", result.stderr)
        self.assertEqual((self.config / "hyprland.lua").read_bytes(), before)
        self.assertFalse((self.config / "dev-setup").exists())
        self.assertFalse((self.config / "hyprland.lua.bak").exists())

    def test_existing_portal_picker_is_not_overwritten(self):
        self.prepare_dictation_fixture()
        portal = self.config / "xdph.conf"
        portal.write_text("screencopy {\n    custom_picker_binary = /user/observer-picker\n}\n")
        result = self.deploy_overlay()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(portal.read_text(),
                         "screencopy {\n    custom_picker_binary = /user/observer-picker\n}\n")
        self.assertIn('require("hypr.dev-setup.dev-setup")',
                      (self.config / "hyprland.lua").read_text())

    def test_deployment_does_not_select_missing_backend(self):
        self.prepare_dictation_fixture()
        result = self.deploy_overlay()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('require("hypr.dev-setup.dev-setup")',
                      (self.config / "hyprland.lua").read_text())
        self.assertFalse((self.home / ".config/omarchy/defaults/dictation").exists())
        self.assertFalse((self.home / "installer-calls").exists())

    def test_stock_backend_migrations_and_first_run_remain_upstream_owned(self):
        selected = (UPSTREAM / "config/omarchy/defaults/dictation").read_text()
        self.prepare_dictation_fixture(selected)
        preserve = self.run_command(["bash", str(UPSTREAM / "migrations/1791479273.sh")])
        self.assertEqual(preserve.returncode, 0, preserve.stderr)
        migrate = self.run_command(["bash", str(UPSTREAM / "migrations/1793477875.sh")])
        self.assertEqual(migrate.returncode, 0, migrate.stderr)
        personal = (self.config / "bindings.lua").read_bytes()
        result = self.deploy_overlay()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.config / "bindings.lua").read_bytes(), personal)
        self.assertEqual((self.home / ".config/omarchy/defaults/dictation").read_text(), "superwhisper\n")
        self.assertFalse((self.home / "installer-calls").exists())
        repair = self.run_command(["bash", str(UPSTREAM / "migrations/1793667581.sh")])
        self.assertEqual(repair.returncode, 0, repair.stderr)
        self.assertEqual((self.home / "installer-calls").read_text(), "--background\n")
        first_run = self.run_command(["bash", str(UPSTREAM / "install/user/first-run/superwhisper.sh")])
        self.assertEqual(first_run.returncode, 0, first_run.stderr)
        self.assertEqual((self.home / "installer-calls").read_text(), "--background\n--background\n")

    def test_existing_backend_migration_is_not_overridden_by_setup(self):
        self.prepare_dictation_fixture()
        migrate = self.run_command(["bash", str(UPSTREAM / "migrations/1791479273.sh")])
        self.assertEqual(migrate.returncode, 0, migrate.stderr)
        result = self.deploy_overlay()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.home / ".config/omarchy/defaults/dictation").read_text(), "voxtype\n")
        repair = self.run_command(["bash", str(UPSTREAM / "migrations/1793667581.sh")])
        self.assertEqual(repair.returncode, 0, repair.stderr)
        first_run = self.run_command(["bash", str(UPSTREAM / "install/user/first-run/superwhisper.sh")])
        self.assertEqual(first_run.returncode, 0, first_run.stderr)
        self.assertFalse((self.home / "installer-calls").exists())

    def test_lua_syntax(self):
        # Parse individually: luac -p with multiple files can write luac.out.
        for path in sorted(OVERLAY.glob("*.lua")):
            with self.subTest(path=path.name):
                result = self.run_command(["luac", "-p", str(path)])
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_defaults_and_overlay_behavior(self):
        self.prepare_dictation_fixture((UPSTREAM / "config/omarchy/defaults/dictation").read_text())
        migrate = self.run_command(["bash", str(UPSTREAM / "migrations/1793477875.sh")])
        self.assertEqual(migrate.returncode, 0, migrate.stderr)
        result = self.run_command(["lua", str(ROOT / "tests/hypr-quattro.test.lua"),
                                   str(UPSTREAM), str(OVERLAY)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: workspace events, clipboard, stock dictation", result.stdout)

    def test_real_hyprland_parser(self):
        binary = shutil.which("Hyprland", path=self.env["PATH"])
        if not binary:
            self.skipTest("Hyprland unavailable: actual compositor API validation unverified")
        # Stock full autostart's config.reloaded startup-cursor hook assumes a
        # running compositor even in --verify-config (upstream SIGSEGV). Load the
        # real required helper/look defaults and real overlay instead. This tests
        # accepted Lua API/options, not an entire session or shell integration.
        config = self.config / "hyprland.lua"
        config.write_text(
            f'package.path = [[{UPSTREAM}/?.lua;]] .. package.path\n'
            'require("default.hypr.helpers")\n'
            'require("default.hypr.looknfeel")\n'
            'o.workspaces = {} -- no monitor manager in a parser-only process\n'
            'dofile(os.getenv("XDG_CONFIG_HOME") .. "/hypr/dev-setup/dev-setup.lua")\n'
            'assert(hl.get_config("decoration.blur.enabled") == false)\n'
            'assert(hl.get_config("decoration.shadow.enabled") == false)\n'
            'assert(hl.get_config("general.resize_on_border") == true)\n'
            'assert(hl.get_config("general.border_size") == 1)\n'
            '-- Personal files are loaded AFTER the overlay.\n'
            'hl.config({ general = { border_size = 3 }, input = { sensitivity = 0.25 } })\n'
            'require("default.hypr.toggles.no-animations")\n'
            'assert(hl.get_config("general.border_size") == 3)\n'
            'assert(hl.get_config("input.sensitivity") == 0.25)\n'
            'assert(hl.get_config("animations.enabled") == false)\n'
            'assert(hl.get_config("decoration.blur.enabled") == false)\n'
            'assert(hl.get_config("decoration.shadow.enabled") == false)\n'
        )
        result = self.run_command([binary, "--verify-config", "-c", str(config)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Config parsing result", result.stdout)


if __name__ == "__main__":
    unittest.main(argv=[__file__, *remaining], verbosity=2)
