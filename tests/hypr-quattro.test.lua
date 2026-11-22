-- Offline integration: execute the actual v4.5.0 defaults and overlay, replacing
-- only the compositor API. Dispatch payloads are the observable output boundary.
-- Run via hypr-quattro.test.py for an isolated HOME and pinned upstream checkout.
local upstream, overlay = assert(arg[1]), assert(arg[2])
package.path = upstream .. "/?.lua;" .. package.path
local bindings, events, dispatched, timers, commands, monitors, rules, settings = {}, {}, {}, {}, {}, {}, {}, {}
local current_submap, active_window = "reset", nil
local animations = {}
local function chord(key)
  local parts = {}
  for part in key:gmatch("[^+]+") do parts[#parts + 1] = part:match("^%s*(.-)%s*$") end
  local last = table.remove(parts)
  table.sort(parts)
  return table.concat(parts, "+") .. ":" .. last
end
local function dispatcher(path)
  return setmetatable({}, {
    __index = function(_, key) return dispatcher(path .. "." .. key) end,
    __call = function(_, value) return { operation = path, value = value } end,
  })
end
hl = {
  dsp = dispatcher("dsp"),
  bind = function(keys, callback, options)
    local index = current_submap .. "/" .. chord(keys)
    bindings[index] = bindings[index] or {}
    table.insert(bindings[index], { callback = callback, options = options or {} })
  end,
  unbind = function(keys) bindings[current_submap .. "/" .. chord(keys)] = nil end,
  dispatch = function(value) dispatched[#dispatched + 1] = value end,
  exec_cmd = function(value) commands[#commands + 1] = value end,
  timer = function(callback) timers[#timers + 1] = callback end,
  on = function(event, callback)
    events[event] = events[event] or {}
    table.insert(events[event], callback)
  end,
  get_active_window = function() return active_window end,
  get_monitor = function(direction) return direction == "r" and { name = "HDMI-A-2" } or nil end,
  -- Any use of stock's block allocator/reconciler is a defect in this overlay.
  get_monitors = function() error("global workspaces must not invoke block allocator") end,
  define_submap = function(name, callback)
    local previous = current_submap
    current_submap = name
    callback()
    current_submap = previous
  end,
  monitor = function(spec) monitors[spec.output] = spec end,
  workspace_rule = function(spec) rules[spec.workspace] = spec end,
  window_rule = function(spec) rules[spec.match.class] = spec end,
  config = function(spec)
    local function merge(target, source)
      for key, value in pairs(source) do
        if type(value) == "table" then
          target[key] = target[key] or {}
          merge(target[key], value)
        else target[key] = value end
      end
    end
    merge(settings, spec)
  end,
  animation = function(spec) animations[spec.leaf] = spec end,
  curve = function() end,
}
require("default.hypr.helpers")
require("default.hypr.monitor-workspaces")
require("default.hypr.looknfeel")
require("default.hypr.input")
require("default.hypr.bindings.utilities")
require("default.hypr.bindings.applications")
require("default.hypr.bindings.clipboard")
require("default.hypr.bindings.tiling")
-- The runner supplies stock's selected backend in an isolated HOME. Load the
-- actual stock bindings, then migrated personal bindings AFTER the overlay.
require("default.hypr.bindings.dictation")
require("default.hypr.dictation-backend")
-- Snapshot stock animations; the overlay must not freeze copied v3 speeds.
local stock_windows_animation = animations.windows
local stock_special_animation = animations.specialWorkspace

dofile(overlay .. "/dev-setup.lua")
dofile(os.getenv("HOME") .. "/.config/hypr/bindings.lua")
local function press(keys, submap, release)
  local entries = bindings[(submap or "reset") .. "/" .. chord(keys)] or {}
  for _, binding in ipairs(entries) do
    if (binding.options.release == true) == (release == true) then
      if type(binding.callback) == "function" then binding.callback() else hl.dispatch(binding.callback) end
    end
  end
end
local function emit(event, value)
  for _, callback in ipairs(events[event] or {}) do callback(value) end
end
local function flush_timers()
  local pending = timers
  timers = {}
  for _, callback in ipairs(pending) do callback() end
end

-- Global workspace 5 is the same from keyboard and either bar, before and after
-- the *real upstream* reload/hotplug listeners fire (including deferred removal).
press("SUPER + code:14")
assert(dispatched[#dispatched].operation == "dsp.focus")
assert(dispatched[#dispatched].value.workspace == "5")
emit("config.reloaded")
emit("monitor.added", { name = "HDMI-A-2" })
emit("monitor.removed", { name = "HDMI-A-2" })
flush_timers()
o.workspaces.focus(5, "HDMI-A-2")()
assert(dispatched[#dispatched].value.workspace == "5")
press("SUPER + SHIFT + ALT + code:14")
assert(dispatched[#dispatched].operation == "dsp.window.move")
assert(dispatched[#dispatched].value.workspace == "5" and dispatched[#dispatched].value.follow == false)
press("SUPER + SHIFT + ALT + RIGHT")
assert(dispatched[#dispatched].operation == "dsp.workspace.move")
assert(dispatched[#dispatched].value.monitor == "HDMI-A-2")
assert(rules["5"].monitor == "HDMI-A-2" and rules["5"].persistent and rules["5"].default)
assert(rules["1"].monitor == "DP-1" and rules["1"].default)
assert(rules["9"].monitor == "DP-1")
assert(monitors["DP-1"].mode == "3840x2160@60.0" and monitors["DP-1"].scale == 2)
assert(monitors["HDMI-A-2"].position == "3552x477")

-- Real upstream clipboard callback: GUI and panel Ctrl+C/V, terminal Ctrl+Shift.
active_window = { tags = {} }
press("SUPER + C")
assert(dispatched[#dispatched].value.mods == "CTRL" and dispatched[#dispatched].value.key == "C")
flush_timers()
assert(dispatched[#dispatched].value.state == "up")
active_window = { tags = { "terminal*" } }
press("SUPER + V")
assert(dispatched[#dispatched].value.mods == "CTRL SHIFT" and dispatched[#dispatched].value.key == "V")
flush_timers()
active_window = nil
press("SUPER + V")
assert(dispatched[#dispatched].value.mods == "CTRL" and dispatched[#dispatched].value.key == "V")
flush_timers()
local before = #dispatched
press("SUPER + X")
assert(#dispatched == before)
press("SUPER + ALT + X", nil, true)
assert(dispatched[#dispatched].value.mods == "CTRL" and dispatched[#dispatched].value.key == "X")
flush_timers()
assert(dispatched[#dispatched].value.state == "up")

-- Quattro dictation is stock, including migration-owned late personal keys.
-- Each toggle/hold has exactly stock's registration count, never custom ones.
assert(#bindings["reset/" .. chord("ALT + SPACE")] == 1)
assert(#bindings["reset/" .. chord("ALT + Alt_R")] == 2)
assert(#bindings["reset/" .. chord("F9")] == 2)
assert(#bindings["reset/" .. chord("SUPER + CTRL + X")] == 1)
press("ALT + SPACE")
assert(dispatched[#dispatched].value == "omarchy-dictation toggle")
press("ALT + Alt_R")
assert(commands[#commands] == "omarchy-dictation start")
press("ALT + Alt_R", nil, true)
assert(commands[#commands] == "omarchy-dictation stop")
local before_commands = #commands
press("F9", nil, true)
assert(#commands == before_commands)
press("F9")
assert(commands[#commands] == "omarchy-dictation start")
press("F9", nil, true)
assert(commands[#commands] == "omarchy-dictation stop")
local release_binding = bindings["reset/" .. chord("F9")][2]
assert(release_binding.options.ignore_mods and release_binding.options.transparent and release_binding.options.non_consuming)
press("SUPER + CTRL + X")
assert(dispatched[#dispatched].value == "omarchy-dictation toggle")

press("SUPER + SHIFT + D")
assert(dispatched[#dispatched].value == "omarchy-launch-tui 'omarchy-launch-docker-tui'")
press("SUPER + SHIFT + A")
assert(dispatched[#dispatched].value.workspace == "5")
assert(commands[#commands] == 'omarchy-launch-or-focus ChatGPT "uwsm-app -- chatgpt"')
press("SUPER + SHIFT + C")
assert(dispatched[#dispatched].value.workspace == "5")
assert(commands[#commands] == 'omarchy-launch-or-focus anthropic "uwsm-app -- claude-desktop"')
press("SUPER + code:49")
assert(dispatched[#dispatched].value == "omarchy capture screenshot region")
press("SUPER + SHIFT + code:49")
assert(dispatched[#dispatched].value == "omarchy capture screenshot windows")
press("SUPER + CTRL + code:49")
assert(dispatched[#dispatched].value == "omarchy capture screenshot fullscreen")
press("SUPER + ALT + code:49")
assert(dispatched[#dispatched].value == "omarchy capture screenrecording")
press("SUPER + CTRL + ALT + code:49")
assert(dispatched[#dispatched].value == "omarchy capture screenrecording --fullscreen")
assert(bindings["reset/" .. chord("SUPER + grave")] == nil)
-- Real stock capture chords remain usable alongside the personal grave keys.
press("PRINT")
assert(dispatched[#dispatched].value == "omarchy-capture-screenshot")
press("ALT + PRINT")
assert(dispatched[#dispatched].value == "omarchy-capture-screenrecording --stop-recording || omarchy-menu toggle trigger.capture.screenrecord")
press("SUPER + PRINT")
assert(dispatched[#dispatched].value == "pkill hyprpicker || hyprpicker -a")
press("SUPER + CTRL + PRINT")
assert(dispatched[#dispatched].value == "omarchy-capture-text")
assert(settings.input.kb_variant == "intl" and settings.input.kb_options == "compose:caps")
assert(settings.input.sensitivity == -0.4 and settings.input.repeat_delay == 250)
assert(settings.general.border_size == 1 and settings.general.resize_on_border == true)
assert(settings.decoration.active_opacity == 1 and settings.render.direct_scanout == 1)
assert(settings.decoration.blur.enabled == false and settings.decoration.shadow.enabled == false)
assert(settings.group.groupbar.indicator_height == 1)
assert(animations.windows == stock_windows_animation and animations.specialWorkspace == stock_special_animation)
assert(rules.foot.scroll_touchpad == 2.0)

-- Stock's session-start callback and the personal Xwayland callback, isolated
-- to temporary state by the Python runner; no actual external command is run.
emit("hyprland.start")
assert(commands[#commands] == [[bash -c 'for _ in {1..20}; do setxkbmap -layout us -model pc105 -variant intl -option compose:caps && exit 0; sleep 0.5; done']])
print("PASS: workspace events, clipboard, stock dictation, capture, applications, desktop and autostart")
