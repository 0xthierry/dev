#!/usr/bin/env python3
"""Kernel fixture integration + real private ring/CLI tests; never installs a service."""
import fcntl
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/stall-capture"
loader = importlib.machinery.SourceFileLoader("stall_capture", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
capture = importlib.util.module_from_spec(spec)
loader.exec_module(capture)


class StallCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="stall-capture-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.proc = self.root / "proc"
        self.sys = self.root / "sys"
        self.output = self.root / "output"
        self.put("proc/sys/kernel/random/boot_id", "fixture-boot\n")
        self.put("proc/pressure/io", "some avg10=12.00 avg60=2.00 avg300=1.00 total=150\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=10\n")
        self.put("proc/vmstat", "pswpin 10\npgmajfault 20\noom_kill 0\n")
        self.put("proc/diskstats", "259 0 nvme0n1 10 0 20 2 30 0 40 4 0 6 7\n253 0 dm-0 11 0 22 3 33 0 44 5 0 7 8\n259 1 nvme0n1p1 10 0 20 2 30 0 40 4 0 6 7\n")
        (self.sys / "block/nvme0n1").mkdir(parents=True)
        (self.sys / "block/dm-0").mkdir()
        self.put("sys/fs/cgroup/cpu.stat", "usage_usec 100\n")
        self.put("sys/fs/cgroup/io.stat", "259:0 rbytes=10 wbytes=20 rios=1 wios=2\n")
        self.task(10, 30)
        self.put("proc/123/cmdline", "NEVER_CAPTURE_SECRET")
        self.put("proc/123/environ", "NEVER_CAPTURE_SECRET")

    def put(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def task(self, ticks, io, start=500):
        fields = ["S"] + ["0"] * 21
        fields[11], fields[12], fields[19] = str(ticks), "2", str(start)
        self.put("proc/123/stat", "123 (fixture worker) " + " ".join(fields))
        self.put("proc/123/io", f"read_bytes: {io}\nwrite_bytes: 4\n")

    def test_kernel_fixture_reports_deltas_devices_and_pressure(self):
        sampler = capture.Sampler(self.proc, self.sys)
        sampler.sample(5, 30)
        self.put("proc/vmstat", "pswpin 13\npgmajfault 22\noom_kill 0\n")
        result = sampler.sample(5, 30)
        self.assertEqual(result["vmstat_delta"], {"pswpin": 3, "pgmajfault": 2, "oom_kill": 0})
        self.assertEqual(sorted(result["diskstats"]), ["dm-0", "nvme0n1"])
        self.assertEqual(result["diskstats_delta"]["dm-0"]["sectors_read"], 0)
        self.assertEqual(result["flags"], ["io_some_avg10>=10"])
        self.assertEqual(result["boot_id"], "fixture-boot")

    def test_process_delta_uses_comm_without_cmdline_or_environment(self):
        sampler = capture.Sampler(self.proc, self.sys)
        sampler.tasks(None)
        self.task(25, 80)
        result = sampler.tasks(30)
        self.assertEqual(result["top_cpu"], [{"pid": 123, "comm": "fixture worker", "delta": {"cpu_ticks": 15, "read_bytes": 50, "write_bytes": 0}}])
        self.assertNotIn("NEVER_CAPTURE_SECRET", json.dumps(result))

    def test_pid_reuse_does_not_create_false_delta(self):
        sampler = capture.Sampler(self.proc, self.sys)
        sampler.tasks(None)
        self.task(100, 300, start=999)
        self.assertEqual(sampler.tasks(30)["top_cpu"], [])

    def test_cgroup_attribution_reports_io_and_cpu_deltas(self):
        sampler = capture.Sampler(self.proc, self.sys)
        sampler.groups()
        self.put("sys/fs/cgroup/cpu.stat", "usage_usec 150\n")
        self.put("sys/fs/cgroup/io.stat", "259:0 rbytes=35 wbytes=30 rios=2 wios=3\n")
        result = sampler.groups()
        self.assertEqual(result["groups"][0]["delta"], {"cpu_usage_usec": 50, "rbytes": 25, "wbytes": 10, "rios": 1, "wios": 1})

    def test_user_build_leaf_includes_memory_and_swap_evidence(self):
        leaf = f"sys/fs/cgroup/user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service/app.slice/run-build.scope"
        self.put(leaf + "/cpu.stat", "usage_usec 900\n")
        self.put(leaf + "/memory.stat", "anon 100\nfile 200\nshmem 30\nworkingset_refault_file 40\npgscan_direct 50\npgsteal_direct 60\n")
        self.put(leaf + "/memory.events.local", "oom 1\noom_kill 0\n")
        self.put(leaf + "/memory.swap.current", "1234\n")
        self.put(leaf + "/memory.swap.events", "high 2\nmax 3\nfail 0\n")
        result = capture.Sampler(self.proc, self.sys).groups()
        row = next(row for row in result["groups"] if row["path"].endswith("run-build.scope"))
        self.assertEqual(row["memory_stat"], {"anon": 100, "file": 200, "shmem": 30, "workingset_refault_file": 40, "pgscan_direct": 50, "pgsteal_direct": 60})
        self.assertEqual(row["memory_events_local"], {"oom": 1, "oom_kill": 0})
        self.assertEqual(row["swap_current"], "1234")
        self.assertEqual(row["swap_events"], {"high": 2, "max": 3, "fail": 0})

    def test_installer_opt_in_and_rollback_leave_recordings(self):
        fakebin = self.root / "bin"
        fakebin.mkdir()
        systemctl = fakebin / "systemctl"
        systemctl.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n')
        systemctl.chmod(0o755)
        home = self.root / "home"
        calls = self.root / "calls"
        environment = dict(os.environ, HOME=str(home), PATH=f"{fakebin}:{os.environ['PATH']}", CALLS=str(calls))
        installer = str(ROOT / "scripts/stall-capture-install")
        subprocess.run([installer, "--install"], env=environment, check=True, capture_output=True)
        self.assertEqual(calls.read_text(), "--user daemon-reload\n")
        # User-manager PATH may start with a multi-threaded runtime shim that
        # aborts at TasksMax=4; run the stdlib program with system Python.
        unit = (home / '.config/systemd/user/stall-capture.service').read_text()
        self.assertIn('ExecStart=/usr/bin/python3 -I %h/.local/bin/stall-capture ', unit)
        subprocess.run([installer, "--enable"], env=environment, check=True, capture_output=True)
        self.assertIn("--user enable --now stall-capture.service\n", calls.read_text())
        self.put("home/.local/state/stall-capture/samples.jsonl", "keep evidence\n")
        subprocess.run([installer, "--remove"], env=environment, check=True, capture_output=True)
        self.assertEqual((home / ".local/state/stall-capture/samples.jsonl").read_text(), "keep evidence\n")
        self.assertFalse((home / ".config/systemd/user/stall-capture.service").exists())
        self.assertFalse((home / ".local/bin/stall-capture").is_symlink())
        self.assertIn("--user disable --now stall-capture.service\n", calls.read_text())

    def test_ring_rotates_and_keeps_private_bounded_records(self):
        ring = capture.Ring(self.output, 64, 2)
        self.addCleanup(os.close, ring.lock)
        ring.append({"type": "incident", "value": "x" * 20})
        ring.append({"type": "two", "value": "x" * 20})
        self.assertEqual(json.loads((self.output / "samples.1.jsonl").read_text())["type"], "incident")
        ring.append({"type": "three", "value": "x" * 20})
        self.assertEqual(json.loads((self.output / "samples.jsonl").read_text())["type"], "three")
        self.assertEqual(json.loads((self.output / "samples.1.jsonl").read_text())["type"], "two")
        self.assertLessEqual(sum(p.stat().st_size for p in self.output.iterdir()), 128)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.output / "samples.jsonl").stat().st_mode), 0o600)

    def test_rejects_public_directory_and_symlink_file(self):
        self.output.mkdir(mode=0o755)
        with self.assertRaisesRegex(ValueError, "0700"):
            capture.Ring(self.output, 65536, 2)
        self.output.chmod(0o700)
        ring = capture.Ring(self.output, 65536, 2)
        self.addCleanup(os.close, ring.lock)
        target = self.root / "untouched"
        target.write_text("original")
        (self.output / "samples.jsonl").symlink_to(target)
        with self.assertRaises(OSError):
            ring.append({"type": "sample"})
        self.assertEqual(target.read_text(), "original")

    def test_cli_fixture_capture_and_incident_marker(self):
        command = [str(SCRIPT), "--proc-root", str(self.proc), "--sys-root", str(self.sys), "--output", str(self.output)]
        subprocess.run(command + ["--duration", "1"], check=True, capture_output=True, timeout=5)
        subprocess.run(command + ["--mark"], check=True, capture_output=True, timeout=5)
        records = [json.loads(line) for line in (self.output / "samples.jsonl").read_text().splitlines()]
        self.assertEqual([record["type"] for record in records], ["start", "sample", "stop", "incident"])
        self.assertEqual(records[1]["cgroups"]["groups"][0]["counters"]["cpu_usage_usec"], 100)
        self.assertEqual(records[3]["boot_id"], "fixture-boot")
        self.assertIn("boottime_s", records[3])

    def test_active_collector_excludes_second_capture_but_allows_marker(self):
        ring = capture.Ring(self.output, 65536, 2)
        self.addCleanup(os.close, ring.lock)
        lock = ring.open_file("capture.lock")
        self.addCleanup(os.close, lock)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        command = [str(SCRIPT), "--output", str(self.output), "--proc-root", str(self.proc)]
        second = subprocess.run(command + ["--duration", "1"], text=True, capture_output=True, timeout=5)
        self.assertEqual(second.returncode, 1)
        subprocess.run(command + ["--mark"], check=True, capture_output=True, timeout=5)
        records = [json.loads(line) for line in (self.output / "samples.jsonl").read_text().splitlines()]
        self.assertEqual([record["type"] for record in records], ["incident"])
        self.assertEqual(records[0]["boot_id"], "fixture-boot")

    def test_cli_rejects_unbounded_duration_before_creating_output(self):
        result = subprocess.run([str(SCRIPT), "--output", str(self.output), "--duration", "0"], text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
