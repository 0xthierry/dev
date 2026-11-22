-- Historical full-desktop migration reference, NOT an installation entrypoint.
-- Normal setup preserves stock. Explicit personal shortcuts use shortcuts.lua.
-- Kept for historical offline tests; do not load into the current desktop.
local directory = require("default.hypr.paths").config_home .. "/hypr/dev-setup/"
for _, module in ipairs({ "workspaces", "desktop", "bindings" }) do
  dofile(directory .. module .. ".lua")
end
