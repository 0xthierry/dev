import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { ExcalidrawBridge } from "./bridge-server";
import { summarizeCapture, summarizeMutation, summarizeScene, summarizeStatus } from "./scene-summary";

const canvasActionSchema = StringEnum([
  "status",
  "get_scene",
  "capture_view",
  "update_scene",
  "add_elements",
  "add_files",
  "scroll_to_content",
] as const);

const canvasToolSchema = Type.Object({
  action: canvasActionSchema,
  tabId: Type.Optional(
    Type.String({ description: "Optional connected Excalidraw browser tab ID. Defaults to the active/focused tab." }),
  ),
  elements: Type.Optional(
    Type.Array(
      Type.Any({
        description:
          "Raw Excalidraw elements. For add_elements these are appended to the existing canvas. For update_scene this is the complete replacement element list.",
      }),
    ),
  ),
  appState: Type.Optional(
    Type.Record(Type.String(), Type.Any(), { description: "Partial Excalidraw appState for update_scene." }),
  ),
  files: Type.Optional(
    Type.Array(Type.Any({ description: "Excalidraw binary file records for add_files or update_scene." })),
  ),
  elementIds: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Element IDs. For get_scene, include exact JSON for these elements in the text output. For scroll_to_content, scroll to these elements.",
    }),
  ),
  fitToViewport: Type.Optional(Type.Boolean({ default: true })),
  animate: Type.Optional(Type.Boolean({ default: false })),
  captureUpdate: Type.Optional(
    Type.String({ description: "Optional Excalidraw captureUpdate value for update_scene or add_elements." }),
  ),
  commitToHistory: Type.Optional(
    Type.Boolean({ description: "Optional Excalidraw commitToHistory flag for update_scene or add_elements." }),
  ),
});

export type ExcalidrawCanvasToolInput = Static<typeof canvasToolSchema>;

export function registerExcalidrawCanvasTool(pi: ExtensionAPI, bridge: ExcalidrawBridge): void {
  pi.registerTool({
    name: "excalidraw_canvas",
    label: "Excalidraw Canvas",
    description:
      "Inspect or control Thierry's local Excalidraw canvas through the browser bridge. " +
      "Use capture_view when you need to see the currently visible canvas viewport. Output is truncated in text summaries.",
    promptSnippet: "Inspect, screenshot, scroll, or update the connected local Excalidraw canvas",
    promptGuidelines: [
      "Use action capture_view when the user asks about what they are currently seeing in Excalidraw; it returns the visible canvas viewport as an image.",
      "Use action get_scene before targeted edits. If you need exact element JSON to clone style or bindings, call get_scene again with elementIds for the nearby exemplar elements; do not grep local session files or extension source.",
      "Prefer action add_elements when adding new boxes, arrows, or labels. add_elements appends to the current canvas and does not delete existing elements.",
      "Use action update_scene only for deliberate whole-scene replacement or appState/files updates. If elements is supplied to update_scene, it is the complete replacement element list, so include every existing element you want to keep.",
      "When editing existing elements, preserve their IDs and update only the necessary fields. When adding elements, generate unique IDs and clone compatible style fields from nearby elements.",
    ],
    parameters: canvasToolSchema,
    async execute(_toolCallId, params: ExcalidrawCanvasToolInput) {
      await bridge.start();

      if (params.action === "status") {
        const localStatus = bridge.getStatus();
        return {
          content: [{ type: "text", text: summarizeStatus(localStatus) }],
          details: localStatus,
        };
      }

      if (params.action === "get_scene") {
        const result = await bridge.request("get_scene", {}, { tabId: params.tabId, timeoutMs: 15_000 });
        return {
          content: [{ type: "text", text: summarizeScene(result, { elementIds: params.elementIds }) }],
          details: result,
        };
      }

      if (params.action === "capture_view") {
        const result = await bridge.request("capture_view", {}, { tabId: params.tabId, timeoutMs: 20_000 });
        const imageData = extractImageData(result);
        return {
          content: [
            { type: "text", text: summarizeCapture(result) },
            ...(imageData ? [{ type: "image" as const, data: imageData, mimeType: "image/png" }] : []),
          ],
          details: result,
        };
      }

      if (params.action === "update_scene") {
        const request = pickDefined({
          elements: params.elements,
          appState: params.appState,
          files: params.files,
          captureUpdate: params.captureUpdate,
          commitToHistory: params.commitToHistory,
        });
        const result = await bridge.request("update_scene", request, { tabId: params.tabId, timeoutMs: 15_000 });
        return {
          content: [{ type: "text", text: summarizeMutation("update_scene", result) }],
          details: result,
        };
      }

      if (params.action === "add_elements") {
        const result = await bridge.request(
          "add_elements",
          pickDefined({
            elements: params.elements ?? [],
            captureUpdate: params.captureUpdate,
            commitToHistory: params.commitToHistory,
          }),
          { tabId: params.tabId, timeoutMs: 15_000 },
        );
        return {
          content: [{ type: "text", text: summarizeMutation("add_elements", result) }],
          details: result,
        };
      }

      if (params.action === "add_files") {
        const result = await bridge.request(
          "add_files",
          { files: params.files ?? [] },
          { tabId: params.tabId, timeoutMs: 15_000 },
        );
        return {
          content: [{ type: "text", text: summarizeMutation("add_files", result) }],
          details: result,
        };
      }

      const result = await bridge.request(
        "scroll_to_content",
        pickDefined({ elementIds: params.elementIds, fitToViewport: params.fitToViewport, animate: params.animate }),
        { tabId: params.tabId, timeoutMs: 15_000 },
      );
      return {
        content: [{ type: "text", text: summarizeMutation("scroll_to_content", result) }],
        details: result,
      };
    },
  });
}

function pickDefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function extractImageData(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = (value as { data?: unknown }).data;
  return typeof data === "string" ? data : undefined;
}
