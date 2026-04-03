import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { getProjectStateDir } from '../lib/harness.ts'
import { addFailure } from './store.ts'

const ROOT_DIR = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const SCRIPT_PATH = fileURLToPath(new URL('./on-pre-use.ts', import.meta.url))
const TEST_CWDS: string[] = []

function makeCwd(name: string): string {
  const cwd = `/tmp/${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  TEST_CWDS.push(cwd)
  return cwd
}

async function runHook(input: Record<string, unknown>): Promise<{ stdout: string, stderr: string, exitCode: number }> {
  const proc = Bun.spawn([process.execPath, SCRIPT_PATH], {
    cwd: ROOT_DIR,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  proc.stdin.write(`${JSON.stringify(input)}\n`)
  proc.stdin.end()

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { stdout, stderr, exitCode }
}

afterEach(() => {
  for (const cwd of TEST_CWDS.splice(0)) {
    rmSync(getProjectStateDir('claude', cwd), { recursive: true, force: true })
    rmSync(getProjectStateDir('codex', cwd), { recursive: true, force: true })
  }
})

describe('on-pre-use hook', () => {
  test('emits Claude additionalContext output', async () => {
    const cwd = makeCwd('pre-use-claude')
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'claude failure', undefined, undefined, 'claude')

    const result = await runHook({
      hook_event_name: 'PreToolUse',
      cwd,
      session_id: 'claude-session',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: expect.stringContaining('Known failures for this tool'),
      },
    })
  })

  test('emits Codex systemMessage output', async () => {
    const cwd = makeCwd('pre-use-codex')
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'codex failure', undefined, undefined, 'codex')

    const result = await runHook({
      hook_event_name: 'PreToolUse',
      cwd,
      session_id: 'codex-session',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      permission_mode: 'default',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      systemMessage: expect.stringContaining('Known failures for this tool'),
    })
  })
})

