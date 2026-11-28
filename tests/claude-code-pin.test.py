#!/usr/bin/env python3
"""Offline Omarchy pin regression: real mise activation and account dispatch."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def executable(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('#!/bin/sh\nset -eu\n' + body + '\n')
    path.chmod(0o755)


def claude(path, version):
    executable(path, f'''case "$1" in
      --version) echo '{version} (Claude Code)';;
      --account) echo "$CLAUDE_CONFIG_DIR";;
      *) exit 2;;
    esac''')


class ClaudePinTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='claude-pin-')
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        bin_dir = self.home / 'bin'
        bin_dir.mkdir()
        mise = shutil.which('mise')
        if not mise:
            self.fail('real mise is required for command-wrapper integration tests')
        (bin_dir / 'mise').symlink_to(mise)
        self.native = self.home / '.local/bin/claude'
        self.system = self.home / 'system/conf.d'
        self.system.mkdir(parents=True)
        self.env = dict(HOME=str(self.home), PATH=f'{bin_dir}:{self.native.parent}:/usr/bin:/bin',
                        MISE_SYSTEM_CONFIG_DIR=str(self.system.parent), MISE_OFFLINE='1',
                        SETUP_HOST='omarchy', DRY_RUN='0', INSTALLER=str(ROOT / 'install/ai-cli.sh'))
        # Use a concrete installed release instead of a live registry's latest.
        (self.system / 'omarchy-tools.toml').write_text('''[settings]
system_installs_dir = "~/.local/share/mise/installs"
system_shims_dir = "~/.local/share/mise/shims"
[tools]
claude = "2.1.321"
''')
        self.wrappers = self.system / 'omarchy-agent-accounts.toml'
        self.wrapper_config = '[wrappers.claude]\ncommand = "omarchy-agent-account-exec"\nargs = ["claude"]\n'
        self.wrappers.write_text(self.wrapper_config)
        executable(bin_dir / 'omarchy-agent-account-exec', '''provider=$1; shift
export CLAUDE_CONFIG_DIR="$HOME/test-account"
exec "$provider" "$@"''')
        self.download = self.home / 'download-attempt'
        executable(bin_dir / 'curl', '''touch "$HOME/download-attempt"
exit 22''')
        claude(self.home / '.local/share/mise/installs/claude/2.1.321/claude', '2.1.321')
        self.settings = self.home / '.config/mise/config.toml'
        self.settings.parent.mkdir(parents=True)
        self.settings.write_text('[settings]\ncolor = false\ndisable_tools = ["ruby"]\n')
        subprocess.run(['mise', 'reshim'], env=self.env, cwd=self.home, check=True, timeout=20)

    def shell(self, commands, check=True):
        return subprocess.run(['bash', '--noprofile', '--norc', '-c', '''set -eu
eval "$(mise activate bash)"
eval "$(mise hook-env -s bash)"
''' + commands], env=self.env, cwd=self.home, text=True, capture_output=True, timeout=20, check=check)

    def install(self):
        return self.shell('source "$INSTALLER"; install_claude_code_binary 2.1.296', check=False)

    def test_verified_native_pin_wins_without_redownload_and_keeps_account_wrapper(self):
        claude(self.native, '2.1.296')
        self.assertEqual(self.shell('claude --version').stdout.strip(), '2.1.321 (Claude Code)')

        installed = self.install()

        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertFalse(self.download.exists())
        self.assertEqual(self.shell('claude --version; claude --account').stdout.splitlines(),
                         ['2.1.296 (Claude Code)', str(self.home / 'test-account')])
        self.assertEqual(sorted(json.loads(self.shell('mise settings get disable_tools').stdout)), ['claude', 'ruby'])
        self.assertEqual(self.shell('mise settings get color').stdout.strip(), 'false')
        self.assertEqual(self.wrappers.read_text(), self.wrapper_config)

    def test_installer_reporting_success_with_wrong_native_version_keeps_distro_cli(self):
        claude(self.native, '2.1.295')
        executable(self.home / 'bin/curl', "echo 'exit 0'")

        installed = self.install()

        self.assertNotEqual(installed.returncode, 0, installed.stdout)
        self.assertEqual(json.loads(self.shell('mise settings get disable_tools').stdout), ['ruby'])
        self.assertEqual(self.shell('claude --version').stdout.strip(), '2.1.321 (Claude Code)')

    def test_failed_install_leaves_working_distro_cli_active(self):
        installed = self.install()

        self.assertNotEqual(installed.returncode, 0, installed.stdout)
        self.assertTrue(self.download.exists())
        self.assertEqual(json.loads(self.shell('mise settings get disable_tools').stdout), ['ruby'])
        self.assertEqual(self.shell('claude --version; claude --account').stdout.splitlines(),
                         ['2.1.321 (Claude Code)', str(self.home / 'test-account')])


if __name__ == '__main__':
    unittest.main()
