-- Run via global-workspaces-lua.test.sh (pinned upstream, disposable state).
package.path = os.getenv("OMARCHY_PATH") .. "/?.lua;" .. package.path
local bindings, events, timers, rules, dispatched = {}, {}, {}, {}, {}
local active_window, active_workspace = { address = "feed" }, { id = 14 }
local function dispatcher(name)
  return setmetatable({}, {
    __index = function(_, k) return dispatcher(name .. "." .. k) end,
    __call = function(_, value) return { name = name, value = value } end,
  })
end
hl = {
  dsp = dispatcher("dsp"),
  bind = function(keys, callback)
    bindings[keys] = bindings[keys] or {}
    table.insert(bindings[keys], callback)
  end,
  unbind = function(keys) bindings[keys] = nil end,
  workspace_rule = function(rule) rules[tonumber(rule.workspace)] = rule end,
  on = function(event, callback) events[event] = callback end,
  timer = function(callback) timers[#timers + 1] = callback end,
  dispatch = function(d) dispatched[#dispatched + 1] = d end,
  get_active_window = function() return active_window end,
  get_active_workspace = function() return active_workspace end,
  get_monitor = function(dir) return dir == "r" and { name = "HDMI-A-2" } or nil end,
  -- No monitor config, block lookups, commands or direct window mutations available.
}
require("default.hypr.helpers")
local ws = require("default.hypr.monitor-workspaces")
require("default.hypr.bindings.tiling")
local old = {}; for key, value in pairs(bindings) do old[key] = value end

dofile(assert(arg[1]))
events["config.reloaded"]()
events["monitor.added"]({ name = "HDMI-A-2" })
events["monitor.removed"]({ name = "HDMI-A-2" })
for _, callback in ipairs(timers) do callback() end
assert(#dispatched == 0, "load or reconcile changed live workspace/window state")

-- An outside binding must neither disappear nor change. Only 30 number chords
-- and the 4 directional workspace-move chords can have different callbacks.
local replaced = 0
for key, callback in pairs(old) do
  assert(bindings[key], "lost stock key: " .. key)
  if bindings[key] ~= callback then replaced = replaced + 1 end
end
assert(replaced == 34)
for key in pairs(bindings) do assert(old[key], "unexpected added key: " .. key) end
assert(bindings["SUPER + SHIFT + CTRL + RIGHT"] == old["SUPER + SHIFT + CTRL + RIGHT"])

local function press(keys)
  dispatched = {}
  assert(#bindings[keys] == 1, "expected one callback for " .. keys)
  bindings[keys][1]()
  assert(#dispatched <= 1, "unexpected extra dispatch for " .. keys)
  return dispatched[1]
end
for id = 1, 10 do
  local key = "code:" .. (id + 9)
  local focus = press("SUPER + " .. key)
  assert(focus.name == "dsp.focus" and focus.value.workspace == tostring(id))
  local move = press("SUPER + SHIFT + " .. key)
  assert(move.name == "dsp.window.move" and move.value.workspace == tostring(id) and move.value.follow == true)
  local silent = press("SUPER + SHIFT + ALT + " .. key)
  assert(silent.name == "dsp.window.move" and silent.value.workspace == tostring(id) and silent.value.follow == false)
end
active_window = nil
assert(press("SUPER + SHIFT + code:14") == nil)
local move = press("SUPER + SHIFT + ALT + RIGHT")
assert(move.name == "dsp.workspace.move" and move.value.monitor == "HDMI-A-2")
assert(press("SUPER + SHIFT + ALT + UP") == nil)
active_workspace = { id = -99, special = true }
assert(press("SUPER + SHIFT + ALT + RIGHT") == nil)
local window_move = press("SUPER + SHIFT + CTRL + RIGHT")
assert(window_move.name == "dsp.window.move" and window_move.value.monitor == "HDMI-A-2")

ws.focus(14, "HDMI-A-2")()
assert(dispatched[#dispatched].value.workspace == "14")
assert(ws.workspace_id({ name = "HDMI-A-2" }, 5) == 5)
for id = 1, 9 do
  assert(rules[id].monitor == (id == 5 and "HDMI-A-2" or "DP-1"))
  assert(rules[id].persistent == (id == 5) and rules[id].default == (id == 1 or id == 5))
end
assert(#rules == 9 and rules[14] == nil)
if arg[2] == "--startup" then
  dispatched = {}
  events["hyprland.start"]()
  assert(#dispatched == 0, "startup moved windows or changed workspace focus")
end
print("PASS: global Quattro rules, stock bindings and event callbacks; no automatic dispatch")
