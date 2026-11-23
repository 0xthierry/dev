#!/usr/bin/env python3
"""Docker installer adapter tests: real shell/merge/files, fake systemd only.

No live system changes. The fixture relocates hardcoded /etc paths in a copy of
our installer; it does not substitute its policy logic. Real systemd's dependency
semantics and dockerd's schema validation remain operator checks, not claims here.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DockerStartupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="docker-startup-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        (self.repo / "install/hosts").mkdir(parents=True)
        for name in ("docker.sh", "lib.sh", "flatpak.sh"):
            shutil.copy(ROOT / "install" / name, self.repo / "install" / name)
        host = (ROOT / "install/hosts/omarchy.sh").read_text()
        (self.repo / "install/hosts/omarchy.sh").write_text(
            host.replace('"/etc/', f'"{self.root}/etc/'))
        shutil.copytree(ROOT / "configs/omarchy", self.repo / "configs/omarchy")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.state = self.root / "state.json"
        self.set_state("inactive")
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "STATE": str(self.state), "HOME": str(self.root),
                    "USER": "fixture", "REPO_ROOT": str(self.repo)}
        self.executable("sudo", '#!/bin/sh\nexec "$@"\n')
        self.executable("pacman", "#!/bin/sh\nexit 0\n")
        self.executable("groups", "#!/bin/sh\necho 'fixture docker'\n")
        self.executable("docker", '#!/bin/sh\ntouch "$HOME/client-used"\nexit 99\n')
        self.executable("dockerd", '''#!/usr/bin/env python3
import json, sys
assert sys.argv[1:3] == ["--validate", "--config-file"]
json.load(open(sys.argv[3]))
''')
        self.executable("systemctl", '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p = os.environ["STATE"]
s = json.load(open(p))
a = sys.argv[1:]
s["calls"].append(a)
json.dump(s, open(p, "w"))
if s.get("fail_on") == a:
    sys.exit(42)
if a == ["show", "docker.service", "--property=UnitFileState", "--value"]:
    print(s["unit_file_state"])
elif a == ["enable", "docker.service"]:
    s["unit_file_state"] = "enabled"
elif a == ["show", "docker.service", "--property=ActiveState", "--value"]:
    print(s["engine"])
elif a == ["start", "--job-mode=fail", "docker.service"]:
    if s["engine"] not in ("inactive", "failed"):
        Path(os.environ["HOME"], "unsafe-systemctl").touch()
        sys.exit("live engine touched")
    s["engine"] = "active"
    s["socket"] = True
elif a == ["daemon-reload"]:
    pass
else:
    Path(os.environ["HOME"], "unsafe-systemctl").touch()
    raise SystemExit("Unexpected or dangerous systemctl operation: " + repr(a))
json.dump(s, open(p, "w"))
''')
        self.daemon = self.root / "etc/docker/daemon.json"
        self.daemon.parent.mkdir(parents=True)
        self.daemon.write_text('{"log-driver":"local","builder":{"gc":{"custom":true}}}\n')

    def executable(self, name, body):
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o755)

    def tearDown(self):
        self.assertFalse((self.root / "client-used").exists(), "installer connected a Docker client")
        self.assertFalse((self.root / "unsafe-systemctl").exists(), "unexpected systemctl operation")

    def set_state(self, engine, unit_file_state="disabled", fail_on=None):
        self.state.write_text(json.dumps({"engine": engine, "socket": engine not in ("inactive", "failed"),
                                         "unit_file_state": unit_file_state, "fail_on": fail_on, "calls": []}))

    def status(self):
        state = json.loads(self.state.read_text())
        return state["engine"], state["socket"], state["unit_file_state"]

    def run_policy(self, *args):
        return subprocess.run(["bash", str(self.repo / "install/docker.sh"),
                               "omarchy", "--policy-only", *args],
                              env=self.env, capture_output=True, text=True, timeout=10)

    def test_idle_repeat_enables_once_starts_once_and_preserves_policy(self):
        first = self.run_policy()
        second = self.run_policy()
        self.assertEqual((first.returncode, second.returncode), (0, 0), first.stderr + second.stderr)
        state = json.loads(self.state.read_text())
        self.assertEqual(self.status(), ("active", True, "enabled"))
        self.assertEqual(state["calls"].count(["enable", "docker.service"]), 1)
        self.assertEqual(state["calls"].count(["start", "--job-mode=fail", "docker.service"]), 1)
        daemon = json.loads(self.daemon.read_text())
        self.assertEqual(daemon["log-driver"], "local")
        self.assertEqual(daemon["cgroup-parent"], "system-docker.slice")
        self.assertEqual(daemon["builder"]["gc"]["custom"], True)
        self.assertEqual(daemon["builder"]["gc"]["policy"][-1]["maxUsedSpace"], "300GB")
        installed = self.root / "etc/systemd/system/system-docker.slice.d/90-dev-setup-memory.conf"
        self.assertIn("MemoryHigh=24G\nMemoryMax=32G\nMemorySwapMax=8G", installed.read_text())
        self.assertEqual(state["calls"].count(["daemon-reload"]), 1)
        socket_policy = self.root / "etc/systemd/system/docker.socket.d/90-dev-setup-standby.conf"
        self.assertEqual(socket_policy.read_text(),
                         "[Unit]\n# Close the API listener when the manually started engine is stopped.\nPartOf=docker.service\n")

    def apply_to_state(self, engine, **options):
        self.set_state(engine, **options)
        self.run_policy().check_returncode()
        return self.status()

    def test_active_engine_is_preserved_and_runtime_enable_is_made_persistent(self):
        self.assertEqual(self.apply_to_state("active", unit_file_state="enabled-runtime"),
                         ("active", True, "enabled"))

    def test_activating_engine_is_preserved(self):
        self.assertEqual(self.apply_to_state("activating"), ("activating", True, "enabled"))

    def test_deactivating_engine_is_preserved(self):
        self.assertEqual(self.apply_to_state("deactivating"), ("deactivating", True, "enabled"))

    def test_reloading_engine_is_preserved(self):
        self.assertEqual(self.apply_to_state("reloading"), ("reloading", True, "enabled"))

    def test_failed_engine_is_started_even_when_already_enabled(self):
        self.assertEqual(self.apply_to_state("failed", unit_file_state="enabled"), ("active", True, "enabled"))

    def test_enable_failure_does_not_start_engine(self):
        self.set_state("inactive", fail_on=["enable", "docker.service"])
        self.assertEqual(self.run_policy().returncode, 42)
        self.assertEqual(self.status(), ("inactive", False, "disabled"))

    def test_state_query_failure_does_not_start_engine(self):
        self.set_state("inactive", fail_on=["show", "docker.service", "--property=ActiveState", "--value"])
        self.assertEqual(self.run_policy().returncode, 42)
        self.assertEqual(self.status(), ("inactive", False, "enabled"))

    def test_start_failure_is_reported(self):
        self.set_state("failed", fail_on=["start", "--job-mode=fail", "docker.service"])
        self.assertEqual(self.run_policy().returncode, 42)
        self.assertEqual(self.status(), ("failed", False, "enabled"))

    def test_install_path_also_applies_fragment_and_startup(self):
        result = subprocess.run(["bash", str(self.repo / "install/docker.sh"), "omarchy"],
                                env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.status(), ("active", True, "enabled"))
        self.assertEqual(json.loads(self.daemon.read_text())["cgroup-parent"], "system-docker.slice")

    def test_dry_run_plans_without_touching_files_or_systemd(self):
        before = self.daemon.read_text()
        result = self.run_policy("--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("systemctl enable docker.service", result.stdout)
        self.assertIn("start docker.service only if inactive or failed", result.stdout)
        self.assertEqual(json.loads(self.state.read_text())["calls"], [])
        self.assertEqual(self.daemon.read_text(), before)
        self.assertFalse((self.root / "etc/systemd").exists())

    def test_host_policy_is_noop_for_macbook(self):
        result = subprocess.run(["bash", "-c", '''set -euo pipefail
source "$REPO_ROOT/install/docker.sh"
source "$REPO_ROOT/install/hosts/omarchy.sh"
SETUP_HOST=macbook
configure_omarchy_docker_policy
configure_omarchy_docker_startup
'''], env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.state.read_text())["calls"], [])
        self.assertEqual(json.loads(self.daemon.read_text()),
                         {"log-driver": "local", "builder": {"gc": {"custom": True}}})

    def test_cli_rejects_non_omarchy_before_changes(self):
        result = subprocess.run(["bash", str(self.repo / "install/docker.sh"), "macbook"],
                                env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Usage:", result.stderr)
        self.assertEqual(json.loads(self.state.read_text())["calls"], [])

    def test_invalid_daemon_json_is_not_replaced(self):
        self.daemon.write_text("invalid json\n")
        result = self.run_policy()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.daemon.read_text(), "invalid json\n")
        self.assertIn("refusing to replace", result.stdout)


if __name__ == "__main__":
    unittest.main()
