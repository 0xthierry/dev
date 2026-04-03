#!/usr/bin/env bun
import { getFilePath, log, readStdin } from '../lib/io.ts'
import { readProjectCommands } from '../project-commands/reader.ts'
import { findScope, isSourceFile, isTestFile } from '../project-commands/schema.ts'
import { addEditedFile } from './store.ts'

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
  const commands = readProjectCommands(input.cwd, 'claude')
  const scope = commands ? findScope(commands, filePath) : null

  if (!isSourceFile(scope, filePath))
    process.exit(0)

  const root = commands?.projectRoot ?? input.cwd
  const relative = filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath
  if (isTestFile(scope, relative))
    process.exit(0)

  const scopeId = scope?.id || 'unknown'
  addEditedFile(input.cwd, input.session_id || 'unknown', filePath, scopeId)
  log(input, 'verify/on-edit', 'tracked', `${filePath} [${scopeId}]`)
  process.exit(0)
}

main().catch(() => process.exit(0))
