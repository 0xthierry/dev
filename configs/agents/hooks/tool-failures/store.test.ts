import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  addFailure,
  encodeProjectPath,
  formatInjection,
  getMatchingFailures,
  getStorePath,
  makeInputSummary,
  makeSignature,
  readStore,
  resolveFailure,
  writeStore,
} from './store.ts'
import type { FailureRecord } from './store.ts'

let testBaseDir: string

beforeEach(() => {
  testBaseDir = join(tmpdir(), `tool-failures-test-${Date.now()}`)
  mkdirSync(testBaseDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(testBaseDir)) {
    rmSync(testBaseDir, { recursive: true })
  }
})

describe('encodeProjectPath', () => {
  test('replaces slashes and dots with hyphens', () => {
    expect(encodeProjectPath('/home/thierry/.claude')).toBe('-home-thierry--claude')
  })

  test('handles simple paths', () => {
    expect(encodeProjectPath('/home/thierry/my-project')).toBe('-home-thierry-my-project')
  })
})

describe('getStorePath', () => {
  test('returns correct path with custom baseDir', () => {
    const path = getStorePath('/home/user/project', '/tmp/base')
    expect(path).toBe('/tmp/base/-home-user-project/tool-failures.json')
  })
})

describe('makeSignature', () => {
  test('Bash: includes command prefix', () => {
    expect(makeSignature('Bash', { command: 'npm test' })).toBe('Bash:npm test')
  })

  test('Bash: truncates long commands at 100 chars', () => {
    const longCmd = 'x'.repeat(200)
    const sig = makeSignature('Bash', { command: longCmd })
    expect(sig).toBe(`Bash:${'x'.repeat(100)}`)
  })

  test('Edit: uses file_path', () => {
    expect(makeSignature('Edit', { file_path: '/src/index.ts' })).toBe('Edit:/src/index.ts')
  })

  test('Write: uses file_path', () => {
    expect(makeSignature('Write', { file_path: '/src/new.ts' })).toBe('Write:/src/new.ts')
  })

  test('Grep: uses pattern', () => {
    expect(makeSignature('Grep', { pattern: 'TODO' })).toBe('Grep:TODO')
  })

  test('Glob: uses pattern', () => {
    expect(makeSignature('Glob', { pattern: '**/*.ts' })).toBe('Glob:**/*.ts')
  })

  test('unknown tool: returns tool name', () => {
    expect(makeSignature('Read', { file_path: '/foo' })).toBe('Read')
  })
})

describe('makeInputSummary', () => {
  test('Bash: returns command', () => {
    expect(makeInputSummary('Bash', { command: 'npm test' })).toBe('npm test')
  })

  test('Edit: includes file path', () => {
    expect(makeInputSummary('Edit', { file_path: '/src/index.ts' })).toBe('Edit /src/index.ts')
  })
})

describe('readStore / writeStore', () => {
  test('returns empty array when no store file', () => {
    const records = readStore('/fake/project', testBaseDir)
    expect(records).toEqual([])
  })

  test('round-trips records', () => {
    const cwd = '/test/project'
    const records: FailureRecord[] = [{
      signature: 'Bash:npm test',
      tool_name: 'Bash',
      tool_input_summary: 'npm test',
      error: 'exit code 1',
      count: 1,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    }]

    writeStore(cwd, records, testBaseDir)
    const loaded = readStore(cwd, testBaseDir)
    expect(loaded).toEqual(records)
  })

  test('prunes expired records on read', () => {
    const cwd = '/test/project'
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const now = new Date().toISOString()

    const records: FailureRecord[] = [
      {
        signature: 'Bash:old-cmd',
        tool_name: 'Bash',
        tool_input_summary: 'old-cmd',
        error: 'old error',
        count: 1,
        first_seen: eightDaysAgo,
        last_seen: eightDaysAgo,
      },
      {
        signature: 'Bash:new-cmd',
        tool_name: 'Bash',
        tool_input_summary: 'new-cmd',
        error: 'new error',
        count: 1,
        first_seen: now,
        last_seen: now,
      },
    ]

    writeStore(cwd, records, testBaseDir)
    const loaded = readStore(cwd, testBaseDir)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.signature).toBe('Bash:new-cmd')
  })

  test('handles corrupted file gracefully', () => {
    const cwd = '/test/project'
    const path = getStorePath(cwd, testBaseDir)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'not json')
    expect(readStore(cwd, testBaseDir)).toEqual([])
  })
})

