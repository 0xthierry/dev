---
name: browser-diagnostics
description: Use to collect bounded CPU, network, JavaScript coverage, heap, or performance evidence from the existing local Brave browser on Omarchy or macOS while the selected browser controller owns interaction. Attach through the existing loopback CDP endpoint; do not launch another browser.
---

# Browser diagnostics

Use this skill for measurement on the existing local Brave browser. The repo installer supplies `chrome-devtools-cli` and `browser-diagnostics` on Omarchy and macOS. If either command is missing, report the missing installation; do not install an ad hoc MCP server or substitute browser. The endpoint is local to the machine running the agent, not a browser on a remote desktop. Use the `web-performance-investigation` skill to design the experiment and interpret results. Discover the checked-out repository's launch, test, and reproduction instructions first; this skill does not define an application or development-server command.

## Ownership and permission

- Use the browser-control tool the user requested. Otherwise, keep the controller already in use for the session, or use an available browser-control tool authorized for the task. This skill does not prefer a particular controller or require installing another one. If the requested tool is unavailable, report the blocker and ask before substituting; if no authorized controller is available, report that interaction is blocked.
- The selected controller owns navigation, clicks, typing, and application interaction. Read its usage instructions, follow its permission requirements, and use the existing Brave session. Do not change controllers merely to run diagnostics.
- The repo-owned capture CLI and pinned Chrome DevTools MCP, reached through the installed MCP client CLI, are a narrow diagnostic exception. They may collect evidence, inspect diagnostic results, and apply explicitly requested measurement controls such as reload, cache disabling, or garbage collection. They are not alternative browser controllers.
- A policy denial, missing controller authentication, unavailable site permission, or unavailable application login is a blocker. Do not switch to CDP, MCP, Playwright, or direct requests to bypass it. Do not remove safety text or fabricate successful policy reads.
- Attach only to the existing local Brave browser at `127.0.0.1:9222`. Do not expose or tunnel its debugging endpoint, start another browser to make a check pass, or introduce network environment configuration. If attachment fails, confirm the agent runs on that desktop and report whether the repo-managed Brave launcher or macOS login configuration has been applied. An already-running browser may predate its launch flags; ask before restarting it, because that affects the user's session.

## Select and verify the target

1. Use the selected controller's browser discovery to identify the intended tab and its URL. Confirm it is the authorized application and build.
2. List diagnostic targets and match the actual target ID and URL. Never select the first page blindly or assume controller tab IDs are CDP target IDs.
3. Run `doctor` with the exact target ID and expected URL. Resolve ambiguity before recording. Recheck after navigation or tab replacement; do not silently retarget a run.
4. Through `chrome-devtools-cli`, call `list_pages` with `{}`, then `select_page` with the verified numeric `pageId` and `bringToFront: false`. Match the page URL and context to the same controller tab/CDP target. A numeric MCP page ID is not a CDP target ID. If identity cannot be established, stop. Pass `pageId` explicitly to page-scoped diagnostic tools even after selection.

```bash
browser-diagnostics targets
browser-diagnostics doctor --target ID --url URL
```

Keep target output private: even URLs and titles can contain sensitive data. Browser-wide performance tracing requires a disposable browser state with no unrelated tabs. Do not close unrelated user tabs without authorization; report this as a blocker instead.

## Discover and call MCP tools through the CLI

Chrome DevTools is **not registered as a native MCP server in Pi, Claude, or Codex**. Use the shell commands below; do not look for native `mcp__chrome_devtools__*` tools or add an MCP server to an agent config. The pinned MCP client keeps the backend alive between commands so active traces and loaded heaps retain their state.

```bash
chrome-devtools-cli list
chrome-devtools-cli list performance_start_trace
chrome-devtools-cli call list_pages '{}'
chrome-devtools-cli status
```

