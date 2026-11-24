#!/usr/bin/env python3
"""Exercise the actual widget, delegates, Quickshell Process and Qt layout offscreen."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / 'configs/omarchy/global-workspaces'
FIXTURE = ROOT / 'tests/global-workspaces-widget'
UPSTREAM = Path(os.environ.get('OMARCHY_TEST_UPSTREAM', Path.home() / '.cache/dev-setup/omarchy-test-upstream'))


class WidgetTest(unittest.TestCase):
    def test_global_destinations_and_native_interactions(self):
        with tempfile.TemporaryDirectory(prefix='quattro-widget-') as tmp:
            base = Path(tmp)
            for name in ('runtime', 'home', 'bin', 'fixture'):
                (base / name).mkdir(mode=0o700)
            # Import actual Quattro UI, style and IPC components. Only substitute the
            # compositor data import: no real displays, session bus or client sockets.
            for name in ('Ui', 'Commons'):
                (base / name).symlink_to(UPSTREAM / 'shell' / name)
            shutil.copy(FIXTURE / 'shell.qml', base)
            shutil.copy(FIXTURE / 'Hyprland.qml', base / 'fixture')
            (base / 'fixture/qmldir').write_text('singleton Hyprland 1.0 Hyprland.qml\n')
            entry = json.loads((PLUGIN / 'manifest.json').read_text())['entryPoints']['barWidget']
            source = (PLUGIN / entry).read_text().replace('import Quickshell.Hyprland\n', 'import "fixture"\n')
            (base / 'Workspaces.qml').write_text(source)
            current = base / 'bin/omarchy-hyprland-workspace-layout-current'
            current.write_text('#!/bin/sh\ncase "$1" in 9) echo scrolling;; 4) echo floating;; esac\n')
            current.chmod(0o700)
            result = subprocess.run([shutil.which('quickshell'), '--no-color', '-p', str(base)],
                                    env={'PATH': str(base / 'bin'), 'HOME': str(base / 'home'),
                                         'XDG_RUNTIME_DIR': str(base / 'runtime'), 'QT_QPA_PLATFORM': 'offscreen',
                                         'QT_QUICK_BACKEND': 'software', 'OMARCHY_PATH': str(UPSTREAM)},
                                    capture_output=True, text=True, timeout=10)
            log = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, log)
            self.assertNotRegex(log, r'TypeError|ReferenceError|Binding loop')
            self.assertIn('LEFT ["1","2","3","4","5","6","7","8","󰝥","14"]', log)
            self.assertIn('RIGHT ["1","2","3","󰔶","5","6","7","8","9","14"]', log)
            self.assertIn('HORIZONTAL true', log)
            self.assertIn('VERTICAL true', log)
            self.assertIn('OPACITY [0.5,1,1]', log)
            self.assertIn('COMMANDS ' + json.dumps([
                'hyprctl dispatch \'hl.dsp.focus({ workspace = "1" })\'',
                'hyprctl dispatch \'hl.dsp.focus({ workspace = "14" })\'',
                'hyprctl dispatch \'hl.dsp.focus({ workspace = "14" })\'',
            ], separators=(',', ':')), log)
            self.assertIn('CYCLE ' + json.dumps([
                'hyprctl dispatch \'hl.dsp.focus({ monitor = "HDMI-A-2" })\' >/dev/null && omarchy-hyprland-workspace-layout-toggle'
            ]), log)
            self.assertIn('AFTER_CLOSE ["1","2","3","󰔶","5","6","7","8","9"]', log)


if __name__ == '__main__':
    unittest.main(verbosity=2)
