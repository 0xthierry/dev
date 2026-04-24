#!/usr/bin/env bun
import { writeFileSync } from 'node:fs'
import { detectHookHarness } from '../lib/harness.ts'
import { log, readStdin } from '../lib/io.ts'
import { getInjectedPath, readInjected, writePreToolUseMessage } from './adapters.ts'
import { formatInjection, getMatchingFailures } from './store.ts'

async function main(): Promise<void> {
  try {
    const input = await readStdin()
    const cwd = input.cwd || process.cwd()
    const sessionId = input.session_id || ''
    const toolName = input.tool_name || ''
    const toolInput = input.tool_input || {}
    const harness = detectHookHarness(input)

    if (!sessionId) {
      process.exit(0)
    }

    const failures = getMatchingFailures(cwd, toolName, toolInput, undefined, harness)
    if (failures.length === 0) {
      process.exit(0)
    }

    const injectedPath = getInjectedPath(input, cwd, sessionId)
    const already = readInjected(injectedPath)
    const unseen = failures.filter(f => !already.has(f.signature))
    if (unseen.length === 0) {
      process.exit(0)
    }

    for (const f of unseen) already.add(f.signature)
    writeFileSync(injectedPath, JSON.stringify([...already]))

    log(input, 'tool-failures/on-pre-use', 'injected', `${unseen.length} failures`)
    const message = formatInjection(unseen)
    writePreToolUseMessage(input, message)
  }
  catch {}
  process.exit(0)
}

main()