`list` returns the allowed tools and their installed schemas; `list TOOL` narrows discovery. `call TOOL '<JSON>'` accepts one JSON argument object and returns the MCP result. Check the exit status and returned result before continuing. Shell stdout is retained in the session: redirect large or sensitive results to a new file under the private artifact root with `umask 077`, then read only a small, reviewed summary. Do not print raw heaps, response bodies, or credential-bearing object values. Do not invoke the backend launcher or the underlying generic client directly, change its config, or supply another transport/server to escape the diagnostic allowlist.

For an interaction trace, set the shell variable `PAGE_ID` to the verified numeric ID before running these commands. Wait for successful start confirmation before using the selected browser controller to interact, then stop on the same page. Use a new private output path for each run.

```bash
umask 077
# The preceding client discovery call has created its private artifact root.
trace_dir="$(mktemp -d "$HOME/.local/state/browser-diagnostics/trace.XXXXXX")"
chrome-devtools-cli call performance_start_trace "$(jq -nc --argjson pageId "$PAGE_ID" '{pageId:$pageId,reload:false,autoStop:false}')"
# Perform the declared interaction through the selected browser controller, not through this shell.
chrome-devtools-cli call performance_stop_trace "$(jq -nc --argjson pageId "$PAGE_ID" --arg filePath "$trace_dir/trace.json.gz" '{pageId:$pageId,filePath:$filePath}')"
```

Do not restart or stop the client between a trace's start and stop, or while analyzing opened snapshots. A lost backend, failed stop, timeout, or interrupted call invalidates an in-progress recording; do not blindly retry it and label the new state complete. When the investigation is finished, stop any active trace, close the heaps you opened with `close_heapsnapshot`, and run:

```bash
chrome-devtools-cli stop
```

Only stop the diagnostics client when no other authorized investigation is using it. This stops the client/backend, not the existing desktop browser. If the client is lost during startup, recovery must verify ownership and the diagnostics instance before retiring an MCP process. Where that ownership cannot be established safely, `stop` fails closed and retains the state instead of killing by PID alone. Corrupt, unreadable, or unsafe state files also block automatic recovery. Report the recovery blocker and request manual inspection; do not bypass it with broad process matching or by deleting state while a backend may be alive. It never signals Brave. Evidence files remain private on disk; stopping the client does not delete them. Finish captures and stop the client before updating the installed runtime.

## Capture one bounded run

The CLI creates a private run directory under `~/.local/state/browser-diagnostics`. Use the returned absolute path; do not construct a path from a scenario name. A manifest distinguishes `recording`, `complete`, and `incomplete` runs.

```bash
browser-diagnostics record --target ID --url URL --kind cpu --duration-ms 15000 --scenario interaction --build REV
browser-diagnostics record --target ID --url URL --kind network --duration-ms 15000 --scenario load --build REV --reload --disable-cache
browser-diagnostics record --target ID --url URL --kind coverage --duration-ms 15000 --scenario interaction --build REV
browser-diagnostics heap --target ID --url URL --scenario after-cycles --build REV --collect-garbage
```

Replace `ID`, `URL`, and `REV` with verified values. `--build` is optional. Recording duration must be an integer from 100 to 300000 ms; capture output is capped at 512 MiB. `--collect-garbage` belongs only to `heap`; heap does not accept duration, kind, reload, or cache flags. Normal commands use the fixed loopback port 9222 and reject endpoint overrides. Do not enable `BROWSER_DIAGNOSTICS_TEST_MODE` or fixture overrides outside isolated automated tests. An isolated fixture test is separate validation, not a substitute for attachment to the existing desktop browser. A build label records your claim; it does not prove that the browser serves that build.

`record` is a bounded foreground process. To interact while it runs, start it as a background terminal job with private output, retain its PID and run path, and wait for this exact JSON stdout event shape before input through the selected browser controller: `{"status":"recording","run":"ABS_PATH","kind":"cpu","targetId":"ID"}`. The `kind` matches the chosen measurement; verify both it and `targetId`. Process creation or a `recording` manifest alone is not readiness. Finish the declared interaction within the recording window, wait for the process, then inspect its exit status and manifest. Do not interact after a failed start and call the result a recording.

