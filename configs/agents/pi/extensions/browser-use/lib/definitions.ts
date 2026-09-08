import { Type } from "typebox";

export const BROWSER_USE_TOOL_NAME = "browser_use";
export const BROWSER_USE_STATUS_COMMAND = "browser-use-status";

export const BROWSER_USE_PARAMETERS = Type.Object(
  {
    code: Type.String({
      description:
        "JavaScript to run in the trusted browser kernel with top-level await. Use nodeRepl.write(value) for output.",
    }),
  },
  { additionalProperties: false },
);

export const BROWSER_USE_PROMPT_SNIPPET = "Drive the user's logged-in Chromium browser through browser_use JavaScript";

export const BROWSER_USE_PROMPT_GUIDELINES = [
  "Use browser_use for tasks that need the user's existing Chrome/Brave/Edge tabs or logins.",
  "Follow the control-browser skill. Import setupBrowserRuntime from the absolute browser-client path in the tool description.",
  "browser_use starts off. If it errors as disabled, ask once for /browser-use on, then continue. /browser-use on --accept-permissions auto-accepts every browser permission prompt for the session. Do not ask permission for each click or navigation after it is on.",
  "For existing-browser tasks, do not substitute agent-browser, Playwright MCP, or Computer Use for browser_use. The agent-browser skill remains available for separate managed automation and QA sessions.",
];
