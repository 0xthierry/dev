#!/usr/bin/env python3
"""Remote client boundary checks in isolated homes; no network or real services."""
import json
import os
import shlex
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "configs/ai-memory/client.py"


class RemoteClientTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="memory-remote-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / "home with spaces"
        self.home.mkdir()
        self.env = {**os.environ, "HOME": str(self.home)}
        self.key = "aim_" + "machinefixturekey" * 3
        self.key_path = self.home / ".config/ai-memory/api-key"
        self.key_path.parent.mkdir(parents=True)
        self.key_path.write_text(self.key + "\n")
        self.key_path.chmod(0o600)
        self.marker = self.key_path.with_name("client.json")
        self.data = self.home / ".local/share/ai-memory-client"

    def run_client(self, *args):
        return subprocess.run([sys.executable, str(CLIENT), *args], env=self.env,
                              capture_output=True, text=True, timeout=20)

    def test_configure_writes_file_reference_and_preserves_local_memory(self):
        old = self.home / ".local/share/ai-memory/wiki/local.md"
        old.parent.mkdir(parents=True)
        old.write_text("old memory must remain untouched")
        result = self.run_client("configure")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.marker.read_text()), {
            "server_url": "https://ai-memory-cloud.tail4e339.ts.net"})
        config = tomllib.loads((self.data / "config.toml").read_text())
        self.assertEqual(config, {"server_url": "https://ai-memory-cloud.tail4e339.ts.net",
                                 "embedding_provider": "none", "data_dir": str(self.data),
                                 "auth": {"bearer_token_file": str(self.key_path)}})
        self.assertEqual(old.read_text(), "old memory must remain untouched")
        self.assertNotIn(self.key, result.stdout + result.stderr + (self.data / "config.toml").read_text())
        self.assertEqual((self.data / "config.toml").stat().st_mode & 0o777, 0o600)
        before = self.marker.stat().st_mtime_ns, (self.data / "config.toml").stat().st_mtime_ns
        repeated = self.run_client("configure")
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assertEqual((self.marker.stat().st_mtime_ns, (self.data / "config.toml").stat().st_mtime_ns), before)

    def test_missing_key_fails_before_publishing_remote_marker(self):
        self.key_path.unlink()
        result = self.run_client("configure")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.marker.exists())
        self.assertFalse(self.data.exists())

    def test_root_bearer_is_refused_and_never_logged(self):
        secret = "a" * 64
        self.key_path.write_text(secret)
        result = self.run_client("configure")
        self.assertEqual(result.returncode, 1)
        self.assertIn("native user key", result.stderr)
        self.assertNotIn(secret, result.stdout + result.stderr)
        self.assertFalse(self.marker.exists())

    def test_group_readable_key_is_refused(self):
        self.key_path.chmod(0o640)
        result = self.run_client("configure")
        self.assertEqual(result.returncode, 1)
        self.assertIn("0600", result.stderr)
        self.assertFalse(self.marker.exists())

    def test_symlink_key_is_refused(self):
        target = self.key_path.with_name("target")
        self.key_path.rename(target)
        self.key_path.symlink_to(target)
        result = self.run_client("configure")
        self.assertEqual(result.returncode, 1)
        self.assertIn("regular file", result.stderr)
        self.assertEqual(target.read_text(), self.key + "\n")

    def test_missing_or_invalid_remote_marker_never_falls_back_to_localhost(self):
        missing = self.run_client("status")
        self.assertEqual(missing.returncode, 1)
        self.marker.write_text('{"server_url":"http://127.0.0.1:49374"}')
        invalid = self.run_client("status")
        self.assertEqual(invalid.returncode, 1)
        self.assertIn("HTTPS Tailscale origin", invalid.stderr)

    def test_other_tailnet_origin_is_refused_before_reading_the_key(self):
        self.marker.write_text('{"server_url":"https://unrelated.tail4e339.ts.net"}')
        self.key_path.unlink()
        result = self.run_client("status")
        self.assertEqual(result.returncode, 1)
        self.assertIn("configured deployment origin", result.stderr)
        self.assertNotIn("api-key", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_launcher_targets_remote_with_canonical_key_not_ambient_root(self):
        self.assertEqual(self.run_client("configure").returncode, 0)
        binary = self.data / "bin/ai-memory"
        binary.parent.mkdir()
        binary.write_text(f'#!{sys.executable}\nimport json,os,sys\nprint(json.dumps({{"args":sys.argv[1:],"url":os.environ["AI_MEMORY_SERVER_URL"],"key":os.environ["AI_MEMORY_AUTH_TOKEN"],"embedding":os.environ["AI_MEMORY_EMBEDDING_PROVIDER"],"old_llm":os.environ.get("AI_MEMORY_LLM_PROVIDER")}}))\n')
        binary.chmod(0o755)
        self.env.update(AI_MEMORY_AUTH_TOKEN="old-root-never-use", AI_MEMORY_SERVER_URL="http://127.0.0.1:49374",
                        AI_MEMORY_LLM_PROVIDER="old-provider", AI_MEMORY_EMBEDDING_PROVIDER="openai")
        result = self.run_client("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            "args": ["--data-dir", str(self.data), "--config", str(self.data / "config.toml"), "status"],
            "url": "https://ai-memory-cloud.tail4e339.ts.net", "key": self.key,
            "embedding": "none", "old_llm": None})

    def test_generated_hooks_use_launcher_and_preserve_unrelated_hooks(self):
        path = self.home / ".claude/settings.json"
        path.parent.mkdir()
        generated = shlex.join([str(self.data / "bin/ai-memory"), "--data-dir", str(self.data),
                                "hook", "--event", "session-start", "--agent", "claude-code",
                                "--server-url", "https://ai-memory-cloud.tail4e339.ts.net"])
        path.write_text(json.dumps({"theme": "keep", "hooks": {"SessionStart": [{"hooks": [
            {"type": "command", "command": generated},
            {"type": "command", "command": "user-owned --keep"}]}]}}))
        result = self.run_client("route-hooks")
        self.assertEqual(result.returncode, 0, result.stderr)
        hooks = json.loads(path.read_text())
        self.assertEqual(hooks["theme"], "keep")
        self.assertEqual(shlex.split(hooks["hooks"]["SessionStart"][0]["hooks"][0]["command"]), [
            str(self.home / ".local/bin/ai-memory"), "hook", "--event", "session-start", "--agent", "claude-code",
            "--server-url", "https://ai-memory-cloud.tail4e339.ts.net"])
        self.assertEqual(hooks["hooks"]["SessionStart"][0]["hooks"][1],
                         {"type": "command", "command": "user-owned --keep"})

    def test_auth_header_reads_rotated_key_without_rewriting_pi_config(self):
        self.assertEqual(self.run_client("configure").returncode, 0)
        initial = self.run_client("auth-header")
        self.assertEqual(initial.stdout, "Bearer " + self.key + "\n")
        rotated = "aim_" + "replacementfixture" * 3
        self.key_path.write_text(rotated)
        second = self.run_client("auth-header")
        self.assertEqual(second.stdout, "Bearer " + rotated + "\n")


if __name__ == "__main__":
    unittest.main()
