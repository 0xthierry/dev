import { describe, expect, mock, test } from "bun:test";
import {
  AgentMailbox,
  DEFAULT_MAILBOX_LIMITS,
  FINAL_ANSWER_MESSAGE_TYPE,
  formatFinalAnswerMailMessage,
  formatFinalAnswerMessage,
  MailboxError,
} from "./mailbox";

function mailbox(): AgentMailbox {
  let id = 0;
  return new AgentMailbox(
    { createMailId: mock(() => `mail-${++id}`) },
    { maxMessagesPerTarget: 2, maxMessageBytes: 256, maxTargetBytes: 1024 },
  );
}

describe("final answer envelope", () => {
  test("uses a stable bounded prefix without execution or control metadata", () => {
    // Arrange
    const notification = {
      messageType: FINAL_ANSWER_MESSAGE_TYPE,
      agentPath: "/root/parent/child",
      agentId: "agent-child",
      parentPath: "/root/parent",
      assignmentId: "agent-child:2",
      generation: 2,
      status: "completed" as const,
      artifactReference: "subagent-artifact:answer",
      outputPreview: "bounded answer",
      execution: {
        profile: { provider: "secret-provider", model: "secret-model", effort: "high" as const },
        source: { model: "invocation" as const, effort: "agent" as const },
      },
    };

    // Act
    const message = formatFinalAnswerMessage(notification);

    // Assert
    expect(message).toBe(
      [
        "Message Type: FINAL_ANSWER",
        "Task name: /root/parent",
        "Sender: /root/parent/child",
        "Payload:",
        "bounded answer",
        "",
        "[Full output: subagent-artifact:answer]",
      ].join("\n"),
    );
    expect(message).not.toContain("agent-child:2");
    expect(message).not.toContain("secret-provider");
    expect(message).not.toContain("secret-model");
    expect(message).not.toMatch(/timestamp|pid|socket|token|authorization|prompt/i);
  });

  test("tail-reduces a pathological 12 KiB preview to the actual encoded mailbox cap", () => {
    // Arrange
    const artifactReference = "subagent-artifact:0123456789abcdef0123456789abcdef";
    const tail = "IMPORTANT-TAIL";
    const notification = {
      messageType: FINAL_ANSWER_MESSAGE_TYPE,
      agentPath: "/root/parent/child",
      agentId: "agent-child",
      parentPath: "/root/parent",
      assignmentId: "agent-child:1",
      generation: 1,
      status: "completed" as const,
      artifactReference,
      outputPreview: `${'\0\n"\\'.repeat(5 * 1024)}${tail}`,
      execution: {
        profile: { provider: "test", model: "test", effort: "high" as const },
        source: { model: "parent" as const, effort: "parent" as const },
      },
    };

    // Act
    const message = formatFinalAnswerMailMessage(notification);

    // Assert
    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(DEFAULT_MAILBOX_LIMITS.maxMessageBytes);
    expect(message).toContain("Completion preview truncated for mailbox");
    expect(message).toContain(artifactReference);
    expect(message).toContain(tail);
  });
});

describe("AgentMailbox", () => {
  test("queues stable bounded messages with sender and target identity", () => {
    // Arrange
    const store = mailbox();

    // Act
    const first = store.queue("/root", "/root/a", "one");
    const second = store.queue("/root/b", "/root/a", "two");

    // Assert
    expect(first).toEqual({
      id: "mail-1",
      senderPath: "/root",
      targetPath: "/root/a",
      content: "one",
      state: "queued",
    });
    expect(second.id).toBe("mail-2");
    expect(store.list("/root/a")).toHaveLength(2);
  });

  test("returns typed capacity errors without dropping old mail", () => {
    // Arrange
    const store = mailbox();
    store.queue("/root", "/root/a", "one");
    store.queue("/root", "/root/a", "two");

    // Act
    const overflow = () => store.queue("/root", "/root/a", "three");

    // Assert
    expect(overflow).toThrow(MailboxError);
    expect(store.list("/root/a").map((message) => message.content)).toEqual(["one", "two"]);
  });

  test("reserves capacity before durable writes and releases failed reservations", () => {
    // Arrange
    const store = mailbox();
    const first = store.reserve("/root", "/root/a", "one");
    const second = store.reserve("/root", "/root/a", "two");

    // Act
    let overflowError: unknown;
    try {
      store.reserve("/root", "/root/a", "three");
    } catch (error) {
      overflowError = error;
    }
    store.release(second);
    const replacement = store.reserve("/root", "/root/a", "three");
    const committed = store.commit(first, "artifact-mail-1");
    store.release(replacement);

    // Assert
    expect(overflowError).toBeInstanceOf(MailboxError);
    expect(committed).toMatchObject({ id: "artifact-mail-1", content: "one", state: "queued" });
    expect(store.list("/root/a")).toHaveLength(1);
  });

  test("delivers in order and removes only acknowledged mail", async () => {
    // Arrange
    const store = mailbox();
    store.queue("/root", "/root/a", "one");
    store.queue("/root", "/root/a", "two");
    const send = mock(async (message: { content: string }) => {
      if (message.content === "two") throw new Error("delivery failed");
    });

    // Act
    const delivery = store.deliver("/root/a", send);

    // Assert
    await expect(delivery).rejects.toThrow("delivery failed");
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.list("/root/a").map((message) => message.content)).toEqual(["two"]);
  });

  test("honors abort before delivery", async () => {
    // Arrange
    const store = mailbox();
    store.queue("/root", "/root/a", "one");
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const send = mock(async () => {});

    // Act
    const delivery = store.deliver("/root/a", send, controller.signal);

    // Assert
    await expect(delivery).rejects.toThrow("stop");
    expect(send).not.toHaveBeenCalled();
    expect(store.list("/root/a")).toHaveLength(1);
  });
});