Serialize recorders, including MCP traces and heap operations. Do not overlap CPU, network, coverage, tracing, or GC experiments even if tools allow it. Automatic cleanup restores target measurement settings on normal completion and handled failure. If the process is killed, the browser disconnects, or cleanup cannot be confirmed, treat the run as incomplete and verify settings before another run. Do not force-remove a live recorder's lock.

A limit breach, timeout, target loss, event cursor loss, truncated event history, failed stop, or failed cleanup invalidates the run. Never promote a partial file or an `incomplete` manifest to a passing result. Preserve the failure category without dumping raw protocol traffic.

## Choose the measurement

| Question | Evidence | Control |
| --- | --- | --- |
| Where does JavaScript spend CPU time? | CLI CPU profile | Repeat the same interaction without coverage or forced GC. |
| Which requests delay or repeat work? | CLI network recording | State warm/cold cache, service-worker state, reload, and cache-disable settings. |
| Which scripts execute in this scenario? | CLI JavaScript coverage | Separate instrumented run; uncovered code is not automatically dead code. |
| What remains after repeated lifecycle cycles? | CLI heap snapshots and MCP heap analysis | Matched baseline/after snapshots, equal cycles, separate GC policy, primitive-only inspection control. |
| What causes rendering or page-load delay? | Pinned MCP performance trace and insights | Verify target, bounded recording, no unrelated tabs; inspect the installed tool schema. |

Before starting or stopping a performance trace, analyzing trace insights, or calling heap tools, read [MCP trace and heap APIs](references/mcp-tools.md). It contains the pinned-version schemas, explicit page selection, safe defaults, and bounded heap-query examples. Also inspect the installed schema with `chrome-devtools-cli list TOOL`; do not load every tool schema for a narrow investigation.

The MCP client CLI exposes the 24-tool diagnostic allowlist, not general evaluation, clicking, typing, navigation, or browser creation. Do not improvise a general-purpose CDP program or use an upstream interaction tool to replace input through the selected browser controller. MCP traces do not use the CLI recorder lock or its readiness event; serialize them yourself, retain their start/stop result, and treat failed stop/cleanup as invalid evidence.

The installed launcher fixes `--workspace` and `TMPDIR` to `~/.local/state/browser-diagnostics` and verifies private directory ownership, permissions, and resolved paths. The backend also honors client-negotiated MCP roots; the artifact root is its default workspace and temporary directory, not an exclusive file-access boundary. A denial outside that directory without client roots does not prove denial when a client supplies broader roots. Keep diagnostic artifacts in the private root and respect the client's authorized roots. Do not change the launcher, request broader roots, or copy private application files into an allowed directory to evade access denial. The launcher also disables usage statistics and CrUX requests and enables network-header redaction. Redaction is not proof that all returned data is secret-free. This tool-level file restriction does not confine an administrator or same-user process. Even file-based heap analysis currently needs the backend's live browser connection; an unavailable browser is a blocker.

`--reload` deliberately changes page lifecycle. `--disable-cache` disables the browser HTTP cache for the measurement; it does not prove an empty service-worker cache, empty application storage, or a fresh login. Record these states separately. Keep timing, forced-GC, and coverage runs separate because each changes the workload.

## Summarize, compare, and protect artifacts

```bash
browser-diagnostics summarize --run ABS_PATH
browser-diagnostics compare --before ABS_PATH --after ABS_PATH
```

Require complete manifests and matched scenarios, durations, cycles, source/build, and measurement controls before interpreting a comparison. A numerical delta is not evidence that unmatched runs are comparable. Verify emitted script URLs and source maps against the served build before assigning a profile frame to current source.

Read bounded summaries first. Drill into only the relevant stacks, request groups, or retaining paths. Produce a short report with scenario, build, target verification, controls, sample count, measured result, evidence paths, interpretation, and remaining uncertainty. Keep raw artifacts local and private. Heaps can contain credentials, cookies, page text, and user data; traces, URLs, and network metadata can also be sensitive. Do not upload raw artifacts, paste giant dumps into tool output, or commit them. Review and redact even summary/report artifacts before sharing. Honor approved retention and deletion instructions without deleting unrelated runs.
