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

      -- Lets the server notice sourcemap.json changing on disk.
      vim.lsp.config('luau-lsp', {
        capabilities = {
          workspace = { didChangeWatchedFiles = { dynamicRegistration = true } },
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
        -- Server Companion" plugin installed in Studio.
        plugin = { enabled = roblox },
        -- The standalone binary pinned by install/lua-lsp.sh, not a
        -- project-manager shim that only resolves inside some projects.
        server = { path = vim.fn.expand '~/.local/bin/luau-lsp' },
      }
    end,
  },
}
