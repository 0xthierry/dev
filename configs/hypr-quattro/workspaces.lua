-- Keep global workspace identities, not Quattro's per-monitor blocks of ten.
-- The v4.5.0 callbacks look up M.reconcile at event time; replace that member
-- in-place, not the module table. Otherwise reload/hotplug renumbers workspace 5.
local workspaces = assert(o.workspaces, "Load Omarchy defaults before dev-setup")
workspaces.reconcile = function() end
workspaces.workspace_id = function(_, slot) return slot end

local function action(dispatcher, expression)
  local callback = function() hl.dispatch(dispatcher) end
  o.bind_expressions[callback] = expression
  return callback
end

-- Also used by the Quattro bar via `o.workspaces.focus(slot, monitorName)`.
-- Ignore the monitor hint: the global workspace's rule owns its output.
workspaces.focus = function(slot)
  return action(hl.dsp.focus({ workspace = tostring(slot) }), "o.workspaces.focus(" .. slot .. ")")
end
workspaces.move_window = function(slot, follow)
  return action(hl.dsp.window.move({ workspace = tostring(slot), follow = follow ~= false }),
    "o.workspaces.move_window(" .. slot .. ", " .. tostring(follow ~= false) .. ")")
end
workspaces.move_to_monitor = function(direction)
  local callback = function()
    local monitor = hl.get_monitor(direction)
    if monitor then
      hl.dispatch(hl.dsp.workspace.move({ monitor = monitor.name }))
    end
  end
  o.bind_expressions[callback] = "o.workspaces.move_to_monitor(" .. string.format("%q", direction) .. ")"
  return callback
end

hl.monitor({ output = "HDMI-A-2", mode = "1920x1080@60.0", position = "3552x477", scale = 1.0 })
hl.monitor({ output = "DP-1", mode = "3840x2160@60.0", position = "1632x477", scale = 2.0 })
for workspace = 1, 9 do
  hl.workspace_rule({
    workspace = tostring(workspace),
    monitor = workspace == 5 and "HDMI-A-2" or "DP-1",
    default = workspace == 1 or workspace == 5,
    persistent = workspace == 5,
  })
end

-- Defaults captured their old closures before this overlay: rebind them too.
for workspace = 1, 10 do
  local key = "code:" .. tostring(workspace + 9)
  o.rebind("SUPER + " .. key, "Switch to workspace " .. workspace, workspaces.focus(workspace))
  o.rebind("SUPER + SHIFT + " .. key, "Move window to workspace " .. workspace, workspaces.move_window(workspace))
  o.rebind("SUPER + SHIFT + ALT + " .. key, "Move window silently to workspace " .. workspace, workspaces.move_window(workspace, false))
end
for key, direction in pairs({ LEFT = "l", RIGHT = "r", UP = "u", DOWN = "d" }) do
  o.rebind("SUPER + SHIFT + ALT + " .. key, "Move workspace to " .. direction .. " monitor", workspaces.move_to_monitor(direction))
end
