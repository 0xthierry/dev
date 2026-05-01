import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { DesktopNotification } from "./format-notification";
import { registerDesktopNotificationExtension } from "./register";

describe("registerDesktopNotificationExtension", () => {
  test("notifies with the latest assistant response when the agent ends", async () => {
    // Arrange
    const notifications: DesktopNotification[] = [];
    const fakePi = createFakePi();
    registerDesktopNotificationExtension(fakePi.pi, (notification) => notifications.push(notification));

    // Act
    await fakePi.emit("agent_end", {
      messages: [
        { role: "assistant", content: "Earlier response" },
        { role: "user", content: "Thanks" },
        { role: "assistant", content: [{ type: "text", text: "**Done**\n\nTests passed." }] },
      ],
    });

    // Assert
    expect(notifications).toEqual([{ title: "π", body: "Done Tests passed." }]);
  });
});
