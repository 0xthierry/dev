return {
  { -- Linting
    'mfussenegger/nvim-lint',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      local lint = require 'lint'

      lint.linters_by_ft = {
        lua = { 'luacheck' },
        markdown = { 'markdownlint' },
        typescript = { 'eslint_d' },
        javascript = { 'eslint_d' },
        vue = { 'eslint_d' },
        typescriptreact = { 'eslint_d' },
        javascriptreact = { 'eslint_d' },
      }

      -- Luacheck discovers .luacheckrc from cwd, even when receiving stdin.
      -- Start at the buffer directory so project-local globals stay project-local.
      local luacheck = lint.linters.luacheck
      lint.linters.luacheck = function()
        local config = vim.deepcopy(luacheck)
        local filename = vim.api.nvim_buf_get_name(0)
        config.cwd = filename ~= '' and vim.fs.dirname(filename) or nil
        vim.list_extend(config.args, { '--filename', filename ~= '' and filename or 'stdin.lua' })
        return config
      end

      -- force eslint/eslint_d to emit pure json
      for _, name in ipairs { 'eslint_d' } do
        if lint.linters[name] then
          lint.linters[name].env = vim.tbl_extend('force', lint.linters[name].env or {}, { CI = '1' })
        end
      end

      local lint_augroup = vim.api.nvim_create_augroup('lint', { clear = true })
      vim.api.nvim_create_autocmd({ 'BufEnter', 'BufWritePost', 'InsertLeave' }, {
        group = lint_augroup,
        callback = function()
          if vim.bo.modifiable then
            lint.try_lint()
          end
        end,
      })

      vim.keymap.set('n', '<leader>ll', function()
        if vim.bo.modifiable then
          lint.try_lint()
        end
      end, { desc = 'Trigger linting for current file' })
    end,
  },
}
