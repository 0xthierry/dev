#!/usr/bin/env python3
"""Trial integration tests: real private filesystem, fake external macOS tools."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('trial', ROOT / 'scripts/claude_snapshot_proxy_trial.py')
trial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trial)


class TrialTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name) / 'home with spaces'
        self.home.mkdir()
        self.root = Path(temporary.name) / 'repo'
        pin_dir = self.root / 'configs/claude-desktop-patch'
        pin_dir.mkdir(parents=True)
        release = json.loads((ROOT / 'configs/claude-desktop-patch/release.json').read_text())
        release['code_bundles']['arm64']['executable_sha256'] = hashlib.sha256(b'vendor engine').hexdigest()
        (pin_dir / 'release.json').write_text(json.dumps(release))
        shutil.copy2(ROOT / 'configs/claude-desktop-patch/manifest.json', pin_dir / 'manifest.json')
        source = self.root / 'configs/claude-snapshot-proxy'
        source.mkdir()
        (source / 'go.mod').write_text('module fixture\n')
        (source / 'proxy.go').write_text('package main\n')
        self.addCleanup(patch.stopall)
        patch.object(trial.platform, 'system', return_value='Darwin').start()
        patch.object(trial.platform, 'machine', return_value='arm64').start()
        self.app = self.home / 'Applications/Claude.app'
        (self.app / 'Contents').mkdir(parents=True)
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleShortVersionString': '4.23118.1', 'CFBundleIdentifier': 'com.anthropic.claudefordesktop'}))
        self.subject = trial.Trial(self.home, self.app, self.root)
        self.subject.binary.parent.mkdir(parents=True)
        self.subject.binary.write_bytes(b'vendor engine')
        self.subject.binary.chmod(0o751)
        os.utime(self.subject.binary, (1700000000, 1700000000))
        (self.subject.slot / '.verified').write_text(self.subject.bundle['sha256'])
        self.subject.link.parent.mkdir(parents=True)
        self.subject.link.symlink_to(self.subject.binary)
        self.processes = ''
        self.bad_signature = False
        self.build_environment = None
        patch.object(trial, 'run', side_effect=self.external).start()

    def external(self, args, **kwargs):
        if args[0] == '/bin/ps':
            if args != ['/bin/ps', '-axo', 'pid=,comm=']:
                raise AssertionError('Process enumeration must collect executable names only')
            return subprocess.CompletedProcess(args, 0, stdout=self.processes)
        if args[0] == '/usr/bin/codesign':
            if self.bad_signature:
                raise subprocess.CalledProcessError(1, args)
            return subprocess.CompletedProcess(args, 0, stderr='TeamIdentifier=Q6L2SF6YDW\n')
        if args[0] == '/usr/bin/ditto':
            shutil.copytree(args[1], args[2], copy_function=shutil.copy2)
            return subprocess.CompletedProcess(args, 0)
        if args[:2] == ['go', 'version']:
            return subprocess.CompletedProcess(args, 0, stdout='go version go1.27.3 darwin/arm64\n')
        if args[:2] == ['go', 'build']:
            self.build_environment = kwargs['env']
            Path(args[args.index('-o') + 1]).write_bytes(b'native proxy')
            return subprocess.CompletedProcess(args, 0)
        raise AssertionError(args)

    def test_install_and_restore_preserve_vendor_metadata_link_and_evidence(self):
        self.assertEqual(self.subject.change('install'), 'proxy')
        self.assertEqual(self.subject.link.read_bytes(), b'native proxy')
        self.assertEqual((self.subject.backup / trial.ENGINE).read_bytes(), b'vendor engine')
        self.assertEqual(self.subject.binary.stat().st_mode & 0o777, 0o751)
        self.assertEqual(self.build_environment['GOPROXY'], 'off')
        self.assertEqual(self.build_environment['GOTOOLCHAIN'], 'local')
        self.assertEqual(self.build_environment['GOSUMDB'], 'off')
        record = self.subject.record.read_bytes()
        self.assertEqual(self.subject.change('restore'), 'original')
        self.assertEqual(self.subject.link.read_bytes(), b'vendor engine')
        self.assertEqual(self.subject.binary.stat().st_mtime, 1700000000)
        self.assertEqual(self.subject.record.read_bytes(), record)
        self.assertEqual(self.subject.proxy.read_bytes(), b'native proxy')

    def test_install_is_idempotent(self):
        self.subject.change('install')
        before = self.subject.record.read_bytes()
        self.assertEqual(self.subject.change('install'), 'proxy')
        self.assertEqual(self.subject.record.read_bytes(), before)
        self.assertEqual(self.subject.binary.read_bytes(), b'native proxy')

    def test_restore_is_idempotent_without_deleting_state(self):
        self.subject.change('install')
        self.subject.change('restore')
        self.assertEqual(self.subject.change('restore'), 'original')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')
        self.assertEqual(json.loads(self.subject.record.read_text())['schema'], 1)

    def test_unknown_initial_bytes_refuse_before_state_creation(self):
        self.subject.binary.write_bytes(b'unknown')
        with self.assertRaisesRegex(RuntimeError, 'Unknown managed'):
            self.subject.change('install')
        self.assertEqual(self.subject.binary.read_bytes(), b'unknown')
        self.assertFalse(self.subject.state.exists())

    def test_unknown_bytes_after_install_refuse_restore(self):
        self.subject.change('install')
        self.subject.binary.write_bytes(b'unknown')
        with self.assertRaisesRegex(RuntimeError, 'Unknown managed'):
            self.subject.change('restore')
        self.assertEqual(self.subject.binary.read_bytes(), b'unknown')
        self.assertEqual((self.subject.backup / trial.ENGINE).read_bytes(), b'vendor engine')

    def test_running_desktop_refuses_before_mutation(self):
        self.processes = '12 /Applications/Claude.app/Contents/MacOS/Claude\n'
        with self.assertRaisesRegex(RuntimeError, 'No processes were stopped'):
            self.subject.change('install')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')
        self.assertFalse(self.subject.state.exists())

    def test_running_basename_claude_refuses_restore(self):
        self.subject.change('install')
        self.processes = '14 claude\n'
        with self.assertRaisesRegex(RuntimeError, 'No processes were stopped'):
            self.subject.change('restore')
        self.assertEqual(self.subject.binary.read_bytes(), b'native proxy')

    def test_browser_native_host_does_not_block(self):
        self.processes = '15 /Applications/Claude.app/Contents/Helpers/chrome-native-host\n'
        self.assertEqual(self.subject.change('install'), 'proxy')
        self.assertEqual(self.subject.link.read_bytes(), b'native proxy')

    def test_helper_exemption_does_not_hide_desktop_and_engines(self):
        self.processes = ('15 /Applications/Claude.app/Contents/Helpers/chrome-native-host\n'
                          '16 /Applications/Claude.app/Contents/MacOS/Claude\n'
                          '17 /private/engine/claude.app/Contents/MacOS/claude\n'
                          '18 claude\n'
                          '19 /Applications/Claude.app/Contents/Helpers/chrome-native-host-other\n')
        self.assertEqual(trial.running_processes(), [16, 17, 18, 19])
        with self.assertRaisesRegex(RuntimeError, 'No processes were stopped'):
            self.subject.change('install')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')
        self.assertFalse(self.subject.state.exists())

    def test_unexpected_go_source_refuses_install(self):
        (self.root / 'configs/claude-snapshot-proxy/extra.go').write_text('package main\n')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected production Go inputs'):
            self.subject.change('install')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')
        self.assertFalse(self.subject.record.exists())

    def test_new_go_source_does_not_block_restore(self):
        self.subject.change('install')
        (self.root / 'configs/claude-snapshot-proxy/extra.go').write_text('package main\n')
        self.assertEqual(self.subject.change('restore'), 'original')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')

    def test_interrupted_before_swap_manifest_supports_restore(self):
        original_copy = trial.atomic_copy
        def crash(source, target):
            if target == self.subject.binary:
                raise OSError('interrupted before swap')
            original_copy(source, target)
        with patch.object(trial, 'atomic_copy', side_effect=crash):
            with self.assertRaisesRegex(OSError, 'interrupted'):
                self.subject.change('install')
        self.assertEqual(json.loads(self.subject.record.read_text())['proxy_sha256'], hashlib.sha256(b'native proxy').hexdigest())
        self.assertEqual(self.subject.change('restore'), 'original')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')

    def test_interrupted_after_swap_is_recognized_and_restorable(self):
        original_copy = trial.atomic_copy
        def crash(source, target):
            original_copy(source, target)
            if target == self.subject.binary:
                raise OSError('interrupted after swap')
        with patch.object(trial, 'atomic_copy', side_effect=crash):
            with self.assertRaisesRegex(OSError, 'interrupted'):
                self.subject.change('install')
        self.assertEqual(self.subject.status()['status'], 'proxy')
        self.assertEqual(self.subject.change('restore'), 'original')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')

    def test_interrupted_backup_preparation_is_reused(self):
        with patch.object(self.subject, 'source_hashes', side_effect=OSError('interrupted')):
            with self.assertRaisesRegex(OSError, 'interrupted'):
                self.subject.change('install')
        self.assertEqual((self.subject.backup / trial.ENGINE).read_bytes(), b'vendor engine')
        self.assertEqual(self.subject.change('install'), 'proxy')
        self.assertEqual(self.subject.binary.read_bytes(), b'native proxy')

    def test_bad_signature_refuses_before_state_creation(self):
        self.bad_signature = True
        with self.assertRaises(subprocess.CalledProcessError):
            self.subject.change('install')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')
        self.assertFalse(self.subject.state.exists())

    def test_marker_mismatch_refuses_before_mutation(self):
        (self.subject.slot / '.verified').write_text('wrong')
        with self.assertRaisesRegex(RuntimeError, 'marker mismatch'):
            self.subject.change('install')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')

    def test_wrong_shared_link_refuses_before_mutation(self):
        self.subject.link.unlink()
        self.subject.link.symlink_to(self.subject.binary.parent / 'different')
        with self.assertRaisesRegex(RuntimeError, 'Shared CLI symlink'):
            self.subject.change('install')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')

    def test_changed_sources_do_not_block_rollback(self):
        self.subject.change('install')
        (self.root / 'configs/claude-snapshot-proxy/proxy.go').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'source differs'):
            self.subject.change('install')
        self.assertEqual(self.subject.change('restore'), 'original')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')

    def test_wrong_desktop_version_refuses_before_mutation(self):
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleShortVersionString': '99', 'CFBundleIdentifier': 'com.anthropic.claudefordesktop'}))
        with self.assertRaisesRegex(RuntimeError, 'exact version'):
            self.subject.change('install')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')
        self.assertFalse(self.subject.state.exists())

    def test_tampered_backup_refuses_restore(self):
        self.subject.change('install')
        (self.subject.backup / trial.ENGINE).write_bytes(b'tampered backup')
        with self.assertRaisesRegex(RuntimeError, 'Original engine checksum'):
            self.subject.change('restore')
        self.assertEqual(self.subject.binary.read_bytes(), b'native proxy')

    def test_non_macos_refuses(self):
        with patch.object(trial.platform, 'system', return_value='Linux'):
            with self.assertRaisesRegex(RuntimeError, 'macOS-only'):
                trial.Trial(self.home, self.app, self.root)
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')
        self.assertFalse(self.subject.state.exists())

    def test_contending_trial_refuses_mutation(self):
        with self.subject.lock():
            with self.assertRaises(BlockingIOError):
                self.subject.change('install')
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')
        self.assertFalse(self.subject.record.exists())

    def test_status_is_read_only(self):
        self.assertEqual(self.subject.status()['status'], 'original')
        self.assertFalse(self.subject.state.exists())
        self.assertEqual(self.subject.binary.read_bytes(), b'vendor engine')


if __name__ == '__main__':
    unittest.main()
