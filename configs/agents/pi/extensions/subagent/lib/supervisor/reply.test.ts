import { expect, test } from "bun:test";
import { formatAgentReplyMessage, SUBAGENT_MESSAGE_TYPE } from "./reply";

test("attributes an ordinary message without altering its payload", () => {
  // Arrange
  const notification = {
    senderPath: "/root/planner/advisor",
    taskName: "advisor",
    message: "Preserve the compatibility layer. 🌍",
  };

  // Act
  const message = formatAgentReplyMessage(notification);

  // Assert
  expect(message).toBe(
    [
      `Message Type: ${SUBAGENT_MESSAGE_TYPE}`,
      "Task name: advisor",
      "Sender: /root/planner/advisor",
      "Payload:",
      notification.message,
    ].join("\n"),
  );
  expect(message.endsWith(notification.message)).toBe(true);
});

test("preserves a maximum accepted payload byte for byte", () => {
  // Arrange
  const payload = "🌍".repeat((16 * 1024) / 4);
  const notification = { senderPath: "/root/advisor", taskName: "advisor", message: payload };

  // Act
  const message = formatAgentReplyMessage(notification);

  // Assert
  expect(Buffer.byteLength(payload, "utf8")).toBe(16 * 1024);
  expect(message.endsWith(payload)).toBe(true);
  expect(message).not.toContain("truncated");
});