describe('addFailure', () => {
  test('creates new record for first failure', () => {
    const cwd = '/test/project'
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'exit code 1', testBaseDir)

    const records = readStore(cwd, testBaseDir)
    expect(records).toHaveLength(1)
    expect(records[0]!.signature).toBe('Bash:npm test')
    expect(records[0]!.count).toBe(1)
    expect(records[0]!.error).toBe('exit code 1')
  })

  test('deduplicates by signature', () => {
    const cwd = '/test/project'
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'error 1', testBaseDir)
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'error 2', testBaseDir)

    const records = readStore(cwd, testBaseDir)
    expect(records).toHaveLength(1)
    expect(records[0]!.count).toBe(2)
    expect(records[0]!.error).toBe('error 2')
  })

  test('keeps different signatures separate', () => {
    const cwd = '/test/project'
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'error 1', testBaseDir)
    addFailure(cwd, 'Bash', { command: 'npm build' }, 'error 2', testBaseDir)

    const records = readStore(cwd, testBaseDir)
    expect(records).toHaveLength(2)
  })
})

describe('resolveFailure', () => {
  test('removes matching failure on success', () => {
    const cwd = '/test/project'
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'error', testBaseDir)
    addFailure(cwd, 'Bash', { command: 'npm build' }, 'error', testBaseDir)

    resolveFailure(cwd, 'Bash', { command: 'npm test' }, testBaseDir)

    const records = readStore(cwd, testBaseDir)
    expect(records).toHaveLength(1)
    expect(records[0]!.signature).toBe('Bash:npm build')
  })

  test('no-op when store is empty', () => {
    const cwd = '/test/project'
    resolveFailure(cwd, 'Bash', { command: 'npm test' }, testBaseDir)
    expect(readStore(cwd, testBaseDir)).toEqual([])
  })

  test('no-op when no matching signature', () => {
    const cwd = '/test/project'
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'error', testBaseDir)
    resolveFailure(cwd, 'Bash', { command: 'npm build' }, testBaseDir)

    const records = readStore(cwd, testBaseDir)
    expect(records).toHaveLength(1)
  })
})

describe('getMatchingFailures', () => {
  test('returns exact signature matches first', () => {
    const cwd = '/test/project'
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'test error', testBaseDir)
    addFailure(cwd, 'Bash', { command: 'npm build' }, 'build error', testBaseDir)

    const matches = getMatchingFailures(cwd, 'Bash', { command: 'npm test' }, testBaseDir)
    expect(matches).toHaveLength(1)
    expect(matches[0]!.error).toBe('test error')
  })

  test('does not fall back to same tool_name when no exact match', () => {
    const cwd = '/test/project'
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'test error', testBaseDir)

    const matches = getMatchingFailures(cwd, 'Bash', { command: 'npm lint' }, testBaseDir)
    expect(matches).toHaveLength(0)
  })

  test('returns empty when no failures', () => {
    const cwd = '/test/project'
    const matches = getMatchingFailures(cwd, 'Bash', { command: 'npm test' }, testBaseDir)
    expect(matches).toEqual([])
  })

  test('caps at 3 results for exact signature matches', () => {
    const cwd = '/test/project'
    // Same command repeated 5 times increments count, but it's one record
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'error 0', testBaseDir)
    addFailure(cwd, 'Bash', { command: 'npm test' }, 'error 1', testBaseDir)

    const matches = getMatchingFailures(cwd, 'Bash', { command: 'npm test' }, testBaseDir)
    expect(matches).toHaveLength(1)

    // Non-matching command returns empty
    const noMatch = getMatchingFailures(cwd, 'Bash', { command: 'other' }, testBaseDir)
    expect(noMatch).toHaveLength(0)
  })
})

describe('formatInjection', () => {
  test('returns empty string for no failures', () => {
    expect(formatInjection([])).toBe('')
  })

  test('formats failure records', () => {
    const failures: FailureRecord[] = [{
      signature: 'Bash:npm test',
      tool_name: 'Bash',
      tool_input_summary: 'npm test',
      error: 'Cannot find module @foo/bar',
      count: 3,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    }]

    const result = formatInjection(failures)
    expect(result).toContain('Known failures')
    expect(result).toContain('Cannot find module @foo/bar')
    expect(result).toContain('3x')
    expect(result).toContain('Consider these before proceeding')
  })

  test('truncates to 500 chars', () => {
    const failures: FailureRecord[] = Array.from({ length: 3 }, (_, i) => ({
      signature: `Bash:cmd-${i}`,
      tool_name: 'Bash',
      tool_input_summary: `cmd-${i}`,
      error: 'x'.repeat(200),
      count: 1,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    }))

    const result = formatInjection(failures)
    expect(result.length).toBeLessThanOrEqual(500)
  })
})
