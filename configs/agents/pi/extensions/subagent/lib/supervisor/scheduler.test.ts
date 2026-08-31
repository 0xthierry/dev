import { describe, expect, mock, test } from "bun:test";
import { AgentScheduler, SchedulerError } from "./scheduler";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("AgentScheduler", () => {
  test("counts active, resident, and queued resources separately", async () => {
    // Arrange
    const scheduler = new AgentScheduler({ maxActiveAgents: 1, maxResidentAgents: 2 });
    const firstSettlement = deferred();
    const secondSettlement = deferred();
    const firstStart = mock(async () => ({ settled: firstSettlement.promise }));
    const secondStart = mock(async () => ({ settled: secondSettlement.promise }));

    // Act
    const first = scheduler.schedule({
      assignmentId: "a:1",
      agentPath: "/root/a",
      start: firstStart,
    });
    const second = scheduler.schedule({
      assignmentId: "b:1",
      agentPath: "/root/b",
      start: secondStart,
    });
    await first.accepted;

    // Assert
    expect(first.queued).toBe(false);
    expect(second.queued).toBe(true);
    expect(scheduler.counts()).toEqual({ active: 1, resident: 1, queued: 1 });
    expect(secondStart).not.toHaveBeenCalled();

    // Act
    firstSettlement.resolve();
    await first.done;
    await second.accepted;

    // Assert
    expect(scheduler.counts()).toEqual({ active: 1, resident: 2, queued: 0 });
    secondSettlement.resolve();
    await second.done;
  });

  test("does not silently evict a resident when capacity is full", async () => {
    // Arrange
    const scheduler = new AgentScheduler({ maxActiveAgents: 1, maxResidentAgents: 1 });
    const firstSettlement = deferred();
    const secondSettlement = deferred();
    const first = scheduler.schedule({
      assignmentId: "a:1",
      agentPath: "/root/a",
      start: mock(async () => ({ settled: firstSettlement.promise })),
    });
    await first.accepted;
    firstSettlement.resolve();
    await first.done;
    const secondStart = mock(async () => ({ settled: secondSettlement.promise }));

    // Act
    const second = scheduler.schedule({
      assignmentId: "b:1",
      agentPath: "/root/b",
      start: secondStart,
    });
    await flush();

    // Assert
    expect(second.queued).toBe(true);
    expect(secondStart).not.toHaveBeenCalled();
    expect(scheduler.counts()).toEqual({ active: 0, resident: 1, queued: 1 });

    // Act
    scheduler.releaseResident("/root/a");
    await second.accepted;

    // Assert
    expect(secondStart).toHaveBeenCalledTimes(1);
    secondSettlement.resolve();
    await second.done;
  });

  test("serializes assignments for the same resident agent", async () => {
    // Arrange
    const scheduler = new AgentScheduler({ maxActiveAgents: 2, maxResidentAgents: 2 });
    const firstSettlement = deferred();
    const secondSettlement = deferred();
    const secondStart = mock(async () => ({ settled: secondSettlement.promise }));
    const first = scheduler.schedule({
      assignmentId: "a:1",
      agentPath: "/root/a",
      start: mock(async () => ({ settled: firstSettlement.promise })),
    });
    await first.accepted;

    // Act
    const second = scheduler.schedule({
      assignmentId: "a:2",
      agentPath: "/root/a",
      start: secondStart,
    });

    // Assert
    expect(second.queued).toBe(true);
    expect(secondStart).not.toHaveBeenCalled();

    // Act
    firstSettlement.resolve();
    await second.accepted;

    // Assert
    expect(secondStart).toHaveBeenCalledTimes(1);
    secondSettlement.resolve();
    await second.done;
  });

  test("rechecks resident capacity when a queued resident exits before its follow-up starts", async () => {
    // Arrange
    const scheduler = new AgentScheduler({ maxActiveAgents: 2, maxResidentAgents: 2 });
    const existingSettlement = deferred();
    const existing = scheduler.schedule({
      assignmentId: "existing:1",
      agentPath: "/root/existing",
      start: mock(async () => ({ settled: existingSettlement.promise })),
    });
    await existing.accepted;
    existingSettlement.resolve();
    await existing.done;
    const firstSettlement = deferred();
    const followupSettlement = deferred();
    const otherSettlement = deferred();
    const followupStart = mock(async () => ({ settled: followupSettlement.promise }));
    const first = scheduler.schedule({
      assignmentId: "a:1",
      agentPath: "/root/a",
      start: mock(async () => ({ settled: firstSettlement.promise })),
    });
    await first.accepted;
    const followup = scheduler.schedule({
      assignmentId: "a:2",
      agentPath: "/root/a",
      start: followupStart,
    });

    // Act
    scheduler.releaseResident("/root/a");
    const other = scheduler.schedule({
      assignmentId: "b:1",
      agentPath: "/root/b",
      start: mock(async () => ({ settled: otherSettlement.promise })),
    });
    await other.accepted;
    firstSettlement.resolve();
    await first.done;
    await flush();

    // Assert
    expect(followupStart).not.toHaveBeenCalled();
    expect(scheduler.counts()).toEqual({ active: 1, resident: 2, queued: 1 });

    // Act
    otherSettlement.resolve();
    await other.done;
    scheduler.releaseResident("/root/b");
    await followup.accepted;

    // Assert
    expect(followupStart).toHaveBeenCalledTimes(1);
    expect(scheduler.counts()).toEqual({ active: 1, resident: 2, queued: 0 });
    followupSettlement.resolve();
    await followup.done;
  });

  test("rejects queued work on cancellation and rejects unsupported limits", async () => {
    // Arrange
    const scheduler = new AgentScheduler({ maxActiveAgents: 1, maxResidentAgents: 1 });
    const settlement = deferred();
    const first = scheduler.schedule({
      assignmentId: "a:1",
      agentPath: "/root/a",
      start: mock(async () => ({ settled: settlement.promise })),
    });
    await first.accepted;
    const second = scheduler.schedule({
      assignmentId: "b:1",
      agentPath: "/root/b",
      start: mock(async () => ({ settled: Promise.resolve() })),
    });

    // Act
    const cancelled = scheduler.cancel("b:1");

    // Assert
    expect(cancelled).toBe(true);
    await expect(second.accepted).rejects.toBeInstanceOf(SchedulerError);
    expect(() => new AgentScheduler({ maxActiveAgents: 2, maxResidentAgents: 1 })).toThrow(SchedulerError);
    settlement.resolve();
    await first.done;
  });
});
