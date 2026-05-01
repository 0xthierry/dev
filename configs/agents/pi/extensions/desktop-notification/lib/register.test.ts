import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { DesktopNotification } from "./format-notification";
import { registerDesktopNotificationExtension } from "./register";

describe("registerDesktopNotificationExtension", () => {
  test("notifies with the latest assistant response when the agent ends", async () => {
    // Arrange
    const notify = mock((notification: DesktopNotification) => notification);
    const fakePi = createFakePi();
    registerDesktopNotificationExtension(fakePi.pi, notify);

    // Act
    await fakePi.emit("agent_end", {
      messages: [
        { role: "assistant", content: "Earlier response" },
        { role: "user", content: "Thanks" },
        { role: "assistant", content: [{ type: "text", text: "**Done**\n\nTests passed." }] },
      ],
    });

    // Assert
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ title: "π", body: "Done Tests passed." });
  });
});
