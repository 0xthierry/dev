#!/usr/bin/env python3
"""Filesystem/client-writer integration tests; no downloads or GUI changes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "configs/creative-mcp"
CODEX = shutil.which("codex")


class CreativeMcpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="creative-mcp-test-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / "home with spaces"
        self.home.mkdir()
        self.env = {key: value for key, value in os.environ.items()
                    if key not in ("CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME")}
        self.env["HOME"] = str(self.home)
        self.code = self.home / ".claude.json"
        self.desktop = self.home / ".config/Claude/claude_desktop_config.json"

    def run_config(self, host="omarchy"):
        return subprocess.run(["python3", str(CONFIG / "configure-clients.py"), host],
                              env=self.env, capture_output=True, text=True)

    def test_claude_merge_preserves_settings_and_other_servers(self):
        self.code.write_text(json.dumps({"theme": "dark", "mcpServers": {"other": {"command": "keep"}, "blender": {"command": "old"}}}))
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text()), {
            "theme": "dark", "mcpServers": {
                "other": {"command": "keep"},
                "blender": {"command": f"{self.home}/.local/bin/blender-mcp", "args": []},
                "Roblox_Studio": {"command": f"{self.home}/.local/bin/roblox-studio-mcp", "args": []},
            },
        })
        self.assertEqual(json.loads(self.desktop.read_text())["mcpServers"]["Roblox_Studio"],
                         {"command": f"{self.home}/.local/bin/roblox-studio-mcp", "args": []})
        self.assertEqual(json.loads(Path(str(self.code) + ".bak").read_text())["theme"], "dark")
        self.assertEqual(self.code.stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(str(self.code) + ".bak").stat().st_mode & 0o777, 0o600)

    def test_macbook_uses_native_desktop_config_location(self):
        result = self.run_config("macbook")
        self.assertEqual(result.returncode, 0, result.stderr)
        path = self.home / "Library/Application Support/Claude/claude_desktop_config.json"
        self.assertEqual(json.loads(path.read_text())["mcpServers"]["blender"],
                         {"command": f"{self.home}/.local/bin/blender-mcp", "args": []})
        self.assertFalse(self.desktop.exists())

    def test_rerun_does_not_rewrite_or_create_backups(self):
        self.run_config()
        before = self.code.stat().st_mtime_ns
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.code.stat().st_mtime_ns, before)
        self.assertEqual(list(self.home.glob(".claude.json.bak*")), [])
        self.assertEqual(set(json.loads(self.code.read_text())["mcpServers"]), {"blender", "Roblox_Studio"})

    def test_invalid_desktop_json_leaves_both_files_unchanged(self):
        self.code.write_text('{"theme":"dark"}')
        self.desktop.parent.mkdir(parents=True)
        self.desktop.write_text('{broken')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.code.read_text(), '{"theme":"dark"}')
        self.assertEqual(self.desktop.read_text(), '{broken')

    def test_symlink_config_is_not_replaced(self):
        target = self.home / "user-config.json"
        target.write_text('{}')
        self.code.symlink_to(target)
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing to replace symlink config", result.stderr)
        self.assertEqual(target.read_text(), '{}')
        self.assertTrue(self.code.is_symlink())

    def test_wrong_mcp_type_is_rejected(self):
        self.code.write_text('{"mcpServers":[]}')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.code.read_text(), '{"mcpServers":[]}')
        self.assertIn("expected an mcpServers object", result.stderr)

    @unittest.skipUnless(CODEX, "Codex CLI required to verify its native TOML writer")
    def test_native_codex_writer_preserves_unrelated_tables_and_converges(self):
        directory = self.home / ".codex"
        directory.mkdir()
        path = directory / "config.toml"
        original = '# keep comment\nmodel = "gpt-5"\n[mcp_servers.other]\ncommand = "keep"\n[mcp_servers.other.env]\nTEST = "kept"\n[mcp_servers.blender]\ncommand = "old"\n'
        path.write_text(original)
        result = subprocess.run(["python3", str(CONFIG / "configure-codex.py")], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        config = tomllib.loads(path.read_text())
        self.assertEqual(config["model"], "gpt-5")
        self.assertEqual(config["mcp_servers"]["other"], {"command": "keep", "env": {"TEST": "kept"}})
        self.assertEqual(config["mcp_servers"]["blender"]["command"], f"{self.home}/.local/bin/blender-mcp")
        self.assertEqual(config["mcp_servers"]["Roblox_Studio"]["command"], f"{self.home}/.local/bin/roblox-studio-mcp")
        self.assertIn("# keep comment", path.read_text())
        self.assertEqual(Path(str(path) + ".bak").read_text(), original)
        before = path.stat().st_mtime_ns
        result = subprocess.run(["python3", str(CONFIG / "configure-codex.py")], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(path.stat().st_mtime_ns, before)
        self.assertEqual(len(list(directory.glob("config.toml.bak*"))), 1)

    def test_codex_invalid_toml_is_not_modified(self):
        directory = self.home / ".codex"
        directory.mkdir()
        path = directory / "config.toml"
        path.write_text('invalid = [')
        result = subprocess.run(["python3", str(CONFIG / "configure-codex.py")], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(path.read_text(), 'invalid = [')

    def test_macbook_setup_installs_blender_uv_and_dispatches_client_configuration(self):
        result = subprocess.run([str(ROOT / "setup.sh"), "macbook", "--dry-run"], cwd=ROOT,
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("brew install openai/tools/tunnel-client", result.stdout)
        self.assertIn("neovim mise uv", result.stdout)
        self.assertIn("bitwarden blender brave-browser", result.stdout)
        self.assertIn("Merge blender and Roblox_Studio into Claude Code, Claude Desktop, and Codex configs (macbook)", result.stdout)
        self.assertFalse((self.home / ".local/share/creative-mcp").exists())
        self.assertFalse(self.code.exists())

    def test_omarchy_setup_installs_blender_uv_and_dispatches_client_configuration(self):
        result = subprocess.run([str(ROOT / "setup.sh"), "omarchy", "--dry-run"], cwd=ROOT,
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("bitwarden blender bluez-utils", result.stdout)
        self.assertIn("git-delta mise uv", result.stdout)
        self.assertIn("Merge blender and Roblox_Studio into Claude Code, Claude Desktop, and Codex configs (omarchy)", result.stdout)
        self.assertFalse((self.home / ".local/share/creative-mcp").exists())
        self.assertFalse(self.desktop.exists())

    def test_dev_setup_does_not_deploy_desktop_creative_integrations(self):
        result = subprocess.run([str(ROOT / "setup.sh"), "dev", "--dry-run"], cwd=ROOT,
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Preparing dev host prerequisites", result.stdout)
        self.assertNotIn("Blender and Roblox MCP", result.stdout)
        self.assertNotIn("tunnel-client", result.stdout)
        self.assertFalse((self.home / ".local/share/creative-mcp").exists())

    def arrange_vinegar(self):
        binaries = self.home / "bin"
        binaries.mkdir()
        (binaries / "uname").write_text('#!/bin/sh\nprintf "Linux\\n"\n')
        # Replace only the Flatpak boundary; execute the actual inner launcher.
        (binaries / "flatpak").write_text('#!/bin/sh\n[ "$1" = run ] && [ "$2" = --command=sh ] && [ "$3" = org.vinegarhq.Vinegar ] || exit 99\nshift 3\nexec /bin/sh "$@"\n')
        (binaries / "uname").chmod(0o755)
        (binaries / "flatpak").chmod(0o755)
        self.env["PATH"] = f"{binaries}:{self.env['PATH']}"
        data = self.home / ".var/app/org.vinegarhq.Vinegar/data"
        self.env["XDG_DATA_HOME"] = str(data)
        return data / "vinegar"

    def test_vinegar_uses_current_batch_same_prefix_and_bundled_wine(self):
        root = self.arrange_vinegar()
        (root / "prefixes/studio").mkdir(parents=True)
        (root / "appdata/Roblox").mkdir(parents=True)
        (root / "appdata/Roblox/mcp.bat").write_text("fixture batch")
        wine = root / "kombucha/bin/wine"
        wine.parent.mkdir(parents=True)
        wine.write_text('#!/usr/bin/env python3\nimport json, os, sys\nprint(json.dumps({"args":sys.argv[1:],"cwd":os.getcwd(),"prefix":os.environ["WINEPREFIX"],"debug":os.environ["WINEDEBUG"]}))\n')
        wine.chmod(0o755)
        result = subprocess.run([str(CONFIG / "roblox-studio-mcp")], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            "args": ["cmd.exe", "/d", "/c", "mcp.bat"],
            "cwd": str(root / "appdata/Roblox"),
            "prefix": str(root / "prefixes/studio"), "debug": "-all",
        })

    def test_vinegar_missing_studio_fails_with_actionable_error(self):
        self.arrange_vinegar()
        result = subprocess.run([str(CONFIG / "roblox-studio-mcp")], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("open Roblox Studio through Vinegar", result.stderr)


if __name__ == "__main__":
    unittest.main()
