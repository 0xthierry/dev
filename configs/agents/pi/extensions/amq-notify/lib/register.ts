import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { buildNotice, isEmptyMonitorOutput } from "./notice";

const POLL_MS = 1500;
const MONITOR_TIMEOUT = "25s";
const EXEC_TIMEOUT_MS = 30_000;
const BINDING_ENTRY = "amq-notify-binding";

const WAIT_GUIDANCE =
  "Incoming AMQ messages are delivered to you automatically as new turns. To wait for a reply, " +
  "just finish your turn — do NOT run `amq monitor`, `amq drain`, `amq watch`, or `sleep` to poll " +
  "(it races with the notifier and wastes turns). If you catch yourself thinking \"I shouldn't end " +
  'my turn until the reply comes", "let me wait for it", or "let me check if it arrived yet" — ' +
  "that is exactly the cue to end your turn now; ending the turn IS how you wait. Keep using " +
  "`amq send` to send.";

interface Binding {
  root: string;
  me: string;
}

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
  pi.on("session_shutdown", () => {
    stopped = true;
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
    );
  });
}

// Resolve which AMQ room this pi session talks on. The room name is persisted as a
// custom session entry, so /reload (rebind) and a full stop+resume (new process)
// both restore the SAME room and reconnect to an existing worker, instead of minting
// a fresh random room per process. A fork starts its own room so it never talks on
// its parent's queue.
function resolveBinding(pi: ExtensionAPI, ctx: ExtensionContext, reason: SessionStartEvent["reason"]): Binding {
  if (reason !== "fork") {
    const entries = ctx.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type === "custom" && entry.customType === BINDING_ENTRY) {
        const data = entry.data as { root?: string; me?: string } | undefined;
        if (data?.root) {
          return { root: data.root, me: data.me ?? "pi" };
        }
      }
    }
  }
  const binding: Binding = {
    root: join(ctx.cwd, ".agent-mail", `pi-${randomUUID().slice(0, 8)}`),
    me: "pi",
  };
  pi.appendEntry(BINDING_ENTRY, binding);
  return binding;
}

async function watchInbox(
  pi: ExtensionAPI,
  getCtx: () => ExtensionContext | undefined,
  root: string,
  me: string,
  isStopped: () => boolean,
): Promise<void> {
  // Lazy: watch nothing until the room exists (the skill makes it when it launches a
  // worker; on resume it already exists), so plain pi stays clutter-free elsewhere.
  while (!isStopped() && !existsSync(root)) {
    await delay(POLL_MS);
  }
  if (isStopped()) return;
  dbg(`monitoring root=${root} me=${me}`);

  while (!isStopped()) {
    let out = "";
    let code = 0;
    try {
      const result = await pi.exec(
        "amq",
        ["monitor", "--me", me, "--root", root, "--include-body", "--timeout", MONITOR_TIMEOUT],
        { timeout: EXEC_TIMEOUT_MS },
      );
      out = result.stdout ?? "";
      code = result.code ?? 0;
    } catch (err) {
      dbg(`monitor exec error: ${String(err)}`);
      await delay(POLL_MS);
      continue;
    }
    if (isStopped()) return;
    // monitor exits non-zero on timeout; that and empty output just mean "nothing yet".
    if (isEmptyMonitorOutput(out)) {
      if (code !== 0) await delay(POLL_MS);
      continue;
    }
    dbg("message(s) drained; injecting as a turn");
    const deliver = getCtx()?.isIdle?.() ? undefined : { deliverAs: "followUp" as const };
    try {
      pi.sendUserMessage(buildNotice(out), deliver);
    } catch (err) {
      // Agent busy/aborted, or instance torn down mid-flight — next pass re-delivers.
      dbg(`sendUserMessage error: ${String(err)}`);
    }
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
