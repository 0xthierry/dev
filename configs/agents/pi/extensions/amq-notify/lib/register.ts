import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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

export function registerAmqNotifyExtension(pi: ExtensionAPI): void {
  const binding = resolveBinding(process.env, process.cwd(), () => randomUUID().slice(0, 8));

  // Bind the whole pi process to one AMQ session. Because an extension's env
  // mutation reaches pi's bash tool, the use-agent launch skill and every `amq`
  // command pi runs now inherit AM_ROOT/AM_ME with no prefixing.
  process.env.AM_ROOT = binding.root;
  process.env.AM_ME = binding.me;

  // Only pi-as-main needs this push loop. A coop-exec worker (inherited binding)
  // is already notified by amq wake; draining here too would steal its messages.
  if (!binding.derived) return;

  // The use-agent skill tells a main to pull replies with `amq monitor`/`drain`. With this
  // notifier active that double-drains and races, and agents tend to busy-wait with `sleep`.
  // Tell pi to wait passively instead — replies arrive on their own as new turns.
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n[amq-notify] ${WAIT_GUIDANCE}`,
  }));

  let stopped = false;
  let started = false;
  pi.on("session_shutdown", () => {
    stopped = true;
  });
  pi.on("session_start", (_event, ctx) => {
    if (started) return;
    started = true;
    void watchInbox(pi, ctx, binding.root, binding.me, () => stopped);
  });
}

async function watchInbox(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  root: string,
  me: string,
  isStopped: () => boolean,
): Promise<void> {
  // Lazy: create/watch nothing until the session exists (the skill makes it when it
  // launches a worker), so plain pi stays clutter-free in unrelated repos.
  while (!isStopped() && !existsSync(root)) {
    await delay(POLL_MS);
  }

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
    } catch {
      await delay(POLL_MS);
      continue;
    }
    if (isStopped()) return;
    // monitor exits non-zero on timeout; that and empty output just mean "nothing yet".
    if (isEmptyMonitorOutput(out)) {
      if (code !== 0) await delay(POLL_MS);
      continue;
    }
    const deliver = ctx.isIdle?.() ? undefined : { deliverAs: "followUp" as const };
    try {
      pi.sendUserMessage(buildNotice(out), deliver);
    } catch {
      // Agent busy/aborted — the next monitor pass re-delivers anything still queued.
    }
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
