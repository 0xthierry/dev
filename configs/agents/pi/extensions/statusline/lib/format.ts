import { hasChanges } from "./git";
import type { GitChangeSummary, PullRequestStatus, StatuslineSnapshot, StockQuote } from "./types";

const OSC8_CLOSE = "\x1b]8;;\x1b\\";

export type StatuslineStyle = {
  pullRequest(text: string): string;
  added(text: string): string;
  removed(text: string): string;
  changed(text: string): string;
  untracked(text: string): string;
  binary(text: string): string;
  stock(text: string): string;
  separator(text: string): string;
};

const plainStyle: StatuslineStyle = {
  pullRequest: passthrough,
  added: passthrough,
  removed: passthrough,
  changed: passthrough,
  untracked: passthrough,
  binary: passthrough,
  stock: passthrough,
  separator: passthrough,
};

export function formatStatusline(
  snapshot: StatuslineSnapshot,
  style: StatuslineStyle = plainStyle,
): string | undefined {
  const parts: string[] = [];

  if (snapshot.git?.pullRequest) parts.push(formatPullRequest(snapshot.git.pullRequest, style));

  const changeText = snapshot.git ? formatChangeSummary(snapshot.git.changes, style) : undefined;
  if (changeText) parts.push(changeText);

  const stockText = snapshot.stock ? formatStockQuote(snapshot.stock, style) : undefined;
  if (stockText) parts.push(stockText);

  return parts.length > 0 ? parts.join(style.separator(" · ")) : undefined;
}

export function formatPullRequest(pullRequest: PullRequestStatus, style: StatuslineStyle = plainStyle): string {
  const label = style.pullRequest(`PR #${pullRequest.number}`);
  return pullRequest.url ? terminalLink(label, pullRequest.url) : label;
}

export function formatChangeSummary(
  changes: GitChangeSummary,
  style: StatuslineStyle = plainStyle,
): string | undefined {
  if (!hasChanges(changes)) return undefined;

  const parts: string[] = [];
  if (changes.added > 0 || changes.removed > 0) {
    parts.push(style.added(`+${changes.added}`) + style.separator("/") + style.removed(`-${changes.removed}`));
  }
  if (changes.changedFiles > 0) parts.push(style.changed(`~${changes.changedFiles}`));
  if (changes.untrackedFiles > 0) parts.push(style.untracked(`?${changes.untrackedFiles}`));
  if (changes.binaryFiles > 0) parts.push(style.binary(`bin${changes.binaryFiles}`));

  return parts.join(" ");
}

export function formatStockQuote(quote: StockQuote, style: StatuslineStyle = plainStyle): string {
  const price = quote.price.toFixed(2);
  const currency = quote.currency?.trim().toUpperCase();
  if (currency === "BRL") return style.stock(`${quote.label} R$${price}`);
  if (currency) return style.stock(`${quote.label} ${currency} ${price}`);
  return style.stock(`${quote.label} ${price}`);
}

function terminalLink(label: string, url: string): string {
  const safeUrl = stripTerminalControl(url);
  return `\x1b]8;;${safeUrl}\x1b\\${label}${OSC8_CLOSE}`;
}

function stripTerminalControl(value: string): string {
  return [...value].filter((character) => !isTerminalControl(character)).join("");
}

function isTerminalControl(character: string): boolean {
  const code = character.codePointAt(0);
  return code != null && ((code >= 0 && code <= 31) || code === 127);
}

function passthrough(text: string): string {
  return text;
}
