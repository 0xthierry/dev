-- Evidenced personal deltas only; see README.md for the provenance audit.
-- Leave stock repeat delay, scrolling, resize handles, blur, shadows, groupbar
-- and animations to Quattro, not the copied legacy preference/default files.
hl.config({
  input = {
    kb_layout = "us", kb_model = "pc105", kb_variant = "intl", kb_options = "compose:caps",
    sensitivity = -0.4,
  },
  general = { border_size = 1 },
  decoration = { active_opacity = 1.0, inactive_opacity = 1.0, fullscreen_opacity = 1.0 },
  render = { direct_scanout = 1 },
})

-- Preserve the terminal class recognized by the personal clipboard helper.
o.window("org\\.wezfurlong\\.wezterm", { tag = "+terminal" })

-- Explicit US International/Xwayland workflow (d08aa0c), once per session.
o.exec_on_start([[bash -c 'for _ in {1..20}; do setxkbmap -layout us -model pc105 -variant intl -option compose:caps && exit 0; sleep 0.5; done']])
-- No personal env overrides existed. No Waybar watchdog: Quattro owns the shell.
