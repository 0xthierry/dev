import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";

export const BINDING_ENTRY = "amq-notify-binding";

export interface Binding {
  root: string;
  me: string;
}

export type AmqNotifyRole = "main" | "worker";

export function resolveAmqNotifyRole(
  configuredRole: string | undefined,
  inheritedRoot: string | undefined,
): AmqNotifyRole {
  const configured = configuredRole?.trim();
  if (configured === "main" || configured === "worker") return configured;
  return inheritedRoot?.trim() ? "worker" : "main";
}

export function resolveWorkerBinding(root: string | undefined, me: string | undefined): Binding | undefined {
  const normalizedRoot = root?.trim();
  const normalizedMe = me?.trim();
  return normalizedRoot && normalizedMe ? { root: normalizedRoot, me: normalizedMe } : undefined;
}

// Resolve which AMQ room this pi session talks on. The room name is persisted as a
// custom session entry, so /reload (rebind) and a full stop+resume (new process)
// both restore the SAME room and reconnect to an existing worker, instead of minting
// a fresh random room per process. A fork starts its own room so it never talks on
// its parent's queue.
export function resolveBinding(pi: ExtensionAPI, ctx: ExtensionContext, reason: SessionStartEvent["reason"]): Binding {
  if (reason !== "fork") {
    const restored = restoreBinding(ctx);
    if (restored) return restored;
  }

  const binding: Binding = {
    root: join(ctx.cwd, ".agent-mail", `pi-${randomUUID().slice(0, 8)}`),
    me: "pi",
  };
  pi.appendEntry(BINDING_ENTRY, binding);
  return binding;
}

function restoreBinding(ctx: ExtensionContext): Binding | undefined {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== BINDING_ENTRY) continue;

    const data = entry.data as { root?: string; me?: string } | undefined;
    if (data?.root) return { root: data.root, me: data.me ?? "pi" };
  }

  return undefined;
}
