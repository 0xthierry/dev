#!/usr/bin/env bun
import { resolve } from 'node:path'
import { getFilePath, log, readStdin } from '../lib/io.ts'
import { buildCommandArgs, findScope } from '../project-commands/schema.ts'
import { readProjectCommands } from '../project-commands/reader.ts'

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|py|rs|go|java|rb|css|scss|html|vue|svelte|json|yaml|yml|toml|md|mdx)$/

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
  if (!SOURCE_EXTENSIONS.test(filePath))
    process.exit(0)

  const commands = readProjectCommands(input.cwd, 'claude')
  if (!commands) {
    log(input, 'auto-format', 'skip', 'no project-commands.json')
    process.exit(0)
  }

  const scope = findScope(commands, filePath)
  if (!scope || scope.format.length === 0) {
    log(input, 'auto-format', 'skip', 'no format commands for scope')
    process.exit(0)
  }

  const ext = filePath.match(/\.([^.]+)$/)?.pop() || ''
  const cmd = scope.format.find(f =>
    f.mode === 'file' && (!f.extensions || f.extensions.includes(ext))
  )
  if (!cmd) {
    log(input, 'auto-format', 'skip', `no file-mode formatter for .${ext}`)
    process.exit(0)
  }

  const args = buildCommandArgs(cmd, filePath)
  const cwd = resolve(commands.projectRoot, scope.cwd)

  try {
    const proc = Bun.spawn(args, { cwd, stdout: 'ignore', stderr: 'ignore' })
    const exitCode = await proc.exited

    if (exitCode === 0) {
      log(input, 'auto-format', 'formatted', args.join(' ').slice(0, 80))
    }
    else {
      log(input, 'auto-format', 'error', `exit ${exitCode}: ${args.join(' ').slice(0, 60)}`)
    }
  }
  catch {
    log(input, 'auto-format', 'error', `spawn failed: ${args.join(' ').slice(0, 60)}`)
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
