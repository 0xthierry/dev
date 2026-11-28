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
# Resolve mise's dispatch shim before changing HOME; resolving its symlink
# would invoke mise itself, not the Codex config reader.
MISE = shutil.which("mise")
if CODEX and MISE and (Path(CODEX).parent.name == "shims" or Path(CODEX).samefile(MISE)):
    CODEX = subprocess.check_output(["mise", "which", "codex"], text=True).strip()
CODEX_BIN = str(Path(CODEX).parent) if CODEX else ""
CODEX = str(Path(CODEX).resolve()) if CODEX else None


class McpClientTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mcp-clients-test-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve() / "home with spaces"
        self.home.mkdir()
        self.env = {key: value for key, value in os.environ.items()
                    if key not in ("CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME",
                                   "PI_CODING_AGENT_DIR")}
        self.env.update(HOME=str(self.home), PI_OFFLINE="1", PI_SKIP_VERSION_CHECK="1",
                        PATH=f"{CODEX_BIN}:{os.environ['PATH']}")
        self.code = self.home / ".claude.json"
        self.agy = self.home / ".gemini/config/mcp_config.json"
        self.pi = self.home / ".pi/agent/mcp.json"
        self.codex = self.home / ".codex/config.toml"
        self.desktop = self.home / ".config/Claude/claude_desktop_config.json"
        self.preferences = self.home / ".config/mcp-services/preferences.json"

    def run_config(self, host="omarchy", *options):
        return subprocess.run([sys.executable, str(RENDERER), host, *options], env=self.env,
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

    def test_fresh_default_keeps_native_services_but_omits_desktop_remote_services(self):
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        code = json.loads(self.code.read_text())["mcpServers"]
        self.assertEqual(set(code), {"neon", "datadog", "figma", "rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio", "cua-driver"})
        self.assertEqual(code["cua-driver"], {"command": f"{self.home}/.local/bin/cua-driver-mcp", "args": []})
        self.assertEqual(code["rea"], {"command": f"{self.home}/.local/bin/rea-mcp", "args": []})
        self.assertEqual(code["neon"], {"type": "http", "url": "https://mcp.neon.tech/mcp"})
        self.assertEqual(code["datadog"], {"type": "http", "url": "https://mcp.us5.datadoghq.com/v1/mcp"})
        self.assertEqual(code["blender"], {"command": f"{self.home}/.local/bin/blender-mcp", "args": []})
        pi = json.loads(self.pi.read_text())["mcpServers"]
        self.assertNotIn("ai-memory", pi)
        self.assertNotIn("ai-memory", code)
        self.assertEqual(set(pi), set(code) | {"mobbin"})
        self.assertEqual(pi["mobbin"], {
            "url": "https://api.mobbin.com/mcp", "exposure": "deferred",
            "description": "Search Mobbin for app screens and design flows."})
        self.assertEqual(pi["cua-driver"], {**code["cua-driver"], "exposure": "deferred",
                         "description": "Inspect and interact with desktop applications through the managed Cua Driver daemon."})
        self.assertEqual(pi["rea"], {
            "command": f"{self.home}/.local/bin/rea-mcp", "args": [],
            "description": "Analyze and reverse-engineer binaries with REA.", "exposure": "deferred"})
        desktop = json.loads(self.desktop.read_text())["mcpServers"]
        self.assertEqual(set(desktop), {"rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio"})
        self.assertEqual(desktop["rea"], {"command": f"{self.home}/.local/bin/rea-mcp", "args": []})
        self.assertEqual(desktop["Roblox_Studio"], {"command": f"{self.home}/.local/bin/roblox-studio-mcp", "args": []})
        codex = tomllib.loads(self.codex.read_text())["mcp_servers"]
        self.assertEqual(codex["figma"], {"url": "https://mcp.figma.com/mcp"})
        self.assertEqual(set(codex), set(code) | {"mobbin"})
        self.assertEqual(codex["mobbin"], {"url": "https://api.mobbin.com/mcp"})
        self.assertEqual(codex["cua-driver"], code["cua-driver"])
        self.assertEqual(codex["rea"], {"command": f"{self.home}/.local/bin/rea-mcp", "args": []})

    def test_agy_fresh_global_config_uses_native_transports(self):
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.agy.read_text()), {"mcpServers": {
            "cua-driver": {"command": f"{self.home}/.local/bin/cua-driver-mcp", "args": []},
            "neon": {"serverUrl": "https://mcp.neon.tech/mcp"},
            "datadog": {"serverUrl": "https://mcp.us5.datadoghq.com/v1/mcp"},
            "figma": {"serverUrl": "https://mcp.figma.com/mcp"},
            "rea": {"command": f"{self.home}/.local/bin/rea-mcp", "args": []},
            "playwriter": {"command": f"{self.home}/.local/bin/playwriter-mcp", "args": []},
            "chrome-devtools": {"command": f"{self.home}/.local/bin/chrome-devtools-mcp", "args": []},
            "blender": {"command": f"{self.home}/.local/bin/blender-mcp", "args": []},
            "Roblox_Studio": {"command": f"{self.home}/.local/bin/roblox-studio-mcp", "args": []}}})

    def test_agy_zero_byte_bootstrap_and_rerun_on_macbook(self):
        self.put(self.agy, "")
        first = self.run_config("macbook")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(set(json.loads(self.agy.read_text())["mcpServers"]), {
            "neon", "datadog", "figma", "rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio"})
        before = self.agy.read_bytes(), self.agy.stat().st_mtime_ns
        second = self.run_config("macbook")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual((self.agy.read_bytes(), self.agy.stat().st_mtime_ns), before)
        self.assertEqual(self.agy.stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(f"{self.agy}.bak").read_bytes(), b"")
        self.assertFalse(Path(f"{self.agy}.bak.1").exists())

    def test_agy_migrates_transport_aliases_without_resetting_options_or_other_servers(self):
        remote_options = {"headers": {"X-Test": "fixture"}, "oauth": {"clientId": "fixture"},
                          "authProviderType": "google_credentials", "disabled": True, "timeoutSeconds": 90}
        local_options = {"env": {"CUSTOM": "fixture"}, "cwd": "/custom", "disabledTools": ["edit"]}
        custom = {"command": "custom", "args": ["--custom"], "disabled": True}
        self.put(self.agy, json.dumps({"theme": "dark", "mcpServers": {
            "neon": {"httpUrl": "https://mcp.neon.tech/mcp", "url": "https://mcp.neon.tech/mcp", **remote_options},
            "rea": {"command": f"{self.home}/.local/bin/rea-mcp", **local_options}, "ai-memory": custom}}))
        original = self.agy.read_bytes()
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads(self.agy.read_text())
        self.assertEqual(config["theme"], "dark")
        self.assertEqual(config["mcpServers"]["ai-memory"], custom)
        self.assertEqual(config["mcpServers"]["neon"], {"serverUrl": "https://mcp.neon.tech/mcp", **remote_options})
        self.assertEqual(config["mcpServers"]["rea"], {"command": f"{self.home}/.local/bin/rea-mcp", "args": [], **local_options})
        self.assertEqual(Path(f"{self.agy}.bak").read_bytes(), original)

    def test_agy_foreign_https_destination_does_not_forward_auth_or_write_any_file(self):
        self.put(self.agy, json.dumps({"mcpServers": {"neon": {
            "serverUrl": "https://private.example/proxy", "headers": {"Authorization": "Bearer dummy-only"},
            "oauth": {"clientSecret": "dummy-only"}, "authProviderType": "google_credentials"}}}))
        self.put(self.code, '{"theme":"unchanged"}')
        original = {self.code: self.code.read_bytes(), self.agy: self.agy.read_bytes()}
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("Antigravity server 'neon'", result.stderr)
        self.assertNotIn("dummy-only", result.stderr)
        self.assertEqual({p: p.read_bytes() for p in self.home.rglob("*") if p.is_file()}, original)

    def test_agy_foreign_command_does_not_forward_env_or_write_any_file(self):
        self.put(self.agy, json.dumps({"mcpServers": {"rea": {
            "command": "/user/rea-wrapper", "args": [], "env": {"PRIVATE_TOKEN": "dummy-only"}}}}))
        original = self.agy.read_bytes()
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("Antigravity server 'rea'", result.stderr)
        self.assertNotIn("dummy-only", result.stderr)
        self.assertEqual({p: p.read_bytes() for p in self.home.rglob("*") if p.is_file()}, {self.agy: original})

    def test_agy_rejects_ambiguous_unknown_and_incompatible_existing_transports(self):
        cases = {
            "contradictory aliases": {"neon": {"serverUrl": "https://mcp.neon.tech/mcp", "url": "https://other.invalid"}},
            "remote to local": {"rea": {"url": "https://other.invalid"}},
            "local to remote": {"neon": {"command": "/user/server"}},
            "mixed transports": {"neon": {"url": "https://mcp.neon.tech/mcp", "command": "/user/server"}},
            "foreign args": {"rea": {"command": f"{self.home}/.local/bin/rea-mcp", "args": ["--proxy"]}},
            "disabled placeholder": {"neon": {"disabled": True}},
            "empty placeholder": {"rea": {}}}
        for case, servers in cases.items():
            with self.subTest(case=case):
                self.put(self.agy, json.dumps({"mcpServers": servers}))
                original = self.agy.read_bytes()
                result = self.run_config()
                self.assertEqual(result.returncode, 1)
                self.assertIn("Antigravity server", result.stderr)
                self.assertEqual({p: p.read_bytes() for p in self.home.rglob("*") if p.is_file()}, {self.agy: original})

    def test_agy_nonempty_whitespace_is_invalid_before_any_write(self):
        self.put(self.agy, " \n")
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.agy.read_text(), " \n")
        self.assertEqual([p for p in self.home.rglob("*") if p.is_file()], [self.agy])

    def test_select_only_antigravity_ignores_unrelated_client_inputs_and_outputs(self):
        settings = self.home / ".claude/settings.json"
        self.put(settings, "not json")
        self.put(self.preferences, "not json")
        self.put(self.pi, "not json")
        result = self.run_config("omarchy", "--client", "antigravity")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.agy.read_text())["mcpServers"]["neon"],
                         {"serverUrl": "https://mcp.neon.tech/mcp"})
        self.assertEqual({p for p in self.home.rglob("*") if p.is_file()},
                         {settings, self.preferences, self.pi, self.agy})
        self.assertEqual(self.pi.read_text(), "not json")

    def test_agy_symlink_fails_without_writing_any_client(self):
        target = self.home / "target"
        self.put(target, "{}")
        self.agy.parent.mkdir(parents=True)
        self.agy.symlink_to(target)
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing symlink", result.stderr)
        self.assertTrue(self.agy.is_symlink())
        self.assertEqual(target.read_text(), "{}")
        self.assertEqual({p for p in self.home.rglob("*") if p.is_file()}, {self.agy, target})

    def test_empty_claude_json_is_not_a_bootstrap_file(self):
        self.put(self.code, "")
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertEqual([p for p in self.home.rglob("*") if p.is_file()], [self.code])

    def render_fixture_catalog(self, **scope):
        source = Path(self.temp.name) / "catalog fixture"
        source.mkdir()
        renderer = source / RENDERER.name
        shutil.copy2(RENDERER, renderer)
        self.put(source / "catalog.json", json.dumps({"fixture": {"launcher": "fixture-mcp",
                 "description": "fixture", **scope}}))
        return subprocess.run([sys.executable, str(renderer), "omarchy"], env=self.env,
                              capture_output=True, text=True, timeout=10)

    def test_unknown_host_selector_rejected_before_writing(self):
        result = self.render_fixture_catalog(clients_by_host={"bogus": ["pi"]})
        self.assertEqual(result.returncode, 1)
        self.assertIn("invalid catalog host scope", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_unknown_client_selector_rejected_before_writing(self):
        result = self.render_fixture_catalog(clients_by_host={"omarchy": ["bogus"]})
        self.assertEqual(result.returncode, 1)
        self.assertIn("invalid catalog clients", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_misspelled_catalog_scope_cannot_register_service_everywhere(self):
        result = self.render_fixture_catalog(clients_by_hosts={"macbook": ["pi"]})
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown catalog field", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_cua_preserves_existing_pi_hidden_tools_and_disabled_server(self):
        entry = {"command": f"{self.home}/.local/bin/cua-driver-mcp", "enabled": False,
                 "exposure": "hidden", "toolExposure": {"get_window_state": "hidden"},
                 "env": {"CUSTOM": "fixture"}, "description": "private"}
        self.put(self.pi, json.dumps({"mcpServers": {"cua-driver": entry}}))
        result = self.run_config("macbook", "--client", "pi")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.pi.read_text())["mcpServers"]["cua-driver"], {**entry, "args": []})
        self.assertFalse(self.agy.exists())

    def test_cua_mac_does_not_remove_an_unselected_foreign_entry(self):
        foreign = {"serverUrl": "https://example.invalid", "disabled": True}
        self.put(self.agy, json.dumps({"mcpServers": {"cua-driver": foreign}}))
        result = self.run_config("macbook")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.agy.read_text())["mcpServers"]["cua-driver"], foreign)
        self.assertIn("cua-driver", json.loads(self.pi.read_text())["mcpServers"])

    def test_cua_claude_mixed_remote_transport_with_credentials_fails_before_write(self):
        entry = {"command": f"{self.home}/.local/bin/cua-driver-mcp", "url": "https://example.invalid",
                 "headers": {"Authorization": "sensitive-fixture"}}
        original = json.dumps({"mcpServers": {"cua-driver": entry}})
        self.put(self.code, original)
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("claude server 'cua-driver'", result.stderr)
        self.assertNotIn("sensitive-fixture", result.stderr)
        self.assertEqual({p: p.read_text() for p in self.home.rglob('*') if p.is_file()}, {self.code: original})

    def test_cua_codex_custom_launcher_with_credentials_fails_before_write(self):
        original = '[mcp_servers.cua-driver]\ncommand="custom"\n[mcp_servers.cua-driver.env]\nTOKEN="sensitive-fixture"\n'
        self.put(self.codex, original)
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("codex server 'cua-driver'", result.stderr)
        self.assertNotIn("sensitive-fixture", result.stderr)
        self.assertEqual({p: p.read_text() for p in self.home.rglob('*') if p.is_file()}, {self.codex: original})

    def test_browser_stdio_launchers_reach_every_client_with_absolute_commands(self):
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = {
            "playwriter": {"command": f"{self.home}/.local/bin/playwriter-mcp", "args": []},
            "chrome-devtools": {"command": f"{self.home}/.local/bin/chrome-devtools-mcp", "args": []},
        }
        code = json.loads(self.code.read_text())["mcpServers"]
        desktop = json.loads(self.desktop.read_text())["mcpServers"]
        codex = tomllib.loads(self.codex.read_text())["mcp_servers"]
        pi = json.loads(self.pi.read_text())["mcpServers"]
        self.assertEqual({name: code[name] for name in expected}, expected)
        self.assertEqual({name: desktop[name] for name in expected}, expected)
        self.assertEqual({name: codex[name] for name in expected}, expected)
        self.assertEqual(pi["playwriter"], {
            "command": f"{self.home}/.local/bin/playwriter-mcp", "args": [],
            "description": "Automate the user's existing browser through the Playwriter extension.",
            "exposure": "deferred"})
        self.assertEqual(pi["chrome-devtools"], {
            "command": f"{self.home}/.local/bin/chrome-devtools-mcp", "args": [],
            "description": "Diagnose and inspect the existing local browser at 127.0.0.1:9222.",
            "exposure": "deferred"})

    def test_browser_transport_migration_preserves_credentials_and_user_settings(self):
        self.put(self.code, '{"mcpServers":{"playwriter":{"command":"npx","args":["playwriter"],"env":{"PLAYWRITER_TOKEN":"keep"},"timeout":90}}}')
        self.put(self.pi, '{"mcpServers":{"chrome-devtools":{"command":"npx","args":["chrome-devtools-mcp"],"timeout":90}}}')
        self.put(self.codex, '# browser preferences\n[mcp_servers.playwriter]\ncommand="npx"\nargs=["playwriter"]\ntool_timeout_sec=90\n[mcp_servers.playwriter.env]\nPLAYWRITER_TOKEN="keep"\n')
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["playwriter"], {
            "command": f"{self.home}/.local/bin/playwriter-mcp", "args": [],
            "env": {"PLAYWRITER_TOKEN": "keep"}, "timeout": 90})
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["playwriter"], {
            "command": f"{self.home}/.local/bin/playwriter-mcp", "args": [],
            "env": {"PLAYWRITER_TOKEN": "keep"}, "tool_timeout_sec": 90})
        self.assertEqual(json.loads(self.pi.read_text())["mcpServers"]["chrome-devtools"], {
            "command": f"{self.home}/.local/bin/chrome-devtools-mcp", "args": [],
            "description": "Diagnose and inspect the existing local browser at 127.0.0.1:9222.",
            "exposure": "deferred", "timeout": 90})
        self.assertIn("# browser preferences", self.codex.read_text())

    def test_upstream_memory_transport_auth_and_approval_options_are_preserved(self):
        code = {"command": "/upstream/ai-memory", "args": ["mcp-bridge"],
                "env": {"AI_MEMORY_SERVER_URL": "http://127.0.0.1:49374"}, "timeout": 90}
        desktop = {"command": "/upstream/ai-memory", "args": ["mcp-bridge", "--no-session-id"],
                   "env": {"CUSTOM": "keep"}}
        codex = ('# upstream memory options\n[mcp_servers.ai-memory]\n'
                 'command="/upstream/ai-memory"\nargs=["mcp-bridge","--no-session-id"]\n'
                 'default_tools_approval_mode="approve"\nstartup_timeout_sec=30\n'
                 '[mcp_servers.ai-memory.tools.memory_write_page]\napproval_mode="prompt"\n'
                 '[mcp_servers.ai-memory.env]\nAI_MEMORY_SERVER_URL="http://127.0.0.1:49374"\n')
        self.put(self.code, json.dumps({"mcpServers": {"ai-memory": code}}))
        self.put(self.desktop, json.dumps({"mcpServers": {"ai-memory": desktop}}))
        self.put(self.codex, codex)
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["ai-memory"], code)
        self.assertEqual(json.loads(self.desktop.read_text())["mcpServers"]["ai-memory"], desktop)
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["ai-memory"],
                         tomllib.loads(codex)["mcp_servers"]["ai-memory"])
        self.assertIn("# upstream memory options", self.codex.read_text())
        self.assertEqual(json.loads(self.pi.read_text())["mcpServers"]["rea"]["args"], [])
        self.assertNotIn("ai-memory", json.loads(self.pi.read_text())["mcpServers"])

    def test_existing_memory_http_auth_is_not_rewritten(self):
        entry = {"url": "https://custom.invalid/mcp", "headers": {"Authorization": "fixture"},
                 "oauth": {"clientId": "keep"}, "timeout": 90}
        self.put(self.code, json.dumps({"mcpServers": {"ai-memory": entry}}))
        self.put(self.desktop, json.dumps({"mcpServers": {"ai-memory": entry}}))
        codex = '[mcp_servers.ai-memory]\nurl="https://custom.invalid/mcp"\nbearer_token_env_var="KEEP_TOKEN"\n'
        self.put(self.codex, codex)
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["ai-memory"], entry)
        self.assertEqual(json.loads(self.desktop.read_text())["mcpServers"]["ai-memory"], entry)
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["ai-memory"],
                         {"url": "https://custom.invalid/mcp", "bearer_token_env_var": "KEEP_TOKEN"})

    def test_old_managed_pi_memory_transports_are_removed_idempotently(self):
        entries = [
            {"command": f"{self.home}/.local/bin/ai-memory", "args": ["mcp-bridge", "--server-url",
             "http://127.0.0.1:49374", "--no-session-id"], "exposure": "deferred"},
            {"url": "http://127.0.0.1:49374/mcp", "headers": {"Authorization": "old-fixture"}},
            {"url": "https://ai-memory-cloud.tail4e339.ts.net/mcp", "exposure": "deferred"}]
        for entry in entries:
            with self.subTest(entry=entry):
                self.put(self.pi, json.dumps({"mcpServers": {
                    "ai-memory": entry, "ai_memory": {"command": "unrelated"}}}))
                result = self.run_config()
                self.assertEqual(result.returncode, 0, result.stderr)
                servers = json.loads(self.pi.read_text())["mcpServers"]
                self.assertNotIn("ai-memory", servers)
                self.assertEqual(servers["ai_memory"], {"command": "unrelated"})
                original = self.pi.read_bytes(), self.pi.stat().st_mtime_ns
                repeated = self.run_config()
                self.assertEqual(repeated.returncode, 0, repeated.stderr)
                self.assertEqual((self.pi.read_bytes(), self.pi.stat().st_mtime_ns), original)

    def test_custom_pi_memory_fails_before_any_writes(self):
        entries = [{"url": "https://custom.invalid/mcp"},
                   {"command": f"{self.home}/.local/bin/ai-memory", "args": ["mcp-bridge"]},
                   {"command": "/custom/ai-memory", "args": ["mcp-bridge", "--server-url",
                    "http://127.0.0.1:49374", "--no-session-id"]}]
        for entry in entries:
            with self.subTest(entry=entry):
                original = json.dumps({"mcpServers": {"ai-memory": entry}})
                self.put(self.pi, original)
                result = self.run_config()
                self.assertEqual(result.returncode, 1)
                self.assertIn("remove that native mcpServers entry explicitly", result.stderr)
                self.assertIn(str(self.pi), result.stderr)
                self.assertEqual(self.pi.read_text(), original)
                self.assertFalse(self.code.exists())
                self.assertFalse(self.codex.exists())
                self.assertFalse(self.desktop.exists())
                self.assertEqual(list(self.home.rglob("*.bak*")), [])

    def test_old_remote_files_are_not_read_or_modified(self):
        marker = self.home / ".config/ai-memory/client.json"
        key = self.home / ".config/ai-memory/api-key"
        self.put(marker, "retired and deliberately invalid")
        self.put(key, "preserve-unused-key")
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(marker.read_text(), "retired and deliberately invalid")
        self.assertEqual(key.read_text(), "preserve-unused-key")
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["rea"]["command"],
                         f"{self.home}/.local/bin/rea-mcp")

    def test_persistent_opt_in_enables_all_three_desktop_remote_services(self):
        self.put(self.preferences, '{"claude_desktop_remote_services":["neon","datadog","figma"]}')
        original = self.preferences.read_bytes()
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        desktop = json.loads(self.desktop.read_text())["mcpServers"]
        self.assertEqual(desktop, {
            "neon": {"command": f"{self.home}/.local/bin/mcp-service", "args": ["neon"]},
            "datadog": {"command": f"{self.home}/.local/bin/mcp-service", "args": ["datadog"]},
            "figma": {"command": f"{self.home}/.local/bin/mcp-service", "args": ["figma"]},
            "rea": {"command": f"{self.home}/.local/bin/rea-mcp", "args": []},
            "playwriter": {"command": f"{self.home}/.local/bin/playwriter-mcp", "args": []},
            "chrome-devtools": {"command": f"{self.home}/.local/bin/chrome-devtools-mcp", "args": []},
            "blender": {"command": f"{self.home}/.local/bin/blender-mcp", "args": []},
            "Roblox_Studio": {"command": f"{self.home}/.local/bin/roblox-studio-mcp", "args": []}})
        before = self.desktop.read_bytes(), self.desktop.stat().st_mtime_ns
        repeated = self.run_config()
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assertEqual((self.desktop.read_bytes(), self.desktop.stat().st_mtime_ns), before)
        self.assertEqual(self.preferences.read_bytes(), original)
        self.assertFalse(Path(f"{self.desktop}.bak").exists())

    def test_partial_opt_in_enables_only_listed_desktop_remote_service(self):
        self.put(self.preferences, '{"claude_desktop_remote_services":["figma"]}')
        result = self.run_config("macbook")
        self.assertEqual(result.returncode, 0, result.stderr)
        desktop = self.home / "Library/Application Support/Claude/claude_desktop_config.json"
        servers = json.loads(desktop.read_text())["mcpServers"]
        self.assertEqual(set(servers), {"figma", "rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio"})
        self.assertEqual(servers["figma"], {
            "command": f"{self.home}/.local/bin/mcp-service", "args": ["figma"]})

    def test_default_migrates_managed_remote_entries_and_preserves_other_clients(self):
        self.put(self.preferences, '{"claude_desktop_remote_services":["neon","datadog","figma"]}')
        first = self.run_config()
        self.assertEqual(first.returncode, 0, first.stderr)
        config = json.loads(self.desktop.read_text())
        config["preferences"] = {"keep": True}
        config["mcpServers"]["other"] = {"command": "user-owned", "args": ["app"]}
        config["mcpServers"]["neon"]["env"] = {"EXAMPLE": "managed extra option"}
        self.put(self.desktop, json.dumps(config))
        original = self.desktop.read_bytes()
        code_original = self.code.read_bytes()
        pi_original = self.pi.read_bytes()
        codex_original = self.codex.read_bytes()
        self.preferences.unlink()
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        migrated = json.loads(self.desktop.read_text())
        self.assertEqual(set(migrated["mcpServers"]), {"rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio", "other"})
        self.assertEqual(migrated["mcpServers"]["other"], {"command": "user-owned", "args": ["app"]})
        self.assertEqual(migrated["preferences"], {"keep": True})
        self.assertEqual(self.code.read_bytes(), code_original)
        self.assertEqual(self.pi.read_bytes(), pi_original)
        self.assertEqual(self.codex.read_bytes(), codex_original)
        self.assertEqual(Path(f"{self.desktop}.bak").read_bytes(), original)
        self.assertEqual(Path(f"{self.desktop}.bak").stat().st_mode & 0o777, 0o600)
        before = self.desktop.read_bytes(), self.desktop.stat().st_mtime_ns
        repeated = self.run_config()
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assertEqual((self.desktop.read_bytes(), self.desktop.stat().st_mtime_ns), before)
        self.assertFalse(Path(f"{self.desktop}.bak.1").exists())

    def test_default_preserves_same_name_custom_desktop_transports_with_warning(self):
        custom = {
            "neon": {"command": "/custom/mcp-service", "args": ["neon"]},
            "datadog": {"command": f"{self.home}/.local/bin/mcp-service", "args": ["datadog", "custom"]},
            "figma": {"url": "https://custom.invalid/mcp", "headers": {"X-Custom": "keep"}}}
        self.put(self.desktop, json.dumps({"mcpServers": custom}))
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        desktop = json.loads(self.desktop.read_text())["mcpServers"]
        self.assertEqual(desktop["neon"], custom["neon"])
        self.assertEqual(desktop["datadog"], custom["datadog"])
        self.assertEqual(desktop["figma"], custom["figma"])
        self.assertIn("preserving custom Claude Desktop neon entry", result.stderr)
        self.assertIn("preserving custom Claude Desktop datadog entry", result.stderr)
        self.assertIn("preserving custom Claude Desktop figma entry", result.stderr)

    def test_opt_in_preserves_same_name_custom_desktop_entry_with_warning(self):
        self.put(self.preferences, '{"claude_desktop_remote_services":["neon"]}')
        self.put(self.desktop, '{"mcpServers":{"neon":{"command":"custom","args":["neon"]}}}')
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.desktop.read_text())["mcpServers"]["neon"],
                         {"command": "custom", "args": ["neon"]})
        self.assertIn("preserving custom Claude Desktop neon entry", result.stderr)

    def test_removed_dev_host_is_rejected_without_writes(self):
        result = self.run_config("dev")
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid choice", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_macbook_uses_native_desktop_location(self):
        result = self.run_config("macbook")
        self.assertEqual(result.returncode, 0, result.stderr)
        desktop = self.home / "Library/Application Support/Claude/claude_desktop_config.json"
        self.assertEqual(set(json.loads(desktop.read_text())["mcpServers"]),
                         {"rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio"})
        self.assertEqual(set(json.loads(self.code.read_text())["mcpServers"]),
                         {"neon", "datadog", "figma", "rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio"})
        self.assertEqual(set(json.loads(self.pi.read_text())["mcpServers"]),
                         {"neon", "datadog", "figma", "mobbin", "rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio", "cua-driver"})
        self.assertEqual(json.loads(self.pi.read_text())["mcpServers"]["mobbin"], {
            "url": "https://api.mobbin.com/mcp", "exposure": "deferred",
            "description": "Search Mobbin for app screens and design flows."})
        pi_cua = json.loads(self.pi.read_text())["mcpServers"]["cua-driver"]
        self.assertEqual((pi_cua["command"], pi_cua["args"], pi_cua["exposure"]),
                         (f"{self.home}/.local/bin/cua-driver-mcp", [], "deferred"))
        self.assertEqual(set(tomllib.loads(self.codex.read_text())["mcp_servers"]),
                         {"neon", "datadog", "figma", "mobbin", "rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio"})
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["mobbin"],
                         {"url": "https://api.mobbin.com/mcp"})
        self.assertEqual(json.loads(desktop.read_text())["mcpServers"]["rea"],
                         {"command": f"{self.home}/.local/bin/rea-mcp", "args": []})
        self.assertFalse(self.desktop.exists())

    def test_config_directory_environment_overrides(self):
        self.env.update(CLAUDE_CONFIG_DIR=str(self.home / "claude override"),
                        CODEX_HOME=str(self.home / "codex override"),
                        PI_CODING_AGENT_DIR=str(self.home / "pi override"),
                        XDG_CONFIG_HOME=str(self.home / "xdg override"))
        self.put(self.home / "xdg override/mcp-services/preferences.json",
                 '{"claude_desktop_remote_services":["figma"]}')
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.home / "claude override/.claude.json").read_text())["mcpServers"]["figma"],
                         {"type": "http", "url": "https://mcp.figma.com/mcp"})
        self.assertEqual(json.loads((self.home / "pi override/mcp.json").read_text())["mcpServers"]["neon"]["exposure"], "deferred")
        self.assertEqual(tomllib.loads((self.home / "codex override/config.toml").read_text())["mcp_servers"]["rea"],
                         {"command": f"{self.home}/.local/bin/rea-mcp", "args": []})
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
        for name in ("chrome_devtools", "Roblox-Studio"):
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
        result = self.run_config("omarchy")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["neon"], {
            "type": "http", "url": "https://mcp.neon.tech/mcp", "headers": {"X-Custom": "keep"}, "timeout": 90})
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["neon"], {
            "url": "https://mcp.neon.tech/mcp", "tool_timeout_sec": 90, "http_headers": {"X-Custom": "keep"}})
        self.assertIn("# keep endpoint comment", self.codex.read_text())

    def test_rea_transport_update_preserves_user_options(self):
        self.put(self.code, '{"mcpServers":{"rea":{"command":"old-rea","args":["old"],"env":{"REA_CUSTOM":"keep"},"timeout":90}}}')
        self.put(self.pi, '{"mcpServers":{"rea":{"command":"old-rea","args":["old"],"env":{"REA_CUSTOM":"keep"},"timeout":90}}}')
        self.put(self.codex, '# REA user options\n[mcp_servers.rea]\ncommand="old-rea"\nargs=["old"]\ntool_timeout_sec=90\n[mcp_servers.rea.env]\nREA_CUSTOM="keep"\n')
        self.put(self.desktop, '{"mcpServers":{"rea":{"command":"old-rea","args":["old"],"env":{"REA_CUSTOM":"keep"}}}}')
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["rea"], {
            "command": f"{self.home}/.local/bin/rea-mcp", "args": [],
            "env": {"REA_CUSTOM": "keep"}, "timeout": 90})
        self.assertEqual(json.loads(self.pi.read_text())["mcpServers"]["rea"], {
            "command": f"{self.home}/.local/bin/rea-mcp", "args": [],
            "description": "Analyze and reverse-engineer binaries with REA.", "exposure": "deferred",
            "env": {"REA_CUSTOM": "keep"}, "timeout": 90})
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["rea"], {
            "command": f"{self.home}/.local/bin/rea-mcp", "args": [],
            "env": {"REA_CUSTOM": "keep"}, "tool_timeout_sec": 90})
        self.assertIn("# REA user options", self.codex.read_text())
        self.assertEqual(json.loads(self.desktop.read_text())["mcpServers"]["rea"], {
            "command": f"{self.home}/.local/bin/rea-mcp", "args": [],
            "env": {"REA_CUSTOM": "keep"}})

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
        self.assertEqual(json.loads(self.code.read_text())["mcpServers"]["rea"],
                         {"command": f"{self.home}/.local/bin/rea-mcp", "args": []})
        self.assertEqual(Path(f"{self.code}.bak").read_text(), '{"theme":"keep"}')
        self.assertEqual(Path(f"{self.codex}.bak").read_text(), '# original\nmodel="gpt-5"\n')
        self.assertFalse(Path(f"{self.code}.bak.1").exists())
        self.assertFalse(Path(f"{self.codex}.bak.1").exists())
        self.assertEqual(self.code.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.codex.stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(f"{self.code}.bak").stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(f"{self.codex}.bak").stat().st_mode & 0o777, 0o600)

    def test_empty_opt_in_list_removes_managed_desktop_remote_entries(self):
        self.put(self.preferences, '{"claude_desktop_remote_services":[]}')
        self.put(self.desktop, json.dumps({"mcpServers": {
            "neon": {"command": f"{self.home}/.local/bin/mcp-service", "args": ["neon"]}}}))
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(json.loads(self.desktop.read_text())["mcpServers"]),
                         {"rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio"})

    def test_preferences_without_opt_in_key_keep_desktop_remotes_disabled(self):
        self.put(self.preferences, '{}')
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(json.loads(self.desktop.read_text())["mcpServers"]),
                         {"rea", "playwriter", "chrome-devtools", "blender", "Roblox_Studio"})

    def test_malformed_preferences_preflight_before_any_write(self):
        self.put(self.preferences, '{broken')
        self.put(self.desktop, '{"mcpServers":{"other":{"command":"keep"}}}')
        original = self.desktop.read_bytes()
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.desktop.read_bytes(), original)
        self.assertFalse(self.code.exists())
        self.assertFalse(self.pi.exists())
        self.assertFalse(self.codex.exists())
        self.assertFalse(list(self.home.rglob("*.bak*")))

    def test_unknown_opt_in_service_preflights_before_any_write(self):
        self.put(self.preferences, '{"claude_desktop_remote_services":["ai-memory"]}')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("must be a list of opt-in service names", result.stderr)
        self.assertFalse(self.code.exists())
        self.assertFalse(self.pi.exists())
        self.assertFalse(self.codex.exists())
        self.assertFalse(self.desktop.exists())

    def test_wrong_opt_in_shape_preflights_before_any_write(self):
        self.put(self.preferences, '{"claude_desktop_remote_services":true}')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("must be a list", result.stderr)
        self.assertFalse(self.code.exists())
        self.assertFalse(self.pi.exists())
        self.assertFalse(self.codex.exists())
        self.assertFalse(self.desktop.exists())

    def test_unknown_preference_key_fails_closed(self):
        self.put(self.preferences, '{"claude_desktop_remote_service":["neon"]}')
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown MCP preference", result.stderr)
        self.assertFalse(self.code.exists())
        self.assertFalse(self.desktop.exists())

    def test_repo_symlinked_preferences_are_read_only(self):
        target = self.home / "repo/preferences.json"
        self.put(target, '{"claude_desktop_remote_services":["neon"]}')
        self.preferences.parent.mkdir(parents=True)
        self.preferences.symlink_to(target)
        original = target.read_bytes()
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.desktop.read_text())["mcpServers"]["neon"],
                         {"command": f"{self.home}/.local/bin/mcp-service", "args": ["neon"]})
        self.assertEqual(target.read_bytes(), original)
        self.assertTrue(self.preferences.is_symlink())

    def test_dangling_preference_symlink_fails_before_any_client_write(self):
        self.preferences.parent.mkdir(parents=True)
        self.preferences.symlink_to(self.home / "missing-preferences.json")
        result = self.run_config()
        self.assertEqual(result.returncode, 1)
        self.assertIn("No such file", result.stderr)
        self.assertFalse(self.code.exists())
        self.assertFalse(self.pi.exists())
        self.assertFalse(self.codex.exists())
        self.assertFalse(self.desktop.exists())

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
sys.argv = [sys.argv[1], "omarchy"]
runpy.run_path(sys.argv[0], run_name="__main__")
'''
        result = subprocess.run([sys.executable, "-c", guard, str(RENDERER)], env=self.env,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(tomllib.loads(self.codex.read_text())["mcp_servers"]["figma"],
                         {"url": "https://mcp.figma.com/mcp"})
        self.assertEqual(json.loads(self.pi.read_text())["mcpServers"]["rea"]["command"],
                         f"{self.home}/.local/bin/rea-mcp")

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

    @unittest.skipUnless(CODEX, "Codex CLI required to verify native config reader")
    def test_real_codex_reads_preserved_upstream_memory_bridge_and_approvals(self):
        self.put(self.codex, '[mcp_servers.ai-memory]\ncommand="/upstream/ai-memory"\n'
                 'args=["mcp-bridge","--server-url","http://127.0.0.1:49374","--no-session-id"]\n'
                 'default_tools_approval_mode="approve"\n'
                 '[mcp_servers.ai-memory.tools.memory_write_page]\napproval_mode="prompt"\n')
        result = self.run_config()
        local = subprocess.run([CODEX, "mcp", "get", "ai-memory", "--json"], env=self.env,
                               cwd=self.home, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(local.returncode, 0, local.stderr)
        memory = json.loads(local.stdout)
        self.assertEqual(memory["transport"]["type"], "stdio")
        self.assertEqual(memory["transport"]["command"], "/upstream/ai-memory")
        self.assertEqual(memory["transport"]["args"],
                         ["mcp-bridge", "--server-url", "http://127.0.0.1:49374", "--no-session-id"])
        preserved = tomllib.loads(self.codex.read_text())["mcp_servers"]["ai-memory"]
        self.assertEqual(preserved["default_tools_approval_mode"], "approve")
        self.assertEqual(preserved["tools"], {"memory_write_page": {"approval_mode": "prompt"}})

    @unittest.skipUnless(CODEX, "Codex CLI required to verify native config reader")
    def test_real_codex_reads_rea_stdio_without_connecting(self):
        result = self.run_config("omarchy")
        local = subprocess.run([CODEX, "mcp", "get", "rea", "--json"], env=self.env,
                               cwd=self.home, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(local.returncode, 0, local.stderr)
        transport = json.loads(local.stdout)["transport"]
        self.assertEqual(transport["type"], "stdio")
        self.assertEqual(transport["command"], f"{self.home}/.local/bin/rea-mcp")
        self.assertEqual(transport["args"], [])


if __name__ == "__main__":
    unittest.main()
