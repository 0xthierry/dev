const DEFAULT_ELEMENT_LIMIT = 40;

type JsonObject = Record<string, unknown>;

export type SceneSummaryOptions = {
  elementLimit?: number;
  elementIds?: string[];
  maxElementJsonChars?: number;
};

export function summarizeStatus(status: JsonObject): string {
  const running = status.running === true ? "running" : "stopped";
  const clients = Array.isArray(status.clients) ? status.clients : [];
  const activeTabId = typeof status.activeTabId === "string" ? status.activeTabId : "none";
  const lines = [
    `Excalidraw bridge is ${running}.`,
    `Connected tabs: ${clients.length}.`,
    `Active tab: ${activeTabId}.`,
  ];

  for (const client of clients) {
    if (!client || typeof client !== "object") continue;
    const item = client as JsonObject;
    const tabId = stringValue(item.tabId) ?? "unknown";
    const title = stringValue(item.title) ?? "Untitled";
    const url = stringValue(item.url) ?? "unknown URL";
    const focused = item.focused === true ? "focused" : "not focused";
    const visible = item.visible === true ? "visible" : "hidden";
    const apiReady = item.apiReady === true ? "API ready" : "API not ready";
    const elementCount = numberValue(item.elementCount);
    const elementText = elementCount === undefined ? "unknown elements" : `${elementCount} element(s)`;
    lines.push(`- ${tabId}: ${title} (${focused}, ${visible}, ${apiReady}, ${elementText}) — ${url}`);
  }

  return lines.join("\n");
}

export function summarizeScene(scene: unknown, options: SceneSummaryOptions = {}): string {
  const root = objectValue(scene);
  const sceneObject = objectValue(root?.scene);
  const viewport = objectValue(root?.viewport);
  const elements = arrayValue(sceneObject?.elements);
  const selectedElementIds = objectValue(sceneObject?.selectedElementIds);
  const elementLimit = options.elementLimit ?? DEFAULT_ELEMENT_LIMIT;

  const lines = [
    `Scene elements: ${elements.length}.`,
    `Selected elements: ${selectedIds(selectedElementIds).join(", ") || "none"}.`,
    `Viewport: ${formatViewport(viewport)}.`,
  ];

  const visibleElements = elements.slice(0, elementLimit);
  for (const [index, rawElement] of visibleElements.entries()) {
    const element = objectValue(rawElement);
    if (!element) continue;
    lines.push(`${index + 1}. ${formatElement(element)}`);
  }

  if (elements.length > elementLimit) {
    lines.push(
      `… ${elements.length - elementLimit} more element(s) omitted from text summary. To inspect exact JSON for specific elements, call get_scene with elementIds.`,
    );
  }

  if (options.elementIds && options.elementIds.length > 0) {
    lines.push(formatRequestedElements(elements, options.elementIds, options.maxElementJsonChars ?? 12_000));
  }

  return lines.join("\n");
}

export function summarizeCapture(result: unknown): string {
  const capture = objectValue(result);
  const data = stringValue(capture?.data);
  const size = data ? `${data.length} base64 character(s)` : "unknown size";
  return `Captured current Excalidraw canvas viewport as PNG (${size}). Screenshot attached for visual inspection.`;
}

export function summarizeMutation(action: string, result: unknown): string {
  const object = objectValue(result);
  const elementCount = numberValue(object?.elementCount);
  if (elementCount !== undefined) return `${action} succeeded. Canvas now has ${elementCount} element(s).`;
  return `${action} succeeded.`;
}

function selectedIds(value: JsonObject | undefined): string[] {
  if (!value) return [];
  return Object.entries(value)
    .filter(([, selected]) => selected === true)
    .map(([id]) => id);
}

function formatViewport(viewport: JsonObject | undefined): string {
  if (!viewport) return "unknown";
  const zoom = objectValue(viewport.zoom);
  const zoomValue = numberValue(zoom?.value) ?? numberValue(viewport.zoom);
  const width = numberValue(viewport.width);
  const height = numberValue(viewport.height);
  const scrollX = numberValue(viewport.scrollX);
  const scrollY = numberValue(viewport.scrollY);
  const parts = [];
  if (width !== undefined && height !== undefined) parts.push(`${Math.round(width)}×${Math.round(height)}`);
  if (zoomValue !== undefined) parts.push(`zoom ${round(zoomValue)}`);
  if (scrollX !== undefined && scrollY !== undefined) parts.push(`scroll ${round(scrollX)}, ${round(scrollY)}`);
  return parts.join(", ") || "unknown";
}

function formatElement(element: JsonObject): string {
  const id = stringValue(element.id) ?? "unknown-id";
  const type = stringValue(element.type) ?? "unknown";
  const x = round(numberValue(element.x) ?? 0);
  const y = round(numberValue(element.y) ?? 0);
  const width = round(numberValue(element.width) ?? 0);
  const height = round(numberValue(element.height) ?? 0);
  const text = stringValue(element.text);
  const textSuffix = text ? ` text=${JSON.stringify(truncate(text, 100))}` : "";
  return `${type} ${id} at (${x}, ${y}) size ${width}×${height}${textSuffix}`;
}

function formatRequestedElements(elements: unknown[], elementIds: string[], maxElementJsonChars: number): string {
  const requested = new Set(elementIds);
  const matches = elements.filter((element) => {
    const object = objectValue(element);
    return object && requested.has(stringValue(object.id) ?? "");
  });

  if (matches.length === 0) return `Requested element JSON: no matches for ${elementIds.join(", ")}.`;

  const json = JSON.stringify(matches, null, 2);
  return `Requested element JSON (${matches.length} match(es)):\n${truncate(json, maxElementJsonChars)}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
