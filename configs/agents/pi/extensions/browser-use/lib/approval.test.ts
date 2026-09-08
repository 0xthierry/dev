import { expect, mock, test } from "bun:test";
import { browserUseApprovalMessage, createBrowserUseApprovalHandler } from "./approval";

const request = {
  message: "Allow Browser Use to access http://127.0.0.1:1234?",
  requestedSchema: { type: "object", properties: {}, additionalProperties: false },
  _meta: {
    tool_name: "access_browser_origin",
    origin: "http://127.0.0.1:1234",
    tool_params: { origin: "http://127.0.0.1:1234" },
  },
};

test.each([true, false])("returns only the actual user's decision (%s)", async (accepted) => {
  // Arrange
  const confirm = mock(async () => accepted);
  const handler = createBrowserUseApprovalHandler(confirm);
  const controller = new AbortController();

  // Act
  const result = await handler(request, controller.signal);

  // Assert
  expect(result.action).toBe(accepted ? "accept" : "decline");
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("http://127.0.0.1:1234"), controller.signal);
  expect(result).not.toHaveProperty("_meta");
  expect(result.content).not.toHaveProperty("persist");
});

test.each([
  null,
  { ...request, mode: "url" },
  { ...request, _meta: { codex_strict_auto_review: true } },
  { ...request, meta: { codex_strict_auto_review: true }, _meta: {} },
  { ...request, requestedSchema: { type: "object", properties: { secret: { type: "string" } } } },
  { ...request, requestedSchema: { type: "object", properties: {}, required: ["secret"] } },
  { ...request, message: "x".repeat(8_001) },
  { ...request, message: "hidden\u001b[0m" },
])("fails closed for unsupported or unsafe elicitation %#", async (value) => {
  // Arrange
  const confirm = mock(async () => true);
  const handler = createBrowserUseApprovalHandler(confirm);

  // Act
  const result = await handler(value, new AbortController().signal);

  // Assert
  expect(result).toEqual({ action: "cancel" });
  expect(confirm).not.toHaveBeenCalled();
});

test("cancelled confirmation cannot approve access", async () => {
  // Arrange
  const controller = new AbortController();
  const confirm = mock(async () => {
    controller.abort();
    return true;
  });
  const handler = createBrowserUseApprovalHandler(confirm);

  // Act
  const result = await handler(request, controller.signal);

  // Assert
  expect(result).toEqual({ action: "cancel" });
});

test("already aborted approval never prompts and message includes action scope", async () => {
  // Arrange
  const confirm = mock(async () => true);
  const controller = new AbortController();
  controller.abort();

  // Act
  const result = await createBrowserUseApprovalHandler(confirm)(request, controller.signal);

  // Assert
  expect(result.action).toBe("cancel");
  expect(confirm).not.toHaveBeenCalled();
  expect(browserUseApprovalMessage(request)).toContain("Action: access_browser_origin");
  expect(browserUseApprovalMessage(request)).toContain("Pi will not request persistent permission");
});
