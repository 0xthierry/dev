#!/usr/bin/env python3
"""Offline REA installer/launcher integration tests in isolated homes/repos.

Package managers, mise, and Frida prebuild downloads are fake. A fake pinned
Node delegates installer validation and the stub prebuild CLI to real Node;
it records application arguments instead of running REA. Frida import checks
load a stub module, not a native binding. No network or MCP servers start.
"""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = "/usr/bin/node" if Path("/usr/bin/node").is_file() else shutil.which("node")


class ReaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rea-test-")
        self.addCleanup(self.temp.cleanup)
        self.fixture = Path(self.temp.name).resolve()
        self.home = self.fixture / "home with spaces"
        self.home.mkdir()
        self.repo = self.fixture / "repo with spaces"
        self.assets = self.repo / "configs/rea"
        self.assets.mkdir(parents=True)
        for name in ("rea", "rea-mcp", "package.json", "package-lock.json"):
            shutil.copy2(ROOT / "configs/rea" / name, self.assets / name)
        (self.repo / "install/packages").mkdir(parents=True)
        for name in ("rea.sh", "rea-prereqs.sh", "pacman.sh", "lib.sh", "packages/common.sh"):
            shutil.copy2(ROOT / "install" / name, self.repo / "install" / name)
        self.runtime = self.home / ".local/share/rea"
        self.launcher = self.home / ".local/bin/rea-mcp"
        self.tools = self.fixture / "fake tools"
        self.tools.mkdir()
        self.node = self.fixture / "pinned node/bin/node"
        self.entry = self.assets / "node_modules/rea-agents/scripts/rea.mjs"
        self.calls = self.fixture / "calls.jsonl"
        self.env = {key: value for key, value in os.environ.items()
                    if key not in ("BASH_ENV", "ENV", "NODE_OPTIONS", "NODE_PATH",
                                   "HOST_PACMAN_ARCHIVE_FALLBACK", "GHIDRA_INSTALL_DIR",
                                   "JAVA_HOME", "REA_TEST_PRINT_ENV")}
        self.env.update(HOME=str(self.home), PATH=f"{self.tools}:/usr/bin:/bin",
                        REA_TEST_CALLS=str(self.calls), REA_TEST_NODE=str(self.node),
                        REA_TEST_REAL_NODE=NODE or "", REA_TEST_OS="Linux")
        self.executable(self.tools / "uname", 'import os\nprint(os.environ["REA_TEST_OS"])\n')
        self.executable(self.tools / "mise", '''import os, sys
with open(os.environ["REA_TEST_CALLS"], "a") as log:
    log.write("mise " + " ".join(sys.argv[1:]) + "\\n")
if sys.argv[1] == "where":
    print(os.path.dirname(os.path.dirname(os.environ["REA_TEST_NODE"])))
elif sys.argv[1] != "install":
    sys.exit("unexpected mise operation")
''')
        self.executable(self.tools / "pacman", '''import os, sys
with open(os.environ["REA_TEST_CALLS"], "a") as log:
    log.write("pacman " + " ".join(sys.argv[1:]) + "\\n")
sys.exit(0 if os.environ.get("REA_TEST_PACKAGES_PRESENT") == "1" else 1)
''')
        self.executable(self.tools / "sudo", '''import os, sys
with open(os.environ["REA_TEST_CALLS"], "a") as log:
    log.write("sudo " + " ".join(sys.argv[1:]) + "\\n")
if sys.argv[1:] != ["pacman", "-S", "--needed", "--noconfirm", "procps-ng"]:
    sys.exit("unexpected privileged operation")
''')
        self.executable(self.node, '''import json, os, sys
if sys.argv[1:] == ["--version"]:
    with open(os.environ["REA_TEST_CALLS"], "a") as log:
        log.write("node-version\\n")
    print(os.environ.get("REA_TEST_NODE_VERSION", "v26.12.0"))
elif sys.argv[1] == "--input-type=module" or sys.argv[1].endswith("/prebuild-install/bin.js"):
    with open(os.environ["REA_TEST_CALLS"], "a") as log:
        log.write("node " + json.dumps(sys.argv[1:]) + "\\n")
    os.execv(os.environ["REA_TEST_REAL_NODE"], [os.environ["REA_TEST_REAL_NODE"], *sys.argv[1:]])
elif os.environ.get("REA_TEST_PRINT_ENV") == "1":
    with open(os.environ["REA_TEST_CALLS"], "a") as log:
        log.write("node-env\\n")
    print(json.dumps({"args": sys.argv[1:], "GHIDRA_INSTALL_DIR": os.environ.get("GHIDRA_INSTALL_DIR"),
                      "JAVA_HOME": os.environ.get("JAVA_HOME"), "PATH": os.environ.get("PATH")}))
else:
    print(json.dumps(sys.argv[1:]))
''')
        prebuild = r'''const fs = require('node:fs');
fs.appendFileSync(process.env.REA_TEST_CALLS, 'prebuild ' + JSON.stringify({
  cwd: process.cwd(), args: process.argv.slice(1)
}) + '\n');
if (process.env.REA_TEST_FRIDA_PREBUILD_FAIL === '1') {
  console.error('fixture Frida prebuild unavailable');
  process.exit(17);
}
fs.mkdirSync('build/src', {recursive: true});
fs.writeFileSync('build/src/frida.js', process.env.REA_TEST_FRIDA_LOAD_FAIL === '1'
  ? "throw new Error('fixture Frida binding cannot load');\n"
  : "import fs from 'node:fs';\n" +
    "fs.appendFileSync(process.env.REA_TEST_CALLS, 'frida loaded\\n');\n" +
    "export const version = 'fixture';\n");
'''
        self.executable(self.node.parent / "npm", '''import json, os, pathlib, sys
with open(os.environ["REA_TEST_CALLS"], "a") as log:
    log.write("npm " + " ".join(sys.argv[1:]) + "\\n")
if sys.argv[1:3] != ["ci", "--prefix"] or sys.argv[4:] != ["--ignore-scripts", "--no-audit", "--no-fund"]:
    sys.exit("unexpected npm operation")
assets = pathlib.Path(sys.argv[3])
package = assets / "node_modules/rea-agents"
(package / "scripts").mkdir(parents=True, exist_ok=True)
version = json.loads((assets / "package.json").read_text())["dependencies"]["rea-agents"]
(package / "package.json").write_text(json.dumps({"version": version}))
if os.environ.get("REA_TEST_INTERRUPT") == "1":
    sys.exit(9)
if os.environ.get("REA_TEST_INCOMPLETE") != "1":
    (package / "scripts/rea.mjs").write_text("// fixture entrypoint\\n")
frida = assets / "node_modules/frida"
frida.mkdir(parents=True, exist_ok=True)
(frida / "package.json").write_text(json.dumps({"type": "module"}))
module = frida / "build/src/frida.js"
if module.exists():
    module.unlink()
prebuild = assets / "node_modules/prebuild-install/bin.js"
prebuild.parent.mkdir(parents=True, exist_ok=True)
prebuild.write_text(''' + repr(prebuild) + ''')
''')

    def put(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def executable(self, path, body):
        self.put(path, f"#!{sys.executable}\n{body}")
        path.chmod(0o755)

    def installer(self, *args, prereqs=False):
        script = "rea-prereqs.sh" if prereqs else "rea.sh"
        return subprocess.run(["/bin/bash", str(self.repo / "install" / script), *args],
                              env=self.env, cwd=self.repo, capture_output=True, text=True, timeout=30)

    def launch(self, *args):
        return subprocess.run([str(self.assets / "rea-mcp"), *args], env=self.env,
                              cwd=self.home, capture_output=True, text=True, timeout=15)

    def launcher_runtime(self):
        self.put(self.entry, "// fixture entrypoint\n")
        self.put(self.runtime / "node-path", str(self.node) + "\n")
        (self.runtime / "source").symlink_to(self.assets)

    def foreign_link(self, target):
        foreign = self.fixture / "foreign file"
        foreign.write_text("preserve me")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(foreign)
        return foreign

    def test_all_host_dry_runs_leave_home_and_dependencies_untouched(self):
        dev = self.installer("dev", "--dry-run")
        mac = self.installer("macbook", "--dry-run")
        desktop = self.installer("omarchy", "--dry-run")
        self.assertEqual([dev.returncode, mac.returncode, desktop.returncode], [0, 0, 0])
        self.assertIn("npm ci --prefix", dev.stdout)
        self.assertIn("npm ci --prefix", mac.stdout)
        self.assertIn("npm ci --prefix", desktop.stdout)
        command = ["node", str(self.assets / "node_modules/prebuild-install/bin.js"),
                   "--runtime", "napi", "--target", "8"]
        self.assertIn(command, [shlex.split(line.removeprefix("[dry-run] "))
                                for line in dev.stdout.splitlines() if line.startswith("[dry-run] ")])
        self.assertIn(command, [shlex.split(line.removeprefix("[dry-run] "))
                                for line in mac.stdout.splitlines() if line.startswith("[dry-run] ")])
        self.assertIn(command, [shlex.split(line.removeprefix("[dry-run] "))
                                for line in desktop.stdout.splitlines() if line.startswith("[dry-run] ")])
        self.assertIn(str(self.assets / "node_modules/frida"), dev.stdout)
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse(self.calls.exists())
        self.assertFalse((self.assets / "node_modules").exists())

    def test_prerequisite_only_dry_runs_leave_no_runtime(self):
        dev = self.installer("dev", "--dry-run", prereqs=True)
        mac = self.installer("macbook", "--dry-run", prereqs=True)
        desktop = self.installer("omarchy", "--dry-run", prereqs=True)
        self.assertEqual([dev.returncode, mac.returncode, desktop.returncode], [0, 0, 0])
        self.assertIn("sudo pacman -S --needed --noconfirm procps-ng", dev.stdout)
        self.assertIn("mise install node@", mac.stdout)
        self.assertIn("sudo pacman -S --needed --noconfirm procps-ng", desktop.stdout)
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse(self.calls.exists())
        self.assertFalse((self.assets / "node_modules").exists())

    def test_invalid_hosts_fail_before_tools(self):
        runtime = self.installer("unknown")
        prereqs = self.installer("unknown", prereqs=True)
        self.assertEqual([runtime.returncode, prereqs.returncode], [1, 1])
        self.assertIn("requires dev, omarchy, or macbook", runtime.stderr)
        self.assertIn("require dev, omarchy, or macbook", prereqs.stderr)
        self.assertFalse(self.calls.exists())
        self.assertEqual(list(self.home.iterdir()), [])

    def test_extra_flags_fail_before_tools(self):
        runtime = self.installer("dev", "--force")
        prereqs = self.installer("dev", "--dry-run", "extra", prereqs=True)
        self.assertEqual([runtime.returncode, prereqs.returncode], [1, 1])
        self.assertIn("Usage:", runtime.stderr)
        self.assertIn("Usage:", prereqs.stderr)
        self.assertFalse(self.calls.exists())
        self.assertEqual(list(self.home.iterdir()), [])

    def test_foreign_runtime_symlink_is_rejected_before_tools(self):
        foreign = self.foreign_link(self.runtime)
        result = self.installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated REA runtime path", result.stderr)
        self.assertEqual(self.runtime.readlink(), foreign)
        self.assertEqual(foreign.read_text(), "preserve me")
        self.assertFalse(self.calls.exists())

    def test_foreign_source_symlink_is_rejected_before_tools(self):
        target = self.runtime / "source"
        foreign = self.foreign_link(target)
        result = self.installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated REA symlink", result.stderr)
        self.assertEqual(target.readlink(), foreign)
        self.assertEqual(foreign.read_text(), "preserve me")
        self.assertFalse(self.calls.exists())

    def test_foreign_mcp_launcher_symlink_is_rejected_before_tools(self):
        foreign = self.foreign_link(self.launcher)
        result = self.installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated REA symlink", result.stderr)
        self.assertEqual(self.launcher.readlink(), foreign)
        self.assertEqual(foreign.read_text(), "preserve me")
        self.assertFalse(self.calls.exists())

    def test_foreign_cli_launcher_symlink_is_rejected_before_tools(self):
        target = self.launcher.with_name("rea")
        foreign = self.foreign_link(target)
        result = self.installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated REA symlink", result.stderr)
        self.assertEqual(target.readlink(), foreign)
        self.assertEqual(foreign.read_text(), "preserve me")
        self.assertFalse(self.calls.exists())

    def test_foreign_node_path_symlink_is_rejected_before_tools(self):
        target = self.runtime / "node-path"
        foreign = self.foreign_link(target)
        result = self.installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated REA runtime path", result.stderr)
        self.assertEqual(target.readlink(), foreign)
        self.assertEqual(foreign.read_text(), "preserve me")
        self.assertFalse(self.calls.exists())

    def test_node_path_directory_is_rejected_before_tools(self):
        target = self.runtime / "node-path"
        target.mkdir(parents=True)
        self.put(target / "user-note", "keep")
        result = self.installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated REA runtime path", result.stderr)
        self.assertEqual((target / "user-note").read_text(), "keep")
        self.assertFalse(self.calls.exists())
        self.assertFalse(self.launcher.exists())

    def test_missing_runtime_launcher_reports_repair_command(self):
        result = self.launch()
        self.assertEqual(result.returncode, 1)
        self.assertIn("REA runtime is incomplete; run repository install/rea.sh", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.calls.exists())

    def test_missing_dependency_launcher_reports_repair_command(self):
        self.launcher_runtime()
        self.entry.unlink()
        result = self.launch()
        self.assertEqual(result.returncode, 1)
        self.assertIn("REA runtime is incomplete; run repository install/rea.sh", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.calls.exists())

    def test_relative_node_path_is_rejected_without_path_lookup(self):
        self.launcher_runtime()
        self.put(self.runtime / "node-path", "node\n")
        result = self.launch()
        self.assertEqual(result.returncode, 1)
        self.assertIn("REA runtime is incomplete", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_launch_uses_recorded_node_with_exact_mcp_arguments_without_package_tools(self):
        self.launcher_runtime()
        guard = 'import os, sys\nwith open(os.environ["REA_TEST_CALLS"], "a") as log:\n    log.write("forbidden launch-time tool\\n")\nsys.exit(1)\n'
        for name in ("node", "npm", "npx", "curl", "wget", "mise", "brew", "pacman", "sudo"):
            self.executable(self.tools / name, guard)
        self.env["PATH"] = str(self.tools) + ":/usr/bin:/bin"
        result = self.launch("--example", "argument with spaces")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [str(self.runtime / "source/node_modules/rea-agents/scripts/rea.mjs"),
                                                   "mcp", "--example", "argument with spaces"])
        self.assertFalse(self.calls.exists())

    def test_absent_native_records_preserve_caller_java_and_supply_gui_tool_paths(self):
        self.launcher_runtime()
        self.env.update(REA_TEST_PRINT_ENV="1", JAVA_HOME="/caller/jdk17")
        guard = 'import os, sys\nwith open(os.environ["REA_TEST_CALLS"], "a") as log:\n    log.write("forbidden launch-time tool\\n")\nsys.exit(1)\n'
        for name in ("npm", "npx", "mise", "brew", "pacman", "sudo"):
            self.executable(self.tools / name, guard)

        result = self.launch("--example", "argument with spaces")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            "args": [str(self.runtime / "source/node_modules/rea-agents/scripts/rea.mjs"),
                     "mcp", "--example", "argument with spaces"],
            "GHIDRA_INSTALL_DIR": None,
            "JAVA_HOME": "/caller/jdk17",
            "PATH": f"{self.node.parent}:{self.env['PATH']}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
        })
        self.assertEqual(self.calls.read_text(), "node-env\n")

    def test_native_records_set_ghidra_and_override_java_only_for_child(self):
        self.launcher_runtime()
        ghidra = self.fixture / "ghidra with spaces"
        java = self.fixture / "isolated jdk with spaces"
        self.executable(ghidra / "support/analyzeHeadless", "raise SystemExit('must not run')\n")
        self.executable(java / "bin/java", "raise SystemExit('must not run')\n")
        self.executable(java / "bin/javac", "raise SystemExit('must not run')\n")
        self.put(self.runtime / "ghidra-path", str(ghidra) + "\n")
        self.put(self.runtime / "java-home", str(java) + "\n")
        self.env.update(REA_TEST_PRINT_ENV="1", JAVA_HOME="/caller/jdk17")
        caller_env = self.env.copy()

        result = self.launch()

        self.assertEqual(result.returncode, 0, result.stderr)
        child = json.loads(result.stdout)
        self.assertEqual(child["GHIDRA_INSTALL_DIR"], str(ghidra))
        self.assertEqual(child["JAVA_HOME"], str(java))
        self.assertEqual(self.env, caller_env)
        self.assertEqual((self.runtime / "java-home").read_text(), str(java) + "\n")
        self.assertEqual(self.calls.read_text(), "node-env\n")

    def test_explicit_ghidra_override_wins_over_invalid_record(self):
        self.launcher_runtime()
        self.put(self.runtime / "ghidra-path", "invalid relative record\n")
        self.env.update(REA_TEST_PRINT_ENV="1", GHIDRA_INSTALL_DIR="/caller/ghidra")

        result = self.launch()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["GHIDRA_INSTALL_DIR"], "/caller/ghidra")
        self.assertEqual(self.calls.read_text(), "node-env\n")

    def test_relative_ghidra_record_fails_before_node(self):
        self.launcher_runtime()
        self.env["REA_TEST_PRINT_ENV"] = "1"
        self.executable(self.home / "relative-ghidra/support/analyzeHeadless", "pass\n")
        self.put(self.runtime / "ghidra-path", "relative-ghidra\n")

        result = self.launch()

        self.assertEqual(result.returncode, 1)
        self.assertIn("REA Ghidra runtime is incomplete; run repository install/rea-ghidra.sh", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.calls.exists())

    def test_missing_ghidra_record_target_fails_before_node(self):
        self.launcher_runtime()
        self.env["REA_TEST_PRINT_ENV"] = "1"
        self.put(self.runtime / "ghidra-path", str(self.fixture / "missing ghidra") + "\n")

        result = self.launch()

        self.assertEqual(result.returncode, 1)
        self.assertIn("REA Ghidra runtime is incomplete; run repository install/rea-ghidra.sh", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.calls.exists())

    def test_java_record_without_javac_fails_before_node(self):
        self.launcher_runtime()
        self.env["REA_TEST_PRINT_ENV"] = "1"
        java = self.fixture / "jre without compiler"
        self.executable(java / "bin/java", "pass\n")
        self.put(self.runtime / "java-home", str(java) + "\n")

        result = self.launch()

        self.assertEqual(result.returncode, 1)
        self.assertIn("REA Java runtime is incomplete; run repository install/rea-ghidra.sh", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.calls.exists())

    def test_native_records_treat_shell_expressions_as_literal_path_data(self):
        self.launcher_runtime()
        self.env["REA_TEST_PRINT_ENV"] = "1"
        ghidra = self.fixture / "ghidra $(touch ghidra-evaluated)"
        java = self.fixture / "jdk `touch java-evaluated`"
        self.executable(ghidra / "support/analyzeHeadless", "pass\n")
        self.executable(java / "bin/java", "pass\n")
        self.executable(java / "bin/javac", "pass\n")
        self.put(self.runtime / "ghidra-path", str(ghidra) + "\n")
        self.put(self.runtime / "java-home", str(java) + "\n")

        result = self.launch()

        self.assertEqual(result.returncode, 0, result.stderr)
        child = json.loads(result.stdout)
        self.assertEqual(child["GHIDRA_INSTALL_DIR"], str(ghidra))
        self.assertEqual(child["JAVA_HOME"], str(java))
        self.assertFalse((self.home / "ghidra-evaluated").exists())
        self.assertFalse((self.home / "java-evaluated").exists())
        self.assertEqual(self.calls.read_text(), "node-env\n")

    @unittest.skipUnless(NODE, "Node required for real installer JavaScript validation")
    def test_install_rerun_converges_and_preserves_unrelated_files(self):
        self.put(self.home / ".claude.json", '{"mcpServers":{"custom":{"command":"keep"}}}\n')
        self.put(self.home / ".codex/config.toml", '# keep\nmodel="custom"\n')
        self.put(self.home / ".pi/agent/mcp.json", '{"mcpServers":{}}\n')
        self.put(self.home / ".config/Claude/claude_desktop_config.json", '{"preferences":{"keep":true}}\n')
        self.put(self.runtime / "user-note", "keep")
        before = {path: path.read_bytes() for path in self.home.rglob("*") if path.is_file()}
        first = self.installer("dev")
        self.assertEqual(first.returncode, 0, first.stderr)
        node_before = (self.runtime / "node-path").stat().st_mtime_ns
        second = self.installer("dev")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual({path: path.read_bytes() for path in before}, before)
        self.assertEqual((self.runtime / "node-path").read_text(), str(self.node) + "\n")
        self.assertEqual((self.runtime / "node-path").stat().st_mtime_ns, node_before)
        self.assertEqual((self.runtime / "source").readlink(), self.assets)
        self.assertEqual(self.launcher.readlink(), self.assets / "rea-mcp")
        self.assertEqual(self.launcher.with_name("rea").readlink(), self.assets / "rea")
        self.assertEqual(list(self.home.rglob("*.bak*")), [])
        self.assertEqual(list(self.runtime.glob(".node-path.*")), [])
        launched = self.launch()
        self.assertEqual(launched.returncode, 0, launched.stderr)
        self.assertEqual(json.loads(launched.stdout), [str(self.runtime / "source/node_modules/rea-agents/scripts/rea.mjs"), "mcp"])

    @unittest.skipUnless(NODE, "Node required for real installer JavaScript validation")
    def test_install_provisions_frida_prebuild_with_pinned_node_then_loads_stub(self):
        result = self.installer("dev")

        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls.read_text().splitlines()
        prebuild = str(self.assets / "node_modules/prebuild-install/bin.js")
        self.assertEqual([json.loads(line.removeprefix("prebuild "))
                          for line in calls if line.startswith("prebuild ")],
                         [{"cwd": str(self.assets / "node_modules/frida"),
                           "args": [prebuild, "--runtime", "napi", "--target", "8"]}])
        self.assertEqual([json.loads(line.removeprefix("node "))
                          for line in calls if line.startswith("node ")],
                         [["--input-type=module", "-", str(self.assets)],
                          [prebuild, "--runtime", "napi", "--target", "8"],
                          ["--input-type=module", "-", str(self.assets)]])
        self.assertEqual(calls[-1], "frida loaded")
        self.assertEqual(self.launcher.readlink(), self.assets / "rea-mcp")
        self.assertEqual((self.runtime / "node-path").read_text(), str(self.node) + "\n")

    @unittest.skipUnless(NODE, "Node required for real installer JavaScript validation")
    def test_frida_prebuild_failure_publishes_no_runtime_and_rerun_recovers(self):
        self.env["REA_TEST_FRIDA_PREBUILD_FAIL"] = "1"
        failed = self.installer("dev")

        self.assertEqual(failed.returncode, 17, failed.stderr)
        self.assertIn("fixture Frida prebuild unavailable", failed.stderr)
        self.assertFalse(self.launcher.exists())
        self.assertFalse(self.launcher.with_name("rea").exists())
        self.assertFalse((self.runtime / "node-path").exists())
        self.assertFalse((self.runtime / "source").exists())
        self.assertFalse((self.assets / "node_modules/frida/build/src/frida.js").exists())
        self.assertNotIn("frida loaded", self.calls.read_text())

        del self.env["REA_TEST_FRIDA_PREBUILD_FAIL"]
        repaired = self.installer("dev")

        self.assertEqual(repaired.returncode, 0, repaired.stderr)
        self.assertEqual(self.launcher.readlink(), self.assets / "rea-mcp")
        self.assertEqual(self.launcher.with_name("rea").readlink(), self.assets / "rea")
        self.assertEqual((self.runtime / "node-path").read_text(), str(self.node) + "\n")
        self.assertEqual((self.runtime / "source").readlink(), self.assets)
        self.assertIn("frida loaded", self.calls.read_text().splitlines())

    @unittest.skipUnless(NODE, "Node required for real installer JavaScript validation")
    def test_frida_import_failure_prevents_runtime_publication(self):
        self.env["REA_TEST_FRIDA_LOAD_FAIL"] = "1"
        result = self.installer("dev")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("fixture Frida binding cannot load", result.stderr)
        self.assertTrue((self.assets / "node_modules/frida/build/src/frida.js").is_file())
        self.assertFalse(self.launcher.exists())
        self.assertFalse(self.launcher.with_name("rea").exists())
        self.assertFalse((self.runtime / "node-path").exists())
        self.assertFalse((self.runtime / "source").exists())
        self.assertNotIn("frida loaded", self.calls.read_text())

    @unittest.skipUnless(NODE, "Node required for real installer JavaScript validation")
    def test_interrupted_dependency_install_is_repaired_by_rerun(self):
        self.env["REA_TEST_INTERRUPT"] = "1"
        interrupted = self.installer("dev")
        self.assertEqual(interrupted.returncode, 9)
        self.assertFalse(self.launcher.exists())
        self.assertFalse((self.runtime / "node-path").exists())
        self.assertFalse(self.entry.exists())
        del self.env["REA_TEST_INTERRUPT"]
        repaired = self.installer("dev")
        self.assertEqual(repaired.returncode, 0, repaired.stderr)
        self.assertTrue(self.entry.is_file())
        self.assertEqual(self.launcher.readlink(), self.assets / "rea-mcp")
        result = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[1:], ["mcp"])

    @unittest.skipUnless(NODE, "Node required for real installer JavaScript validation")
    def test_incomplete_npm_success_fails_validation_then_rerun_repairs(self):
        self.env["REA_TEST_INCOMPLETE"] = "1"
        incomplete = self.installer("dev")
        self.assertNotEqual(incomplete.returncode, 0)
        self.assertIn("Incomplete or unpinned REA installation", incomplete.stderr)
        self.assertNotIn("prebuild ", self.calls.read_text())
        self.assertFalse(self.launcher.exists())
        self.assertFalse((self.runtime / "node-path").exists())
        del self.env["REA_TEST_INCOMPLETE"]
        repaired = self.installer("dev")
        self.assertEqual(repaired.returncode, 0, repaired.stderr)
        self.assertTrue(self.entry.is_file())
        self.assertEqual((self.runtime / "node-path").read_text(), str(self.node) + "\n")

    @unittest.skipUnless(NODE, "Node required for real installer JavaScript validation")
    def test_removed_dependency_is_repaired_in_existing_runtime(self):
        first = self.installer("dev")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.entry.unlink()
        broken = self.launch()
        self.assertEqual(broken.returncode, 1)
        self.assertIn("REA runtime is incomplete", broken.stderr)
        repaired = self.installer("dev")
        self.assertEqual(repaired.returncode, 0, repaired.stderr)
        launched = self.launch()
        self.assertEqual(launched.returncode, 0, launched.stderr)
        self.assertEqual(json.loads(launched.stdout), [str(self.runtime / "source/node_modules/rea-agents/scripts/rea.mjs"), "mcp"])

    def test_prerequisites_install_without_creating_runtime_or_client_files(self):
        result = self.installer("dev", prereqs=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("sudo pacman -S --needed --noconfirm procps-ng", self.calls.read_text())
        self.assertIn("mise install node@", self.calls.read_text())
        self.assertNotIn("npm ", self.calls.read_text())
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse((self.assets / "node_modules").exists())

    @unittest.skipUnless(NODE, "Node required for real installer JavaScript validation")
    def test_macbook_install_uses_mise_without_linux_package_manager(self):
        self.env["REA_TEST_OS"] = "Darwin"
        result = self.installer("macbook")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.runtime / "node-path").read_text(), str(self.node) + "\n")
        self.assertEqual(self.launcher.readlink(), self.assets / "rea-mcp")
        self.assertNotIn("pacman", self.calls.read_text())
        self.assertIn("mise install node@", self.calls.read_text())

    @unittest.skipUnless(NODE, "Node required for real installer JavaScript validation")
    def test_omarchy_install_skips_already_installed_prerequisite_packages(self):
        self.env["REA_TEST_PACKAGES_PRESENT"] = "1"
        result = self.installer("omarchy")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.runtime / "node-path").read_text(), str(self.node) + "\n")
        self.assertEqual(self.launcher.readlink(), self.assets / "rea-mcp")
        self.assertIn("pacman -Q procps-ng", self.calls.read_text())
        self.assertNotIn("sudo", self.calls.read_text())

    def test_os_mismatch_fails_before_package_commands(self):
        result = self.installer("macbook")
        self.assertEqual(result.returncode, 1)
        self.assertIn("host does not match this operating system", result.stderr)
        self.assertFalse(self.calls.exists())
        self.assertFalse(self.runtime.exists())

    def test_unsupported_os_fails_prerequisite_preflight(self):
        self.env["REA_TEST_OS"] = "FreeBSD"
        result = self.installer("dev", prereqs=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("host does not match this operating system", result.stderr)
        self.assertFalse(self.calls.exists())
        self.assertEqual(list(self.home.iterdir()), [])

    def test_wrong_pinned_node_version_fails_before_npm_and_runtime_writes(self):
        self.env["REA_TEST_NODE_VERSION"] = "v20.0.0"
        result = self.installer("dev")
        self.assertEqual(result.returncode, 1)
        self.assertIn("pinned REA Node/npm runtime is missing or has the wrong version", result.stderr)
        self.assertIn("mise install node@", self.calls.read_text())
        self.assertNotIn("npm ", self.calls.read_text())
        self.assertFalse(self.runtime.exists())
        self.assertFalse((self.assets / "node_modules").exists())


if __name__ == "__main__":
    unittest.main()
