#!/usr/bin/env bun
import { detectHookHarness } from '../lib/harness.ts'
import { log, readStdin } from '../lib/io.ts'
import { addFailure } from './store.ts'

async function main(): Promise<void> {
  try {
    const input = await readStdin()
    const cwd = input.cwd || process.cwd()
    const toolName = input.tool_name || 'unknown'
    const toolInput = input.tool_input || {}
    const harness = detectHookHarness(input)
    const error = typeof (input as any).error === 'string'
      ? (input as any).error
      : JSON.stringify((input as any).error ?? '')

    addFailure(cwd, toolName, toolInput, error, undefined, {
      session_id: input.session_id,
      transcript_path: input.transcript_path,
    }, harness)
    log(input, 'tool-failures/on-failure', 'recorded', error.slice(0, 120))
  }
  catch {}
  process.exit(0)
}

main()
