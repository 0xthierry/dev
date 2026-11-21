#!/usr/bin/env python3
"""Real pinned upstream installers and our one Codex transport adjustment.

Isolated HOME/data/client files. No running server, network, model, GUI, trust
approval, or service changes. Run with the shared MCP runtime's tomlkit Python.
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
BINARY = Path.home() / ".local/lib/ai-memory/ai-memory"


class UpstreamClientsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="upstream-memory-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve() / "home with spaces"
        self.home.mkdir()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("AI_MEMORY_", "XDG_"))
                    and k not in ("CODEX_HOME", "CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR")}
        self.env["HOME"] = str(self.home)
        self.data = self.home / "data"
        self.run_binary("init")

    def run_binary(self, *args):
        result = subprocess.run([str(BINARY), "--data-dir", str(self.data), *args],
                                env=self.env, cwd=self.home, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_upstream_claude_uses_session_identity_desktop_does_not(self):
        self.run_binary("install-mcp", "--client", "claude-code", "--apply")
        self.run_binary("install-mcp", "--client", "claude-desktop", "--apply",
                        "--config-file", str(self.home / "desktop.json"))
        code = json.loads((self.home / ".claude.json").read_text())["mcpServers"]["ai-memory"]
        desktop = json.loads((self.home / "desktop.json").read_text())["mcpServers"]["ai-memory"]
        self.assertEqual(code["args"], ["mcp-bridge", "--server-url", "http://127.0.0.1:49374/mcp",
                                        "--data-dir", str(self.data)])
        self.assertEqual(desktop["args"], ["mcp-bridge", "--no-session-id", "--server-url",
                                           "http://127.0.0.1:49374/mcp", "--data-dir", str(self.data)])
        self.assertEqual(code["command"], str(BINARY))
        self.assertEqual(desktop["command"], str(BINARY))

    def test_codex_bridge_preserves_upstream_approval_policy_and_user_settings(self):
        config = self.home / ".codex/config.toml"
        config.parent.mkdir()
        config.write_text('# keep comment\nmodel = "fixture"\n[mcp_servers.other]\ncommand = "keep"\n')
        self.run_binary("install-mcp", "--client", "codex", "--apply")
        upstream = tomllib.loads(config.read_text())["mcp_servers"]["ai-memory"]
        result = subprocess.run([sys.executable, str(ROOT / "configs/ai-memory/codex-bridge.py")],
                                env=self.env, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        value = tomllib.loads(config.read_text())
        entry = value["mcp_servers"]["ai-memory"]
        self.assertEqual(entry["command"], str(self.home / ".local/bin/ai-memory"))
        self.assertEqual(entry["args"], ["mcp-bridge", "--no-session-id", "--server-url", "http://127.0.0.1:49374/mcp"])
        self.assertEqual(entry["tools"], upstream["tools"])
        self.assertEqual(entry["tools"]["memory_delete_page"]["approval_mode"], "prompt")
        self.assertEqual(entry["default_tools_approval_mode"], "approve")
        self.assertNotIn("bearer_token_env_var", entry)
        self.assertNotIn("url", entry)
        self.assertEqual(value["model"], "fixture")
        self.assertEqual(value["mcp_servers"]["other"], {"command": "keep"})
        self.assertIn("# keep comment", config.read_text())
        before = config.read_bytes(), config.stat().st_mtime_ns
        repeat = subprocess.run([sys.executable, str(ROOT / "configs/ai-memory/codex-bridge.py")],
                                env=self.env, text=True, capture_output=True, timeout=30)
        self.assertEqual(repeat.returncode, 0, repeat.stderr)
        self.assertEqual((config.read_bytes(), config.stat().st_mtime_ns), before)

    def test_upstream_hooks_are_installed_without_custom_launcher_or_token(self):
        self.run_binary("install-hooks", "--agent", "claude-code", "--apply")
        self.run_binary("install-hooks", "--agent", "codex", "--apply")
        for relative in (".claude/settings.json", ".codex/hooks.json"):
            config = json.loads((self.home / relative).read_text())
            hook = config["hooks"]["SessionStart"][0]["hooks"][0]
            self.assertIn(" hook --event session-start --agent ", hook["command"])
            self.assertIn(str(BINARY), hook["command"])
            self.assertNotIn("--auth-token", hook["command"])
            self.assertNotIn("AI_MEMORY_AUTH_TOKEN", hook["command"])
        self.assertEqual((self.data / "auth-token").stat().st_mode & 0o777, 0o600)

    def test_legacy_env_migration_keeps_custom_overrides(self):
        path = self.home / ".config/ai-memory/env"
        path.parent.mkdir(parents=True)
        original = 'AI_MEMORY_EMBEDDING_PROVIDER=openai-compat\nAI_MEMORY_EMBEDDING_MODEL=custom\n'
        path.write_text(original)
        result = subprocess.run([sys.executable, str(ROOT / "configs/ai-memory/retire-env.py")],
                                env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(path.read_text(), original)


if __name__ == "__main__":
    if not BINARY.is_file():
        raise SystemExit("Pinned upstream binary missing; run bash install/ai-memory.sh <host> first")
    unittest.main()
