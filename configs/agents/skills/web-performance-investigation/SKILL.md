---
name: web-performance-investigation
description: Use to investigate browser performance or memory regressions with repeatable scenarios, matched source/build evidence, controlled measurements, and privacy-safe reports on local Omarchy or macOS desktops.
---

# Web performance investigation

Start with the observed user problem, not a profiler. Read `browser-diagnostics` for controller selection, target verification, command syntax, tool ownership, capture lifecycle, and artifact handling. Use the user-requested or already available browser controller under those selection rules; this investigation does not require a particular controller. Diagnostic access never overrides authentication or policy failures.

## Establish the reproduction contract

Read the repository's agent guide, package scripts, launch instructions, and nearby tests. Identify the actual application URL, prerequisites, build mode, fixture or approved account, and readiness signal. Use its documented commands. Do not assume a framework, port, package manager, design system, or local backend. Missing services or approved credentials are blockers, not permission to substitute a fake application.

Write down:

- The user-visible symptom and the smallest interaction sequence that reproduces it.
- The expected result and the failure threshold, if one exists.
- The source revision, uncommitted changes, served build identity, browser version, and target ID/URL.
- The initial state, warmup, cycle count, duration, cache/service-worker state, and measurement settings.
- What would disprove the leading explanation.

Verify the browser actually serves the code under investigation. A checked-out revision or `--build` label is insufficient. Match asset identity and source maps to that build. Development HMR and production assets have different costs; compare like with like. If maps are missing or stale, report that limit instead of assigning generated offsets to unrelated source.

## Separate experiments

1. Reproduce through the approved browser interaction surface selected for this task without heavy instrumentation. Record the observable failure.
2. Choose one measurement that can distinguish competing explanations. For rendering or load delay, use the pinned MCP performance trace/insights. For CPU, requests, or scenario coverage, use the bounded CLI. For retention, use matched heaps and MCP analysis.
3. Verify the same target in each tool. Serialize all recorders. For the CLI, wait for stdout `{"status":"recording","run":"ABS_PATH","kind":"cpu","targetId":"ID"}` with the expected kind and target before input. For `chrome-devtools-cli call performance_start_trace`, pass the verified numeric `pageId` explicitly and wait for successful start confirmation; stop with `performance_stop_trace` on the same page within the declared time budget. Read `browser-diagnostics` for the verified schemas. Do not start a browser-wide trace while unrelated tabs are open.
4. Run several matched samples where practical. Record individual observations and variation; one favorable run does not establish an improvement.
5. Change one cause at a time, verify the served build, and repeat the same scenario. Confirm the original user-visible failure separately from any internal metric.

Keep clean timing runs separate from coverage, allocation/heap capture, and forced GC. Instrumentation changes execution cost. A cache-disabled reload is a different experiment from a warm interaction; disabling HTTP cache does not clear service-worker caches or application storage. Do not erase profile/login state to claim a cold run without authorization.

For network evidence, distinguish failed requests, repeated requests, transfer cost, and server waiting. For coverage, report code not executed by this scenario; do not conclude it is safe to delete. For CPU, distinguish JavaScript samples from rendering, network, and idle time. Use the appropriate trace instead of treating CPU samples as total page latency.

## Memory retention and false-leak controls

Use a fixed lifecycle sequence: a baseline after warmup, a declared number of mount/open/close/unmount cycles, and a post-cycle observation. Repeat with the same cycle count and settling period. If using explicit GC, apply the same GC policy to both snapshots and keep these results out of clean timing comparisons. Heap size growth alone is not proof of a leak; inspect retaining paths and whether retained instances continue to accumulate across repetitions.

DevTools can itself retain objects. Console evaluation, semantic element queries, selected nodes, global variables, and remote object handles can keep DOM trees alive. Avoid storing DOM nodes or returning object graphs during a retention test. Prefer primitive-only counts or booleans and release diagnostic object groups/handles through supported APIs. When previous tooling may have retained nodes, repeat with a fresh authorized target state and no semantic element queries. Keep the application interaction sequence unchanged.

A prior experiment initially showed retained DOM after semantic element queries had created DevTools global handles. A primitive-only control removed that explanation and still showed accumulating `CookieStore` listeners. The lesson is to test both causes: tool-induced retention can coexist with an application lifecycle defect. Do not infer that every detached node is a leak, or that finding a DevTools handle disproves all application retention.

A useful retention report identifies the accumulating instance/listener type, the retaining path, cycle-normalized growth, the lifecycle owner expected to release it, and the primitive-only control result. Prove a listener cleanup fix with the same cycles and verify application behavior still works.

## Failure and reporting

Stop on target drift, event cursor loss, overflow, timeout, incomplete capture, unconfirmed cleanup, or permission/authentication failure. Keep the run's failure status. Never compare an incomplete capture as though it were an empty or fast successful run.

Use the capture CLI's `summarize` and `compare` on the returned absolute run paths, and `chrome-devtools-cli call TOOL '<JSON>'` for bounded MCP trace/heap analysis. Discover the installed schemas with `chrome-devtools-cli list TOOL`; no Chrome DevTools MCP tools are registered directly in Codex. Heap tools take the `.heapsnapshot` file path, not the run directory. Start with `get_heapsnapshot_summary`, then paginated `query_heapsnapshot_objects` and `get_heapsnapshot_retainers` using node IDs from that same snapshot. Broad `compare_heapsnapshots` responses can be large; prefer bounded queries when a private, bounded output path is unavailable. Close loaded snapshots with `close_heapsnapshot`, then stop the diagnostics client with `chrome-devtools-cli stop` after all captures and analysis finish. Keep the client running across related calls; a backend restart does not preserve an in-progress trace. Keep files inside the launcher's private artifact root; do not widen client roots or bypass a file access denial. Review compatibility yourself; a tool-produced delta does not prove matched experiments. Do not print raw heaps, full profiles, response bodies, or protocol logs. Private local artifacts may contain credentials and user data. Do not upload or commit them; redact the small report before sharing.

Report:

- Reproduction and environment/build identity, including mismatches or unknowns.
- Measurement kind, target verification, duration/cycles, cache and GC controls, and sample count.
- Before/after observations with variation and local evidence paths.
- The supported explanation, alternatives tested, and limits of the evidence.
- The code change, regression checks, and whether the original symptom recovered.

Distinguish an isolated deterministic fixture test from host installation/readiness and from an authenticated model run attached to the real Brave browser through the selected browser controller. A fixture proves the measurement mechanism only. An installation check proves the installed artifacts only to the extent exercised. Model acceptance must show actual target selection, recording readiness, interaction through the selected controller, complete artifacts, bounded analysis, and cleanup. Do not claim any level passed without its recorded evidence. Functional acceptance does not establish process confinement or permission-policy enforcement.
