#!/usr/bin/env python3
"""Filesystem integration coverage through the retirement CLI; no live home changes."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/retire-apps.py"
VERSION = ".local/share/cursor-agent/versions/2026.11.22-e9042b2"
ELF = b"\x7fELF" + bytes(60)
MACHO = b"\xcf\xfa\xed\xfe" + bytes(60)
WRAPPER = '''#!/bin/bash
package="opencode-ai"
command="opencode"
node_root="$(mise where node@latest)"
exec_package_bin() { "$node_bin" "$npx_bin" "$@"; }
'''


class RetirementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="retire-apps-test-")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve() / "home"
        self.home.mkdir()

    def file(self, relative, content=ELF):
        path = self.home / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode())
        path.chmod(0o755)
        return path

    def link(self, relative, target):
        path = self.home / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.symlink_to(target)
        return path

    def cursor(self):
        self.file(VERSION + "/package.json", '{"name":"@anysphere/agent-cli-runtime","private":true}')
        self.file(VERSION + "/cursor-agent", '#!/bin/bash\nexport CURSOR_INVOKED_AS="$0"\nexec "$SCRIPT_DIR/node" "$SCRIPT_DIR/index.js"\n')
        self.file(VERSION + "/node")
        self.file(VERSION + "/index.js", "console.log('agent')")
        self.link(".local/bin/cursor-agent", self.home / VERSION / "cursor-agent")
        self.link(".local/bin/agent", "cursor-agent")

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), "--home", str(self.home), *args],
                              capture_output=True, text=True, timeout=15)

    def test_default_preview_does_not_create_quarantine_or_move_program(self):
        self.file(".amp/bin/amp")
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"mode": "preview", "home": str(self.home), "paths": [".amp/bin/amp"]})
        self.assertEqual((self.home / ".amp/bin/amp").read_bytes(), ELF)
        self.assertFalse((self.home / ".retired-apps").exists())

    def test_apply_preserves_data_and_relative_paths_and_private_quarantine(self):
        self.file(".amp/bin/amp")
        self.link(".local/bin/amp", self.home / ".amp/bin/amp")
        self.file(".amp/file-changes/history", "keep amp history")
        self.file(".grok/settings.json", "keep grok settings")
        self.file(".cursor/notes.txt", "keep Cursor editor notes")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        quarantine = Path(json.loads(result.stdout)["quarantine"])
        self.assertEqual((quarantine / ".amp/bin/amp").read_bytes(), ELF)
        self.assertEqual(os.readlink(quarantine / ".local/bin/amp"), str(self.home / ".amp/bin/amp"))
        self.assertEqual(quarantine.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.home / ".amp/file-changes/history").read_text(), "keep amp history")
        self.assertEqual((self.home / ".grok/settings.json").read_text(), "keep grok settings")
        self.assertEqual((self.home / ".cursor/notes.txt").read_text(), "keep Cursor editor notes")
        self.assertFalse(os.path.lexists(self.home / ".local/bin/amp"))
        self.assertFalse((self.home / ".amp/bin/amp").exists())

    def test_cursor_chain_moves_only_verified_version_not_sibling_data(self):
        self.cursor()
        self.file(".local/share/cursor-agent/history.json", "keep")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        quarantine = Path(json.loads(result.stdout)["quarantine"])
        self.assertEqual((quarantine / VERSION / "node").read_bytes(), ELF)
        self.assertEqual(os.readlink(quarantine / ".local/bin/agent"), "cursor-agent")
        self.assertEqual((self.home / ".local/share/cursor-agent/history.json").read_text(), "keep")
        self.assertEqual(list((self.home / ".local/share/cursor-agent/versions").iterdir()), [])

    def test_repeat_apply_is_noop(self):
        self.file(".amp/bin/amp")
        first = self.run_cli("--apply")
        result = self.run_cli("--apply")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(json.loads(result.stdout), {"mode": "apply", "home": str(self.home), "paths": [], "quarantine": None})
        self.assertEqual(len(list((self.home / ".retired-apps").iterdir())), 1)

    def test_separate_runs_never_overwrite_existing_quarantine(self):
        self.file(".amp/bin/amp")
        first = self.run_cli("--apply")
        self.file(".amp/bin/amp", ELF + b"second")
        result = self.run_cli("--apply")
        old = Path(json.loads(first.stdout)["quarantine"])
        new = Path(json.loads(result.stdout)["quarantine"])
        self.assertNotEqual(old, new)
        self.assertEqual((old / ".amp/bin/amp").read_bytes(), ELF)
        self.assertEqual((new / ".amp/bin/amp").read_bytes(), ELF + b"second")

    def test_macos_native_grok_preserves_other_grok_content(self):
        self.file(".grok/bin/grok", MACHO)
        self.file(".grok/history/chat", "keep")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        quarantine = Path(json.loads(result.stdout)["quarantine"])
        self.assertEqual((quarantine / ".grok/bin/grok").read_bytes(), MACHO)
        self.assertEqual((self.home / ".grok/history/chat").read_text(), "keep")

    def test_opencode_native_and_omarchy_wrapper_are_both_moved(self):
        self.file(".opencode/bin/opencode")
        self.file(".local/bin/opencode", WRAPPER)
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        quarantine = Path(json.loads(result.stdout)["quarantine"])
        self.assertEqual((quarantine / ".local/bin/opencode").read_text(), WRAPPER)
        self.assertEqual((quarantine / ".opencode/bin/opencode").read_bytes(), ELF)

    def test_known_mise_shims_and_repo_grok_launcher_are_moved(self):
        self.link(".local/share/mise/shims/amp", "/usr/bin/mise")
        self.link(".local/share/mise/command-wrappers/bin/grok", "/opt/homebrew/bin/mise")
        self.link(".local/bin/grok", ROOT / "scripts/grok")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        quarantine = Path(json.loads(result.stdout)["quarantine"])
        self.assertEqual(os.readlink(quarantine / ".local/share/mise/shims/amp"), "/usr/bin/mise")
        self.assertEqual(os.readlink(quarantine / ".local/share/mise/command-wrappers/bin/grok"), "/opt/homebrew/bin/mise")
        self.assertEqual(os.readlink(quarantine / ".local/bin/grok"), str(ROOT / "scripts/grok"))

    def test_generic_agent_binary_blocks_all_moves(self):
        self.file(".amp/bin/amp")
        self.file(".local/bin/agent")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown command object", result.stderr)
        self.assertEqual((self.home / ".amp/bin/amp").read_bytes(), ELF)
        self.assertFalse((self.home / ".retired-apps").exists())

    def test_foreign_symlink_is_preserved(self):
        self.link(".local/bin/amp", "/usr/bin/true")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("foreign symlink", result.stderr)
        self.assertEqual(os.readlink(self.home / ".local/bin/amp"), "/usr/bin/true")

    def test_symlink_ancestor_blocks_traversal(self):
        external = Path(self.temp.name) / "external"
        external.mkdir()
        (external / "bin").mkdir()
        (external / "bin/amp").write_bytes(ELF)
        self.link(".amp", external)
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("not a real directory", result.stderr)
        self.assertEqual((external / "bin/amp").read_bytes(), ELF)

    def test_unknown_file_in_version_blocks_whole_plan(self):
        self.cursor()
        self.file(VERSION + "/notes.txt", "private notes")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown file inside Cursor payload", result.stderr)
        self.assertEqual((self.home / VERSION / "notes.txt").read_text(), "private notes")
        self.assertTrue((self.home / ".local/bin/agent").is_symlink())

    def test_foreign_dependency_symlink_blocks_cursor_version(self):
        self.cursor()
        self.link(VERSION + "/node_modules/foreign", "/tmp")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown object inside Cursor payload", result.stderr)
        self.assertTrue((self.home / ".local/bin/agent").is_symlink())

    def test_unknown_version_directory_is_not_swept(self):
        self.file(".local/share/cursor-agent/versions/my-notes/note", "keep")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown Cursor version object", result.stderr)
        self.assertEqual((self.home / ".local/share/cursor-agent/versions/my-notes/note").read_text(), "keep")

    def test_native_named_shell_script_is_not_accepted(self):
        self.file(".amp/bin/amp", "#!/bin/sh\necho foreign")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("not an executable ELF/Mach-O", result.stderr)
        self.assertEqual((self.home / ".amp/bin/amp").read_text(), "#!/bin/sh\necho foreign")

    def test_non_mise_shim_is_rejected(self):
        self.link(".local/share/mise/shims/amp", "/usr/bin/other")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("not a recognized mise shim", result.stderr)
        self.assertEqual(os.readlink(self.home / ".local/share/mise/shims/amp"), "/usr/bin/other")

    def test_quarantine_symlink_is_rejected(self):
        self.file(".amp/bin/amp")
        self.link(".retired-apps", self.temp.name)
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("quarantine must be an owned private directory", result.stderr)
        self.assertEqual((self.home / ".amp/bin/amp").read_bytes(), ELF)

    def test_wrong_cursor_package_identity_is_rejected(self):
        self.cursor()
        self.file(VERSION + "/package.json", '{"name":"other-app","private":true}')
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown Cursor runtime package", result.stderr)
        self.assertTrue((self.home / ".local/bin/agent").is_symlink())

    def test_other_package_wrapper_is_rejected(self):
        self.file(".local/bin/opencode", WRAPPER.replace('package="opencode-ai"', 'package="other"'))
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown OpenCode wrapper", result.stderr)
        self.assertEqual((self.home / ".local/bin/opencode").read_text(), WRAPPER.replace('package="opencode-ai"', 'package="other"'))

    def test_native_payload_symlink_is_rejected(self):
        self.link(".grok/bin/grok", "/usr/bin/true")
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("not a regular file", result.stderr)
        self.assertEqual(os.readlink(self.home / ".grok/bin/grok"), "/usr/bin/true")

    def test_non_executable_native_payload_is_rejected(self):
        self.file(".amp/bin/amp").chmod(0o644)
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("not an executable ELF/Mach-O", result.stderr)
        self.assertEqual((self.home / ".amp/bin/amp").read_bytes(), ELF)

    def test_special_file_is_rejected_without_opening_it(self):
        path = self.home / ".amp/bin/amp"
        path.parent.mkdir(parents=True)
        os.mkfifo(path)
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("not a regular file", result.stderr)
        self.assertFalse((self.home / ".retired-apps").exists())

    def test_public_quarantine_directory_is_rejected(self):
        self.file(".amp/bin/amp")
        (self.home / ".retired-apps").mkdir(mode=0o755)
        result = self.run_cli("--apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("quarantine must be an owned private directory", result.stderr)
        self.assertEqual((self.home / ".amp/bin/amp").read_bytes(), ELF)


if __name__ == "__main__":
    unittest.main()
