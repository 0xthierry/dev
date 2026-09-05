import { appendFileSync, existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import {
  type AmqNotifyRole,
  type Binding,
  resolveAmqNotifyRole,
  resolveBinding,
  resolveWorkerBinding,
} from "./binding";
import { parseMonitorResult } from "./monitor";
import { buildNotice } from "./notice";

const POLL_MS = 1500;
const MONITOR_TIMEOUT = "25s";
const EXEC_TIMEOUT_MS = 30_000;

const WAIT_GUIDANCE =
  "Incoming AMQ messages are delivered to you automatically as new turns. By default, to wait for " +
  "a reply, just finish your turn — do not run `amq monitor`, `amq drain`, `amq watch`, `sleep`, " +
  "or `.agent-mail` filesystem probes to poll. Answer a received message with `amq reply --id " +
  "<message-id> --strict` so AMQ preserves its thread and refs; use `amq send --strict` only for readiness " +
  "or a new conversation. If the user explicitly asks/orders you to manually check AMQ, obey with " +
  "exactly one bounded AMQ command (`amq drain --strict --include-body` to check now, or a " +
  "short-timeout `amq monitor --strict --include-body` only if they asked to wait), report the " +
  "result, then stop. Do not " +
  "substitute filesystem probes for an AMQ check.";

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
  // Decide the role once per process and remember it across reloads. A main sets
  // AM_ROOT after registration; a coop-exec worker inherits its exact root and
  // handle before Pi starts. The marker prevents a rebound main from being
  // misclassified as a worker after it has exported its binding.
  const inheritedRoot = process.env.AM_ROOT;
  const role = resolveAmqNotifyRole(process.env.AMQ_NOTIFY_ROLE, inheritedRoot);
  const workerBinding = role === "worker" ? resolveWorkerBinding(inheritedRoot, process.env.AM_ME) : undefined;
  process.env.AMQ_NOTIFY_ROLE = role;
  dbg(`register role=${role}`);

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

    const binding = bindingForSession(pi, ctx, event.reason, role, workerBinding);
    if (!binding) {
      const message = "AMQ worker notifier requires inherited AM_ROOT and AM_ME";
      dbg(message);
      if (ctx.hasUI) ctx.ui.notify(message, "error");
      return;
    }

    // A main exports its generated binding so Pi's bash tool and Herdr-launched
    // workers share the room. A worker keeps the exact coop-exec binding it inherited.
    if (role === "main") {
      process.env.AM_ROOT = binding.root;
      process.env.AM_ME = binding.me;
    }
    dbg(`session_start reason=${event.reason} root=${binding.root} me=${binding.me}`);
    void watchInbox(
      pi,
      () => ctx,
      binding,
      role,
      () => stopped,
      abortController.signal,
    );
  });
}

function bindingForSession(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  reason: SessionStartEvent["reason"],
  role: AmqNotifyRole,
  workerBinding: Binding | undefined,
): Binding | undefined {
  return role === "worker" ? workerBinding : resolveBinding(pi, ctx, reason);
}

async function watchInbox(
  pi: ExtensionAPI,
  getCtx: () => ExtensionContext | undefined,
  binding: Binding,
  role: AmqNotifyRole,
  isStopped: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  const { root, me } = binding;
  // Lazy for mains: watch nothing until the skill creates the room. A worker's
  // coop-exec room already exists, so it proceeds immediately through this loop.
  while (!isStopped() && !existsSync(root)) {
    await delay(POLL_MS, signal);
  }
  if (isStopped()) return;
  dbg(`monitoring root=${root} me=${me}`);

  let reportedFailure: string | undefined;
  while (!isStopped()) {
    let stdout = "";
    let stderr = "";
    let code = 0;
    try {
      const result = await pi.exec(
        "amq",
        [
          "monitor",
          "--me",
          me,
          "--root",
          root,
          "--strict",
          "--include-body",
          "--json",
          "--peek",
          "--timeout",
          MONITOR_TIMEOUT,
        ],
        { timeout: EXEC_TIMEOUT_MS, signal },
      );
      stdout = result.stdout ?? "";
      stderr = result.stderr ?? "";
      code = result.code ?? 0;
    } catch (err) {
      dbg(`monitor exec error: ${String(err)}`);
      await delay(POLL_MS, signal);
      continue;
    }
    if (isStopped()) return;

    const payload = parseMonitorResult({ stdout, stderr, code }, me);
    if (payload.kind === "empty") {
      reportedFailure = undefined;
      if (code !== 0) await delay(POLL_MS, signal);
      continue;
    }
    if (payload.kind === "failure") {
      dbg(payload.reason);
      if (reportedFailure !== payload.reason) {
        const ctx = getCtx();
        if (ctx?.hasUI) ctx.ui.notify(`AMQ notifier cannot monitor ${me}: ${payload.reason}; retrying`, "error");
        reportedFailure = payload.reason;
      }
      await delay(POLL_MS, signal);
      continue;
    }

    reportedFailure = undefined;
    dbg("message(s) peeked; injecting as a turn");
    const deliver = getCtx()?.isIdle?.() ? undefined : { deliverAs: "steer" as const };
    try {
      pi.sendUserMessage(buildNotice(payload.text, role), deliver);
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
      await pi.exec("amq", ["read", "--me", me, "--root", root, "--strict", "--id", id], {
        timeout: EXEC_TIMEOUT_MS,
        signal,
      });
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
