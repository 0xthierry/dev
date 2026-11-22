/** Keep Pi in step with Omarchy 3.x markers and Quattro's resolved palette. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function omarchyPiTheme(home = process.env.HOME ?? ""): "light" | "dark" | null {
  const current = join(home, ".local/state/omarchy/current/theme");
  if (existsSync(current)) {
    // Use upstream's mode/theme_type/marker/luminance precedence, not a second
    // TOML parser. A failed read during a theme swap keeps Pi's existing theme.
    const result = spawnSync("omarchy-theme-color", ["--file", join(current, "colors.toml"), "mode"], {
      encoding: "utf8",
      timeout: 1000,
    });
    const mode = result.stdout?.trim();
    return result.status === 0 && (mode === "light" || mode === "dark") ? mode : null;
  }
  const legacy = join(home, ".config/omarchy/current/theme");
  if (!existsSync(legacy)) return null; // Leave macOS and non-Omarchy users alone.
  return existsSync(join(legacy, "light.mode")) ? "light" : "dark";
}

export default function (pi: ExtensionAPI) {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  pi.on("session_start", (_event, ctx) => {
    if (intervalId) clearInterval(intervalId);
    if (!ctx.hasUI) return;
    let currentTheme: "light" | "dark" | null = null;
    const sync = () => {
      const nextTheme = omarchyPiTheme();
      if (nextTheme !== null && nextTheme !== currentTheme) {
        ctx.ui.setTheme(nextTheme);
        currentTheme = nextTheme;
      }
    };
    sync();
    intervalId = setInterval(sync, 2000);
  });

  pi.on("session_shutdown", () => {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  });
}
