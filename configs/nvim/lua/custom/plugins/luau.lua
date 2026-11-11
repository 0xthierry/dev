-- Luau language server (luau-lsp) through luau-lsp.nvim.
--
-- The plugin registers and enables its own LSP config named `luau-lsp`. Never
-- also enable nvim-lspconfig's `luau_lsp`: that starts the server twice.
--
-- Platform is chosen when the first Luau buffer of a session opens:
--   * inside a Rojo project (a `*.project.json` above the file): Roblox types
--     and docs, a watched Rojo sourcemap, and the Studio companion plugin;
--   * anywhere else: standard Luau, with none of the above.
-- A session keeps the mode it started in. For anything project-specific, put
-- `require('luau-lsp').config { ... }` in the project's `.nvim.lua`.

local function rojo_root(bufnr)
  return vim.fs.root(bufnr, function(name)
    return name:match '.+%.project%.json$' ~= nil
  end)
end

local COMPANION_PORT = 3667

-- The Studio companion server listens on one fixed port, so only one Neovim
-- can own it. A second session in a Roblox project must skip it: when the
-- port is taken, luau-lsp.nvim fails during setup and no language server
-- starts at all.
local function port_is_free(port)
  local tcp = vim.uv.new_tcp()
  -- bind alone succeeds on a port another process listens on; listen fails.
  local ok = tcp:bind('127.0.0.1', port) == 0 and tcp:listen(1, function() end) == 0
  tcp:close()
  return ok
end

return {
  {
    'lopi-py/luau-lsp.nvim',
    ft = 'luau',
    config = function()
      local root = rojo_root(0)
      local roblox = root ~= nil

      -- A `test.project.json` is the superset tree (it also maps dev packages
      -- and spec files), so prefer it for the sourcemap when a project has one.
      local project_file = 'default.project.json'
      if root and vim.uv.fs_stat(root .. '/test.project.json') then
        project_file = 'test.project.json'
      end

      vim.lsp.config('luau-lsp', {
        -- Lets the server notice sourcemap.json changing on disk.
        capabilities = {
          workspace = { didChangeWatchedFiles = { dynamicRegistration = true } },
        },
        settings = {
          ['luau-lsp'] = {
            completion = {
              -- Auto-imports: completing a service or a module from the
              -- sourcemap also writes its `game:GetService` or `require` line.
              imports = {
                enabled = roblox,
                suggestServices = true,
                suggestRequires = true,
              },
            },
          },
        },
      })

      require('luau-lsp').setup {
        platform = { type = roblox and 'roblox' or 'standard' },
        sourcemap = {
          enabled = roblox,
          autogenerate = roblox,
          rojo_project_file = project_file,
        },
        -- Live DataModel completion from Studio; needs the "Luau Language
        -- Server Companion" plugin installed in Studio. Only the first Neovim
        -- session gets it (see port_is_free).
        plugin = { enabled = roblox and port_is_free(COMPANION_PORT), port = COMPANION_PORT },
        -- The standalone binary pinned by install/lua-lsp.sh, not a
        -- project-manager shim that only resolves inside some projects.
        server = { path = vim.fn.expand '~/.local/bin/luau-lsp' },
      }
    end,
  },
}
