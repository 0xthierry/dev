#!/usr/bin/env python3
"""Installer integration: real Bash/filesystem, isolated external Claude CLI fake."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "install/claude-inline-images.sh"
BASH = shutil.which("bash")


class InlineImagesInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="claude-inline-images-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        # A closed PATH prevents falling through to the real Claude installation.
        for command in ("dirname", "jq"):
            target = shutil.which(command)
            if target is None:
                self.fail(f"required test dependency missing: {command}")
            (self.bin / command).symlink_to(target)
        self.env = dict(os.environ, HOME=str(self.home), PATH=str(self.bin), DRY_RUN="0")
        self.state = self.home / "state.json"
        self.calls = self.home / "calls.jsonl"
        self.env.pop("FAKE_CLAUDE_FAILURE", None)
        fake = self.bin / "claude"
        fake.write_text(f"#!{sys.executable}\n" + '''import json
import os
from pathlib import Path
import sys

home = Path(os.environ["HOME"])
args = sys.argv[1:]
with (home / "calls.jsonl").open("a") as calls:
    calls.write(json.dumps(args) + "\\n")
state_path = home / "state.json"
state = json.loads(state_path.read_text()) if state_path.exists() else {}
plugin = "inline-images@thierry-local"
if args[:3] == ["plugin", "marketplace", "add"] and len(args) == 4:
    state["marketplace"] = args[3]
elif args == ["plugin", "install", "--scope", "user", plugin]:
    if os.environ.get("FAKE_CLAUDE_FAILURE") == "install":
        print("fixture: install failed", file=sys.stderr)
        sys.exit(23)
    state.setdefault("plugins", [{"id": plugin, "scope": "user", "enabled": True}])
elif args == ["plugin", "list", "--json"]:
    print(json.dumps(state.get("plugins", [])))
    sys.exit(0)
elif args == ["plugin", "enable", "--scope", "user", plugin]:
    selected = next(p for p in state["plugins"] if p["id"] == plugin and p["scope"] == "user")
    if selected["enabled"]:
        print("fixture: already enabled", file=sys.stderr)
        sys.exit(24)
    selected["enabled"] = True
else:
    print("unexpected Claude arguments: " + repr(args), file=sys.stderr)
    sys.exit(25)
state_path.write_text(json.dumps(state))
''')
        fake.chmod(0o755)

    def run_installer(self, repeat=1):
        return subprocess.run(
            [BASH, "-c", 'source "$1"; for ((i=0; i<$2; i++)); do configure_claude_inline_images; done',
             "_", str(INSTALLER), str(repeat)],
            env=self.env, text=True, capture_output=True, timeout=20,
        )

    def read_calls(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def test_repeat_run_converges_without_redundant_enable(self):
        result = self.run_installer(repeat=2)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.state.read_text()), {
            "marketplace": str(ROOT / "configs/agents/claude/plugins"),
            "plugins": [{"id": "inline-images@thierry-local", "scope": "user", "enabled": True}],
        })
        self.assertEqual(self.read_calls(), [
            ["plugin", "marketplace", "add", str(ROOT / "configs/agents/claude/plugins")],
            ["plugin", "install", "--scope", "user", "inline-images@thierry-local"],
            ["plugin", "list", "--json"],
        ] * 2)

    def test_disabled_user_plugin_is_enabled(self):
        self.state.write_text(json.dumps({"plugins": [
            {"id": "inline-images@thierry-local", "scope": "user", "enabled": False},
            {"id": "other@thierry-local", "scope": "user", "enabled": False},
        ]}))
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.state.read_text())["plugins"], [
            {"id": "inline-images@thierry-local", "scope": "user", "enabled": True},
            {"id": "other@thierry-local", "scope": "user", "enabled": False},
        ])
        self.assertEqual(self.read_calls()[-1],
                         ["plugin", "enable", "--scope", "user", "inline-images@thierry-local"])

    def test_disabled_project_plugin_does_not_trigger_user_enable(self):
        self.state.write_text(json.dumps({"plugins": [
            {"id": "inline-images@thierry-local", "scope": "user", "enabled": True},
            {"id": "inline-images@thierry-local", "scope": "project", "enabled": False},
        ]}))
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.state.read_text())["plugins"], [
            {"id": "inline-images@thierry-local", "scope": "user", "enabled": True},
            {"id": "inline-images@thierry-local", "scope": "project", "enabled": False},
        ])

    def test_failed_install_propagates_and_stops_before_list_or_enable(self):
        self.env["FAKE_CLAUDE_FAILURE"] = "install"
        result = self.run_installer()
        self.assertEqual(result.returncode, 23)
        self.assertIn("fixture: install failed", result.stderr)
        self.assertEqual(self.read_calls(), [
            ["plugin", "marketplace", "add", str(ROOT / "configs/agents/claude/plugins")],
            ["plugin", "install", "--scope", "user", "inline-images@thierry-local"],
        ])
        self.assertEqual(json.loads(self.state.read_text()), {
            "marketplace": str(ROOT / "configs/agents/claude/plugins"),
        })

    def test_partial_marketplace_setup_recovers_on_retry(self):
        self.state.write_text(json.dumps({
            "marketplace": str(ROOT / "configs/agents/claude/plugins"),
        }))
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.state.read_text()), {
            "marketplace": str(ROOT / "configs/agents/claude/plugins"),
            "plugins": [{"id": "inline-images@thierry-local", "scope": "user", "enabled": True}],
        })

    def test_dry_run_prints_plan_without_cli_execution_or_home_mutation(self):
        self.env["DRY_RUN"] = "1"
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("[dry-run] claude plugin marketplace add", result.stdout)
        self.assertIn("[dry-run] claude plugin install --scope user inline-images@thierry-local", result.stdout)
        self.assertIn("only if disabled", result.stdout)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_missing_claude_fails_with_actionable_error(self):
        (self.bin / "claude").unlink()
        result = self.run_installer()
        self.assertEqual(result.returncode, 1)
        self.assertIn("install Claude Code before configuring the inline images plugin", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
