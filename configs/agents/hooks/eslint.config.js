import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  ignores: ['node_modules/**', '.logs/**'],
  rules: {
    // CLI hooks need console for output
    'no-console': 'off',
    // Bun provides these as globals
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
  },
})
