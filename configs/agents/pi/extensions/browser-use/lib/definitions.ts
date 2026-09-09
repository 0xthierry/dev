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

export const BROWSER_USE_PROMPT_SNIPPET =
  "Use browser_use JavaScript only when the user explicitly requests browser_use or control-browser; otherwise use agent-browser for browser automation";

export const BROWSER_USE_PROMPT_GUIDELINES = [
  "Default to agent-browser for browser automation, including the user's existing Chrome/Brave/Edge tabs and logins through CDP. Use browser_use only when the user explicitly requests browser_use, control-browser, or the ChatGPT browser extension for the task. Naming a browser, an existing login, or a URL does not select browser_use.",
  "When browser_use is explicitly requested, follow the control-browser skill. Import setupBrowserRuntime from the absolute browser-client path in the tool description.",
  "browser_use starts off. If it errors as disabled, ask once for /browser-use on, then continue. /browser-use on --accept-permissions auto-accepts every browser permission prompt for the session. Do not ask permission for each click or navigation after it is on.",
  "Tool availability or /browser-use on alone does not select browser_use. Do not ask to enable it during an agent-browser task. Preserve the user's chosen browser and tool; report failures instead of silently switching tools. Never switch tools to bypass an explicit permission denial.",
];
