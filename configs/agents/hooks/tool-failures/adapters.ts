import type { HookInput } from '../lib/io.ts'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectHookHarness, getSessionStateDir } from '../lib/harness.ts'

export function getInjectedPath(input: HookInput, cwd: string, sessionId: string): string {
  const dir = getSessionStateDir(detectHookHarness(input), cwd, sessionId)
  if (!existsSync(dir))
    mkdirSync(dir, { recursive: true })
  return join(dir, 'injected-failures.json')
}

export function readInjected(path: string): Set<string> {
  try {
    if (!existsSync(path))
      return new Set()
    return new Set(JSON.parse(readFileSync(path, 'utf-8')))
  }
  catch {
    return new Set()
  }
}

export function writePreToolUseMessage(input: HookInput, message: string): void {
  if (detectHookHarness(input) === 'codex') {
    console.log(JSON.stringify({
      systemMessage: message,
    }))
    return
  }

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: message,
    },
  }))
}
