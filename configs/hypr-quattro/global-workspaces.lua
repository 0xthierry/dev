-- Optional workspace policy; load after Quattro 4.5.0's defaults and bindings.
local ws = assert(o.workspaces, "Load Omarchy's workspace defaults first")

-- The installed startup/reload/hotplug callbacks capture this table but look up
-- reconcile when fired. Suppress block allocation, not Hyprland's own hotplug.
ws.reconcile = function() end
ws.workspace_id = function(_, id) return id end

for id = 1, 9 do
  hl.workspace_rule({
    workspace = tostring(id), monitor = id == 5 and "HDMI-A-2" or "DP-1",
    default = id == 1 or id == 5, persistent = id == 5,
  })
end

-- Keep Quattro's action-factory API and replay expressions for the shortcuts menu.
local function action(expression, callback)
  o.bind_expressions[callback] = expression
  return callback
end

function ws.focus(id)
  return action("o.workspaces.focus(" .. id .. ")", function()
    hl.dispatch(hl.dsp.focus({ workspace = tostring(id) }))
  end)
end

function ws.move_window(id, follow)
  return action("o.workspaces.move_window(" .. id .. (follow == false and ", false" or "") .. ")", function()
    if hl.get_active_window() then
      hl.dispatch(hl.dsp.window.move({ workspace = tostring(id), follow = follow ~= false }))
    end
  end)
end

function ws.move_to_monitor(direction)
  return action("o.workspaces.move_to_monitor(" .. string.format("%q", direction) .. ")", function()
    local workspace, target = hl.get_active_workspace(), hl.get_monitor(direction)
    if workspace and not workspace.special and workspace.id > 0 and target then
      hl.dispatch(hl.dsp.workspace.move({ monitor = target.name }))
    end
  end)
end

-- Stock keys already captured their old callbacks; changing ws alone is not enough.
for id = 1, 10 do
  local key = "code:" .. (id + 9) -- physical number row: 1..9, then 0 for workspace 10
  o.rebind("SUPER + " .. key, "Switch to workspace " .. id, ws.focus(id))
  o.rebind("SUPER + SHIFT + " .. key, "Move window to workspace " .. id, ws.move_window(id))
  o.rebind("SUPER + SHIFT + ALT + " .. key, "Move window silently to workspace " .. id, ws.move_window(id, false))
end
for _, dir in ipairs({ "left", "right", "up", "down" }) do
  o.rebind("SUPER + SHIFT + ALT + " .. dir:upper(), "Move workspace to " .. dir .. " monitor", ws.move_to_monitor(dir:sub(1, 1)))
end
-- Stock move_window_to_monitor already targets the visible workspace without renumbering.
