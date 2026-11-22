-- Explicitly reviewed personal shortcuts only. Never load historical desktop
-- or global-workspace modules: stock/current monitor and workspace policy wins.
local directory = require("default.hypr.paths").config_home .. "/hypr/dev-setup/"
dofile(directory .. "bindings.lua")
