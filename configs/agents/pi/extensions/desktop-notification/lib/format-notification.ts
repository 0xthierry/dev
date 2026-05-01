import { renderPlainMarkdown } from "./markdown";

export type DesktopNotification = {
  title: string;
  body: string;
};

const DEFAULT_TITLE = "π";
const READY_TITLE = "Ready for input";
const MAX_BODY_LENGTH = 200;

export function formatNotification(text: string | null): DesktopNotification {
  const normalized = normalizeNotificationBody(text);
  if (!normalized) {
    return { title: READY_TITLE, body: "" };
  }

  return {
    title: DEFAULT_TITLE,
    body: truncateNotificationBody(normalized),
  };
}

export function normalizeNotificationBody(text: string | null): string {
  if (!text) return "";
  return renderPlainMarkdown(text).replace(/\s+/g, " ").trim();
}

export function truncateNotificationBody(body: string, maxLength = MAX_BODY_LENGTH): string {
  if (body.length <= maxLength) return body;
  if (maxLength <= 1) return "…".slice(0, maxLength);
  return `${body.slice(0, maxLength - 1)}…`;
}
