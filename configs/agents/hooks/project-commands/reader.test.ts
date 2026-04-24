import type { HookHarness } from '../lib/harness.ts'
import type { ProjectCommands } from './schema.ts'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { getProjectStateDir } from '../lib/harness.ts'
import { getProjectCommandsPath, readProjectCommands } from './reader.ts'

const TEST_CWDS: string[] = []

function makeCwd(name: string): string {
  const cwd = `/tmp/${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  TEST_CWDS.push(cwd)
  return cwd
}

function makeCommands(projectRoot: string): ProjectCommands {
  return {
    schemaVersion: 1,
    projectRoot,
    sourceFiles: ['package.json'],
    scopes: [{
      id: 'root',
      pattern: '**',
      cwd: '.',
      test: [{ argv: ['npm', 'test'], mode: 'project' }],
      lint: [],
      typecheck: [],
      format: [],
    }],
  }
}

function writeCommands(cwd: string, harness: HookHarness, commands: ProjectCommands): void {
  const path = getProjectCommandsPath(cwd, harness)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(commands, null, 2))
}

afterEach(() => {
  for (const cwd of TEST_CWDS.splice(0)) {
    rmSync(getProjectStateDir('claude', cwd), { recursive: true, force: true })
    rmSync(getProjectStateDir('codex', cwd), { recursive: true, force: true })
  }
})

describe('getProjectCommandsPath', () => {
  test('uses harness-specific state roots', () => {
    const cwd = makeCwd('reader-path')
    expect(getProjectCommandsPath(cwd, 'claude')).toContain('/.claude/projects/')
    expect(getProjectCommandsPath(cwd, 'codex')).toContain('/.codex/projects/')
  })
})

describe('readProjectCommands', () => {
  test('reads commands from the requested harness path', () => {
    const cwd = makeCwd('reader-direct')
    const commands = makeCommands(cwd)
    writeCommands(cwd, 'codex', commands)

    expect(readProjectCommands(cwd, 'codex')).toEqual(commands)
  })

  test('falls back to the other harness path when preferred file is missing', () => {
    const cwd = makeCwd('reader-fallback')
    const commands = makeCommands(cwd)
    writeCommands(cwd, 'claude', commands)

    expect(readProjectCommands(cwd, 'codex')).toEqual(commands)
  })

  test('returns null for invalid JSON payloads', () => {
    const cwd = makeCwd('reader-invalid')
    const path = getProjectCommandsPath(cwd, 'claude')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{"schemaVersion":2}')

    expect(readProjectCommands(cwd, 'claude')).toBeNull()
  })
})
