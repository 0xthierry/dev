#!/usr/bin/env python3
"""Integration tests: real Codex app-server, isolated HOME and persisted config."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "configs/ai-memory/trust-codex-hooks.py"
spec = importlib.util.spec_from_file_location("hook_review", HELPER)
assert spec is not None and spec.loader is not None
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def codex_executable():
    # Resolve the mise shim before HOME isolation. Its installed Node launcher
    # also needs the real Node directory rather than an isolated mise shim.
    executable = shutil.which("codex")
    if executable and "/mise/shims/" in executable:
        executable = subprocess.check_output(["mise", "which", "codex"], text=True).strip()
    if not executable:
        raise RuntimeError("installed Codex 0.169.0 required")
    return str(Path(executable).absolute())


CODEX = codex_executable()
AI_MEMORY = shutil.which("ai-memory")
if not AI_MEMORY:
    raise RuntimeError("installed upstream ai-memory required to generate real fixtures")
AI_MEMORY_HOOKS = Path(AI_MEMORY).resolve().parent / "hooks"
if not (AI_MEMORY_HOOKS / "codex").is_dir():
    raise RuntimeError("installed upstream ai-memory hooks bundle required")


class TrustTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ai-memory-codex-trust-")
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name).resolve()
        self.codex_home = self.home / "codex-config"
        self.codex_home.mkdir()
        self.cwd = self.home / "project"
        self.cwd.mkdir()
        self.config = self.codex_home / "config.toml"
        self.config.write_text('model = "gpt-5.4"\nmodel_reasoning_effort = "low"\n[features]\nhooks = true\n')
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("CODEX_", "XDG_", "AI_MEMORY_"))}
        self.env.update(HOME=str(self.home), CODEX_HOME=str(self.codex_home),
                        PATH=str(Path(CODEX).parent) + os.pathsep + os.environ["PATH"],
                        XDG_CONFIG_HOME=str(self.home / "config"), XDG_DATA_HOME=str(self.home / ".local/share"))
        # Use upstream's real installer, not an approximation of its defaults.
        binary = self.home / ".local/bin/ai-memory"
        binary.parent.mkdir(parents=True)
        assert AI_MEMORY is not None
        shutil.copy2(AI_MEMORY, binary)
        subprocess.run([str(binary), "install-hooks", "--agent", "codex", "--apply",
                        "--server-url", "http://127.0.0.1:49374", "--hooks-dir", str(AI_MEMORY_HOOKS)],
                       cwd=self.cwd, env=self.env, check=True, capture_output=True, timeout=30)
        self.hooks = json.loads((self.codex_home / "hooks.json").read_text())["hooks"]
        self.hooks["Stop"].append({"hooks": [{"type": "command", "command": "printf unrelated-hook"}]})
        self.save_hooks()

    def save_hooks(self):
        (self.codex_home / "hooks.json").write_text(json.dumps({"hooks": self.hooks}))

    def run_helper(self, apply=True):
        return subprocess.run([sys.executable, str(HELPER), "--codex", CODEX,
                               "--cwd", str(self.cwd)] + (["--apply"] if apply else []),
                              env=self.env, capture_output=True, text=True, timeout=60)

    def rpc(self, method, params):
        # Use the same small transport, but independent inventory/config
        # assertions below test the actual persistent Codex API semantics.
        old = os.environ.copy()
        os.environ.clear()
        os.environ.update(self.env)
        try:
            with review.Codex(CODEX, 20) as client:
                client.initialize()
                return client.request(method, params)
        finally:
            os.environ.clear()
            os.environ.update(old)

    def hooks_inventory(self):
        return self.rpc("hooks/list", {"cwds": [str(self.cwd)]})["data"][0]["hooks"]

    def test_plan_does_not_write_then_apply_trusts_real_hooks(self):
        original = self.config.read_bytes()
        result = self.run_helper(apply=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("planned=8", result.stdout)
        self.assertEqual(self.config.read_bytes(), original)
        applied = self.run_helper()
        self.assertEqual(applied.returncode, 0, applied.stderr)
        hooks = self.hooks_inventory()
        self.assertEqual([h["trustStatus"] for h in hooks if "ai-memory" in h["command"]], ["trusted"] * 8)
        self.assertEqual([h["trustStatus"] for h in hooks if h["command"] == "printf unrelated-hook"], ["untrusted"])

    def test_preserves_unrelated_trust_disabled_hook_and_user_fields_and_rerun(self):
        hooks = self.hooks_inventory()
        unrelated = next(h for h in hooks if h["command"] == "printf unrelated-hook")
        disabled = next(h for h in hooks if h["eventName"] == "sessionEnd")
        self.rpc("config/batchWrite", {"edits": [{"keyPath": "hooks.state", "value": {
            unrelated["key"]: {"trusted_hash": unrelated["currentHash"]},
            disabled["key"]: {"enabled": False},
        }, "mergeStrategy": "upsert"}], "reloadUserConfig": True})
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("disabled-preserved=1 applied=7", result.stdout)
        config = tomllib.loads(self.config.read_text())
        self.assertEqual(config["model"], "gpt-5.4")
        self.assertEqual(config["model_reasoning_effort"], "low")
        self.assertEqual(config["hooks"]["state"][unrelated["key"]], {"trusted_hash": unrelated["currentHash"]})
        self.assertEqual(config["hooks"]["state"][disabled["key"]], {"enabled": False})
        hooks_after = {h["key"]: h for h in self.hooks_inventory()}
        self.assertEqual(hooks_after[disabled["key"]]["enabled"], False)
        self.assertEqual(hooks_after[disabled["key"]]["trustStatus"], "untrusted")
        self.assertEqual(hooks_after[unrelated["key"]]["trustStatus"], "trusted")
        before_rerun = self.config.read_bytes()
        rerun = self.run_helper()
        self.assertEqual(rerun.returncode, 0, rerun.stderr)
        self.assertIn("applied=0", rerun.stdout)
        self.assertEqual(self.config.read_bytes(), before_rerun)

    def test_malicious_changed_command_fails_without_mutation(self):
        self.hooks["SessionStart"][0]["hooks"][0]["command"] += "; printf malicious"
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("declaration differs", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_duplicate_event_fails_without_mutation(self):
        self.hooks["Stop"].append(copy.deepcopy(self.hooks["Stop"][0]))
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_missing_event_fails_without_mutation(self):
        del self.hooks["Interrupt"]
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_unexpected_ai_memory_entry_fails_without_mutation(self):
        self.hooks["Stop"].append({"hooks": [{"type": "command", "command": "ai_memory --arbitrary"}]})
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_async_hook_fails_without_mutation(self):
        self.hooks["PreToolUse"][0]["hooks"][0]["async"] = True
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("declaration differs", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_absent_upstream_matcher_fails_without_mutation(self):
        del self.hooks["PreToolUse"][0]["matcher"]
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("declaration differs", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_matcher_hook_fails_without_mutation(self):
        self.hooks["PreToolUse"][0]["matcher"] = "Bash"
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("declaration differs", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_custom_timeout_fails_without_mutation(self):
        self.hooks["PreToolUse"][0]["hooks"][0]["timeout"] = 42
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("declaration differs", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_custom_context_limit_fails_without_mutation(self):
        self.hooks["PreToolUse"][0]["hooks"][0]["additionalContextLimit"] = 0
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("declaration differs", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_custom_status_message_fails_without_mutation(self):
        self.hooks["PreToolUse"][0]["hooks"][0]["statusMessage"] = "custom status"
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("declaration differs", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_default_codex_home_is_supported(self):
        default_home = self.home / ".codex"
        self.codex_home.rename(default_home)
        self.codex_home = default_home
        self.config = default_home / "config.toml"
        del self.env["CODEX_HOME"]
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("applied=8", result.stdout)
        self.assertEqual([h["trustStatus"] for h in self.hooks_inventory() if "ai-memory" in h["command"]], ["trusted"] * 8)

    def test_inventory_parse_error_fails_without_mutation(self):
        (self.codex_home / "hooks.json").write_text("{broken json")
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("errors, warnings", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)

    def test_modified_previously_trusted_hook_is_not_reapproved(self):
        first = self.run_helper()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.hooks["SessionStart"][0]["hooks"][0]["command"] += " --unexpected"
        self.save_hooks()
        before = self.config.read_bytes()
        result = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertIn("declaration differs", result.stderr)
        self.assertEqual(self.config.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
