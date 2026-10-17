#!/usr/bin/env python3
"""Verify hook approvals survive the real agent installer, using an isolated HOME."""
import os
from pathlib import Path
import subprocess
import tempfile
import tomllib
import unittest

REPO_ROOT = Path(__file__).resolve().parents[1]


class CodexHookStateTest(unittest.TestCase):
    def test_preserves_local_state_without_trusting_new_hooks(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config = home / ".codex/config.toml"
            config.parent.mkdir()
            config.write_text('''
[hooks.state."user:SessionStart:0:0"]
trusted_hash = "approved-definition-hash"
enabled = true

[hooks.state."user:Stop:0:0"]
trusted_hash = "disabled-definition-hash"
enabled = false

[hooks.state."user:PreToolUse:0:0"]
enabled = true

[[hooks.SessionStart]]
matcher = "unmanaged-definition"

[hooks.state_extra]
remove_me = true

[mcp_servers.fixture]
command = "fixture-mcp"

[mcp_servers.fixture.env]
FIXTURE = "preserved"

[local_only]
remove_me = true
''')
            env = {**os.environ, "HOME": str(home)}
            command = ["bash", str(REPO_ROOT / "configs/agents/install.sh"), "--yes"]
            subprocess.run(command, env=env, check=True, capture_output=True, text=True)
            first = config.read_text()
            parsed = tomllib.loads(first)
            self.assertEqual(parsed["hooks"], {"state": {
                "user:SessionStart:0:0": {
                    "trusted_hash": "approved-definition-hash", "enabled": True,
                },
                "user:Stop:0:0": {
                    "trusted_hash": "disabled-definition-hash", "enabled": False,
                },
                "user:PreToolUse:0:0": {"enabled": True},
            }})
            self.assertEqual(parsed["mcp_servers"]["fixture"], {
                "command": "fixture-mcp", "env": {"FIXTURE": "preserved"},
            })
            self.assertNotIn("local_only", parsed)

            subprocess.run(command, env=env, check=True, capture_output=True, text=True)
            self.assertEqual(config.read_text(), first)


if __name__ == "__main__":
    unittest.main()
