-- Thierry's overlay for Omarchy v4.5.0. Load immediately after package defaults,
-- BEFORE personal modules and toggles. The installer links this as hypr/dev-setup.
local directory = require("default.hypr.paths").config_home .. "/hypr/dev-setup/"
for _, module in ipairs({ "workspaces", "desktop", "bindings" }) do
  dofile(directory .. module .. ".lua")
end
