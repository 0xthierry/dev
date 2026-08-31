import { describe, expect, test } from "bun:test";
import {
  isAgentSettledEvent,
  isBlockingExtensionUiMethod,
  isExtensionUiRequest,
  isRpcResponse,
  type RpcInboundMessage,
} from "./protocol";

describe("RPC protocol guards", () => {
  test("recognizes correlated responses without classifying ordinary events", () => {
    // Arrange
    const response = { type: "response", command: "get_state", success: true } as RpcInboundMessage;
    const event = { type: "agent_end" } as RpcInboundMessage;

    // Act
    const result = [isRpcResponse(response), isRpcResponse(event)];

    // Assert
    expect(result).toEqual([true, false]);
  });

  test("requires extension UI request identity and method", () => {
    // Arrange
    const valid = { type: "extension_ui_request", id: "ui-1", method: "confirm" } as RpcInboundMessage;
    const missingMethod = { type: "extension_ui_request", id: "ui-2" } as RpcInboundMessage;

    // Act
    const result = [isExtensionUiRequest(valid), isExtensionUiRequest(missingMethod)];

    // Assert
    expect(result).toEqual([true, false]);
  });

  test("classifies only the four blocking UI methods", () => {
    // Arrange
    const methods = ["select", "confirm", "input", "editor", "notify", "setStatus"];

    // Act
    const blocking = methods.filter(isBlockingExtensionUiMethod);

    // Assert
    expect(blocking).toEqual(["select", "confirm", "input", "editor"]);
  });

  test("settles only on agent_settled and never on agent_end", () => {
    // Arrange
    const settled = { type: "agent_settled" } as RpcInboundMessage;
    const ended = { type: "agent_end" } as RpcInboundMessage;

    // Act
    const result = [isAgentSettledEvent(settled), isAgentSettledEvent(ended)];

    // Assert
    expect(result).toEqual([true, false]);
  });
});
