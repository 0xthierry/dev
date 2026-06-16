import { join } from "node:path";

export interface AmqBinding {
  root: string;
  me: string;
  /**
   * true  -> we generated the session (pi is the main): no coop `amq wake`, so this
   *          extension is responsible for notifying pi.
   * false -> AM_ROOT was inherited (coop-exec worker, or user-set): assume coop wake
   *          already pushes notifications; do not double-drain.
   */
  derived: boolean;
}

export function sanitizeTag(raw: string): string {
  const v = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return v || "pi";
}

/**
 * Resolve which AMQ queue this pi process talks on. When nothing is inherited we
 * mint a unique session per pi process so multiple pis (each with its own sidecar)
 * stay isolated in the same repo.
 */
export function resolveBinding(env: Record<string, string | undefined>, cwd: string, genId: () => string): AmqBinding {
  const me = (env.AM_ME ?? "").trim() || "pi";
  const inherited = (env.AM_ROOT ?? "").trim();
  if (inherited) {
    return { root: inherited, me, derived: false };
  }
  const tag = sanitizeTag(`pi-${genId()}`);
  return { root: join(cwd, ".agent-mail", tag), me, derived: true };
}
