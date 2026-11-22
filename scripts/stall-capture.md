# Stall evidence, without adding a workload

Linux, Python 3 standard library only. No root, Docker, sockets, subprocess probes,
command lines, environment, stack traces, open-file names, or application logs are
collected. Only `/proc` and `/sys` counters and bounded process `comm`/cgroup names
are read. Those names are still private metadata: review before sharing.

## Capture a suspected incident (no deployment)

From this checkout:

```sh
# Default: 5-second samples for 15 minutes, not an unbounded foreground process.
scripts/stall-capture
# Intensive manual window: 2-second sampling for 15 minutes; attribution stays 30s.
scripts/stall-capture --interval 2 --duration 900
# Mark the moment of a visible stall/recovery, even while the recorder is running.
scripts/stall-capture --mark
```

A `start` record is also a timestamp. Marker text is deliberately not accepted, to
avoid accidental secrets. Each record includes UTC, monotonic and boot-relative
clocks; samples/start/stop/markers carry the boot ID. After a hard freeze, mark as
soon as input returns; after reboot, preserve the ring promptly before it rotates.

Default data: `~/.local/state/stall-capture` (or `$XDG_STATE_HOME/stall-capture` for
the CLI). Directory mode **0700**, files **0600**, at most **four 4 MiB JSONL
segments** (16 MiB plus two empty lock files). Rotation is size-based, **not a
promise of a particular number of hours**. `samples.jsonl` is newest;
`samples.1.jsonl` is the next oldest, up to `.3`. One collector per output directory;
a concurrent collector fails rather than mixing its baselines. Markers use the
same write lock and survive segment rotation until their segment ages out; they
are **not permanent archives**. Existing public directories, symlink files, and hard-linked files
are rejected, not silently repaired. Use a separate `--output` for a different
capture budget; do not reconfigure a running ring.

Each sample is appended immediately (no userspace batch); no per-sample fsync
storm. A power loss may lose buffered tail records. A fully frozen kernel cannot
be sampled: the useful evidence is the **history preceding it**, not an assertion
that userspace can diagnose every kernel hang. Sampling gaps can also mean suspend,
CPU throttling, recorder delays or clock scheduling, not necessarily a desktop bug.

## Explicit opt-in pre-incident history

A foreground recorder started after a freeze cannot reconstruct its lead-up. The
optional systemd **user** service keeps the same private ring while logged in:

```sh
# Install a repo-linked executable and unit, but do not start anything:
scripts/stall-capture-install --install
# OR install and explicitly opt in to recording now and on future user sessions:
scripts/stall-capture-install --enable
systemctl --user status stall-capture.service
```

From the canonical workstation checkout the exact opt-in command is:
`~/dev/scripts/stall-capture-install --enable`.
The first system sample is written **immediately when the service process starts**
(no initial 5-second wait). The first process/cgroup delta window becomes available
after about **30 seconds**; an incident marker can be written immediately.

This is **not part of ordinary setup**, requires no sudo/linger, and enables no
network endpoint. Keep the checkout at its installed path (the executable is a
symlink). The service fixes output to `~/.local/state/stall-capture` regardless of
XDG overrides; when marking a service recording with a custom XDG environment use
`stall-capture --output ~/.local/state/stall-capture --mark`.

The service runs bounded 15-minute captures, restarts after 5 seconds, and uses
5-second sampling, attribution every 30 seconds, nice 19, idle I/O scheduling,
5% CPU quota, 96 MiB memory ceiling, and four tasks maximum. The quota is a safety
ceiling, not expected utilization. No 1-second always-on scan. Restart boundaries
reset deltas and introduce a short gap. No auto-triggered profiler, stress tool,
workload launch, or automatic system tuning is performed.

Rollback (retains all recording data):

```sh
scripts/stall-capture-install --remove
```

After deployment, verify `systemctl --user is-active stall-capture.service` returns
`active`, inspect the latest `sample` record in
`~/.local/state/stall-capture/samples.jsonl`, then check again after 35 seconds for
a sample containing `processes.window_s` around 30 and non-baseline deltas. The
same-path foreground command should fail while the service holds `capture.lock`;
`--mark` should still append an `incident` record. A service that is merely enabled
is not proof it is collecting: check the actual timestamped JSONL.

At the next recovered freeze:

```sh
stall-capture --output ~/.local/state/stall-capture --mark
systemctl --user stop stall-capture.service
```

