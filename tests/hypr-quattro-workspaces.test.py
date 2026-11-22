#!/usr/bin/env python3
"""Stopped-session state migration and actual upstream QML function coverage."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT.parent / "upstream"
spec = importlib.util.spec_from_file_location("workspace_state", ROOT / "configs/hypr-quattro/workspace-state.py")
state_helper = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(state_helper)
STOCK = b"0\tDP-1\tPrimary\n1\tHDMI-A-2\tSecondary\n"
MERGED = b"12\t5\tSecondary\n"


class WorkspaceStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="quattro-state-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.state = self.base / "state"
        self.state.mkdir()
        (self.state / "monitor-workspaces").write_bytes(STOCK)
        (self.state / "monitor-workspaces-merged").write_bytes(MERGED)
        self.snapshot = self.base / "stock-before-overlay"

    def test_save_repeat_restore_and_matching_overlay_snapshot(self):
        state_helper.transfer("save", self.state, self.snapshot)
        state_helper.transfer("save", self.state, self.snapshot)
        self.assertFalse((self.state / "monitor-workspaces").exists())
        self.assertEqual((self.snapshot / "monitor-workspaces").read_bytes(), STOCK)
        self.assertEqual((self.snapshot / "monitor-workspaces-merged").read_bytes(), MERGED)
        # The actual upstream start callback creates an empty merged file under
        # the overlay. Save that new config's pair before restoring stock's pair.
        (self.state / "monitor-workspaces-merged").write_bytes(b"")
        overlay_snapshot = self.base / "overlay-before-stock"
        state_helper.transfer("save", self.state, overlay_snapshot)
        state_helper.transfer("restore", self.state, self.snapshot)
        state_helper.transfer("restore", self.state, self.snapshot)
        self.assertEqual((self.state / "monitor-workspaces").read_bytes(), STOCK)
        self.assertEqual((self.state / "monitor-workspaces-merged").read_bytes(), MERGED)
        state_helper.transfer("save", self.state, self.snapshot)
        state_helper.transfer("restore", self.state, overlay_snapshot)
        self.assertFalse((self.state / "monitor-workspaces").exists())
        self.assertEqual((self.state / "monitor-workspaces-merged").read_bytes(), b"")

    def test_restore_collision_preserves_both_pairs(self):
        state_helper.transfer("save", self.state, self.snapshot)
        (self.state / "monitor-workspaces").write_bytes(b"new config state\n")
        with self.assertRaisesRegex(ValueError, "Missing or changed state"):
            state_helper.transfer("restore", self.state, self.snapshot)
        self.assertEqual((self.state / "monitor-workspaces").read_bytes(), b"new config state\n")
        self.assertEqual((self.snapshot / "monitor-workspaces").read_bytes(), STOCK)
        self.assertEqual((self.snapshot / "monitor-workspaces-merged").read_bytes(), MERGED)

    def test_unowned_snapshot_directory_is_refused_before_state_moves(self):
        self.snapshot.mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, "Snapshot collision"):
            state_helper.transfer("save", self.state, self.snapshot)
        self.assertEqual((self.state / "monitor-workspaces").read_bytes(), STOCK)

    def test_symlink_state_is_refused(self):
        (self.state / "monitor-workspaces").unlink()
        (self.state / "monitor-workspaces").symlink_to(self.state / "monitor-workspaces-merged")
        with self.assertRaisesRegex(ValueError, "Not a regular"):
            state_helper.transfer("save", self.state, self.snapshot)
        self.assertEqual((self.state / "monitor-workspaces-merged").read_bytes(), MERGED)

    def test_snapshot_permissions_and_ownership_are_checked(self):
        state_helper.transfer("save", self.state, self.snapshot)
        self.snapshot.chmod(0o755)
        with self.assertRaisesRegex(ValueError, "private"):
            state_helper.transfer("restore", self.state, self.snapshot)
        self.snapshot.chmod(0o700)
        with patch.object(state_helper.os, "getuid", return_value=os.getuid() + 1):
            with self.assertRaisesRegex(ValueError, "owned by this user"):
                state_helper.validate_directory(self.snapshot, private=True)
        self.assertEqual((self.snapshot / "monitor-workspaces").read_bytes(), STOCK)

    def test_symlinked_source_and_snapshot_ancestors_are_refused(self):
        alias = self.base / "alias"
        alias.symlink_to(self.base, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlinked path component"):
            state_helper.transfer("save", alias / "state", self.snapshot)
        with self.assertRaisesRegex(ValueError, "Symlinked path component"):
            state_helper.transfer("save", self.state, alias / "backup")
        self.assertEqual((self.state / "monitor-workspaces").read_bytes(), STOCK)
        self.assertFalse((self.base / "backup").exists())

    def test_empty_xdg_state_home_uses_home_fallback(self):
        with patch.dict(os.environ, {"HOME": str(self.base), "XDG_STATE_HOME": ""}, clear=True):
            self.assertEqual(state_helper.state_directory(), self.base / ".local/state/omarchy")

    def test_interruption_between_pair_members_resumes(self):
        link = os.link
        count = 0
        def interrupted(src, dst):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError("simulated interrupted second move")
            link(src, dst)
        with patch.object(state_helper.os, "link", side_effect=interrupted):
            with self.assertRaisesRegex(OSError, "simulated interrupted"):
                state_helper.transfer("save", self.state, self.snapshot)
        self.assertEqual((self.snapshot / "monitor-workspaces").read_bytes(), STOCK)
        self.assertEqual((self.state / "monitor-workspaces-merged").read_bytes(), MERGED)
        state_helper.transfer("save", self.state, self.snapshot)
        self.assertFalse((self.state / "monitor-workspaces-merged").exists())
        self.assertEqual((self.snapshot / "monitor-workspaces-merged").read_bytes(), MERGED)

    def test_interrupted_link_move_resumes_without_overwriting(self):
        state_helper.transfer("save", self.state, self.snapshot)
        os.link(self.snapshot / "monitor-workspaces", self.state / "monitor-workspaces")
        state_helper.transfer("save", self.state, self.snapshot)
        self.assertFalse((self.state / "monitor-workspaces").exists())
        self.assertEqual((self.snapshot / "monitor-workspaces").read_bytes(), STOCK)

    def test_live_compositor_and_failed_probe_are_refused(self):
        with patch.object(state_helper.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaisesRegex(ValueError, "Log out"):
                state_helper.require_stopped_session()
        with patch.object(state_helper.subprocess, "run", return_value=subprocess.CompletedProcess([], 2)):
            with self.assertRaisesRegex(ValueError, "Log out"):
                state_helper.require_stopped_session()
        with patch.object(state_helper.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)):
            self.assertIsNone(state_helper.require_stopped_session())

    def test_actual_qml_functions_with_populated_then_quarantined_state(self):
        # Execute the actual source bodies and label expression with Qt's JS
        # engine. Only Hyprland data/dispatch and QML property wiring are fixtures;
        # this is not a rendered or live Quickshell session.
        source = (UPSTREAM / "shell/plugins/bar/widgets/Workspaces.qml").read_text()
        def body(marker):
            start = source.index("{", source.index(marker))
            depth = 1
            end = start + 1
            while depth:
                depth += (source[end] == "{") - (source[end] == "}")
                end += 1
            return source[start:end]
        names = ("readBlocks", "blockOf", "slotOf", "activeWorkspaceId", "workspaceIds", "focusWorkspace", "modeGlyph")
        functions = []
        for name in names:
            start = source.index("function " + name + "(")
            signature = source[start:source.index("{", start)]
            functions.append(signature + body("function " + name + "("))
        label = next(line.split("text: ", 1)[1] for line in source.splitlines() if "text: shown ?" in line)
        js = '''.pragma library
function inspect(text, monitorName, activeId, click) {
  var dispatched = [];
  var root = { slots: 10, monitorName: monitorName, blocks: {}, activeMode: "dwindle",
    monitor: {activeWorkspace: {id: activeId}}, dispatch: function(x) { dispatched.push(x); } };
  var Hyprland = {workspaces: {values: [
    {id: 1, monitor: {name: "DP-1"}}, {id: 5, monitor: {name: "HDMI-A-2"}},
    {id: 9, monitor: {name: "DP-1"}}]}};
''' + "\n".join(functions) + "\n"
        js += "\n".join(f"root.{name} = {name};" for name in names)
        js += '\nObject.defineProperty(root, "block", {get: function() ' + body("readonly property int block:") + '});\n'
        js += '''root.readBlocks(text);
var ids = root.workspaceIds();
var labels = ids.map(function(id) {var shown = id === activeId; var slot = root.slotOf(id); return ''' + label + ''';});
root.focusWorkspace(click);
return {ids: ids, labels: labels, dispatched: dispatched};
}
'''
        (self.base / "Logic.js").write_text(js)
        state_helper.transfer("save", self.state, self.snapshot)
        self.assertFalse((self.state / "monitor-workspaces").exists())
        qml = '''import QtQuick
import QtTest
import "Logic.js" as Logic
TestCase {
 name: "ActualWorkspaceLogic"
 function test_stock_state_conflicts() {
  var r = Logic.inspect(STOCK, "HDMI-A-2", 5, 11);
  compare(JSON.stringify(r.ids), "[11,12,13,14,15,5]");
  compare(r.labels[0], "1");
  compare(r.dispatched[0], 'o.workspaces.focus(1, "HDMI-A-2")');
 }
 function test_quarantined_state_on_both_bars() {
  var left = Logic.inspect("", "DP-1", 1, 5);
  var right = Logic.inspect("", "HDMI-A-2", 5, 9);
  compare(JSON.stringify(left.ids), "[1,2,3,4,5,9]");
  compare(JSON.stringify(right.ids), "[1,2,3,4,5,9]");
  compare(left.labels[4], "5");
  compare(right.labels[0], "1");
  compare(right.labels[5], "9");
  compare(right.labels[4], "󱓻"); // the active workspace's real dwindle glyph
  compare(left.dispatched[0], 'o.workspaces.focus(5, "DP-1")');
  compare(right.dispatched[0], 'o.workspaces.focus(9, "HDMI-A-2")');
 }
}
'''.replace("STOCK", json.dumps(STOCK.decode()))
        (self.base / "tst_workspace.qml").write_text(qml)
        binary = "/usr/lib/qt6/bin/qmltestrunner" if Path("/usr/lib/qt6/bin/qmltestrunner").is_file() else shutil.which("qmltestrunner")
        self.assertIsNotNone(binary, "Qt qmltestrunner is required to validate actual QML JS behavior")
        result = subprocess.run([binary, "-input", str(self.base / "tst_workspace.qml")],
            env={"PATH": "/usr/bin:/bin", "HOME": str(self.base), "QT_QPA_PLATFORM": "offscreen", "QT_QUICK_BACKEND": "software"},
            cwd=self.base, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("4 passed, 0 failed", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
