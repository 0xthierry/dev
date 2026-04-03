import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { getProjectStateDir } from '../lib/harness.ts'
import { getProjectCommandsPath } from '../project-commands/reader.ts'
import { detectVerificationCommand, extractVerificationOutcome } from './shared.ts'

const TEST_CWDS: string[] = []

function makeCwd(name: string): string {
  const cwd = `/tmp/${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  TEST_CWDS.push(cwd)
  return cwd
}

function writeCommands(cwd: string, harness: 'claude' | 'codex'): void {
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
      lint: [{ argv: ['npm', 'run', 'lint'], mode: 'project' }],
      typecheck: [{ argv: ['npm', 'run', 'typecheck'], mode: 'project' }],
      format: [],
    }],
  }, null, 2))
}

afterEach(() => {
  for (const cwd of TEST_CWDS.splice(0)) {
    rmSync(getProjectStateDir('claude', cwd), { recursive: true, force: true })
    rmSync(getProjectStateDir('codex', cwd), { recursive: true, force: true })
  }
})

describe('detectVerificationCommand', () => {
  test('uses fallback regexes when no project commands exist', () => {
    const cwd = makeCwd('verify-fallback')
    expect(detectVerificationCommand('pytest', cwd, 'codex')).toEqual({
      type: 'test',
      scopeId: 'unknown',
    })
  })

  test('matches configured commands from the requested harness', () => {
    const cwd = makeCwd('verify-configured')
    writeCommands(cwd, 'codex')

    expect(detectVerificationCommand('npm run lint', cwd, 'codex')).toEqual({
      type: 'lint',
      scopeId: 'api',
    })
  })

  test('matches commands after a cd prefix', () => {
    const cwd = makeCwd('verify-cd-prefix')
    writeCommands(cwd, 'claude')

    expect(detectVerificationCommand(`cd ${cwd} && npm run typecheck`, cwd, 'claude')).toEqual({
      type: 'typecheck',
      scopeId: 'api',
    })
  })
})

describe('extractVerificationOutcome', () => {
  test('treats zero exit codes as passes', () => {
    expect(extractVerificationOutcome({ exitCode: 0 })).toEqual({
      passed: true,
      errors: null,
    })
  })

  test('extracts failures from string responses', () => {
    expect(extractVerificationOutcome('Command failed\nExit code: 2\nboom')).toEqual({
      passed: false,
      errors: 'Command failed\nExit code: 2\nboom',
    })
  })

  test('extracts failures from object responses', () => {
    expect(extractVerificationOutcome({ exit_code: 1 })).toEqual({
      passed: false,
      errors: null,
    })
  })
})

