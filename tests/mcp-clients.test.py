#!/usr/bin/env python3
"""Isolated renderer integration tests. Run with the managed tomlkit Python.

No package installation, MCP connection, GUI operation, or authentication occurs.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
RENDERER = ROOT / "configs/mcp/configure-clients.py"
CODEX = shutil.which("codex")


class McpClientTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mcp-clients-test-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / "home with spaces"
        self.home.mkdir()
        self.env = {key: value for key, value in os.environ.items()
                    if key not in ("CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME",
                                   "PI_CODING_AGENT_DIR")}
        self.env.update(HOME=str(self.home), PI_OFFLINE="1", PI_SKIP_VERSION_CHECK="1")
        self.code = self.home / ".claude.json"
        self.pi = self.home / ".pi/agent/mcp.json"
        self.codex = self.home / ".codex/config.toml"
        self.desktop = self.home / ".config/Claude/claude_desktop_config.json"

    def run_config(self, host="omarchy"):
        return subprocess.run([sys.executable, str(RENDERER), host], env=self.env,
                              capture_output=True, text=True, timeout=30)

    def put(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def plugin(self, *, enabled=True, endpoint="https://mcp.figma.com/mcp", installed=True,
               registry=False):
        settings = self.home / ".claude/settings.json"
        self.put(settings, json.dumps({"enabledPlugins": {"figma@official": enabled},
                                      "customSetting": "keep"}))
        cache = self.home / ".claude/plugins/cache/official/figma/1.0"
        if installed:
            self.put(cache / ".mcp.json", json.dumps({"mcpServers": {"figma": {
                "type": "http", "url": endpoint, "headers": {"X-Plugin": "fixture"}}}}))
        if registry:
            self.put(self.home / ".claude/plugins/installed_plugins.json", json.dumps({
                "version": 2, "plugins": {"figma@official": [{"scope": "user", "installPath": str(cache)}]}}))
        return settings

    def test_all_desktop_clients_receive_six_native_or_bridged_services(self):
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        code = json.loads(self.code.read_text())["mcpServers"]
        self.assertEqual(set(code), {"neon", "datadog", "figma", "ai-memory", "blender", "Roblox_Studio"})
        self.assertEqual(code["neon"], {"type": "http", "url": "https://mcp.neon.tech/mcp"})
        self.assertEqual(code["datadog"], {"type": "http", "url": "https://mcp.us5.datadoghq.com/v1/mcp"})
        self.assertEqual(code["blender"], {"command": f"{self.home}/.local/bin/blender-mcp", "args": []})
        pi = json.loads(self.pi.read_text())["mcpServers"]
        self.assertEqual(pi["ai-memory"], {"url": "http://127.0.0.1:49374/mcp",
                         "description": "Shared local project memory.", "exposure": "deferred"})
        self.assertEqual(set(pi), set(code))
        desktop = json.loads(self.desktop.read_text())["mcpServers"]
        self.assertEqual(desktop["neon"], {"command": f"{self.home}/.local/bin/mcp-service", "args": ["neon"]})
        self.assertEqual(desktop["Roblox_Studio"], {"command": f"{self.home}/.local/bin/roblox-studio-mcp", "args": []})
        codex = tomllib.loads(self.codex.read_text())["mcp_servers"]
        self.assertEqual(codex["figma"], {"url": "https://mcp.figma.com/mcp"})
        self.assertEqual(set(codex), set(code))

    def test_dev_only_receives_four_services_and_does_not_touch_desktop(self):
        self.put(self.desktop, "do not read desktop on dev")
        result = self.run_config("dev")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(json.loads(self.code.read_text())["mcpServers"]), {"neon", "datadog", "figma", "ai-memory"})
        self.assertEqual(set(json.loads(self.pi.read_text())["mcpServers"]), {"neon", "datadog", "figma", "ai-memory"})
        self.assertEqual(set(tomllib.loads(self.codex.read_text())["mcp_servers"]), {"neon", "datadog", "figma", "ai-memory"})
        self.assertEqual(self.desktop.read_text(), "do not read desktop on dev")

    def test_macbook_uses_native_desktop_location(self):
        result = self.run_config("macbook")
        self.assertEqual(result.returncode, 0, result.stderr)
        desktop = self.home / "Library/Application Support/Claude/claude_desktop_config.json"
        self.assertEqual(json.loads(desktop.read_text())["mcpServers"]["figma"], {
            "command": f"{self.home}/.local/bin/mcp-service", "args": ["figma"]})
        self.assertFalse(self.desktop.exists())

    def test_config_directory_environment_overrides(self):
        self.env.update(CLAUDE_CONFIG_DIR=str(self.home / "claude override"),
                        CODEX_HOME=str(self.home / "codex override"),
                        PI_CODING_AGENT_DIR=str(self.home / "pi override"),
                        XDG_CONFIG_HOME=str(self.home / "xdg override"))
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.home / "claude override/.claude.json").read_text())["mcpServers"]["figma"],
                         {"type": "http", "url": "https://mcp.figma.com/mcp"})
        self.assertEqual(json.loads((self.home / "pi override/mcp.json").read_text())["mcpServers"]["neon"]["exposure"], "deferred")
        self.assertEqual(tomllib.loads((self.home / "codex override/config.toml").read_text())["mcp_servers"]["ai-memory"],
                         {"url": "http://127.0.0.1:49374/mcp"})
        self.assertEqual(json.loads((self.home / "xdg override/Claude/claude_desktop_config.json").read_text())["mcpServers"]["figma"]["args"], ["figma"])
        self.assertFalse(self.code.exists())
        self.assertFalse(self.pi.exists())
        self.assertFalse(self.codex.exists())

    def test_preserves_unrelated_settings_servers_and_pi_extension(self):
        self.put(self.code, '{"theme":"dark","mcpServers":{"node_repl":{"command":"keep","args":["app"]}}}')
        self.put(self.pi, '{"autoEnableCodemode":false,"mcpServers":{"node_repl":{"command":"keep"}}}')
        extension = self.home / ".pi/agent/extensions/ai-memory-pi.ts"
        self.put(extension, "extension fixture remains parent-owned")
        self.put(self.codex, '# retain comment\nmodel = "gpt-5"\n[mcp_servers.node_repl]\ncommand = "keep"\n[mcp_servers.node_repl.env]\nEXAMPLE = "kept"\n')
        self.put(self.desktop, '{"preferences":{"keep":true},"mcpServers":{"other":{"command":"keep"}}}')
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["theme"], "dark")
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["node_repl"], {"command": "keep", "args": ["app"]})
        self.assertEqual(json.loads(self.pi.read_text())["autoEnableCodemode"], False)
        self.assertEqual(json.loads(self.pi.read_text())["mcpServers"]["node_repl"], {"command": "keep"})
        self.assertEqual(extension.read_text(), "extension fixture remains parent-owned")
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["node_repl"], {"command": "keep", "env": {"EXAMPLE": "kept"}})
        self.assertIn("# retain comment", self.codex.read_text())
        self.assertEqual(json.loads(self.desktop.read_text())["preferences"], {"keep": True})
        self.assertEqual(json.loads(self.desktop.read_text())["mcpServers"]["other"], {"command": "keep"})

    def test_pi_normalized_name_collision_fails_before_any_client_write(self):
        for name in ("ai_memory", "Roblox-Studio"):
            with self.subTest(name=name):
                original = json.dumps({"mcpServers": {name: {"command": "user-owned"}}})
                self.put(self.pi, original)
                result = self.run_config()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("collide", result.stderr)
                self.assertIn(name, result.stderr)
                self.assertEqual(self.pi.read_text(), original)
                for other in (self.code, self.codex, self.desktop):
                    self.assertFalse(other.exists())
                self.assertFalse(list(self.home.rglob("*.bak*")))

    def test_managed_url_update_preserves_auth_options_and_comments(self):
        self.put(self.code, '{"mcpServers":{"neon":{"url":"https://old.invalid","headers":{"X-Custom":"keep"},"timeout":90}}}')
        self.put(self.codex, '# comment\n[mcp_servers.neon]\nurl = "https://old.invalid" # keep endpoint comment\ntool_timeout_sec = 90\n[mcp_servers.neon.http_headers]\nX-Custom = "keep"\n')
        result = self.run_config("dev")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["neon"], {
            "type": "http", "url": "https://mcp.neon.tech/mcp", "headers": {"X-Custom": "keep"}, "timeout": 90})
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["neon"], {
            "url": "https://mcp.neon.tech/mcp", "tool_timeout_sec": 90, "http_headers": {"X-Custom": "keep"}})
        self.assertIn("# keep endpoint comment", self.codex.read_text())

    def test_rerun_is_byte_stable_without_extra_backups(self):
        self.put(self.code, '{"theme":"keep"}')
        self.put(self.codex, '# original\nmodel="gpt-5"\n')
        first = self.run_config()
        before = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in (self.code, self.pi, self.codex, self.desktop)}
        result = self.run_config()
        after = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in before}
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(after, before)
        self.assertEqual(Path(f"{self.code}.bak").read_text(), '{"theme":"keep"}')
        self.assertEqual(Path(f"{self.codex}.bak").read_text(), '# original\nmodel="gpt-5"\n')
        self.assertFalse(Path(f"{self.code}.bak.1").exists())
        self.assertFalse(Path(f"{self.codex}.bak.1").exists())
        self.assertEqual(self.code.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.codex.stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(f"{self.code}.bak").stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(f"{self.codex}.bak").stat().st_mode & 0o777, 0o600)

    def test_malformed_json_preflights_before_any_write(self):
        self.put(self.desktop, '{broken')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.desktop.read_text(), '{broken')
        self.assertFalse(self.code.exists())
        self.assertFalse(self.pi.exists())
        self.assertFalse(self.codex.exists())

    def test_malformed_toml_preflights_before_any_write(self):
        self.put(self.codex, 'broken = [')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.codex.read_text(), 'broken = [')
        self.assertFalse(self.code.exists())
        self.assertFalse(self.pi.exists())
        self.assertFalse(self.desktop.exists())

    def test_wrong_json_root_shape_fails_closed(self):
        self.put(self.code, '[]')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("expected an object", result.stderr)
        self.assertEqual(self.code.read_text(), '[]')
        self.assertFalse(self.pi.exists())

    def test_wrong_json_mcp_container_shape_fails_closed(self):
        self.put(self.pi, '{"mcpServers":[]}')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("expected an object", result.stderr)
        self.assertEqual(self.pi.read_text(), '{"mcpServers":[]}')
        self.assertFalse(self.code.exists())

    def test_wrong_json_mcp_entry_shape_fails_closed(self):
        self.put(self.desktop, '{"mcpServers":{"node_repl":[]}}')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("expected an object", result.stderr)
        self.assertEqual(self.desktop.read_text(), '{"mcpServers":{"node_repl":[]}}')
        self.assertFalse(self.code.exists())

    def test_wrong_toml_mcp_container_shape_fails_closed(self):
        self.put(self.codex, 'mcp_servers = []')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("expected an object", result.stderr)
        self.assertEqual(self.codex.read_text(), 'mcp_servers = []')
        self.assertFalse(self.code.exists())

    def test_wrong_toml_mcp_entry_shape_fails_closed(self):
        self.put(self.codex, '[mcp_servers]\nnode_repl = "wrong"')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("expected an object", result.stderr)
        self.assertEqual(self.codex.read_text(), '[mcp_servers]\nnode_repl = "wrong"')
        self.assertFalse(self.code.exists())

    def test_config_symlink_fails_without_touching_target(self):
        target = self.home / "target"
        target.write_text('{}')
        self.codex.parent.mkdir()
        self.codex.symlink_to(target)
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing symlink", result.stderr)
        self.assertEqual(target.read_text(), '{}')
        self.assertTrue(self.codex.is_symlink())
        self.assertFalse(self.code.exists())

    def test_parent_directory_symlink_fails_closed(self):
        target = self.home / "target directory"
        target.mkdir()
        (self.home / ".codex").symlink_to(target, target_is_directory=True)
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing symlink", result.stderr)
        self.assertEqual(list(target.iterdir()), [])
        self.assertFalse(self.code.exists())

    def test_backup_symlink_is_not_followed(self):
        self.put(self.code, '{"theme":"keep"}')
        target = self.home / "backup-target"
        target.write_text("unchanged target")
        Path(f"{self.code}.bak").symlink_to(target)
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(target.read_text(), "unchanged target")
        self.assertEqual(Path(f"{self.code}.bak.1").read_text(), '{"theme":"keep"}')

    def test_enabled_installed_figma_plugin_avoids_code_duplicate_only(self):
        settings = self.plugin(registry=True)
        original = settings.read_bytes()
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("figma", json.loads(self.code.read_text())["mcpServers"])
        self.assertEqual(json.loads(self.pi.read_text())["mcpServers"]["figma"]["url"], "https://mcp.figma.com/mcp")
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["figma"], {"url": "https://mcp.figma.com/mcp"})
        self.assertEqual(settings.read_bytes(), original)

    def test_enabled_plugin_without_installed_files_gets_native_figma(self):
        self.plugin(installed=False, registry=True)
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["figma"], {"type": "http", "url": "https://mcp.figma.com/mcp"})

    def test_disabled_plugin_gets_native_figma(self):
        self.plugin(enabled=False)
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["figma"], {"type": "http", "url": "https://mcp.figma.com/mcp"})

    def test_wrong_endpoint_plugin_gets_native_figma(self):
        self.plugin(endpoint="https://different.invalid/mcp")
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["figma"], {"type": "http", "url": "https://mcp.figma.com/mcp"})

    def test_plugin_removes_only_exact_managed_standalone(self):
        self.plugin()
        self.put(self.code, '{"mcpServers":{"figma":{"type":"http","url":"https://mcp.figma.com/mcp"}}}')
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("figma", json.loads(self.code.read_text())["mcpServers"])
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["neon"], {"type": "http", "url": "https://mcp.neon.tech/mcp"})
        self.assertEqual(json.loads(Path(f"{self.code}.bak").read_text())["mcpServers"]["figma"]["url"], "https://mcp.figma.com/mcp")

    def test_plugin_preserves_custom_standalone_with_warning(self):
        self.plugin()
        self.put(self.code, '{"mcpServers":{"figma":{"type":"http","url":"https://mcp.figma.com/mcp","headers":{"X-Custom":"keep"}}}}')
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("preserving custom standalone figma", result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["figma"], {
            "type": "http", "url": "https://mcp.figma.com/mcp", "headers": {"X-Custom": "keep"}})

    def test_registry_does_not_mistake_stale_cache_for_active_install(self):
        self.plugin()
        self.put(self.home / ".claude/plugins/installed_plugins.json", '{"version":2,"plugins":{}}')
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["figma"], {"type": "http", "url": "https://mcp.figma.com/mcp"})

    def test_renderer_needs_no_network_subprocess_or_auth_file_access(self):
        guard = '''
import os, runpy, sys

def audit(event, args):
    if event.startswith("socket.") or event in ("subprocess.Popen", "os.system"):
        raise RuntimeError("renderer attempted network or subprocess access")
    if event == "open" and isinstance(args[0], (str, bytes)):
        name = os.path.basename(os.fsdecode(args[0]))
        if name in ("auth.json", "mcp-auth.json", ".credentials.json"):
            raise RuntimeError("renderer attempted credential access")

sys.addaudithook(audit)
sys.argv = [sys.argv[1], "dev"]
runpy.run_path(sys.argv[0], run_name="__main__")
'''
        result = subprocess.run([sys.executable, "-c", guard, str(RENDERER)], env=self.env,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["figma"],
                         {"url": "https://mcp.figma.com/mcp"})
        self.assertEqual(json.loads(self.pi.read_text())["mcpServers"]["ai-memory"]["url"],
                         "http://127.0.0.1:49374/mcp")

    @unittest.skipUnless(CODEX, "Codex CLI required to verify native config reader")
    def test_real_codex_reads_generated_http_and_stdio_without_connecting(self):
        result = self.run_config()
        remote = subprocess.run([CODEX, "mcp", "get", "neon", "--json"], env=self.env,
                                cwd=self.home, capture_output=True, text=True, timeout=30)
        local = subprocess.run([CODEX, "mcp", "get", "blender", "--json"], env=self.env,
                               cwd=self.home, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(remote.returncode, 0, remote.stderr)
        self.assertEqual(local.returncode, 0, local.stderr)
        self.assertEqual(json.loads(remote.stdout)["transport"]["type"], "streamable_http")
        self.assertEqual(json.loads(remote.stdout)["transport"]["url"], "https://mcp.neon.tech/mcp")
        self.assertEqual(json.loads(local.stdout)["transport"]["command"], f"{self.home}/.local/bin/blender-mcp")
        self.assertEqual(json.loads(local.stdout)["transport"]["args"], [])


if __name__ == "__main__":
    unittest.main()
