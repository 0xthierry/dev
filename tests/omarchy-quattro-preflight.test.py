#!/usr/bin/env python3
"""Real-filesystem integration tests; all writes are confined to temporary HOME."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/omarchy-quattro-preflight.py"
RUNBOOK = ROOT / "docs/omarchy-quattro-links.md"


def block(name):
    text = RUNBOOK.read_text()
    return re.search(rf"<!-- {name}:start -->\n```bash\n(.*?)\n```", text, re.S).group(1)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="quattro-preflight-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.home = self.base / "home"
        (self.home / ".config/ghostty").mkdir(parents=True)
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.upstream = self.base / "upstream"
        (self.upstream / "config/hypr").mkdir(parents=True)
        (self.upstream / "config/hypr/hyprland.lua").write_text("package default\n")
        (self.upstream / "version").write_text("fixture\n")
        self.bridge = self.base / "bridge"
        self.bridge.write_text(
            "# deliberately unknown bridge, never executed\n"
            "refresh\tghostty/config\t" + "a" * 64 + "\n"
            "always_copy_config_files=(\n  hypr/hyprland.lua\n)\n"
            'file="$HOME/.config/ghostty/config"\n'
            'dynamic="$HOME/$not_statically_resolved"\n'
        )
        self.source = self.repo / "hypr"
        self.source.mkdir()
        (self.source / "hyprland.conf").write_text("original repo config\n")
        self.link = self.home / ".config/hypr"
        self.link.symlink_to(self.source)

    def report(self, *extra):
        result = subprocess.run(
            ["python3", str(SCRIPT), "--home", str(self.home), "--bridge", str(self.bridge),
             "--upstream", str(self.upstream), "--json", *extra],
            text=True, capture_output=True, timeout=20,
        )
        if result.returncode:
            raise RuntimeError(result.stderr)
        return json.loads(result.stdout)

    def runbook(self, name="materialize-rehearsal", link=None, expected=None):
        link = link or self.link
        return subprocess.run(
            ["bash", "-c", block(name)],
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "HOME": str(self.home), "LINK": str(link),
                 "EXPECTED_TARGET": str(expected or self.source)},
            text=True, capture_output=True, timeout=20,
        )

    def test_rehearsal_refuses_unknown_source_before_running_bridge_code(self):
        result = subprocess.run(
            ["python3", str(ROOT / "scripts/omarchy-quattro-preflight-rehearse.py"),
             "--bridge", str(self.bridge), "--upstream", str(self.upstream)],
            text=True, capture_output=True, timeout=20,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("unreviewed bridge checksum", result.stderr)
        self.assertEqual(self.link.readlink(), self.source)
        self.assertEqual((self.source / "hyprland.conf").read_text(), "original repo config\n")

    def test_package_missing_leaf_exposes_parent_repository_link_without_mutation(self):
        before = self.source.stat().st_mtime_ns
        data = self.report()
        link = next(item for item in data["links"] if item["path"] == str(self.link))
        self.assertIn("footprint:.config/hypr/hyprland.lua", link["scopes"])
        self.assertEqual(link["resolved"], str(self.source))
        self.assertEqual(self.link.readlink(), self.source)
        self.assertEqual((self.source / "hyprland.conf").read_text(), "original repo config\n")
        self.assertEqual(self.source.stat().st_mtime_ns, before)
        self.assertFalse((self.source / "hyprland.lua").exists())

    def test_nested_dangling_link_is_reported_instead_of_hidden_by_exists(self):
        (self.source / "missing.conf").symlink_to("absent.conf")
        data = self.report()
        link = next(item for item in data["links"] if item["path"] == str(self.source / "missing.conf"))
        self.assertEqual(link["target_status"], "missing")
        self.assertIn(str(self.link / "missing.conf"), link["observed_via"])

    def test_alias_in_target_parent_is_reported(self):
        alias = self.base / "repo-alias"
        alias.symlink_to(self.repo)
        self.link.unlink()
        self.link.symlink_to(alias / "hypr")
        data = self.report()
        link = next(item for item in data["links"] if item["path"] == str(alias))
        self.assertEqual(link["resolved"], str(self.repo))
        self.assertIn(str(self.link), link["observed_via"])

    def test_cycle_is_bounded_and_marks_inventory_incomplete(self):
        (self.source / "cycle").symlink_to(self.source)
        data = self.report()
        self.assertIn({"path": str(self.link / "cycle"), "reason": "directory-cycle-or-depth-limit"}, data["incomplete"])
        self.assertEqual(data["status"], "manual-review-required")

    def test_self_referencing_link_is_reported_without_hanging(self):
        self.link.unlink()
        self.link.symlink_to("hypr")
        data = self.report()
        link = next(item for item in data["links"] if item["path"] == str(self.link))
        self.assertEqual(link["target_status"], "cycle-or-too-many-links")
        self.assertEqual(data["safe_to_upgrade"], False)

    def test_unknown_bridge_never_reports_safe_even_without_links(self):
        self.link.unlink()
        data = self.report()
        self.assertEqual(data["safe_to_upgrade"], False)
        self.assertEqual(data["reviewed_bridge_matches"], False)
        self.assertIn("Bridge differs from reviewed 3.8.5 source: re-review ALL operations; extracted references do not establish coverage.", data["unknown"])
        self.assertEqual(data["links"], [])

    def test_limit_is_explicit_but_known_parent_is_still_reported(self):
        data = self.report("--max-entries", "1")
        self.assertIn({"path": str(self.link), "reason": "entry-limit", "limit": 1}, data["incomplete"])
        self.assertIn(str(self.link), [item["path"] for item in data["links"]])

    def test_materialized_directory_is_independent_and_rollback_preserves_changes(self):
        result = self.runbook()
        self.assertEqual(result.returncode, 0, result.stderr)
        # Model the exact filesystem boundary used by bridge Python writes/cp.
        (self.link / "hyprland.conf").write_text("upgraded local config\n")
        (self.link / "hyprland.lua").write_text("package Lua\n")
        self.assertEqual((self.source / "hyprland.conf").read_text(), "original repo config\n")
        self.assertFalse((self.source / "hyprland.lua").exists())
        restored = self.runbook("restore-rehearsal")
        self.assertEqual(restored.returncode, 0, restored.stderr)
        self.assertEqual(self.link.readlink(), self.source)
        self.assertEqual((self.home / ".config/hypr.post-quattro-copy/hyprland.conf").read_text(), "upgraded local config\n")
        self.assertEqual((self.home / ".config/hypr.post-quattro-copy/hyprland.lua").read_text(), "package Lua\n")

    def test_rollback_with_missing_legacy_tree_leaves_active_config_alone(self):
        result = self.runbook()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.source.rename(self.repo / "old-checkout")
        entry = self.link / "hyprland.lua"
        entry.write_text("working Quattro config\n")
        result = self.runbook("restore-rehearsal")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.link.is_symlink())
        self.assertEqual(entry.read_text(), "working Quattro config\n")
        self.assertTrue(Path(str(self.link) + ".pre-quattro-link").is_symlink())
        self.assertFalse(Path(str(self.link) + ".post-quattro-copy").exists())

    def test_materialized_leaf_preserves_repository_file(self):
        source = self.repo / "ghostty-config"
        source.write_text("theme = original\n")
        link = self.home / ".config/ghostty/config"
        link.symlink_to(source)
        result = self.runbook(link=link, expected=source)
        self.assertEqual(result.returncode, 0, result.stderr)
        link.write_text("theme = changed\n")
        self.assertEqual(source.read_text(), "theme = original\n")
        self.assertEqual(link.read_text(), "theme = changed\n")
        self.assertEqual(Path(str(link) + ".pre-quattro-link").readlink(), source)

    def test_valid_nested_links_are_copied_not_retained(self):
        external = self.repo / "shared.conf"
        external.write_text("shared data\n")
        (self.source / "nested.conf").symlink_to("../shared.conf")
        result = self.runbook()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.link / "nested.conf").is_symlink())
        (self.link / "nested.conf").write_text("local change\n")
        self.assertEqual(external.read_text(), "shared data\n")

    def test_dangling_nested_link_aborts_before_active_link_moves(self):
        (self.source / "missing.conf").symlink_to("absent.conf")
        result = self.runbook()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.link.readlink(), self.source)
        self.assertEqual((self.source / "hyprland.conf").read_text(), "original repo config\n")
        self.assertFalse(Path(str(self.link) + ".pre-quattro-link").is_symlink())

    def test_dangling_root_refuses_detachment(self):
        self.link.unlink()
        missing = self.repo / "absent"
        self.link.symlink_to(missing)
        result = self.runbook(expected=missing)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.link.readlink(), missing)
        self.assertFalse(Path(str(self.link) + ".pre-quattro-link").is_symlink())

    def test_fifo_refuses_detachment_without_reading_it(self):
        os.mkfifo(self.source / "pipe")
        result = self.runbook()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.link.readlink(), self.source)
        self.assertEqual((self.source / "hyprland.conf").read_text(), "original repo config\n")

    def test_repeat_does_not_replace_materialized_content_or_original_backup(self):
        first = self.runbook()
        self.assertEqual(first.returncode, 0, first.stderr)
        (self.link / "hyprland.conf").write_text("retain local edits\n")
        second = self.runbook()
        self.assertNotEqual(second.returncode, 0)
        self.assertEqual((self.link / "hyprland.conf").read_text(), "retain local edits\n")
        self.assertEqual(Path(str(self.link) + ".pre-quattro-link").readlink(), self.source)

    def test_existing_backup_is_not_overwritten(self):
        backup = Path(str(self.link) + ".pre-quattro-link")
        backup.write_text("retain backup\n")
        result = self.runbook()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(backup.read_text(), "retain backup\n")
        self.assertEqual(self.link.readlink(), self.source)

    def test_parent_alias_refuses_detachment(self):
        config = self.home / ".config"
        config.rename(self.home / "real-config")
        config.symlink_to("real-config")
        result = self.runbook()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.link.readlink(), self.source)
        self.assertEqual(config.readlink(), Path("real-config"))

    def test_unexpected_target_refuses_detachment(self):
        result = self.runbook(expected=self.repo / "not-the-target")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.link.readlink(), self.source)
        self.assertEqual((self.source / "hyprland.conf").read_text(), "original repo config\n")


if __name__ == "__main__":
    unittest.main()
