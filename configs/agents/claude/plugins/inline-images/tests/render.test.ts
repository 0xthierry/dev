import { expect, test } from 'claude-code/testing'

// A 1x1 PNG. The real Claude mod engine renders fixture output without a model call.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const READ = {
  plugin: 'inline-images',
  component: 'ToolUse',
  requestId: 'image-read',
  surface: 'terminal',
  viewport: { columns: 100, rows: 40 },
  props: {
    tool: 'Read', input: { file_path: '/tmp/picture.png' },
    output: { type: 'image', file: { base64: PNG, type: 'image/png' } },
    isRunning: false, isErrored: false, tool_use_id: 'read-fixture',
  },
} as const

test('Read PNG produces an inline image and its caption toggles visibility', async ($, on) => {
  // Arrange: cell measurement may fail without preventing an image preview.
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  // Act
  const ui = await $.ui.mount(READ)
  // Assert
  expect((await ui.find({ type: 'Image' }))?.props).toEqual({
    key: 'read-fixture-0', source: { png: PNG }, columns: 8, rows: 4, alt: '[image 1×1]',
  })
  await ui.press({ key: 'toggle-read-fixture-0' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.press({ key: 'toggle-read-fixture-0' })
  expect((await ui.find({ type: 'Image' }))?.props.source).toEqual({ png: PNG })
  await ui.unmount()
})

test('MCP image output produces an inline preview', async ($, on) => {
  // Arrange
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  // Act
  const ui = await $.ui.mount({ ...READ, props: {
    ...READ.props, tool: 'mcp__screenshots__capture',
    output: { content: [{ type: 'image', mimeType: 'image/png', data: PNG }] },
  } })
  // Assert
  expect((await ui.find({ type: 'Image' }))?.props.source).toEqual({ png: PNG })
  await ui.unmount()
})

test('JPEG reads convert to a PNG-backed preview', async ($, on) => {
  // Arrange: stub external conversion, but exercise the real hook's conversion path.
  on('process.run', (_$, e) => ({ value: {
    exitCode: 0, stderr: '',
    stdout: e.argv.length === 6 ? PNG : e.argv[2].includes('mkdir') ? '/tmp/inline-test-cache' : '',
  } }))
  // Act
  const ui = await $.ui.mount({ ...READ, props: { ...READ.props,
    output: { type: 'image', file: { base64: 'fixture-jpeg', type: 'image/jpeg' } },
  } })
  // Assert
  const image = await ui.find({ type: 'Image' })
  expect(image?.props.source.format).toBe('png')
  expect(image?.props.source.file).toMatch(/^\/tmp\/inline-test-cache\/read-fixture-0-[a-f0-9]+\.png$/)
  expect(image?.props.alt).toBe('[image 1×1]')
  await ui.unmount()
})

test('pasted images render below the user prompt', async ($, on) => {
  // Arrange
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('session.id', () => ({ value: 'paste-session' }))
  on('session.messages', () => ({ value: [{ role: 'user', content: [
    { type: 'text', text: 'Describe this [Image #1]' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
  ] }] }))
  // Act
  const ui = await $.ui.mount({ ...READ, component: 'UserMessage', props: {
    text: 'Describe this [Image #1]', origin: { kind: 'composer' },
  } })
  // Assert
  expect((await ui.find({ type: 'Image' }))?.props.source).toEqual({ png: PNG })
  await ui.unmount()
})

test('desktop keeps its native rendering instead of adding terminal images', async ($, on) => {
  // Arrange
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['native image row'] }))
  // Act
  const ui = await $.ui.mount({ ...READ, surface: 'desktop' })
  // Assert
  expect((await ui.find({ type: 'Text' }))?.children).toEqual(['native image row'])
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})
