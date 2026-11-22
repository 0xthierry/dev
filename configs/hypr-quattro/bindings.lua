-- Stock v4.5.0 universal copy/paste now handles terminals, GUI apps, and focused
-- shell panels correctly. Keep it (including its key-up timer fix), not the old
-- shell helper's activewindow-only sendshortcut. Only cut moves off SUPER + X.
hl.unbind("SUPER + X")
o.rebind("SUPER + ALT + X", "Universal cut", function()
  hl.dispatch(hl.dsp.send_key_state({ mods = "CTRL", key = "X", state = "down" }))
  hl.timer(function()
    hl.dispatch(hl.dsp.send_key_state({ mods = "CTRL", key = "X", state = "up" }))
  end, { timeout = 50, type = "oneshot" })
end, { release = true })

-- Same-behavior stock application bindings remain stock (terminal/cwd, browser,
-- file manager, editor, music, btop and web apps). These are personal differences.
o.rebind("SUPER + SHIFT + SLASH", "Passwords", { launch = "bitwarden.desktop" })
local function ai_app(command)
  local callback = function()
    hl.dispatch(hl.dsp.focus({ workspace = "5" }))
    hl.exec_cmd(command)
  end
  -- The keybindings menu needs a shell equivalent for function-backed binds.
  o.bind_commands[callback] = [[hyprctl dispatch 'hl.dsp.focus({ workspace = "5" })'; ]] .. command
  return callback
end
o.rebind("SUPER + SHIFT + A", "ChatGPT", ai_app([[omarchy-launch-or-focus ChatGPT "uwsm-app -- chatgpt"]]))
o.rebind("SUPER + SHIFT + C", "Claude", ai_app([[omarchy-launch-or-focus anthropic "uwsm-app -- claude-desktop"]]))
o.rebind("SUPER + SHIFT + G", "Github", { webapp = "https://github.com" })
o.rebind("SUPER + SHIFT + E", "Email", { webapp = "https://mail.google.com/mail/u/0/#inbox" })
o.rebind("SUPER + SHIFT + S", "Steam Gaming Mode", "$HOME/.local/share/steam-launcher/enter-gamesmode")
o.rebind("SUPER + SHIFT + R", "Exit Gaming Mode", "$HOME/.local/share/steam-launcher/leave-gamesmode")

-- Physical grave works with us(intl)'s dead_grave/dead_tilde. Only remove
-- the Quake console's conflicting grave chords; unrelated PRINT/OCR stays stock.
-- Legacy PRINT unbinds claimed conflicts, not a separate freed-key workflow.
for _, key in ipairs({ "SUPER + grave", "SUPER + SHIFT + grave" }) do
  hl.unbind(key)
end
o.rebind("SUPER + code:49", "Screenshot of region", "omarchy capture screenshot region")
o.rebind("SUPER + SHIFT + code:49", "Screenshot of window", "omarchy capture screenshot windows")
o.rebind("SUPER + CTRL + code:49", "Screenshot of display", "omarchy capture screenshot fullscreen")
-- Screenrecording's current command toggles stop/start itself; the retired
-- omarchy-cmd-screenrecord path and positional `output` flag no longer exist.
o.rebind("SUPER + ALT + code:49", "Screen record a region", "omarchy capture screenrecording")
o.rebind("SUPER + CTRL + ALT + code:49", "Screen record display", "omarchy capture screenrecording --fullscreen")
