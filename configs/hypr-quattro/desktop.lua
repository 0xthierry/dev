-- Only differences from v4.5.0 defaults: keep package themes, env, tiling,
-- shell autostart and app rules instead of freezing another full default copy.
hl.config({
  input = {
    kb_layout = "us", kb_model = "pc105", kb_variant = "intl", kb_options = "compose:caps",
    repeat_delay = 600, sensitivity = -0.4,
  },
  general = { border_size = 1, resize_on_border = false },
  decoration = {
    active_opacity = 1.0, inactive_opacity = 1.0, fullscreen_opacity = 1.0,
    shadow = { enabled = true, range = 2, render_power = 3, color = "rgba(1a1a1aee)" },
    blur = { enabled = true, size = 2, passes = 2, special = true, brightness = 0.60, contrast = 0.75 },
  },
  group = { groupbar = { indicator_height = 0 } },
  render = { direct_scanout = 1 },
})
hl.animation({ leaf = "windows", enabled = true, speed = 4.79, bezier = "easeOutQuint" })
hl.animation({ leaf = "specialWorkspace", enabled = true, speed = 4, bezier = "easeOutQuint", style = "slidevert" })

-- Stock has Alacritty/kitty=1.5 and Ghostty=0.2 already. Preserve personal foot
-- speed (stock changed it to 2.0), and the old WezTerm clipboard recognition.
o.window("foot", { scroll_touchpad = 1.5 })
o.window("org\\.wezfurlong\\.wezterm", { tag = "+terminal" })

-- Xwayland keyboard alignment, once per session (not on config reload).
o.exec_on_start([[bash -c 'for _ in {1..20}; do setxkbmap -layout us -model pc105 -variant intl -option compose:caps && exit 0; sleep 0.5; done']])
-- No personal env overrides existed. No Waybar watchdog: Quattro owns the shell.
