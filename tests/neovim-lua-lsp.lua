-- Component integration check against installed Neovim plugins and real system servers.
-- Run from the repository root: nvim --headless -u NONE -l tests/neovim-lua-lsp.lua
-- No plugins/packages are installed or updated. Only temporary fixture files are written.
local fixture = vim.fn.tempname()
local ok, err = xpcall(function()
  local data = vim.fn.stdpath 'data'
  assert(vim.fn.isdirectory(data .. '/lazy/lazy.nvim') == 1, 'Install the configured Neovim plugins first')
  for _, path in ipairs(vim.fn.glob(data .. '/lazy/*', false, true)) do
    vim.opt.rtp:append(path)
  end

  -- Capture the real plugin spec without starting unrelated plugins or their installers.
  local specs
  package.loaded.lazy = { setup = function(value) specs = value end }
  dofile 'configs/nvim/init.lua'
  local lsp_spec, lazydev_spec
  for _, spec in ipairs(specs) do
    if type(spec) == 'table' and spec[1] == 'neovim/nvim-lspconfig' then lsp_spec = spec end
    if type(spec) == 'table' and spec[1] == 'folke/lazydev.nvim' then lazydev_spec = spec end
  end
  require('mason').setup {}
  local installer = require 'mason-tool-installer'
  local setup = installer.setup
  installer.setup = function(opts)
    opts.run_on_start = false
    setup(opts)
  end
  require('lazydev').setup(lazydev_spec.opts)
  lsp_spec.config()
  vim.cmd 'filetype plugin on'

  vim.fn.mkdir(fixture, 'p')
  vim.fn.writefile({ 'local answer = 42', 'print(answer)' }, fixture .. '/plain.lua')
  vim.fn.writefile({ 'local answer: number = 42', 'print(answer)' }, fixture .. '/typed.luau')

  local function observe(path, server, prepare)
    vim.cmd.edit(vim.fn.fnameescape(path))
    local bufnr = vim.api.nvim_get_current_buf()
    if prepare then prepare(bufnr) end
    local attached = vim.wait(15000, function()
      local clients = vim.lsp.get_clients { bufnr = bufnr, name = server }
      return #clients == 1 and clients[1].initialized
    end, 50)
    if not attached then error('Timed out waiting for ' .. server .. ' on ' .. path) end
    local client = vim.lsp.get_clients({ bufnr = bufnr, name = server })[1]
    local response
    -- LuaLS can answer early requests with a workspace-loading progress message.
    vim.wait(15000, function()
      response = client:request_sync('textDocument/hover', {
        textDocument = { uri = vim.uri_from_bufnr(bufnr) },
        position = { line = 1, character = 7 },
      }, 1000, bufnr)
      return response and response.result and not vim.inspect(response.result.contents):find('Workspace loading', 1, true)
    end, 100)
    local names = vim.tbl_map(function(c) return c.name end, vim.lsp.get_clients { bufnr = bufnr })
    table.sort(names)
    return {
      filetype = vim.bo[bufnr].filetype,
      clients = names,
      cmd = client.config.cmd,
      hover = response and response.result and response.result.contents,
    }
  end

  local lua = observe(fixture .. '/plain.lua', 'lua_ls')
  assert(lua.filetype == 'lua', vim.inspect(lua))
  assert(vim.deep_equal(lua.clients, { 'lua_ls' }), vim.inspect(lua))
  assert(lua.cmd[1]:find('/mason/', 1, true) == nil, vim.inspect(lua))
  assert(vim.inspect(lua.hover):find('integer', 1, true), vim.inspect(lua))
  print('PASS .lua: only system lua_ls attached; hover reports integer')

  -- luau-lsp.nvim owns the Luau server. Load its spec as lazy.nvim does on the first
  -- Luau buffer: run the spec's config, then the plugin's own startup, which resolves
  -- type files and enables its `luau-lsp` config asynchronously.
  local luau_spec = dofile('configs/nvim/lua/custom/plugins/luau.lua')[1]
  assert(luau_spec[1] == 'lopi-py/luau-lsp.nvim', vim.inspect(luau_spec[1]))
  local luau = observe(fixture .. '/typed.luau', 'luau-lsp', function(bufnr)
    luau_spec.config()
    require('luau-lsp.server').setup()
    local enabled = vim.wait(60000, function() return vim.lsp.is_enabled 'luau-lsp' end, 50)
    assert(enabled, 'luau-lsp.nvim did not enable its server')
    -- Before VimEnter, enabling a config does not attach to buffers that are already open.
    vim.api.nvim_exec_autocmds('FileType', { buffer = bufnr })
  end)
  assert(luau.filetype == 'luau', vim.inspect(luau))
  assert(vim.deep_equal(luau.clients, { 'luau-lsp' }), vim.inspect(luau))
  assert(not vim.lsp.is_enabled 'luau_lsp', 'nvim-lspconfig luau_lsp must stay disabled: it would start a second server')
  assert(luau.cmd[1] == vim.fn.expand '~/.local/bin/luau-lsp', vim.inspect(luau))
  assert(vim.inspect(luau.hover):find('number', 1, true), vim.inspect(luau))
  -- The fixture is not inside a Rojo project, so Roblox mode must stay off.
  local luau_config = require('luau-lsp.config').get()
  assert(luau_config.platform.type == 'standard', vim.inspect(luau_config.platform))
  assert(luau_config.sourcemap.enabled == false and luau_config.plugin.enabled == false, vim.inspect(luau_config))
  print('PASS .luau: only standalone luau-lsp attached in standard mode; hover reports number')
end, debug.traceback)
for _, client in ipairs(vim.lsp.get_clients()) do
  client:stop(true)
end
vim.fn.delete(fixture, 'rf')
if not ok then
  io.stderr:write(err .. '\n')
  vim.cmd 'cquit 1'
end
vim.cmd 'qa!'
