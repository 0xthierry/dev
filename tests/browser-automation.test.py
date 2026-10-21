#!/usr/bin/env python3
"""Installer/launcher integration tests in disposable homes; never control a browser.

Most cases replace only the npm registry boundary with published-shape fixtures.
The upstream case installs the checked lock in a temporary repo and runs real help
entrypoints, not MCP servers. No user runtime, browser, or extension is touched.
"""
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = subprocess.check_output(["node", "-p", "process.execPath"], text=True).strip()
NPM = str(Path(NODE).with_name("npm"))


class BrowserAutomationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="browser-automation-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo with spaces"
        self.assets = self.root / "configs/browser-automation"
        shutil.copytree(ROOT / "configs/browser-automation", self.assets,
                        ignore=shutil.ignore_patterns("node_modules"))
        (self.root / "install").mkdir()
        shutil.copy2(ROOT / "install/browser-automation.sh", self.root / "install/browser-automation.sh")
        shutil.copy2(ROOT / "install/lib.sh", self.root / "install/lib.sh")
        self.home = Path(self.temp.name) / "home with spaces"
        self.home.mkdir()
        self.bin = Path(self.temp.name) / "fixture-bin"
        self.bin.mkdir()
        (self.bin / "node").symlink_to(NODE)
        self.put(self.bin / "npm", "#!/bin/sh\nexec /usr/bin/python3 \"$NPM_FIXTURE\" \"$@\"\n", executable=True)
        fixture = Path(self.temp.name) / "npm-fixture.py"
        self.put(fixture, '''import json, os, pathlib, sys
pathlib.Path(os.environ["NPM_LOG"]).write_text(json.dumps(sys.argv[1:]))
if os.environ.get("FAIL_NPM"):
    sys.exit(19)
root = pathlib.Path(sys.argv[sys.argv.index("--prefix") + 1])
for name, version, entry in [("playwriter", "0.9.0", "bin.js"),
                             ("chrome-devtools-mcp", "1.9.0", "build/src/bin/chrome-devtools-mcp.js")]:
    directory = root / "node_modules" / name
    (directory / entry).parent.mkdir(parents=True, exist_ok=True)
    (directory / "package.json").write_text(json.dumps({"version": version, "bin": {name: entry}}))
    (directory / entry).write_text("console.log(JSON.stringify({args:process.argv.slice(2),node:process.execPath}));")
if os.environ.get("BAD_PACKAGE"):
    (root / "node_modules/playwriter/package.json").write_text('{"version":"wrong","bin":{}}')
''')
        self.env = dict(os.environ, HOME=str(self.home), PATH=f"{self.bin}:/usr/bin:/bin",
                        NPM_FIXTURE=str(fixture), NPM_LOG=str(Path(self.temp.name) / "npm-log"))
        self.runtime = self.home / ".local/share/browser-automation"

    def put(self, path, content, executable=False):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        if executable:
            path.chmod(0o755)

    def install(self, *args):
        return subprocess.run(["/bin/bash", str(self.root / "install/browser-automation.sh"), *args],
                              env=self.env, capture_output=True, text=True, timeout=120)

    def launch(self, command, *args):
        return subprocess.run([str(self.home / ".local/bin" / command), *args],
                              env=dict(self.env, PATH="/usr/bin:/bin"),
                              capture_output=True, text=True, timeout=30)

    def test_install_and_minimal_gui_path_launchers_preserve_arguments(self):
        result = self.install("omarchy")
        self.assertEqual(result.returncode, 0, result.stderr)
        cli = self.launch("playwriter", "-s", "session 1", "-e", "console.log('hello')")
        mcp = self.launch("playwriter-mcp")
        diagnostics = self.launch("chrome-devtools-mcp")
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.assertEqual(mcp.returncode, 0, mcp.stderr)
        self.assertEqual(diagnostics.returncode, 0, diagnostics.stderr)
        self.assertEqual(json.loads(cli.stdout), {"node": NODE, "args": ["-s", "session 1", "-e", "console.log('hello')"]})
        self.assertEqual(json.loads(mcp.stdout), {"node": NODE, "args": []})
        self.assertEqual(json.loads(diagnostics.stdout), {"node": NODE, "args": [
            "--browserUrl=http://127.0.0.1:9222", "--no-usage-statistics", "--no-performance-crux",
            "--memory-debugging", "--redact-network-headers"]})
        self.assertEqual(json.loads(Path(self.env["NPM_LOG"]).read_text()), [
            "ci", "--prefix", str(self.assets), "--ignore-scripts", "--no-audit", "--no-fund"])

    def test_rerun_is_stable_and_regular_launcher_is_backed_up(self):
        target = self.home / ".local/bin/playwriter"
        self.put(target, "old user command")
        first = self.install("dev")
        before = (self.runtime / "node-path").stat().st_mtime_ns
        repeated = self.install("dev")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assertEqual(Path(str(target) + ".bak").read_text(), "old user command")
        self.assertEqual(target.resolve(), self.assets / "playwriter")
        self.assertEqual((self.runtime / "node-path").stat().st_mtime_ns, before)
        self.assertFalse(Path(str(target) + ".bak.1").exists())

    def test_foreign_symlink_is_rejected_before_package_install(self):
        target = self.home / ".local/bin/chrome-devtools-mcp"
        target.parent.mkdir(parents=True)
        target.symlink_to("/foreign/launcher")
        result = self.install("macbook")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated browser automation symlink", result.stderr)
        self.assertEqual(os.readlink(target), "/foreign/launcher")
        self.assertFalse(Path(self.env["NPM_LOG"]).exists())
        self.assertFalse(self.runtime.exists())

    def test_command_directory_is_rejected_before_install_or_partial_publication(self):
        conflict = self.home / ".local/bin/chrome-devtools-mcp"
        conflict.mkdir(parents=True)
        (conflict / "keep").write_text("user directory")
        result = self.install("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing browser automation command directory", result.stderr)
        self.assertEqual((conflict / "keep").read_text(), "user directory")
        self.assertFalse(Path(self.env["NPM_LOG"]).exists())
        self.assertFalse((self.home / ".local/bin/playwriter").exists())
        self.assertFalse(self.runtime.exists())

    def test_foreign_node_path_symlink_is_rejected_before_package_install(self):
        self.runtime.mkdir(parents=True)
        (self.runtime / "node-path").symlink_to("/foreign/node-path")
        result = self.install("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated browser automation runtime path", result.stderr)
        self.assertEqual(os.readlink(self.runtime / "node-path"), "/foreign/node-path")
        self.assertFalse(Path(self.env["NPM_LOG"]).exists())

    def test_dry_run_needs_no_node_and_writes_nothing(self):
        (self.bin / "node").unlink()
        result = self.install("macbook", "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("npm ci --prefix", result.stdout)
        self.assertIn("playwriter-mcp", result.stdout)
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse(Path(self.env["NPM_LOG"]).exists())

    def test_install_failure_does_not_publish_launchers_and_retry_converges(self):
        self.env["FAIL_NPM"] = "1"
        failed = self.install("dev")
        self.assertFalse((self.home / ".local/bin").exists())
        self.assertFalse(self.runtime.exists())
        self.env.pop("FAIL_NPM")
        retry = self.install("dev")
        self.assertEqual(failed.returncode, 19)
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertEqual(json.loads(self.launch("playwriter-mcp").stdout), {"node": NODE, "args": []})

    def test_invalid_installed_package_is_rejected_without_publishing(self):
        self.env["BAD_PACKAGE"] = "1"
        result = self.install("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Incomplete or unpinned browser runtime", result.stderr)
        self.assertFalse((self.home / ".local/bin").exists())
        self.assertFalse(self.runtime.exists())

    def test_missing_node_record_reports_recovery(self):
        installed = self.install("dev")
        (self.runtime / "node-path").unlink()
        result = self.launch("playwriter")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertEqual(result.returncode, 1)
        self.assertIn("runtime is missing; rerun host setup", result.stderr)

    def test_mcp_launchers_reject_browser_launch_and_endpoint_overrides(self):
        installed = self.install("dev")
        diagnostics = self.launch("chrome-devtools-mcp", "--browserUrl=http://remote:9222")
        browser = self.launch("playwriter-mcp", "browser", "start", "--headless")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertEqual(diagnostics.returncode, 1)
        self.assertIn("fixed existing browser", diagnostics.stderr)
        self.assertEqual(browser.returncode, 1)
        self.assertIn("takes no arguments", browser.stderr)

    def test_mcp_rejects_inherited_direct_selector_without_restricting_cli(self):
        installed = self.install("dev")
        self.env["PLAYWRITER_DIRECT"] = "wss://cloud.example/browser"
        mcp = self.launch("playwriter-mcp")
        cli = self.launch("playwriter", "--help")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertEqual(mcp.returncode, 1)
        self.assertIn("unset PLAYWRITER_DIRECT in the MCP client environment", mcp.stderr)
        self.assertEqual(mcp.stdout, "")
        self.assertEqual(json.loads(cli.stdout), {"node": NODE, "args": ["--help"]})

    def test_mcp_rejects_inherited_remote_host_before_runtime_is_loaded(self):
        installed = self.install("dev")
        self.env["PLAYWRITER_HOST"] = "https://remote.example"
        (self.runtime / "node-path").unlink()
        result = self.launch("playwriter-mcp")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unset PLAYWRITER_HOST in the MCP client environment", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_mcp_preserves_nontransport_environment_without_generating_mode_arguments(self):
        installed = self.install("dev")
        self.env.update(PLAYWRITER_SESSION="cloud-session", PLAYWRITER_REMOTE="remote-session",
                        PLAYWRITER_HEADLESS="1", PLAYWRITER_CLOUD_URL="https://cloud.example",
                        PLAYWRITER_TOKEN="local-auth", PLAYWRITER_EXEC_TIMEOUT="25000",
                        USER_APP_SETTING="keep", PLAYWRITER_DIRECT="", PLAYWRITER_HOST="")
        # Observe the upstream process boundary. 0.9.0 MCP ignores the CLI-only
        # selectors; retaining them must not synthesize CLI mode arguments.
        self.put(self.assets / "node_modules/playwriter/bin.js", '''console.log(JSON.stringify({
args:process.argv.slice(2), session:process.env.PLAYWRITER_SESSION,
remote:process.env.PLAYWRITER_REMOTE, headless:process.env.PLAYWRITER_HEADLESS,
cloud:process.env.PLAYWRITER_CLOUD_URL, token:process.env.PLAYWRITER_TOKEN,
timeout:process.env.PLAYWRITER_EXEC_TIMEOUT, app:process.env.USER_APP_SETTING}));''')
        result = self.launch("playwriter-mcp")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            "args": [], "session": "cloud-session", "remote": "remote-session", "headless": "1",
            "cloud": "https://cloud.example", "token": "local-auth", "timeout": "25000", "app": "keep"})

    def test_unknown_host_is_rejected_without_side_effects(self):
        result = self.install("unknown")
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires dev, omarchy, or macbook", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse(Path(self.env["NPM_LOG"]).exists())

    def test_real_frozen_packages_start_help_with_gui_path_without_browser(self):
        # Registry/network boundary is real here; npm runs only in this disposable repo.
        (self.bin / "npm").unlink()
        self.put(self.bin / "npm", f'#!/bin/sh\nexec {shlex.quote(NPM)} "$@"\n', executable=True)
        result = self.install("dev")
        self.assertEqual(result.returncode, 0, result.stderr)
        cli = self.launch("playwriter", "--help")
        mcp = self.launch("playwriter-mcp", "--help")
        diagnostics = self.launch("chrome-devtools-mcp", "--help")
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.assertIn("session", cli.stdout)
        self.assertEqual(mcp.returncode, 0, mcp.stderr)
        self.assertIn("MCP", mcp.stdout)
        self.assertEqual(diagnostics.returncode, 0, diagnostics.stderr)
        self.assertIn("--browserUrl", diagnostics.stdout)
        self.assertIn("--performanceCrux", diagnostics.stdout)
        self.assertIn("--usageStatistics", diagnostics.stdout)
        self.assertEqual((self.runtime / "node-path").read_text(), NODE + "\n")


if __name__ == "__main__":
    unittest.main()
