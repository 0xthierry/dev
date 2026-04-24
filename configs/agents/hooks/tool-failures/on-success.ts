#!/usr/bin/env bun
import { detectHookHarness } from '../lib/harness.ts'
import { log, readStdin } from '../lib/io.ts'
import { resolveFailure } from './store.ts'

async function main(): Promise<void> {
  try {
    const input = await readStdin()
    const cwd = input.cwd || process.cwd()
    const toolName = input.tool_name || ''
    const toolInput = input.tool_input || {}
    resolveFailure(cwd, toolName, toolInput, undefined, detectHookHarness(input))
    log(input, 'tool-failures/on-success', 'checked', toolName)
  }
  catch {}
  process.exit(0)
}

main()
