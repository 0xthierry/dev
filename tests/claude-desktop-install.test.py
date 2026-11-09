#!/usr/bin/env python3
"""Installer policy/lifecycle tests; private files only, no account or app access."""
import importlib.util
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

installer = load('claude_desktop_snapshot_install')
code = load('claude_desktop_code_install')

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.library = self.home / 'Library/Application Support/Claude-3p/configLibrary'

    def test_fresh_update_pin_is_repeatable(self):
        installer.pin_desktop_updates(self.home)
        before = {p.name: p.read_bytes() for p in self.library.iterdir()}
        installer.pin_desktop_updates(self.home)
        self.assertEqual({p.name: p.read_bytes() for p in self.library.iterdir()}, before)
        meta = json.loads((self.library / '_meta.json').read_text())
        self.assertEqual(json.loads((self.library / (meta['appliedId'] + '.json')).read_text()), {'disableAutoUpdates': True})

    def test_selected_provider_and_other_entries_are_preserved(self):
        self.library.mkdir(parents=True)
        selected = str(uuid.uuid4())
        meta = {'appliedId': selected, 'entries': [{'id': selected, 'name': 'Keep my provider'}], 'futureField': 7}
        original = {'provider': 'fixture-provider', 'region': 'fixture-region', 'disableAutoUpdates': False}
        (self.library / '_meta.json').write_text(json.dumps(meta))
        profile = self.library / (selected + '.json')
        profile.write_text(json.dumps(original))
        installer.pin_desktop_updates(self.home)
        self.assertEqual(json.loads((self.library / '_meta.json').read_text()), meta)
        self.assertEqual(json.loads(profile.read_text()), {**original, 'disableAutoUpdates': True})
        backups = list(self.library.glob('*.backup-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text()), original)

    def test_hybrid_bootstrap_refuses_instead_of_claiming_ineffective_pin(self):
        self.library.mkdir(parents=True)
        path = self.library / '_meta.json'
        path.write_text('{"hybridPointer":{"fixture":true},"entries":[]}')
        before = path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'hybrid bootstrap'):
            installer.pin_desktop_updates(self.home)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual([p.name for p in self.library.iterdir()], ['_meta.json'])

    def test_invalid_selected_path_refuses_without_writes(self):
        self.library.mkdir(parents=True)
        path = self.library / '_meta.json'
        path.write_text('{"appliedId":"../../elsewhere"}')
        before = path.read_bytes()
        with self.assertRaises(ValueError): installer.pin_desktop_updates(self.home)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual([p.name for p in self.library.iterdir()], ['_meta.json'])

    def test_running_process_guard_includes_app_and_code_not_similar_names(self):
        output = '11 /Applications/Claude.app/Contents/MacOS/Claude\n12 /tmp/claude-code/2.1.321/claude\n13 /Applications/Claude.app-other/Contents/MacOS/Claude\n'
        with patch.object(installer, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=output)):
            self.assertEqual(installer.running_processes(Path('/Applications/Claude.app')), [
                '11 /Applications/Claude.app/Contents/MacOS/Claude', '12 /tmp/claude-code/2.1.321/claude'])
            with self.assertRaisesRegex(RuntimeError, 'No processes were stopped'):
                installer.require_stopped(Path('/Applications/Claude.app'))

    @unittest.skipUnless(platform.system() == 'Darwin', 'macOS installer CLI')
    def test_install_is_blocked_before_state_creation(self):
        state = self.home / 'state'
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/claude_desktop_snapshot_install.py'), 'install', '--app', str(self.home / 'Claude.app'), '--state', str(state)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('PATCH DEPLOYMENT BLOCKED', result.stderr)
        self.assertFalse(state.exists())

    def test_active_process_refusal_precedes_fresh_vendor_install(self):
        with patch.object(installer, 'require_stopped', side_effect=RuntimeError('active')), patch.object(installer, 'run') as calls:
            with self.assertRaisesRegex(RuntimeError, 'active'):
                installer.pin_vendor(self.home / 'Claude.app', self.home, {})
            calls.assert_not_called()
        self.assertEqual(list(self.home.iterdir()), [])

    def test_known_broken_patch_deployment_fails_before_any_mutation(self):
        with self.assertRaisesRegex(RuntimeError, 'PATCH DEPLOYMENT BLOCKED'):
            installer.refuse_patch_deployment()
        self.assertEqual(list(self.home.iterdir()), [])

    @unittest.skipUnless(platform.system() == 'Darwin', 'macOS installer CLI')
    def test_restore_cannot_reverse_roles_to_deploy_blocked_patch(self):
        state = self.home / 'state'
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/claude_desktop_snapshot_install.py'), 'restore', '--app', str(self.home / 'Patched.app'), '--backup', '/Applications/Claude.app', '--state', str(state)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('PATCH DEPLOYMENT BLOCKED', result.stderr)
        self.assertFalse(state.exists())

    def test_prepare_rejects_unvalidated_prepared_argument(self):
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/claude_desktop_snapshot_install.py'), 'prepare', '--prepared', '/nonexistent.app', '--state', str(self.home / 'state')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('only with install', result.stderr)
        self.assertFalse((self.home / 'state').exists())

    @unittest.skipUnless(platform.system() == 'Darwin', 'macOS installer CLI')
    def test_state_inside_source_app_is_rejected_without_writing(self):
        app = self.home / 'Unknown.app'; app.mkdir()
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/claude_desktop_snapshot_install.py'), 'prepare', '--app', str(app), '--state', str(app / 'state')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('outside the installed app', result.stderr)
        self.assertEqual(list(app.iterdir()), [])

    def test_existing_cli_slot_reuses_same_binary_and_preserves_launcher(self):
        release = {'code_version': '2.1.321', 'code_bundles': {platform.machine(): {'sha256': 'a' * 64}}}
        slot = self.home / 'Library/Application Support/Claude/claude-code/2.1.321' / ('a' * 12)
        binary = slot / 'claude.app/Contents/MacOS/claude'
        binary.parent.mkdir(parents=True)
        binary.write_text('signed-fixture')
        launcher = self.home / '.local/bin/claude'
        launcher.parent.mkdir(parents=True)
        launcher.write_text('old-launcher')
        with patch.object(code, 'verify', return_value=binary):
            self.assertEqual(code.install(self.home, release), binary)
            self.assertEqual(code.install(self.home, release), binary)
        self.assertEqual(launcher.resolve(), binary)
        backups = list(launcher.parent.glob('claude.backup-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), 'old-launcher')

    def test_archive_traversal_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unconfined'):
            code.validate_members([tarfile.TarInfo('claude.app/../../escape')])

    def test_archive_absolute_link_is_rejected(self):
        entry = tarfile.TarInfo('claude.app/link'); entry.type = tarfile.SYMTYPE; entry.linkname = '/etc/passwd'
        with self.assertRaisesRegex(ValueError, 'Absolute'):
            code.validate_members([entry])

    def test_archive_special_file_is_rejected(self):
        entry = tarfile.TarInfo('claude.app/device'); entry.type = tarfile.CHRTYPE
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            code.validate_members([entry])

if __name__ == '__main__': unittest.main()
