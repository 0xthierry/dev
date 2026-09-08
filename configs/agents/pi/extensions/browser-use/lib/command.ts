export type BrowserUseCommand =
  | { mode: "status" }
  | { mode: "off" }
  | { mode: "on"; acceptPermissions: boolean }
  | { mode: "invalid" };

const ACCEPT_FLAGS = new Set(["--accept-permissions", "--dangerously-accept-permissions"]);

export const BROWSER_USE_COMMAND_USAGE = "Usage: /browser-use on [--accept-permissions]|off|status";

export const BROWSER_USE_COMMAND_COMPLETIONS = ["on", "on --accept-permissions", "off", "status"];

export function parseBrowserUseCommand(args: string): BrowserUseCommand {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens[0] === "status") {
    return tokens.length > 1 ? { mode: "invalid" } : { mode: "status" };
  }
  if (tokens[0] === "off") {
    return tokens.length > 1 ? { mode: "invalid" } : { mode: "off" };
  }
  if (tokens[0] !== "on") return { mode: "invalid" };
  const flags = tokens.slice(1);
  if (flags.some((flag) => !ACCEPT_FLAGS.has(flag))) return { mode: "invalid" };
  return { mode: "on", acceptPermissions: flags.length > 0 };
}
