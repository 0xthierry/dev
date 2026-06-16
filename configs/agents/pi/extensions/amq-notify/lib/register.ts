import { appendFileSync, existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveBinding } from "./binding";
import { parseMonitorPayload } from "./monitor";
import { buildNotice } from "./notice";

const POLL_MS = 1500;
const MONITOR_TIMEOUT = "25s";
const EXEC_TIMEOUT_MS = 30_000;

const WAIT_GUIDANCE =
  "Incoming AMQ messages are delivered to you automatically as new turns. To wait for a reply, " +
  "just finish your turn — do NOT run `amq monitor`, `amq drain`, `amq watch`, or `sleep` to poll " +
  "(it races with the notifier and wastes turns). If you catch yourself thinking \"I shouldn't end " +
  'my turn until the reply comes", "let me wait for it", or "let me check if it arrived yet" — ' +
  "that is exactly the cue to end your turn now; ending the turn IS how you wait. Keep using " +
  "`amq send` to send.";

// Opt-in trace (set AMQ_NOTIFY_DEBUG=/path) so a notifier that silently stops can be diagnosed.
function dbg(msg: string): void {
  const path = process.env.AMQ_NOTIFY_DEBUG;
  if (!path) return;
  try {
    appendFileSync(path, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // best-effort only
  }
}

export function registerAmqNotifyExtension(pi: ExtensionAPI): void {
  // Decide the role once per process and remember it across reloads. A coop-exec
  // worker is launched with AM_ROOT already set and is notified by `amq wake`, so
  // this notifier must stay out of its way and leave its AM_ROOT untouched. The env
  // marker survives the extension re-running on /reload (where AM_ROOT may by then
  // be set by us, the main).
  const role = (process.env.AMQ_NOTIFY_ROLE ?? "").trim() || (process.env.AM_ROOT ? "worker" : "main");
  process.env.AMQ_NOTIFY_ROLE = role;
  dbg(`register role=${role}`);
  if (role === "worker") return;

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n[amq-notify] ${WAIT_GUIDANCE}`,
  }));

  // pi rebinds extensions on /reload, /resume, /new and /fork: it tears down this
  // instance (session_shutdown) and re-runs the factory for a fresh one
  // (session_start), after which the old `pi`/`ctx` are stale. So the push loop is
  // owned by THIS instance — started in session_start, stopped in session_shutdown,
  // using this instance's `pi`/`ctx`. The room name is persisted in the session, so
  // the rebound instance (reload) or a new process (resume) reuses the same room and
  // reconnects to the existing worker instead of minting a fresh random one.
  let stopped = false;
  let started = false;
  const abortController = new AbortController();
  pi.on("session_shutdown", () => {
    stopped = true;
    abortController.abort();
    dbg("session_shutdown -> stopping this instance's loop");
  });
  pi.on("session_start", (event, ctx) => {
    if (started) return;
    started = true;
    const binding = resolveBinding(pi, ctx, event.reason);
    // pi's bash tool inherits these, so the use-agent skill and the bare `amq`
    // commands pi runs all bind to the same room.
    process.env.AM_ROOT = binding.root;
    process.env.AM_ME = binding.me;
    dbg(`session_start reason=${event.reason} root=${binding.root} me=${binding.me}`);
    void watchInbox(
      pi,
      () => ctx,
      binding.root,
      binding.me,
      () => stopped,
      abortController.signal,
    );
  });
}

async function watchInbox(
  pi: ExtensionAPI,
  getCtx: () => ExtensionContext | undefined,
  root: string,
  me: string,
  isStopped: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  // Lazy: watch nothing until the room exists (the skill makes it when it launches a
  // worker; on resume it already exists), so plain pi stays clutter-free elsewhere.
  while (!isStopped() && !existsSync(root)) {
    await delay(POLL_MS, signal);
  }
  if (isStopped()) return;
  dbg(`monitoring root=${root} me=${me}`);

  while (!isStopped()) {
    let out = "";
    let code = 0;
    try {
      const result = await pi.exec(
        "amq",
        ["monitor", "--me", me, "--root", root, "--include-body", "--json", "--peek", "--timeout", MONITOR_TIMEOUT],
        { timeout: EXEC_TIMEOUT_MS, signal },
      );
      out = result.stdout ?? "";
      code = result.code ?? 0;
    } catch (err) {
      dbg(`monitor exec error: ${String(err)}`);
      await delay(POLL_MS, signal);
      continue;
    }
    if (isStopped()) return;

    // monitor exits non-zero on timeout; empty payloads just mean "nothing yet".
    const payload = parseMonitorPayload(out, me);
    if (payload.kind === "empty") {
      if (code !== 0) await delay(POLL_MS, signal);
      continue;
    }
    if (payload.kind === "invalid") {
      dbg(payload.reason);
      await delay(POLL_MS, signal);
      continue;
    }

    dbg("message(s) peeked; injecting as a turn");
    const deliver = getCtx()?.isIdle?.() ? undefined : { deliverAs: "steer" as const };
    try {
      pi.sendUserMessage(buildNotice(payload.text), deliver);
    } catch (err) {
      // Because monitor used --peek, a failed injection leaves messages in inbox/new
      // for the next pass instead of silently dropping them.
      dbg(`sendUserMessage error: ${String(err)}`);
      await delay(POLL_MS, signal);
      continue;
    }

    await acknowledgeMessages(pi, root, me, payload.ids, signal);
  }
}

async function acknowledgeMessages(
  pi: ExtensionAPI,
  root: string,
  me: string,
  ids: string[],
  signal: AbortSignal,
): Promise<void> {
  for (const id of ids) {
    if (signal.aborted) return;
    try {
      await pi.exec("amq", ["read", "--me", me, "--root", root, "--id", id], { timeout: EXEC_TIMEOUT_MS, signal });
    } catch (err) {
      dbg(`ack error for ${id}: ${String(err)}`);
    }
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    };

    timeout = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}
