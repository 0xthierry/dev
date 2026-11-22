#!/usr/bin/env python3
"""Real mise settings and offline activation, using only an isolated HOME."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MISE = shutil.which('mise')


@unittest.skipUnless(MISE, 'mise required for real offline activation coverage')
class RetiredToolsTest(unittest.TestCase):
    def test_preserves_configuration_and_disables_lazy_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            config = home / '.config/mise'
            config.mkdir(parents=True)
            vendor = home / 'system'
            (vendor / 'conf.d').mkdir(parents=True)
            vendor_file = vendor / 'conf.d/omarchy-agent-accounts.toml'
            original = '# User-owned settings\n[settings]\ndisable_tools = ["ruby"]\nverbose = false\n'
            (config / 'config.toml').write_text(original)
            override = '# Keep this comment\n[settings]\nexperimental = false\n'
            (config / 'config.override.toml').write_text(override)
            vendor_text = '[tools]\n' + ''.join(
                f'{name} = {{ version = "1.0.0", lazy = true, lazy_bins = ["{name}"] }}\n'
                for name in ['amp', 'cursor-agent', 'grok', 'opencode'])
            vendor_text += 'node = "path:' + str(home / 'node') + '"\n'
            vendor_text += '\n[wrappers.grok]\ncommand = "' + str(home / 'account-manager') + '"\nargs = ["grok"]\n'
            vendor_text += '\n[wrappers.retained]\ncommand = "/bin/echo"\nargs = ["retained-wrapper"]\n'
            vendor_file.write_text(vendor_text)
            manager = home / 'account-manager'
            manager.write_text('#!/bin/sh\nprintf "invoked" > "$HOME/account-manager-called"\n')
            manager.chmod(0o755)
            (home / 'node/bin').mkdir(parents=True)
            node = home / 'node/bin/node'
            node.write_text('#!/bin/sh\necho retained-node\n')
            node.chmod(0o755)
            env = {key: value for key, value in os.environ.items()
                   if not key.startswith(('MISE_', 'XDG_'))}
            env.update(HOME=str(home), XDG_CONFIG_HOME=str(home / '.config'),
                       XDG_DATA_HOME=str(home / '.local/share'),
                       XDG_CACHE_HOME=str(home / '.cache'),
                       XDG_STATE_HOME=str(home / '.local/state'),
                       XDG_RUNTIME_DIR=str(home / 'runtime'),
                       XDG_CONFIG_DIRS=str(home / 'config-dirs'),
                       XDG_DATA_DIRS=str(home / 'data-dirs'),
                       MISE_SYSTEM_CONFIG_DIR=str(vendor), MISE_OFFLINE='1',
                       MISE_TRUSTED_CONFIG_PATHS=str(home),
                       PATH=str(Path(MISE).parent) + ':/usr/bin:/bin')

            def run(*args):
                return subprocess.check_output(args, env=env, cwd=home, text=True)

            helper = str(ROOT / 'install/retired-ai-tools.sh')
            before = run(MISE, 'ls', '--json')
            self.assertEqual(set(json.loads(before)), {'amp', 'cursor-agent', 'grok', 'opencode', 'node'})
            run('bash', '-c', 'eval "$(mise activate bash)"; grok')
            self.assertEqual((home / 'account-manager-called').read_text(), 'invoked')
            (home / 'account-manager-called').unlink()
            self.assertIn('[dry-run]', run('bash', helper, '--dry-run'))
            self.assertEqual((config / 'config.override.toml').read_text(), override)
            run('bash', helper)
            self.assertEqual(json.loads(run(MISE, 'settings', 'get', 'disable_tools')),
                             ['amp', 'cursor-agent', 'grok', 'opencode', 'ruby'])
            self.assertEqual((config / 'config.toml').read_text(), original)
            self.assertEqual(vendor_file.read_text(), vendor_text)
            updated = (config / 'config.override.toml').read_text()
            self.assertIn('# Keep this comment', updated)
            self.assertIn('experimental = false', updated)
            run('bash', helper)
            self.assertEqual((config / 'config.override.toml').read_text(), updated)
            self.assertEqual(set(json.loads(run(MISE, 'ls', '--json'))), {'node'})
            activated = run('bash', '-c', 'eval "$(mise activate bash)"; eval "$(mise hook-env -s bash)"; node')
            self.assertEqual(activated.strip(), 'retained-node')
            # Activation still creates a grok wrapper: it must fail closed rather
            # than dispatching the distro account manager or installing anything.
            wrapped = run('bash', '-c', 'eval "$(mise activate bash)"; grok ignored; result=$?; retained ok; printf "grok-status=%s\\n" "$result"')
            self.assertEqual(wrapped, 'retained-wrapper ok\ngrok-status=1\n')
            self.assertFalse((home / 'account-manager-called').exists())
            self.assertEqual(run('bash', '-c', 'eval "$(mise activate bash --shims)"; grok; result=$?; retained ok; printf "grok-status=%s\\n" "$result"'),
                             'retained-wrapper ok\ngrok-status=1\n')
            self.assertFalse((home / 'account-manager-called').exists())
            self.assertFalse((home / '.local/share/mise/installs/grok').exists())
            project = home / 'project'
            project.mkdir()
            (project / 'mise.toml').write_text('[wrappers]\ngrok = "' + str(manager) + '"\n')
            project_result = subprocess.run(['bash', '-c', 'eval "$(mise activate bash)"; grok'],
                                            env=env, cwd=project, capture_output=True, text=True)
            self.assertEqual(project_result.returncode, 1)
            self.assertFalse((home / 'account-manager-called').exists())
            self.assertNotIn('/installs/grok/', run(MISE, 'env', '--json'))
            # Setup's baseline replacement must not undo the opt-out or drop ruby.
            run('bash', '-c', 'source "$1"; write_mise_config', '_', str(ROOT / 'install/mise.sh'))
            self.assertEqual(json.loads(run(MISE, 'settings', 'get', 'disable_tools')),
                             ['amp', 'cursor-agent', 'grok', 'opencode', 'ruby'])
            self.assertEqual((config / 'config.override.toml').read_text(), updated)
            # Refuse to overwrite a user's unrelated Grok wrapper, before writing.
            custom = updated.replace('grok = "/usr/bin/false"', 'grok = "/bin/echo"')
            self.assertNotEqual(custom, updated)
            (config / 'config.override.toml').write_text(custom)
            refused = subprocess.run(['bash', helper], env=env, cwd=home, capture_output=True, text=True)
            self.assertEqual(refused.returncode, 1)
            self.assertIn('not owned by this helper', refused.stderr)
            self.assertEqual((config / 'config.override.toml').read_text(), custom)
            # Without the distro wrapper, do not create or replace a Grok wrapper.
            vendor_file.unlink()
            run('bash', helper)
            self.assertEqual((config / 'config.override.toml').read_text(), custom)
            (config / 'config.override.toml').write_text(override)
            run('bash', helper)
            self.assertNotIn('wrappers', (config / 'config.override.toml').read_text())


if __name__ == '__main__':
    unittest.main()
