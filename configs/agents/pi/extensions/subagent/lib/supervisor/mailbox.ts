import type { ResolvedAgentExecution } from "../execution/profile";
import { SUPERVISOR_LIMIT_EVIDENCE } from "./limits";
import type { AssignmentOutcome } from "./registry";

export const FINAL_ANSWER_MESSAGE_TYPE = "FINAL_ANSWER" as const;

export interface FinalAnswerNotification {
  messageType: typeof FINAL_ANSWER_MESSAGE_TYPE;
  agentPath: string;
  agentId: string;
  parentPath: string;
  assignmentId: string;
  generation: number;
  status: AssignmentOutcome;
  artifactReference?: string;
  outputPreview?: string;
  execution: ResolvedAgentExecution;
}

/** Compact Codex-compatible model-facing completion envelope. */
export function formatFinalAnswerMessage(notification: FinalAnswerNotification): string {
  return [
    `Message Type: ${FINAL_ANSWER_MESSAGE_TYPE}`,
    `Task name: ${notification.parentPath}`,
    `Sender: ${notification.agentPath}`,
    "Payload:",
    completionPayload(notification),
  ].join("\n");
}

function completionPayload(notification: FinalAnswerNotification): string {
  if (notification.outputPreview) {
    if (!notification.artifactReference || notification.outputPreview.includes(notification.artifactReference)) {
      return notification.outputPreview;
    }
    return `${notification.outputPreview}\n\n[Full output: ${notification.artifactReference}]`;
  }
  if (notification.artifactReference) return `Full output: ${notification.artifactReference}`;
  return notification.status === "interrupted"
    ? "[Agent assignment interrupted.]"
    : `[Agent assignment ${notification.status}. Durable output unavailable.]`;
}

/**
 * Produces the nested-parent envelope that is safe to steer or queue through the
 * mailbox. Pathological UTF-8 output is measured on the final formatted bytes;
 * reductions preserve the preview tail and retain the durable artifact reference.
 */
export function formatFinalAnswerMailMessage(
  notification: FinalAnswerNotification,
  maxBytes = SUPERVISOR_LIMIT_EVIDENCE.mailMessageBytes.default,
): string {
  const full = formatFinalAnswerMessage(notification);
  if (byteLength(full) <= maxBytes) return full;

  const reference = notification.artifactReference
    ? ` Full output: ${notification.artifactReference}`
    : " Durable full output unavailable.";
  const notice = `[Completion preview truncated for mailbox.${reference}]`;
  const preview = notification.outputPreview ?? "";
  const codePoints = [...preview];
  let low = 0;
  let high = codePoints.length;
  let selected = formatFinalAnswerMessage({ ...notification, outputPreview: notice });
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const tail = count === 0 ? "" : codePoints.slice(codePoints.length - count).join("");
    const candidate = formatFinalAnswerMessage({
      ...notification,
      outputPreview: tail ? `${notice}\n${tail}` : notice,
    });
    if (byteLength(candidate) <= maxBytes) {
      selected = candidate;
      low = count + 1;
    } else {
      high = count - 1;
    }
  }
  if (byteLength(selected) > maxBytes)
    throw new MailboxError("message_too_large", "FINAL_ANSWER envelope is too large");
  return selected;
}

export type MailState = "queued" | "delivered";

export interface MailMessage {
  id: string;
  senderPath: string;
  targetPath: string;
  content: string;
  state: MailState;
}

export interface MailReservation {
  readonly senderPath: string;
  readonly targetPath: string;
  readonly content: string;
}

export interface MailboxLimits {
  maxMessagesPerTarget: number;
  maxMessageBytes: number;
  maxTargetBytes: number;
}

export interface MailboxRuntime {
  createMailId(): string;
}

export class MailboxError extends Error {
  constructor(
    readonly kind: "invalid_message" | "message_too_large" | "mailbox_full",
    message: string,
  ) {
    super(message);
    this.name = "MailboxError";
  }
}

export const DEFAULT_MAILBOX_LIMITS: MailboxLimits = {
  maxMessagesPerTarget: SUPERVISOR_LIMIT_EVIDENCE.mailMessages.default,
  maxMessageBytes: SUPERVISOR_LIMIT_EVIDENCE.mailMessageBytes.default,
  maxTargetBytes: SUPERVISOR_LIMIT_EVIDENCE.mailTargetBytes.default,
};

/** A bounded in-memory mailbox. Durable lifecycle metadata is journaled by the supervisor. */
export class AgentMailbox {
  private readonly queuedByTarget = new Map<string, MailMessage[]>();
  private readonly reservationsByTarget = new Map<string, Set<MailReservation>>();

