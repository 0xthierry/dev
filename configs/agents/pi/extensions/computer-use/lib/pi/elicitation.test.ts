import { afterEach, describe, expect, mock, test } from "bun:test";
import { handleOfficialElicitation, type PiElicitationContext } from "./elicitation";

afterEach(() => {
  mock.clearAllMocks();
});

describe("handleOfficialElicitation", () => {
  test("accepts a validated form response from interactive Pi", async () => {
    // Arrange
    const select = mock(async () => "Respond");
    const editor = mock(async () => '{"choice":"allow"}');
    const notify = mock(() => undefined);
    const openUrl = mock(async () => false);
    const ctx: PiElicitationContext = { hasUI: true, ui: { select, editor, notify } };

    // Act
    const response = await handleOfficialElicitation(
      {
        mode: "form",
        message: "Choose access",
        requestedSchema: {
          type: "object",
          properties: { choice: { type: "string", enum: ["allow", "deny"] } },
        },
      },
      ctx,
      openUrl,
    );

    // Assert
    expect(response).toEqual({ action: "accept", content: { choice: "allow" } });
    expect(select).toHaveBeenCalledWith("Choose access", ["Respond", "Decline", "Cancel"]);
    expect(editor).toHaveBeenCalledWith(expect.stringContaining("Schema:"), "{}");
    expect(openUrl).not.toHaveBeenCalled();
  });

  test("opens a URL only after the user accepts it", async () => {
    // Arrange
    const select = mock(async () => "Open URL");
    const editor = mock(async () => undefined);
    const notify = mock(() => undefined);
    const openUrl = mock(async () => true);
    const ctx: PiElicitationContext = { hasUI: true, ui: { select, editor, notify } };

    // Act
    const response = await handleOfficialElicitation(
      { mode: "url", message: "Complete setup", url: "https://example.test/setup" },
      ctx,
      openUrl,
    );

    // Assert
    expect(response).toEqual({ action: "accept" });
    expect(openUrl).toHaveBeenCalledWith("https://example.test/setup");
  });

  test("preserves an explicit decline without opening the requested URL", async () => {
    // Arrange
    const select = mock(async () => "Decline");
    const editor = mock(async () => undefined);
    const notify = mock(() => undefined);
    const openUrl = mock(async () => true);
    const ctx: PiElicitationContext = { hasUI: true, ui: { select, editor, notify } };

    // Act
    const response = await handleOfficialElicitation(
      { mode: "url", message: "Complete setup", url: "https://example.test/setup" },
      ctx,
      openUrl,
    );

    // Assert
    expect(response).toEqual({ action: "decline" });
    expect(openUrl).not.toHaveBeenCalled();
  });

  test("preserves every valid JSON value for opaque OpenAI forms", async () => {
    // Arrange
    const encodedValues = ["null", "true", "[]", "{}", '"hello"', "42"];
    const openUrl = mock(async () => false);

    // Act
    const responses = await Promise.all(
      encodedValues.map((encoded) => {
        const ctx: PiElicitationContext = {
          hasUI: true,
          ui: {
            select: mock(async () => "Respond"),
            editor: mock(async () => encoded),
            notify: mock(() => undefined),
          },
        };
        return handleOfficialElicitation(
          { mode: "openai/form", message: "Official form", requestedSchema: {} },
          ctx,
          openUrl,
        );
      }),
    );

    // Assert
    expect(responses).toEqual([
      { action: "accept", content: null },
      { action: "accept", content: true },
      { action: "accept", content: [] },
      { action: "accept", content: {} },
      { action: "accept", content: "hello" },
      { action: "accept", content: 42 },
    ]);
    expect(openUrl).not.toHaveBeenCalled();
  });

  test("cancels headless requests without invoking any UI or URL action", async () => {
    // Arrange
    const select = mock(async () => "Respond");
    const editor = mock(async () => "{}");
    const notify = mock(() => undefined);
    const openUrl = mock(async () => true);
    const ctx: PiElicitationContext = { hasUI: false, ui: { select, editor, notify } };

    // Act
    const response = await handleOfficialElicitation(
      { mode: "form", message: "Choose", requestedSchema: { type: "object" } },
      ctx,
      openUrl,
    );

    // Assert
    expect(response).toEqual({ action: "cancel" });
    expect(select).not.toHaveBeenCalled();
    expect(editor).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });
});