This preserves the current ring against further automatic rotation until you
restart the service. Inspect/copy the private segments before restarting; correlate
the marker UTC/boot ID with sar and oomd journal evidence. A successful manual
marker is only timestamp evidence, not a reproduction or diagnosis of the freeze.

Or pause across future logins without uninstalling:
`systemctl --user disable --now stall-capture.service`.
The installer refuses to overwrite unrelated executables or units. Installation
and rollback have only been tested against an isolated HOME/fake systemctl unless
separate deployment evidence is supplied; running these commands changes live state.

## What to inspect

Read segments oldest to newest. JSONL can be processed offline; no special viewer
or daemon is needed. Correlate with sar/journal timestamps and boot ID.

- **PSI**: CPU, memory and I/O `some`/`full` averages and cumulative microseconds.
  `flags` marks any available avg10 >= 10%, a deliberately simple investigation
  hint, **not root-cause detection**. CPU `some` is often normal under load.
- **vmstat deltas**: swap-in/out pages, major faults, OOM kills, reclaim and
  allocation/compaction stalls where the kernel exposes those counters. Missing
  counters stay missing, resets do not create negative deltas.
- **Memory/scheduler**: selected meminfo KiB and runnable/blocked process counts.
- **diskstats**: raw cumulative counters and interval deltas for whole block
  devices from `/sys/block`, including physical disks and `dm-*`; partitions are
  excluded. Sectors are Linux diskstats 512-byte sectors, timings are ms.
  `in_flight` is a gauge, not a delta. Divide deltas by `elapsed_s` for rates.
  **Do not sum dm and backing-device I/O**: the same operation can appear twice.
- **Processes**: every 30 seconds, top ten CPU-tick and I/O-byte delta rows among
  at most 512 visited processes (at most 2048 proc directory entries inspected).
  PID plus starttime prevents PID-reuse errors. Divide CPU ticks by the start
  record's `clock_ticks_per_second` and attribution `window_s`; CPU may exceed a
  single core. A baseline sample has no top deltas; unreadable `/proc/PID/io`
  leaves CPU-only attribution. Processes that disappear between windows may be
  missed. Selection is bounded enumeration, **not guaranteed global top-N**.
- **Cgroups v2**: at most 64 reported groups, 128 visited directories and 1024
  enumerated entries (128 per directory), bounded breadth-first. Seeded paths
  include the current user's service and app.slice plus system.slice; discovered
  `run-*` transient build and `docker-*` scope names are prioritized without
  contacting Docker. CPU/I/O deltas, memory.current, memory.events and
  memory.events.local, memory.stat anon/file/shmem, workingset_refault_file/anon,
  pgscan/pgsteal, memory.swap.current/events and all three PSI files are included
  when readable. Memory event/stat values are cumulative snapshots (compare them
  across windows); CPU/I/O include ready-made deltas.
  Root and parent counters include descendants: **do not sum hierarchy levels**.
  Deep or busy trees can be truncated. Names identify groups, not command lines.
- **Scheduling gaps**: `sampling_gap` when elapsed monotonic time exceeds twice
  the requested interval. Missing/restricted kernel files are empty structures,
  never invented zero activity. Read sizes are capped at 64 KiB per kernel file.

For suspected OOM kills, correlate the incident window with:

```sh
journalctl -u systemd-oomd --since '2026-11-22 12:00:00' --until '2026-11-22 12:20:00'
```

Use the actual local incident time and correct boot (`-b` or `-b -1` as needed).
Journal access depends on permissions; the recorder does not elevate. **systemd-oomd
may SIGKILL a cgroup without incrementing the kernel's `oom_kill` counter**, so a
zero counter does not exclude userspace OOM action. The recorder itself never reads
or stores journals, which may contain sensitive application information.

Limits intentionally trade complete attribution for bounded overhead. This is a
first evidence layer for the next freeze, not a replacement for kernel crash dumps,
full tracing or sar retention. Nothing changes kernel/sysctl/container settings.

## Verification

```sh
python3 tests/stall-capture.test.py
bash -n scripts/stall-capture-install
shellcheck scripts/stall-capture-install
```

Tests use synthetic proc/sys trees and a real temporary filesystem to exercise
counter deltas, pressure hints, physical+dm filtering, PID reuse, private rotation,
symlink rejection, incident markers and CLI bounds. Installer checks use an
isolated HOME and fake systemctl; they never enable a real service.

A safe optional operator check is a **six-second** foreground capture to a fresh
private temporary output directory. Check sample records and modes, then remove
only that temporary directory. Do not enable the service as part of testing.
