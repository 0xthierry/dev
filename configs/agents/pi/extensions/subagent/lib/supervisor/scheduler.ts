import { assertConfigurableLimit } from "./limits";

export interface SchedulerLimits {
  maxActiveAgents: number;
  maxResidentAgents: number;
}

export interface SchedulerCounts {
  active: number;
  resident: number;
  queued: number;
}

export interface ScheduledStart {
  settled: Promise<void>;
}

export interface SchedulerJob {
  assignmentId: string;
  agentPath: string;
  start(signal: AbortSignal): Promise<ScheduledStart>;
}

export interface ScheduleTicket {
  assignmentId: string;
  queued: boolean;
  accepted: Promise<void>;
  done: Promise<void>;
  detachRequestSignal(): void;
}

type EntryState = "queued" | "starting" | "active" | "done";

interface QueueEntry {
  job: SchedulerJob;
  state: EntryState;
  controller: AbortController;
  accepted: Deferred<void>;
  done: Deferred<void>;
  detachRequestSignal: () => void;
  reservedResident: boolean;
}

export class SchedulerError extends Error {
  constructor(
    readonly kind: "duplicate_assignment" | "shutdown" | "cancelled" | "invalid_limits",
    message: string,
  ) {
    super(message);
    this.name = "SchedulerError";
  }
}

/** Counts active assignments, resident processes, and queued assignments independently. */
export class AgentScheduler {
  private readonly queue: QueueEntry[] = [];
  private readonly entries = new Map<string, QueueEntry>();
  private readonly activeAgents = new Set<string>();
  private readonly residents = new Set<string>();
  private stopping = false;

  constructor(readonly limits: SchedulerLimits) {
    try {
      assertConfigurableLimit("activeAgents", limits.maxActiveAgents);
      assertConfigurableLimit("residentAgents", limits.maxResidentAgents);
    } catch {
      throw new SchedulerError("invalid_limits", "Scheduler limits are outside supported ranges");
    }
    if (limits.maxResidentAgents < limits.maxActiveAgents) {
      throw new SchedulerError("invalid_limits", "Scheduler limits require active <= resident");
    }
  }

  schedule(job: SchedulerJob, requestSignal?: AbortSignal): ScheduleTicket {
    if (this.stopping) throw new SchedulerError("shutdown", "Scheduler is shutting down");
    if (this.entries.has(job.assignmentId)) {
      throw new SchedulerError("duplicate_assignment", `Assignment already scheduled: ${job.assignmentId}`);
    }
    throwIfAborted(requestSignal);

    const accepted = deferred<void>();
    const done = deferred<void>();
    const entry: QueueEntry = {
      job,
      state: "queued",
      controller: new AbortController(),
      accepted,
      done,
      detachRequestSignal: () => {},
      reservedResident: false,
    };
    entry.detachRequestSignal = linkAbort(requestSignal, () => this.cancel(job.assignmentId));
    this.entries.set(job.assignmentId, entry);
    this.queue.push(entry);

    const startsImmediately = this.canStart(entry);
    this.pump();
    accepted.promise.catch(() => {});
    done.promise.catch(() => {});
    return {
      assignmentId: job.assignmentId,
      queued: !startsImmediately,
      accepted: accepted.promise,
      done: done.promise,
      detachRequestSignal: () => {
        entry.detachRequestSignal();
        entry.detachRequestSignal = () => {};
      },
    };
  }

  counts(): SchedulerCounts {
    return {
      active: this.activeAgents.size,
      resident: this.residents.size,
      queued: this.queue.filter((entry) => entry.state === "queued").length,
    };
  }

  isResident(agentPath: string): boolean {
    return this.residents.has(agentPath);
  }

  releaseResident(agentPath: string): void {
    this.residents.delete(agentPath);
    this.pump();
  }

  cancel(assignmentId: string): boolean {
    const entry = this.entries.get(assignmentId);
    if (!entry || entry.state === "done") return false;
    entry.controller.abort(new SchedulerError("cancelled", `Assignment cancelled: ${assignmentId}`));
    if (entry.state === "queued") {
      entry.state = "done";
      const error = new SchedulerError("cancelled", `Assignment cancelled: ${assignmentId}`);
      entry.accepted.reject(error);
      entry.done.reject(error);
      this.finishEntry(entry, false);
    }
    return true;
  }

  async shutdown(signal?: AbortSignal): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const pending = [...this.entries.values()].filter((entry) => entry.state !== "done");
    for (const entry of pending) this.cancel(entry.job.assignmentId);
    const completion = Promise.allSettled(pending.map((entry) => entry.done.promise)).then(() => undefined);
    await abortable(completion, signal);
  }

  private pump(): void {
    if (this.stopping) return;
    while (this.activeAgents.size < this.limits.maxActiveAgents) {
      const entry = this.queue.find((candidate) => candidate.state === "queued" && this.canStart(candidate));
      if (!entry) return;
      this.startEntry(entry);
    }
  }

  private canStart(entry: QueueEntry): boolean {
    if (this.stopping || this.activeAgents.size >= this.limits.maxActiveAgents) return false;
    if (this.activeAgents.has(entry.job.agentPath)) return false;
    if (!this.residents.has(entry.job.agentPath) && this.residents.size >= this.limits.maxResidentAgents) {
      return false;
    }
    return true;
  }

  private startEntry(entry: QueueEntry): void {
    entry.state = "starting";
    this.activeAgents.add(entry.job.agentPath);
    if (!this.residents.has(entry.job.agentPath)) {
      this.residents.add(entry.job.agentPath);
      entry.reservedResident = true;
    }

    void entry.job.start(entry.controller.signal).then(
      (started) => {
        if (entry.state === "done") return;
        entry.state = "active";
        entry.accepted.resolve();
        void started.settled.then(
          () => {
            entry.done.resolve();
            this.finishEntry(entry, true);
          },
          (error) => {
            entry.done.reject(error);
            this.finishEntry(entry, true);
          },
        );
      },
      (error) => {
        entry.accepted.reject(error);
        entry.done.reject(error);
        this.finishEntry(entry, false);
      },
    );
  }

  private finishEntry(entry: QueueEntry, accepted: boolean): void {
    if (entry.state === "done" && !this.entries.has(entry.job.assignmentId)) return;
    entry.state = "done";
    entry.detachRequestSignal();
    this.entries.delete(entry.job.assignmentId);
    this.activeAgents.delete(entry.job.agentPath);
    if (!accepted && entry.reservedResident) this.residents.delete(entry.job.agentPath);
    this.pump();
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function linkAbort(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) return () => {};
  const listener = () => onAbort();
  signal.addEventListener("abort", listener, { once: true });
  return () => signal.removeEventListener("abort", listener);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const listener = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", listener, { once: true });
      void promise.finally(() => signal.removeEventListener("abort", listener));
    }),
  ]);
}
