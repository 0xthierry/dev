import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildNotice, isEmptyMonitorOutput } from "./notice";
import { resolveBinding } from "./session";

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
  const binding = resolveBinding(process.env, process.cwd(), () => randomUUID().slice(0, 8));

  // Bind the whole pi process to one AMQ session. Because an extension's env
  // mutation reaches pi's bash tool, the use-agent launch skill and every `amq`
  // command pi runs now inherit AM_ROOT/AM_ME with no prefixing.
  process.env.AM_ROOT = binding.root;
  process.env.AM_ME = binding.me;
  dbg(`register me=${binding.me} root=${binding.root} derived=${binding.derived}`);

  // Only pi-as-main needs this push loop. A coop-exec worker (inherited binding)
  // is already notified by amq wake; draining here too would steal its messages.
  if (!binding.derived) return;

  // The use-agent skill tells a main to pull replies with `amq monitor`/`drain`. With this
  // notifier active that double-drains and races, and agents tend to busy-wait with `sleep`.
  // Tell pi to wait passively instead — replies arrive on their own as new turns.
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n[amq-notify] ${WAIT_GUIDANCE}`,
  }));

  // Own the push loop at PROCESS scope, not session scope. In pi, session_start and
  // session_shutdown bracket each agent run — so starting the loop from session_start
  // (behind a once-guard) and killing it from session_shutdown left the notifier dead
  // after the first turn, and pi fell back to polling. We only track the latest
  // ExtensionContext for isIdle(); the loop itself runs for the life of the process.
  let ctx: ExtensionContext | undefined;
  pi.on("session_start", (_event, c) => {
    ctx = c;
    dbg("session_start");
  });
  pi.on("session_shutdown", () => {
    dbg("session_shutdown (push loop keeps running)");
  });

  dbg("starting watchInbox");
  void watchInbox(pi, () => ctx, binding.root, binding.me);
}

async function watchInbox(
  pi: ExtensionAPI,
  getCtx: () => ExtensionContext | undefined,
  root: string,
  me: string,
): Promise<void> {
  // Lazy: watch nothing until the session root exists (the skill makes it when it
  // launches a worker), so plain pi stays clutter-free in unrelated repos.
  while (!existsSync(root)) {
    await delay(POLL_MS);
  }
  dbg(`root exists; monitoring root=${root} me=${me}`);

  for (;;) {
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
      // Agent busy/aborted — the next monitor pass re-delivers anything still queued.
      dbg(`sendUserMessage error: ${String(err)}`);
    }
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
