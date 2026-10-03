#!/usr/bin/env python3
"""Real filesystem/CLI integration checks; never use live OAuth or service state."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).with_name("priority.py")
spec = importlib.util.spec_from_file_location("priority", HELPER)
priority = importlib.util.module_from_spec(spec)
spec.loader.exec_module(priority)
SECRET = "fixture-secret-do-not-print"


class PriorityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.auth_dir = self.home / ".local/share/cliproxyapi/auth"
        self.auth_dir.mkdir(parents=True)
        self.account = self.auth_dir / "codex-one.json"
        self.original = {"type": "codex", "access_token": SECRET,
                         "nested": {"refresh_token": SECRET, "keep": [1, None, False]}}
        self.account.write_text(json.dumps(self.original))
        self.account.chmod(0o640)

    def run_cli(self, *arguments):
        return subprocess.run([sys.executable, str(HELPER), *arguments],
                              env={**os.environ, "HOME": str(self.home)},
                              capture_output=True, text=True, timeout=10)

    def test_default_list_reports_only_safe_columns_and_missing_priority_zero(self):
        result = self.run_cli()
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (0, 'filename\tprovider\tpriority\n"codex-one.json"\tcodex\t0\n', ""))
        self.assertEqual(json.loads(self.account.read_text()), self.original)
        self.assertFalse((self.auth_dir.parent / ".priority.lock").exists())

    def test_set_preserves_all_other_fields_permissions_and_owner(self):
        before = self.account.stat()
        result = self.run_cli("one", "10")
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (0, 'filename\tprovider\tpriority\n"codex-one.json"\tcodex\t10\n', ""))
        self.assertEqual(json.loads(self.account.read_text()), {**self.original, "priority": 10})
        self.assertEqual(stat.S_IMODE(self.account.stat().st_mode), 0o640)
        self.assertEqual((self.account.stat().st_uid, self.account.stat().st_gid), (before.st_uid, before.st_gid))
        self.assertEqual(list(self.auth_dir.glob(".priority-*")), [])

    def test_explicit_zero_reverts_existing_priority(self):
        self.account.write_text(json.dumps({**self.original, "priority": 10}))
        result = self.run_cli("one", "0")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(self.account.read_text()), {**self.original, "priority": 0})

    def test_negative_integer_is_allowed(self):
        result = self.run_cli("one", "-3")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(self.account.read_text())["priority"], -3)

    def test_list_escapes_filename_controls_and_rejects_provider_payload(self):
        self.account.rename(self.auth_dir / 'codex-\n"one.json')
        self.account = self.auth_dir / 'codex-\n"one.json'
        self.account.write_text(json.dumps({**self.original, "type": SECRET, "priority": 2}))
        result = self.run_cli("list")
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (0, 'filename\tprovider\tpriority\n"codex-\\n\\\"one.json"\tunknown\t2\n', ""))

    def test_ambiguous_selector_changes_nothing(self):
        second = self.auth_dir / "codex-two.json"
        second.write_text(json.dumps(self.original))
        result = self.run_cli("codex", "10")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, "error: Selector matches multiple auth filenames; use a unique substring.\n")
        self.assertEqual(json.loads(self.account.read_text()), self.original)
        self.assertEqual(json.loads(second.read_text()), self.original)

    def test_unmatched_selector_is_safe_and_changes_nothing(self):
        result = self.run_cli(SECRET, "10")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, "error: No auth filename matches the selector; use cliproxy priority list.\n")
        self.assertEqual(json.loads(self.account.read_text()), self.original)

    def test_malformed_args_do_not_expose_or_mutate_auth(self):
        result = self.run_cli("one", "1.5")
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (2, "", "error: Usage: cliproxy priority [list | <unique filename substring> <integer>]\n"))
        self.assertEqual(json.loads(self.account.read_text()), self.original)

    def test_extra_args_are_rejected(self):
        result = self.run_cli("one", "1", SECRET)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertNotIn(SECRET, result.stderr)
        self.assertEqual(json.loads(self.account.read_text()), self.original)

    def test_overflow_is_rejected(self):
        result = self.run_cli("one", str(2**63))
        self.assertEqual((result.returncode, result.stderr),
                         (2, "error: Priority must be a signed 64-bit integer.\n"))
        self.assertEqual(json.loads(self.account.read_text()), self.original)

    def test_malformed_json_error_never_contains_payload(self):
        self.account.write_text('{"access_token": "' + SECRET)
        result = self.run_cli("one", "10")
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (2, "", "error: Invalid auth JSON; no files were changed.\n"))
        self.assertEqual(self.account.read_text(), '{"access_token": "' + SECRET)

    def test_duplicate_json_fields_are_rejected_without_loss(self):
        content = '{"type":"codex","nested":{"token":"first","token":"second"}}'
        self.account.write_text(content)
        result = self.run_cli("one", "10")
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (2, "", "error: Invalid auth JSON; no files were changed.\n"))
        self.assertEqual(self.account.read_text(), content)

    def test_nonfinite_json_is_rejected(self):
        self.account.write_text('{"type":"codex","value":NaN}')
        result = self.run_cli("one", "10")
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (2, "", "error: Invalid auth JSON; no files were changed.\n"))
        self.assertEqual(self.account.read_text(), '{"type":"codex","value":NaN}')

    def test_boolean_priority_is_not_an_integer(self):
        self.account.write_text(json.dumps({**self.original, "priority": True}))
        result = self.run_cli("list")
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (2, "", "error: Auth priority must be a signed 64-bit integer.\n"))

    def test_symlink_target_is_not_modified(self):
        outside = self.home / "outside.json"
        self.account.rename(outside)
        self.account.symlink_to(outside)
        result = self.run_cli("one", "10")
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (1, "", "error: Unable to read or update private auth state; no credentials displayed.\n"))
        self.assertEqual(json.loads(outside.read_text()), self.original)

    def test_external_refresh_between_read_and_replace_is_preserved(self):
        original_mkstemp = tempfile.mkstemp
        refreshed = {**self.original, "access_token": "refreshed-fixture-token"}

        def refresh_then_stage(*args, **kwargs):
            self.account.write_text(json.dumps(refreshed))
            return original_mkstemp(*args, **kwargs)

        with patch.object(priority.tempfile, "mkstemp", side_effect=refresh_then_stage):
            with self.assertRaisesRegex(priority.PriorityError, "Auth file changed before update"):
                priority.replace_priority(self.account, 10)
        self.assertEqual(json.loads(self.account.read_text()), refreshed)
        self.assertEqual(list(self.auth_dir.glob(".priority-*")), [])

    def test_concurrent_helper_updates_preserve_unrelated_fields(self):
        environment = {**os.environ, "HOME": str(self.home)}
        first = subprocess.Popen([sys.executable, str(HELPER), "one", "10"],
                                 env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        second = subprocess.Popen([sys.executable, str(HELPER), "one", "20"],
                                  env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        first_output, first_error = first.communicate(timeout=10)
        second_output, second_error = second.communicate(timeout=10)
        self.assertEqual((first.returncode, first_output, first_error),
                         (0, 'filename\tprovider\tpriority\n"codex-one.json"\tcodex\t10\n', ""))
        self.assertEqual((second.returncode, second_output, second_error),
                         (0, 'filename\tprovider\tpriority\n"codex-one.json"\tcodex\t20\n', ""))
        result = json.loads(self.account.read_text())
        self.assertIn(result.pop("priority"), (10, 20))
        self.assertEqual(result, self.original)


if __name__ == "__main__":
    unittest.main()
