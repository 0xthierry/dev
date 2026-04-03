import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getProjectStateDir } from '../lib/harness.ts'
import { getProjectCommandsPath } from '../project-commands/reader.ts'
import { addEditedFile, readState as readClaudeState } from './store.ts'
import { readState as readCodexState } from './codex-store.ts'

const ROOT_DIR = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const CLAUDE_SCRIPT_PATH = fileURLToPath(new URL('./on-bash.ts', import.meta.url))
const CODEX_SCRIPT_PATH = fileURLToPath(new URL('./codex-on-bash.ts', import.meta.url))
const TEST_CWDS: string[] = []

function makeCwd(name: string): string {
  const cwd = `/tmp/${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  TEST_CWDS.push(cwd)
  return cwd
}

function writeProjectCommands(cwd: string, harness: 'claude' | 'codex'): void {
  const path = getProjectCommandsPath(cwd, harness)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    projectRoot: cwd,
    sourceFiles: ['package.json'],
    scopes: [{
      id: 'api',
      pattern: '**',
      cwd: '.',
      test: [{ argv: ['npm', 'test'], mode: 'project' }],
      lint: [],
      typecheck: [],
      format: [],
    }],
  }, null, 2))
}

async function runHook(scriptPath: string, input: Record<string, unknown>): Promise<{ stdout: string, stderr: string, exitCode: number }> {
  const proc = Bun.spawn([process.execPath, scriptPath], {
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

describe('verification hook adapters', () => {
  test('Claude on-bash records scoped verification results', async () => {
    const cwd = makeCwd('verify-claude-hook')
    const sessionId = 'claude-hook-session'
    writeProjectCommands(cwd, 'claude')
    addEditedFile(cwd, sessionId, `${cwd}/src/app.ts`, 'api')

    const result = await runHook(CLAUDE_SCRIPT_PATH, {
      hook_event_name: 'PostToolUse',
      cwd,
      session_id: sessionId,
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { exitCode: 0 },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')

    const state = readClaudeState(cwd, sessionId)
    expect(state.scopes.api!.verifications.test).toMatchObject({
      passed: true,
      command: 'npm test',
      errors: null,
    })
  })

  test('Codex on-bash records verification failures', async () => {
    const cwd = makeCwd('verify-codex-hook')
    const sessionId = 'codex-hook-session'

    const result = await runHook(CODEX_SCRIPT_PATH, {
      hook_event_name: 'PostToolUse',
      cwd,
      session_id: sessionId,
      tool_name: 'Bash',
      tool_input: { command: 'npm run typecheck' },
      tool_response: 'Typecheck failed\nExit code: 1\nsrc/app.ts:1',
      permission_mode: 'default',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')

    const state = readCodexState(cwd, sessionId)
    expect(state.verifications.typecheck).toMatchObject({
      passed: false,
      command: 'npm run typecheck',
      errors: 'Typecheck failed\nExit code: 1\nsrc/app.ts:1',
    })
  })
})

