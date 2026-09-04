# Pi task title

Shows the task Pi is currently handling in the terminal title.

For interactive and RPC prompts, the extension converts the raw user input into a single sanitized title such as `π · Fix the title shown in Omarchy`. Skill/template expansion and image attachment markup are excluded, terminal control characters are removed, and titles are clipped to 72 characters.

Extension-injected messages such as AMQ wake-ups do not replace the human task title. A queued follow-up becomes the title only when its agent turn starts.

Inside Herdr, `configs/herdr/config.toml` includes `{terminal_title}` in `ui.window_title`. Ghostty exposes that title as the Wayland window title, which Omarchy's Hyprland group bar displays. Standalone Ghostty windows receive Pi's title directly.

After installation, use `/reload` in an existing Pi session. The next submitted prompt updates its title.

## Tests

```bash
bun run test:pi-extensions task-title
bun run test:pi-extensions:e2e task-title
```
