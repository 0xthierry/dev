#!/usr/bin/env bun
import { getFilePath, log, readStdin } from '../lib/io.ts'
import { addEditedFile } from './store.ts'

const SOURCE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rs',
  'go',
  'java',
  'rb',
  'ex',
  'exs',
  'c',
  'cpp',
  'h',
  'hpp',
  'swift',
  'kt',
])

const TEST_FILE_PATTERNS = [
  /\.test\.[^/]+$/,
  /\.spec\.[^/]+$/,
  /_test\.[^/]+$/,
  /(?:^|\/)__tests__\//,
]

function isSourceFile(filePath: string): boolean {
  const ext = filePath.match(/\.([^./]+)$/)?.[1]
  return !!ext && SOURCE_EXTENSIONS.has(ext)
}

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some(p => p.test(filePath))
}

async function main(): Promise<void> {
  let input
  try {
    input = await readStdin()
  }
  catch { process.exit(0) }
  if (input.hook_event_name !== 'PostToolUse')
    process.exit(0)
  if (input.tool_name !== 'Write' && input.tool_name !== 'Edit' && input.tool_name !== 'MultiEdit')
    process.exit(0)

  const filePath = getFilePath(input.tool_input || {})
  if (!isSourceFile(filePath) || isTestFile(filePath))
    process.exit(0)

  addEditedFile(input.cwd, input.session_id || 'unknown', filePath)
  log(input, 'verify/on-edit', 'tracked', filePath)
  process.exit(0)
}

main().catch(() => process.exit(0))
