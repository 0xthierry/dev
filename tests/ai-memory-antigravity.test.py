#!/usr/bin/env python3
"""Real pinned upstream MCP, hook and skill writers; no server, real credentials or live home."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HELPER = Path(__file__).resolve().parents[1] / 'configs/ai-memory/antigravity-client.py'
BINARY = Path.home() / '.local/bin/ai-memory'


class AntigravityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name).resolve()
        self.env = {'HOME': str(self.home), 'PATH': os.defpath}
        binary = self.home / '.local/bin/ai-memory'
        binary.parent.mkdir(parents=True)
        binary.symlink_to(BINARY)
        version = subprocess.check_output([binary, '--version'], cwd=self.home, env=self.env, text=True)
        self.assertEqual(version.strip(), 'ai-memory 3.5.1')
        self.config = self.home / '.gemini/config/mcp_config.json'
        self.config.parent.mkdir(parents=True)
        self.hooks = self.config.with_name('hooks.json')

    def configure(self):
        subprocess.run([sys.executable, HELPER], cwd=self.home, env=self.env, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def test_http_refresh_preserves_operator_policy_and_other_hooks(self):
        self.env['AI_MEMORY_AUTH_TOKEN'] = 'fixture-not-a-real-credential'
        self.config.touch()
        custom = {'Stop': [{'command': 'echo keep'}]}
        self.hooks.write_text(json.dumps({'custom': custom}))
        self.configure()
        cfg = json.loads(self.config.read_bytes())
        entry = cfg['mcpServers']['ai-memory']
        self.assertEqual(entry['serverUrl'], 'http://127.0.0.1:49374/mcp')
        entry.update(disabled=True, disabledTools=['memory_delete_page'], headers={'X-Custom': 'keep'})
        cfg['mcpServers']['operator'] = {'command': 'custom'}
        restricted = json.dumps(cfg).encode()
        self.config.write_bytes(restricted)
        first_hooks = self.hooks.read_bytes()
        self.configure()
        self.assertEqual(self.config.read_bytes(), restricted)
        self.assertEqual(self.hooks.read_bytes(), first_hooks)
        hooks = json.loads(first_hooks)
        self.assertEqual(hooks['custom'], custom)
        self.assertIn('SessionStart', hooks['ai-memory'])
        self.assertTrue((self.home / '.gemini/antigravity-cli/skills/ai-memory-retrieval/SKILL.md').is_file())

    def test_unsupported_http_url_only_registration_is_not_reported_as_ready(self):
        self.env['AI_MEMORY_AUTH_TOKEN'] = 'fixture-not-a-real-credential'
        original = json.dumps({'mcpServers': {'ai-memory': {
            'httpUrl': 'http://127.0.0.1:49374/mcp',
            'disabled': True, 'disabledTools': ['memory_delete_page']}}}).encode()
        self.config.write_bytes(original)
        with self.assertRaises(subprocess.CalledProcessError):
            self.configure()
        self.assertEqual(self.config.read_bytes(), original)
        self.assertFalse(self.hooks.exists())

    def test_file_token_is_never_materialized_in_mcp_config(self):
        data = self.home / ('Library/Application Support/ai-memory' if sys.platform == 'darwin'
                            else '.local/share/ai-memory')
        data.mkdir(parents=True)
        token = data / 'fixture-token'
        token.write_text('fixture-token-0123456789abcdef0123456789')
        token.chmod(0o600)
        (data / 'config.toml').write_text(f'[auth]\nbearer_token_file = {json.dumps(str(token))}\n')
        self.configure()
        before = self.config.read_bytes()
        entry = json.loads(before)['mcpServers']['ai-memory']
        self.assertEqual(entry['args'], ['mcp-bridge', '--no-session-id', '--server-url',
                                         'http://127.0.0.1:49374/mcp'])
        self.assertNotIn(token.read_bytes(), before)
        self.configure()
        self.assertEqual(self.config.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
