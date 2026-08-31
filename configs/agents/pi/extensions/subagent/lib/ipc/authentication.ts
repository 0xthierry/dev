import { createHash, randomBytes } from "node:crypto";

export const CHILD_IPC_SOCKET_ENV = "PI_SUBAGENT_IPC_SOCKET";
export const CHILD_IPC_TOKEN_ENV = "PI_SUBAGENT_IPC_TOKEN";
/** Cryptographic parameter: 256-bit bearer capabilities, not a configurable resource limit. */
export const CAPABILITY_TOKEN_BYTES = 32;

export interface AuthenticatedCaller {
  agentId: string;
  agentPath: string;
}

export interface ChildCapability {
  /** Ephemeral bearer value. Keep only in the immediate child launch environment. */
  token: string;
}

export interface CapabilityAuthority {
  issue(caller: AuthenticatedCaller): ChildCapability;
  authenticate(token: string): AuthenticatedCaller | undefined;
  revoke(caller: AuthenticatedCaller): void;
  clear(): void;
}

export class InMemoryCapabilityAuthority implements CapabilityAuthority {
  private readonly bindingsByHash = new Map<string, AuthenticatedCaller>();
  private readonly hashesByCaller = new Map<string, Set<string>>();

  issue(caller: AuthenticatedCaller): ChildCapability {
    const binding = validateCaller(caller);
    this.revokeBinding(binding);
    const token = randomBytes(CAPABILITY_TOKEN_BYTES).toString("base64url");
    const hash = tokenHash(token);
    this.bindingsByHash.set(hash, binding);
    this.hashesByCaller.set(callerKey(binding), new Set([hash]));
    return { token };
  }

  authenticate(token: string): AuthenticatedCaller | undefined {
    if (typeof token !== "string" || !token) return undefined;
    const caller = this.bindingsByHash.get(tokenHash(token));
    return caller ? { ...caller } : undefined;
  }

  revoke(caller: AuthenticatedCaller): void {
    this.revokeBinding(validateCaller(caller));
  }

  clear(): void {
    this.bindingsByHash.clear();
    this.hashesByCaller.clear();
  }

  private revokeBinding(binding: AuthenticatedCaller): void {
    const key = callerKey(binding);
    for (const hash of this.hashesByCaller.get(key) ?? []) this.bindingsByHash.delete(hash);
    this.hashesByCaller.delete(key);
  }
}

export function createCapabilityAuthority(): CapabilityAuthority {
  return new InMemoryCapabilityAuthority();
}

function callerKey(caller: AuthenticatedCaller): string {
  return `${caller.agentId}\0${caller.agentPath}`;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validateCaller(caller: AuthenticatedCaller): AuthenticatedCaller {
  if (!caller.agentId.trim() || caller.agentId !== caller.agentId.trim()) {
    throw new Error("Capability caller ID must be non-empty and exact");
  }
  const segments = caller.agentPath.split("/").slice(2);
  if (
    !/^\/root\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(caller.agentPath) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Capability caller path must be canonical");
  }
  return Object.freeze({ agentId: caller.agentId, agentPath: caller.agentPath });
}
