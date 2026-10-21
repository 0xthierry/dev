#!/usr/bin/env python3
"""Offline filesystem/subprocess integration tests for shared MCP runtime wiring.

Execute real repository Python/Bash scripts in a copied temporary repository.
Node and package-manager boundaries are fake; no packages or servers are started.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class McpRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mcp-runtime-test-")
        self.addCleanup(self.temp.cleanup)
        self.fixture = Path(self.temp.name).resolve()
        self.home = self.fixture / "home with spaces"
        self.home.mkdir()
        self.repo = self.fixture / "repo with spaces"
        self.assets = self.repo / "configs/mcp"
        self.assets.mkdir(parents=True)
        (self.repo / "install").mkdir()
        for name in ("bridge.py", "catalog.json", "mcp-service"):
            shutil.copy2(ROOT / "configs/mcp" / name, self.assets / name)
        for name in ("mcp.sh", "lib.sh", "browser-automation.sh"):
            shutil.copy2(ROOT / "install" / name, self.repo / "install" / name)
        self.browser_assets = self.repo / "configs/browser-automation"
        self.browser_assets.mkdir()
        for name in ("package.json", "package-lock.json", "runtime.sh", "playwriter", "playwriter-mcp", "chrome-devtools-mcp"):
            shutil.copy2(ROOT / "configs/browser-automation" / name, self.browser_assets / name)
        self.runtime = self.home / ".local/share/mcp-services"
        self.launcher = self.home / ".local/bin/mcp-service"
        self.tools = self.fixture / "fake tools"
        self.tools.mkdir()
        self.calls = self.fixture / "tool-calls.jsonl"
        self.env = {key: value for key, value in os.environ.items()
                    if key not in ("CLAUDE_CONFIG_DIR", "CODEX_HOME", "PI_CODING_AGENT_DIR",
                                   "XDG_CONFIG_HOME", "BASH_ENV", "ENV")}
        self.env.update(HOME=str(self.home), PATH=f"{self.tools}:{os.environ['PATH']}",
                        MCP_TEST_CALLS=str(self.calls))
        self.node = self.tools / "node"
        self.proxy = self.assets / "node_modules/mcp-remote/dist/proxy.js"

    def put(self, path, content, executable=False):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        if executable:
            path.chmod(0o755)

    def executable(self, path, body):
        self.put(path, f"#!{sys.executable}\n{body}", executable=True)

    def bridge_runtime(self):
        self.put(self.proxy, "// fixture proxy; fake Node only records argv\n")
        self.executable(self.node, "import json, sys\nprint(json.dumps(sys.argv[1:]))\n")
        self.put(self.runtime / "runtime.json", json.dumps({"node": str(self.node)}))

    def bridge(self, service="neon"):
        return subprocess.run([sys.executable, str(self.assets / "bridge.py"), service],
                              env=self.env, cwd=self.repo, capture_output=True, text=True, timeout=15)

    def wrapper_runtime(self):
        self.bridge_runtime()
        python = self.runtime / "venv/bin/python"
        python.parent.mkdir(parents=True)
        python.symlink_to(sys.executable)
        (self.runtime / "source").symlink_to(self.assets, target_is_directory=True)

    def wrapper(self, *arguments):
        return subprocess.run(["bash", str(self.assets / "mcp-service"), *arguments],
                              env=self.env, cwd=self.home, capture_output=True, text=True, timeout=15)

    def installer(self, *arguments):
        return subprocess.run(["bash", str(self.repo / "install/mcp.sh"), *arguments],
                              env=self.env, cwd=self.repo, capture_output=True, text=True, timeout=15)

    def guard_package_tools(self):
        body = '''import json, os, sys
with open(os.environ["MCP_TEST_CALLS"], "a") as stream:
    stream.write(json.dumps(sys.argv) + "\\n")
sys.exit("unexpected package/runtime command")
'''
        for name in ("uv", "npm", "node"):
            self.executable(self.tools / name, body)

    def change_url(self, name, url):
        path = self.assets / "catalog.json"
        catalog = json.loads(path.read_text())
        catalog[name]["url"] = url
        path.write_text(json.dumps(catalog))

    def test_neon_https_bridge_passes_exact_http_only_loopback_callback_arguments(self):
        self.bridge_runtime()
        result = self.bridge("neon")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [str(self.proxy), "https://mcp.neon.tech/mcp",
                         "--transport", "http-only", "--host", "127.0.0.1"])

    def test_datadog_uses_us5_https_endpoint_without_allow_http(self):
        self.bridge_runtime()
        result = self.bridge("datadog")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [str(self.proxy), "https://mcp.us5.datadoghq.com/v1/mcp",
                         "--transport", "http-only", "--host", "127.0.0.1"])

    def test_figma_uses_https_endpoint_without_allow_http(self):
        self.bridge_runtime()
        result = self.bridge("figma")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [str(self.proxy), "https://mcp.figma.com/mcp",
                         "--transport", "http-only", "--host", "127.0.0.1"])

    def test_ai_memory_uses_native_bridge_without_node_or_oauth_runtime(self):
        self.executable(self.home / ".local/bin/ai-memory", "import json,sys\nprint(json.dumps(sys.argv[1:]))\n")
        result = self.bridge("ai-memory")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), ["mcp-bridge", "--no-session-id"])

    def test_ai_memory_does_not_take_its_endpoint_from_legacy_catalog(self):
        self.change_url("ai-memory", "http://example.invalid:49374/mcp")
        self.executable(self.home / ".local/bin/ai-memory", "import json,sys\nprint(json.dumps(sys.argv[1:]))\n")
        result = self.bridge("ai-memory")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), ["mcp-bridge", "--no-session-id"])

    def test_ai_memory_missing_client_fails_instead_of_falling_back_to_localhost(self):
        result = self.bridge("ai-memory")
        self.assertEqual(result.returncode, 1)
        self.assertIn("ai-memory", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_remote_services_reject_plaintext_even_on_loopback(self):
        self.bridge_runtime()
        self.change_url("neon", "http://127.0.0.1:49374/mcp")
        result = self.bridge("neon")
        self.assertEqual(result.returncode, 1)
        self.assertIn("remote MCP services require HTTPS", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_unknown_service_is_rejected_before_runtime_lookup(self):
        result = self.bridge("unknown")
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid choice: 'unknown'", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.runtime.exists())

    def test_local_launcher_service_cannot_be_used_as_http_bridge(self):
        self.bridge_runtime()
        result = self.bridge("blender")
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid choice: 'blender'", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_missing_runtime_configuration_fails_without_launch(self):
        result = self.bridge()
        self.assertEqual(result.returncode, 1)
        self.assertIn("runtime.json", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.runtime.exists())

    def test_missing_pinned_proxy_reports_incomplete_runtime(self):
        self.bridge_runtime()
        self.proxy.unlink()
        result = self.bridge()
        self.assertEqual(result.returncode, 1)
        self.assertIn("MCP bridge runtime is incomplete; rerun install/mcp.sh", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_nonexecutable_node_reports_incomplete_runtime(self):
        self.bridge_runtime()
        self.node.chmod(0o644)
        result = self.bridge()
        self.assertEqual(result.returncode, 1)
        self.assertIn("MCP bridge runtime is incomplete; rerun install/mcp.sh", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_relative_node_path_is_rejected_instead_of_searching_path(self):
        self.bridge_runtime()
        self.put(self.runtime / "runtime.json", '{"node":"node"}')
        result = self.bridge()
        self.assertEqual(result.returncode, 1)
        self.assertIn("MCP bridge runtime is incomplete; rerun install/mcp.sh", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_wrapper_executes_managed_python_bridge_from_any_working_directory(self):
        self.wrapper_runtime()
        result = self.wrapper("datadog")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [str(self.proxy), "https://mcp.us5.datadoghq.com/v1/mcp",
                         "--transport", "http-only", "--host", "127.0.0.1"])

    def test_wrapper_propagates_argument_errors(self):
        self.wrapper_runtime()
        result = self.wrapper("neon", "unexpected argument")
        self.assertEqual(result.returncode, 2)
        self.assertIn("unrecognized arguments: unexpected argument", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_wrapper_missing_runtime_has_actionable_error(self):
        result = self.wrapper("neon")
        self.assertEqual(result.returncode, 1)
        self.assertIn("shared MCP runtime missing; run repository install/mcp.sh for this host", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.runtime.exists())

    def test_installer_dry_run_has_no_writes_or_package_runtime_execution(self):
        self.guard_package_tools()
        result = self.installer("dev", "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("uv venv --no-config --no-project --allow-existing --python 3.12", result.stdout)
        self.assertIn("uv pip sync --no-config --python", result.stdout)
        self.assertIn("--require-hashes --only-binary :all:", result.stdout)
        self.assertIn("npm ci --prefix", result.stdout)
        self.assertIn("--ignore-scripts --no-audit --no-fund", result.stdout)
        self.assertIn("configure-clients.py dev", result.stdout)
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse(self.calls.exists())
        self.assertFalse((self.assets / "node_modules").exists())

    def test_installer_rejects_foreign_source_symlink_before_package_commands(self):
        self.guard_package_tools()
        foreign = self.fixture / "foreign source"
        foreign.mkdir()
        self.runtime.mkdir(parents=True)
        source = self.runtime / "source"
        source.symlink_to(foreign, target_is_directory=True)
        result = self.installer("omarchy")
        self.assertEqual(result.returncode, 1)
        self.assertIn("shared MCP runtime source is a foreign symlink", result.stderr)
        self.assertEqual(source.readlink(), foreign)
        self.assertEqual(list(foreign.iterdir()), [])
        self.assertFalse(self.calls.exists())
        self.assertFalse(self.launcher.exists())

    def test_installer_rejects_foreign_launcher_symlink_before_package_commands(self):
        self.guard_package_tools()
        foreign = self.fixture / "foreign launcher"
        foreign.write_text("preserve")
        self.launcher.parent.mkdir(parents=True)
        self.launcher.symlink_to(foreign)
        result = self.installer("macbook")
        self.assertEqual(result.returncode, 1)
        self.assertIn("shared MCP launcher is a foreign symlink", result.stderr)
        self.assertEqual(self.launcher.readlink(), foreign)
        self.assertEqual(foreign.read_text(), "preserve")
        self.assertFalse(self.calls.exists())
        self.assertFalse(self.runtime.exists())

    def test_installer_dry_run_also_rejects_foreign_source_symlink(self):
        self.guard_package_tools()
        self.runtime.mkdir(parents=True)
        source = self.runtime / "source"
        source.symlink_to(self.fixture / "missing foreign source")
        result = self.installer("dev", "--dry-run")
        self.assertEqual(result.returncode, 1)
        self.assertIn("shared MCP runtime source is a foreign symlink", result.stderr)
        self.assertTrue(source.is_symlink())
        self.assertFalse(self.calls.exists())

    def test_installer_rejects_invalid_host_before_any_work(self):
        self.guard_package_tools()
        result = self.installer("unknown")
        self.assertEqual(result.returncode, 1)
        self.assertIn("shared MCP setup requires dev, macbook, or omarchy", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse(self.calls.exists())

    def test_installer_records_node_and_links_runtime_using_fake_package_boundaries(self):
        # Only package installation and the downstream client renderer are replaced.
        # Actual installer, filesystem operations, JSON writer, and links stay real.
        self.executable(self.tools / "uv", '''import json, os, pathlib, sys
with open(os.environ["MCP_TEST_CALLS"], "a") as stream:
    stream.write(json.dumps(["uv", *sys.argv[1:]]) + "\\n")
if sys.argv[1] == "venv":
    target = pathlib.Path(sys.argv[-1]) / "bin/python"
    target.parent.mkdir(parents=True)
    target.symlink_to(sys.executable)
''')
        self.executable(self.tools / "npm", '''import json, os, sys
with open(os.environ["MCP_TEST_CALLS"], "a") as stream:
    stream.write(json.dumps(["npm", *sys.argv[1:]]) + "\\n")
''')
        self.executable(self.node, '''import json, os, pathlib, sys
with open(os.environ["MCP_TEST_CALLS"], "a") as stream:
    stream.write(json.dumps(["node", *sys.argv[1:]]) + "\\n")
print(pathlib.Path(__file__).resolve())
''')
        self.put(self.assets / "configure-clients.py", '''import json, pathlib, sys
(pathlib.Path.home() / "renderer-arguments.json").write_text(json.dumps(sys.argv[1:]))
''')
        result = self.installer("omarchy")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.runtime / "runtime.json").read_text()), {"node": str(self.node)})
        self.assertEqual((self.runtime / "runtime.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.runtime / "source").readlink(), self.assets)
        self.assertEqual(self.launcher.readlink(), self.assets / "mcp-service")
        self.assertEqual(json.loads((self.home / "renderer-arguments.json").read_text()), ["omarchy"])
        self.assertEqual((self.home / ".local/bin/playwriter-mcp").readlink(), self.browser_assets / "playwriter-mcp")
        self.assertEqual((self.home / ".local/bin/chrome-devtools-mcp").readlink(), self.browser_assets / "chrome-devtools-mcp")
        self.assertEqual([json.loads(line) for line in self.calls.read_text().splitlines()], [
            ["uv", "venv", "--no-config", "--no-project", "--allow-existing", "--python", "3.12", str(self.runtime / "venv")],
            ["uv", "pip", "sync", "--no-config", "--python", str(self.runtime / "venv/bin/python"),
             "--require-hashes", "--only-binary", ":all:", str(self.assets / "requirements.lock")],
            ["npm", "ci", "--prefix", str(self.assets), "--ignore-scripts", "--no-audit", "--no-fund"],
            ["node", "-p", "process.execPath"],
            ["node", "-p", "process.execPath"],
            ["npm", "ci", "--prefix", str(self.browser_assets), "--ignore-scripts", "--no-audit", "--no-fund"],
            ["node", "--input-type=module", "-", str(self.browser_assets)],
        ])


if __name__ == "__main__":
    unittest.main()
