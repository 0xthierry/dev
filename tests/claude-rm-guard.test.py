#!/usr/bin/env python3
"""Exercise Claude's stdin/exit-code boundary; NEVER execute a supplied command."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HOOK = Path(__file__).resolve().parents[1] / 'configs/agents/hooks/guard-rm.py'
DENIAL = 'Blocked rm: protected or ambiguous deletion target. Use explicit, specific paths after reviewing the deletion.\n'


def invoke(command, cwd='/home/guard-user/project', home='/home/guard-user', tool='Bash'):
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({'tool_name': tool, 'cwd': cwd, 'tool_input': {'command': command}}),
        text=True, capture_output=True, env={**os.environ, 'HOME': home}, timeout=5)


class GuardTests(unittest.TestCase):
    def test_other_tool_is_not_intercepted(self):
        result = invoke('rm -rf /', tool='Other')
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))

    def test_malformed_payload_is_denied(self):
        result = subprocess.run([sys.executable, str(HOOK)], input='{', text=True,
                                capture_output=True, timeout=5)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (2, '', DENIAL))

    def test_macos_home_ancestor_is_protected(self):
        result = invoke('rm -rf /Users/*', cwd='/tmp', home='/Users/guard-user')
        self.assertEqual((result.returncode, result.stdout, result.stderr), (2, '', DENIAL))

    def test_symlink_parent_is_resolved_before_lexical_normalization(self):
        with tempfile.TemporaryDirectory(prefix='rm-guard-') as directory:
            link = Path(directory) / 'link'
            link.symlink_to('/tmp', target_is_directory=True)
            result = invoke(f'rm -rf {link}/..')
        self.assertEqual((result.returncode, result.stdout, result.stderr), (2, '', DENIAL))

    def test_glob_parent_symlink_to_home_is_denied(self):
        with tempfile.TemporaryDirectory(prefix='rm-guard-') as directory:
            home = Path(directory) / 'home'
            home.mkdir()
            (Path(directory) / 'link').symlink_to(home, target_is_directory=True)
            result = invoke(f'rm -rf {directory}/li*/*', home=str(home))
        self.assertEqual((result.returncode, result.stdout, result.stderr), (2, '', DENIAL))

    def test_missing_cwd_cannot_approve_relative_deletion(self):
        result = invoke('rm -rf build', cwd=None)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (2, '', DENIAL))


# Separate named cases preserve a visible command/result specification without
# ever placing the commands in a shell or importing the implementation.
DENIED = {
    'comment_then_rm': 'echo ok # note\nrm -rf ~',
    'root': 'rm -rf /',
    'double_slash_root': 'rm -rf //',
    'if_body': 'if true; then rm -rf "$HOME"; fi',
    'leading_redirect': '2>/dev/null rm -rf "$HOME"',
    'exec_rm': 'exec rm -rf "$HOME"',
    'timed_rm': 'time rm -rf /',
    'while_body': 'while true; do rm -rf "$HOME"; done',
    'redirect_before_target': 'rm -rf 2>/dev/null "$HOME"',
    'nonrecursive_home_glob': 'rm -f ~/*',
    'nonrecursive_cd_glob': 'cd ~ && rm *',
    'subshell_glob': '(cd /tmp); rm -rf *',
    'root_home': 'rm -Rf /root',
    'home': 'rm --recursive --force /home/guard-user',
    'ancestor': 'rm -fr /home',
    'root_glob': 'rm -rf /*',
    'home_glob': 'rm -rf "$HOME"/*',
    'hidden_glob': 'rm -rf ~/.*',
    'brace_glob': 'rm -rf ~/{*,.*}',
    'quoted_home': 'rm -rf "$HOME"',
    'braced_home': 'rm -rf "${HOME}/"',
    'quoted_tilde': 'rm -rf "~"',
    'multi_target': 'rm -rf node_modules /home/guard-user',
    'absolute_rm': '/bin/rm -rf /',
    'sudo': 'sudo -n -u root /usr/bin/rm -rf /root',
    'sudo_combined': 'sudo /bin/rm -frv /',
    'git_then_rm': 'git status && rm -rf /',
    'newline': 'echo ready\nrm -rf /',
    'cd_home': 'cd "$HOME" && rm -rf .',
    'cd_root': 'cd / && rm -rf *',
    'cd_parent': 'cd /tmp && rm -rf ..',
    'relative_parent': 'rm -rf ..',
    'computed_target': 'rm -rf "$TARGET"',
    'substitution_target': 'rm -rf "$(pwd)"',
    'backtick_target': 'rm -rf `pwd`',
    'computed_cwd': 'cd "$TARGET" && rm -rf .',
    'failed_cd_path': 'cd /tmp || rm -rf .',
    'unchecked_cd': 'cd /tmp; rm -rf .',
    'subshell_cwd': '(cd /tmp); rm -rf .',
    'changed_home': 'HOME=/; rm -rf "$HOME/home"',
    'prefixed_home': 'HOME=/ rm -rf "$HOME/home"',
    'sudo_cwd': 'sudo -D / rm -rf .',
    'env_wrapper': 'env HOME=/ rm -rf .',
    'glob_ancestor': 'rm -rf /home/*/..',
    'option_terminator': 'rm -r -- /',
}
ALLOWED = {
    'scoped_parent_glob': 'rm -rf packages/*/dist',
    'scoped_home_files': 'rm -f ~/scratch-*.log',
    'quoted_hash_target': 'rm -rf "#" /tmp/build',
    'node_modules': 'rm -rf node_modules',
    'tmp_build': 'rm -rf /tmp/build',
    'home_subdir': 'rm -rf "$HOME/project/build"',
    'tilde_subdir': 'rm -rf ~/project/build',
    'specific_glob': 'rm -rf "$HOME/project"/*',
    'cd_tmp': 'cd /tmp && rm -rf build',
    'cd_tmp_contents': 'cd /tmp && rm -rf *',
    'sudo_normal': 'sudo -n rm -rf /tmp/build',
    'unrelated_sudo': 'sudo systemctl status docker',
    'sudo_git': 'sudo git rm -rf directory',
    'echo_redirect': 'echo "rm -rf /" >/tmp/log',
    'printf': 'printf "%s" "rm -rf /"',
    'git': 'git rm -rf directory',
    'echo': 'echo "rm -rf /"',
    'echo_words': 'echo rm -rf /',
    'nonrecursive': 'rm /tmp/file',
    'force_file': 'rm -f some-file',
    'nonrecursive_subdir_glob': 'rm -f ~/project/*',
    'redirect_safe_target': 'rm -rf /tmp/build 2>/dev/null',
    'comment': 'echo safe # rm -rf /',
    'terminator_filename': 'rm -- -rf /tmp/file',
}


def case(command, expected):
    def test(self):
        result = invoke(command)
        self.assertEqual((result.returncode, result.stdout, result.stderr), expected, command)
    return test


for name, command in DENIED.items():
    setattr(GuardTests, 'test_denies_' + name, case(command, (2, '', DENIAL)))
for name, command in ALLOWED.items():
    setattr(GuardTests, 'test_allows_' + name, case(command, (0, '', '')))


if __name__ == '__main__':
    unittest.main()