  constructor(
    private readonly runtime: MailboxRuntime,
    private readonly limits: MailboxLimits = DEFAULT_MAILBOX_LIMITS,
  ) {
    if (
      !within(limits.maxMessagesPerTarget, SUPERVISOR_LIMIT_EVIDENCE.mailMessages) ||
      !within(limits.maxMessageBytes, SUPERVISOR_LIMIT_EVIDENCE.mailMessageBytes) ||
      !within(limits.maxTargetBytes, SUPERVISOR_LIMIT_EVIDENCE.mailTargetBytes) ||
      limits.maxTargetBytes < limits.maxMessageBytes
    ) {
      throw new MailboxError("invalid_message", "Invalid mailbox limits");
    }
  }

  reserve(senderPath: string, targetPath: string, content: string): MailReservation {
    requireIdentity(senderPath, "sender");
    requireIdentity(targetPath, "target");
    if (!content.trim()) throw new MailboxError("invalid_message", "Mail content must not be empty");
    const bytes = byteLength(content);
    if (bytes > this.limits.maxMessageBytes) {
      throw new MailboxError("message_too_large", `Mail exceeds ${this.limits.maxMessageBytes} bytes`);
    }
    this.requireCapacity(targetPath, bytes);

    const reservation: MailReservation = { senderPath, targetPath, content };
    const reservations = this.reservationsByTarget.get(targetPath) ?? new Set<MailReservation>();
    reservations.add(reservation);
    this.reservationsByTarget.set(targetPath, reservations);
    return reservation;
  }

  commit(reservation: MailReservation, stableId?: string): MailMessage {
    const reservations = this.reservationsByTarget.get(reservation.targetPath);
    if (!reservations?.has(reservation)) {
      throw new MailboxError("invalid_message", `Mail reservation is unavailable for ${reservation.targetPath}`);
    }
    const queue = this.queuedByTarget.get(reservation.targetPath) ?? [];
    const id = stableId ?? this.runtime.createMailId();
    if (!id.trim() || queue.some((message) => message.id === id)) {
      throw new MailboxError("invalid_message", `Mail id must be non-empty and unique for ${reservation.targetPath}`);
    }
    reservations.delete(reservation);
    if (!reservations.size) this.reservationsByTarget.delete(reservation.targetPath);
    const message: MailMessage = { id, ...reservation, state: "queued" };
    queue.push(message);
    this.queuedByTarget.set(reservation.targetPath, queue);
    return { ...message };
  }

  release(reservation: MailReservation): void {
    const reservations = this.reservationsByTarget.get(reservation.targetPath);
    reservations?.delete(reservation);
    if (reservations && !reservations.size) this.reservationsByTarget.delete(reservation.targetPath);
  }

  queue(senderPath: string, targetPath: string, content: string, stableId?: string): MailMessage {
    const reservation = this.reserve(senderPath, targetPath, content);
    try {
      return this.commit(reservation, stableId);
    } catch (error) {
      this.release(reservation);
      throw error;
    }
  }

  list(targetPath: string): MailMessage[] {
    return (this.queuedByTarget.get(targetPath) ?? []).map((message) => ({ ...message }));
  }

  private requireCapacity(targetPath: string, addedBytes: number): void {
    const queue = this.queuedByTarget.get(targetPath) ?? [];
    const reservations = [...(this.reservationsByTarget.get(targetPath) ?? [])];
    const retainedCount = queue.length + reservations.length;
    const retainedBytes =
      queue.reduce((total, message) => total + byteLength(message.content), 0) +
      reservations.reduce((total, reservation) => total + byteLength(reservation.content), 0);
    if (retainedCount >= this.limits.maxMessagesPerTarget || retainedBytes + addedBytes > this.limits.maxTargetBytes) {
      throw new MailboxError("mailbox_full", `Mailbox is full: ${targetPath}`);
    }
  }

  async deliver(
    targetPath: string,
    send: (message: MailMessage, signal?: AbortSignal) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<MailMessage[]> {
    const queue = this.queuedByTarget.get(targetPath);
    if (!queue?.length) return [];
    const delivered: MailMessage[] = [];

    while (queue.length) {
      throwIfAborted(signal);
      const message = queue[0];
      if (!message) break;
      await send({ ...message }, signal);
      queue.shift();
      delivered.push({ ...message, state: "delivered" });
    }
    if (!queue.length) this.queuedByTarget.delete(targetPath);
    return delivered;
  }
}

function requireIdentity(value: string, label: string): void {
  if (!value.trim() || value !== value.trim()) {
    throw new MailboxError("invalid_message", `Mail ${label} identity must be non-empty and exact`);
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function within(value: number, evidence: { minimum: number; hardMaximum: number }): boolean {
  return Number.isInteger(value) && value >= evidence.minimum && value <= evidence.hardMaximum;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
