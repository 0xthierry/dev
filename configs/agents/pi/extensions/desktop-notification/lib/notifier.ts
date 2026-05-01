import type { DesktopNotification } from "./format-notification";

export type DesktopNotifier = (notification: DesktopNotification) => void;

export function writeOsc777Notification(notification: DesktopNotification): void {
  if (!canWriteTerminalNotification()) return;
  process.stdout.write(createOsc777Notification(notification));
}

export function canWriteTerminalNotification(): boolean {
  return process.stdout.isTTY === true;
}

export function createOsc777Notification(notification: DesktopNotification): string {
  const title = sanitizeOsc777Field(notification.title);
  const body = sanitizeOsc777Field(notification.body);
  return `\x1b]777;notify;${title};${body}\x07`;
}

export function sanitizeOsc777Field(value: string): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return character === ";" || codePoint <= 31 || codePoint === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
