return {
  { -- Linting
    'mfussenegger/nvim-lint',
    event = { 'BufReadPre', 'BufNewFile' },
    config = function()
      local lint = require 'lint'

      lint.linters_by_ft = {
        markdown = { 'markdownlint' },
        typescript = { 'eslint_d' },
        javascript = { 'eslint_d' },
        vue = { 'eslint_d' },
        typescriptreact = { 'eslint_d' },
        javascriptreact = { 'eslint_d' },
      }

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
