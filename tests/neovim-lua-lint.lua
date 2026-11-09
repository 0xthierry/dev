-- Real nvim-lint/Luacheck integration; no installs or plugin updates.
-- Run from repository root: nvim --headless -u NONE -l tests/neovim-lua-lint.lua
local fixture = vim.fn.tempname()
local ok, err = xpcall(function()
  assert(vim.fn.executable 'luacheck' == 1, 'Run shared setup to install Luacheck first')
  vim.opt.rtp:append(vim.fn.stdpath 'data' .. '/lazy/nvim-lint')
  vim.cmd 'filetype on'
  dofile('configs/nvim/lua/kickstart/plugins/lint.lua')[1].config()
  local lint = require 'lint'
  local namespace = lint.get_namespace 'luacheck'
  vim.fn.mkdir(fixture, 'p')
  vim.fn.writefile({ 'print(missing_global)', 'vim.api.nvim_get_current_buf()' }, fixture .. '/plain.lua')
  vim.fn.writefile({ 'local value: number = missing_global', 'print(value)' }, fixture .. '/typed.luau')

  local function observe(path, expect_publication)
    local published = {}
    local autocmd = vim.api.nvim_create_autocmd('DiagnosticChanged', {
      callback = function(event) published[event.buf] = true end,
    })
    vim.cmd.edit(vim.fn.fnameescape(path))
    local bufnr = vim.api.nvim_get_current_buf()
    local running = lint.get_running(bufnr)
    -- Process exit can precede stdout parsing and scheduled diagnostic publication.
    local finished = not expect_publication or vim.wait(10000, function()
      return published[bufnr] and #lint.get_running(bufnr) == 0
    end, 20)
    vim.api.nvim_del_autocmd(autocmd)
    if not finished then
      error('Luacheck did not publish diagnostics for ' .. path)
    end
    return {
      filetype = vim.bo[bufnr].filetype,
      running = running,
      diagnostics = vim.diagnostic.get(bufnr, { namespace = namespace }),
    }
  end

  -- Cwd remains the repository root; each buffer must discover its own config.
  local lua = observe(fixture .. '/plain.lua', true)
  assert(lua.filetype == 'lua', vim.inspect(lua))
  assert(vim.deep_equal(lua.running, { 'luacheck' }), vim.inspect(lua))
  assert(#lua.diagnostics == 2, vim.inspect(lua))
  assert(lua.diagnostics[1].message == "accessing undefined variable 'missing_global'", vim.inspect(lua))
  assert(lua.diagnostics[1].lnum == 0 and lua.diagnostics[1].code == '113', vim.inspect(lua))
  assert(lua.diagnostics[2].message == "accessing undefined variable 'vim'", vim.inspect(lua))
  print('PASS .lua: real Luacheck diagnostics; vim is not globally allowed')

  local config = observe(vim.fn.getcwd() .. '/configs/nvim/init.lua', true)
  assert(vim.deep_equal(config.running, { 'luacheck' }), vim.inspect(config))
  local undefined_vim = vim.tbl_filter(function(d)
    return d.message == "accessing undefined variable 'vim'"
  end, config.diagnostics)
  assert(#undefined_vim == 0, vim.inspect(undefined_vim))
  print('PASS Neovim config: buffer-local .luacheckrc suppresses undefined vim')

  local luau = observe(fixture .. '/typed.luau', false)
  assert(luau.filetype == 'luau', vim.inspect(luau))
  assert(vim.deep_equal(luau.running, {}), vim.inspect(luau))
  assert(vim.deep_equal(luau.diagnostics, {}), vim.inspect(luau))
  print('PASS .luau: no Luacheck process or diagnostics')
end, debug.traceback)
vim.fn.delete(fixture, 'rf')
if not ok then
  io.stderr:write(err .. '\n')
  vim.cmd 'cquit 1'
end
vim.cmd 'qa!'
