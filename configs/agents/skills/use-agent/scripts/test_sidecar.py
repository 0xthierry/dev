"""Hermetic CLI regression tests; never contact live Herdr, AMQ, or providers.

Run: python3 -B -m unittest discover -s configs/agents/skills/use-agent/scripts -p 'test_*.py'
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('sidecar.sh')
MOCK = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['CALL_LOG'], 'a') as log:
    log.write(json.dumps([name, *args]) + '\n')
if os.environ.get('FAIL_COMMAND') == name + ' ' + ' '.join(args[:2]):
    sys.exit(1)
if name == 'pi':
    print('provider model context max-out thinking images')
    if not os.environ.get('MISSING_MODEL'):
        for provider, model in [('openai-codex','gpt-6-astra'), ('openai-codex','gpt-5.6-sol'), ('xai','grok-4.5'), ('xai','grok-4.6')]:
            print(provider, model, '272K 128K yes yes')
elif name == 'claude':
    print(os.environ.get('CLAUDE_VERSION', '2.1.255 (Claude Code)'))
elif name == 'herdr':
    if args[:2] == ['pane', 'current']:
        print(json.dumps({'result': {'pane': {'pane_id': 'main-pane'}}}))
    elif args[:2] == ['pane', 'split']:
        print(json.dumps({'result': {'pane': {'pane_id': os.environ.get('SPLIT_PANE', 'worker-pane')}}}))
    elif args[:2] == ['pane', 'process-info']:
        print(json.dumps({'result': {'process_info': {'shell_pid': 123, 'foreground_processes': [{'pid': 999 if os.environ.get('BUSY_SHELL') else 123}]}}}))
    elif args[:2] == ['pane', 'get']:
        print(json.dumps({'result': {'pane': {'pane_id': args[2]}}}))
    else:
        print('{}')
elif name == 'amq':
    if 'doctor' in args:
        locks = [{'agent': 'pi-gpt6-astra-1'}] if os.environ.get('WAKE_LOCK') else []
        print('{}' if os.environ.get('BAD_DOCTOR') else json.dumps({'ops': {'wake_locks': locks}}))
    else:
        print('{}')
'''


class SidecarTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.log = self.root / 'calls.jsonl'
        for name in ('herdr', 'amq', 'pi', 'claude'):
            path = self.root / name
            path.write_text(MOCK)
            path.chmod(0o755)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(('AM_', 'AMQ_', 'HERDR_'))}
        self.env.update(PATH=f'{self.root}:{os.environ["PATH"]}', CALL_LOG=str(self.log), HERDR_ENV='1')

    def run_helper(self, command, *args, **env):
        return subprocess.run(['bash', str(SCRIPT), command, '--topic', 'test', '--harness', 'pi', *args],
                              cwd=self.root, env={**self.env, **env}, capture_output=True, text=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_guards_before_external_commands(self):
        for args, env in [
            ([], {'HERDR_ENV': '0'}),
            (['--root', '/other'], {'AM_ROOT': '/bound'}),
            (['--direction', 'left'], {}),
            (['--unknown', 'value'], {}),
        ]:
            with self.subTest(args=args, env=env):
                result = self.run_helper('launch', '--handle', 'pi-gpt6-astra-1', *args, **env)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_init_explicit_roster_and_binding(self):
        result = self.run_helper('init', '--workers', 'pi-gpt6-astra-1,claude-fable51-xhigh-1', AM_ROOT='/bound', AM_ME='actual-main')
        self.assertEqual(result.returncode, 0, result.stderr)
        call = next(c for c in self.calls() if c[:2] == ['amq', 'init'])
        self.assertEqual(call[call.index('--root') + 1], '/bound')
        self.assertEqual(call[call.index('--agents') + 1], 'actual-main,pi-gpt6-astra-1,claude-fable51-xhigh-1')
        self.assertFalse(any(c[0] == 'herdr' for c in self.calls()))

    def test_bad_roster(self):
        for roster in ('pi-gpt6-astra-0', 'unknown-1', 'pi-gpt56-1,pi-gpt56-1', 'pi-gpt56-1,'):
            with self.subTest(roster=roster):
                r = self.run_helper('init', '--workers', roster)
                self.assertNotEqual(r.returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_profiles_and_prompt_quoting(self):
        profiles = [
            ('pi-gpt6-astra-1', 'openai-codex/gpt-6-astra', 'high', True),
            ('pi-gpt56-1', 'openai-codex/gpt-5.6-sol', 'high', False),
            ('pi-grok45-1', 'xai/grok-4.5', 'high', True),
            ('pi-grok46-1', 'xai/grok-4.6', 'high', True),
            ('claude-fable51-xhigh-1', 'claude-fable-5-1', 'xhigh', True),
            ('claude-fable51-high-1', 'claude-fable-5-1', 'high', True),
        ]
        for handle, model, effort, readonly in profiles:
            with self.subTest(handle=handle):
                self.log.unlink(missing_ok=True)
                r = self.run_helper('launch', '--handle', handle, AM_ROOT='/room with spaces', AM_ME='actual-main')
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertIn('WORKER_PANE_ID=worker-pane', r.stdout)
                calls = self.calls()
                split = next(c for c in calls if c[:3] == ['herdr', 'pane', 'split'])
                self.assertEqual(split[split.index('--pane') + 1], 'main-pane')
                command = next(c[-1] for c in calls if c[:3] == ['herdr', 'pane', 'run'])
                # Decode Bash %q using Bash itself, replacing executables with argv capture.
                decoded = subprocess.run(['bash', '-c', 'capture() { printf "%s\\0" "$@"; }; amq() { capture amq "$@"; }; env() { capture env "$@"; }; ' + command], capture_output=True)
                self.assertEqual(decoded.returncode, 0, decoded.stderr)
                argv = decoded.stdout.decode().rstrip('\0').split('\0')
                self.assertEqual(argv[argv.index('--model') + 1], model)
                self.assertEqual(argv[argv.index('--root') + 1], '/room with spaces')
                flag = '--thinking' if handle.startswith('pi-') else '--effort'
                self.assertEqual(argv[argv.index(flag) + 1], effort)
                self.assertIn('actual-main', argv[-1])
                self.assertIn('amq reply', argv[-1])
                self.assertEqual('--tools' in argv, readonly)
                if handle.startswith('pi-'):
                    self.assertIn('AMQ_NOTIFY_ROLE=worker', argv)
                    self.assertEqual(argv[argv.index('--wake-inject-mode') + 1], 'none')
                else:
                    self.assertNotIn('--wake-inject-mode', argv)

    def test_missing_model_does_not_split(self):
        r = self.run_helper('launch', '--handle', 'pi-gpt6-astra-1', MISSING_MODEL='1')
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[:3] == ['herdr', 'pane', 'split'] for c in self.calls()))

    def test_launch_failure_cleans_only_created_pane(self):
        r = self.run_helper('launch', '--handle', 'pi-gpt6-astra-1', FAIL_COMMAND='herdr pane run')
        self.assertNotEqual(r.returncode, 0)
        closes = [c for c in self.calls() if c[:3] == ['herdr', 'pane', 'close']]
        self.assertEqual(closes, [['herdr', 'pane', 'close', 'worker-pane']])

    def test_launch_failure_boundaries(self):
        for command in ('rename', 'report-metadata', 'wait-output', 'process-info'):
            with self.subTest(command=command):
                self.log.unlink(missing_ok=True)
                r = self.run_helper('launch', '--handle', 'pi-gpt6-astra-1', FAIL_COMMAND=f'herdr pane {command}')
                self.assertNotEqual(r.returncode, 0)
                self.assertIn(['herdr', 'pane', 'close', 'worker-pane'], self.calls())
                self.assertFalse(any(c[:3] == ['herdr', 'pane', 'run'] for c in self.calls()))

    def test_bad_split_never_closes_main(self):
        r = self.run_helper('launch', '--handle', 'pi-gpt6-astra-1', SPLIT_PANE='main-pane')
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[:3] == ['herdr', 'pane', 'close'] for c in self.calls()))

    def test_busy_shell_never_receives_launch(self):
        r = self.run_helper('launch', '--handle', 'pi-gpt6-astra-1', BUSY_SHELL='1')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(['herdr', 'pane', 'close', 'worker-pane'], self.calls())
        self.assertFalse(any(c[:3] == ['herdr', 'pane', 'run'] for c in self.calls()))

    def test_old_claude_rejected_before_split(self):
        r = self.run_helper('launch', '--handle', 'claude-fable51-high-1', CLAUDE_VERSION='2.1.254 (Claude Code)')
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[:3] == ['herdr', 'pane', 'split'] for c in self.calls()))

    def test_explicit_target_and_direction(self):
        r = self.run_helper('launch', '--handle', 'pi-gpt56-1', '--target', 'other-pane', '--direction', 'down')
        self.assertEqual(r.returncode, 0, r.stderr)
        split = next(c for c in self.calls() if c[:3] == ['herdr', 'pane', 'split'])
        self.assertEqual(split[split.index('--pane') + 1], 'other-pane')
        self.assertEqual(split[split.index('--direction') + 1], 'down')

    def test_malformed_retirement_diagnostics_fail_closed(self):
        r = self.run_helper('retire', '--handle', 'pi-gpt6-astra-1', '--pane', 'worker-pane', BAD_DOCTOR='1')
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn('RETIRED=true', r.stdout)

    def test_refuse_retiring_main(self):
        r = self.run_helper('retire', '--handle', 'pi-gpt6-astra-1', '--pane', 'main-pane')
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(any(c[:3] == ['herdr', 'pane', 'close'] for c in self.calls()))

    def test_retire_and_remaining_wake_lock(self):
        for lock in ('', '1'):
            with self.subTest(lock=lock):
                self.log.unlink(missing_ok=True)
                r = self.run_helper('retire', '--handle', 'pi-gpt6-astra-1', '--pane', 'worker-pane', WAKE_LOCK=lock)
                self.assertEqual(r.returncode == 0, not bool(lock), r.stderr)
                self.assertIn(['herdr', 'pane', 'close', 'worker-pane'], self.calls())
                self.assertEqual(sum(c[0] == 'amq' and 'doctor' in c for c in self.calls()), 1)


if __name__ == '__main__':
    unittest.main()
