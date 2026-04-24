import type { ProjectCommands, Scope } from './schema.ts'
import { describe, expect, test } from 'bun:test'
import {
  allCommandPrefixes,
  buildCommandArgs,
  findScope,
  isSourceFile,
  isTestFile,
  matchBashCommand,
  parseProjectCommands,
} from './schema.ts'

function makeScope(overrides: Partial<Scope> = {}): Scope {
  return {
    id: 'root',
    pattern: '**',
    cwd: '.',
    test: [],
    lint: [],
    typecheck: [],
    format: [],
    ...overrides,
  }
}

function makeCommands(overrides: Partial<ProjectCommands> = {}): ProjectCommands {
  return {
    schemaVersion: 1,
    projectRoot: '/home/user/project',
    sourceFiles: ['package.json'],
    scopes: [makeScope()],
    ...overrides,
  }
}

// -- parseProjectCommands --

describe('parseProjectCommands', () => {
  test('accepts valid input', () => {
    const raw = makeCommands()
    expect(parseProjectCommands(raw)).toEqual(raw)
  })

  test('returns null for non-object', () => {
    expect(parseProjectCommands('string')).toBeNull()
    expect(parseProjectCommands(null)).toBeNull()
    expect(parseProjectCommands(42)).toBeNull()
  })

  test('returns null for wrong schemaVersion', () => {
    expect(parseProjectCommands(makeCommands({ schemaVersion: 2 }))).toBeNull()
  })

  test('returns null for missing projectRoot', () => {
    const raw = makeCommands()
    ;(raw as unknown as Record<string, unknown>).projectRoot = undefined
    expect(parseProjectCommands(raw)).toBeNull()
  })

  test('returns null for missing sourceFiles', () => {
    const raw = makeCommands()
    ;(raw as unknown as Record<string, unknown>).sourceFiles = 'not-array'
    expect(parseProjectCommands(raw)).toBeNull()
  })

  test('returns null for non-array scopes', () => {
    const raw = makeCommands()
    ;(raw as unknown as Record<string, unknown>).scopes = 'nope'
    expect(parseProjectCommands(raw)).toBeNull()
  })

  test('returns null for empty scope id', () => {
    expect(parseProjectCommands(makeCommands({
      scopes: [makeScope({ id: '' })],
    }))).toBeNull()
  })

  test('returns null for scope with invalid command', () => {
    expect(parseProjectCommands(makeCommands({
      scopes: [makeScope({
        test: [{ argv: [], mode: 'project' }] as never,
      })],
    }))).toBeNull()
  })

  test('returns null for command with wrong mode', () => {
    expect(parseProjectCommands(makeCommands({
      scopes: [makeScope({
        test: [{ argv: ['bun', 'test'], mode: 'bad' }] as never,
      })],
    }))).toBeNull()
  })

  test('accepts empty scopes array', () => {
    const raw = makeCommands({ scopes: [] })
    expect(parseProjectCommands(raw)).toEqual(raw)
  })

  test('accepts command with extensions', () => {
    const raw = makeCommands({
      scopes: [makeScope({
        format: [{
          argv: ['prettier', '--write'],
          mode: 'file',
          extensions: ['ts', 'tsx'],
        }],
      })],
    })
    expect(parseProjectCommands(raw)).toEqual(raw)
  })

  test('returns null for non-string extensions', () => {
    expect(parseProjectCommands(makeCommands({
      scopes: [makeScope({
        format: [{
          argv: ['prettier', '--write'],
          mode: 'file',
          extensions: [123],
        }] as never,
      })],
    }))).toBeNull()
  })
})

// -- findScope --

describe('findScope', () => {
  test('matches exact glob', () => {
    const api = makeScope({ id: 'api', pattern: 'packages/api/**' })
    const root = makeScope({ id: 'root', pattern: '**' })
    const cmds = makeCommands({ scopes: [api, root] })

    expect(findScope(cmds, '/home/user/project/packages/api/src/index.ts'))
      .toEqual(api)
  })

  test('falls back to ** glob', () => {
    const api = makeScope({ id: 'api', pattern: 'packages/api/**' })
    const root = makeScope({ id: 'root', pattern: '**' })
    const cmds = makeCommands({ scopes: [api, root] })

    expect(findScope(cmds, '/home/user/project/README.md'))
      .toEqual(root)
  })

  test('returns null when no scope matches', () => {
    const api = makeScope({ id: 'api', pattern: 'packages/api/**' })
    const cmds = makeCommands({ scopes: [api] })

    expect(findScope(cmds, '/home/user/project/README.md'))
      .toBeNull()
  })

  test('first match wins (specificity order)', () => {
    const apiRoutes = makeScope({ id: 'api-routes', pattern: 'packages/api/routes/**' })
    const api = makeScope({ id: 'api', pattern: 'packages/api/**' })
    const cmds = makeCommands({ scopes: [apiRoutes, api] })

    expect(findScope(cmds, '/home/user/project/packages/api/routes/users.ts'))
      .toEqual(apiRoutes)
  })

  test('normalizes repo-relative path by stripping projectRoot', () => {
    const root = makeScope({ id: 'root', pattern: 'src/**' })
    const cmds = makeCommands({ scopes: [root] })

    expect(findScope(cmds, '/home/user/project/src/app.ts'))
      .toEqual(root)
  })

  test('handles projectRoot without trailing slash', () => {
    const root = makeScope({ id: 'root', pattern: '**' })
    const cmds = makeCommands({ projectRoot: '/home/user/project', scopes: [root] })

    expect(findScope(cmds, '/home/user/project/src/app.ts'))
      .toEqual(root)
  })

  test('handles path not under projectRoot gracefully', () => {
    const root = makeScope({ id: 'root', pattern: 'src/**' })
    const cmds = makeCommands({ scopes: [root] })

    // Path that doesn't start with projectRoot — passed through as-is
    expect(findScope(cmds, '/other/path/src/file.ts'))
      .toBeNull()
  })
})

// -- buildCommandArgs --

describe('buildCommandArgs', () => {
  test('appends filePath for file mode', () => {
    expect(buildCommandArgs(
      { argv: ['prettier', '--write'], mode: 'file' },
      '/home/user/project/src/app.ts',
    )).toEqual(['prettier', '--write', '/home/user/project/src/app.ts'])
  })

  test('returns argv as-is for project mode', () => {
    expect(buildCommandArgs(
      { argv: ['bun', 'test'], mode: 'project' },
    )).toEqual(['bun', 'test'])
  })

  test('returns argv copy for project mode even with filePath', () => {
    const result = buildCommandArgs(
      { argv: ['bun', 'test'], mode: 'project' },
      '/home/user/project/src/app.ts',
    )
    expect(result).toEqual(['bun', 'test'])
  })

  test('returns argv copy for file mode without filePath', () => {
    expect(buildCommandArgs(
      { argv: ['prettier', '--write'], mode: 'file' },
    )).toEqual(['prettier', '--write'])
  })

  test('does not mutate original argv', () => {
    const cmd = { argv: ['prettier', '--write'], mode: 'file' as const }
    buildCommandArgs(cmd, '/tmp/file.ts')
    expect(cmd.argv).toEqual(['prettier', '--write'])
  })
})

// -- allCommandPrefixes --

describe('allCommandPrefixes', () => {
  test('flattens across scopes', () => {
    const cmds = makeCommands({
      scopes: [
        makeScope({
          id: 'api',
          test: [{ argv: ['bun', 'test', 'packages/api'], mode: 'project' }],
        }),
        makeScope({
          id: 'web',
          test: [{ argv: ['bun', 'test', 'packages/web'], mode: 'project' }],
        }),
      ],
    })

    const prefixes = allCommandPrefixes(cmds, 'test')
    expect(prefixes).toContain('bun test packages/api')
    expect(prefixes).toContain('bun test packages/web')
    expect(prefixes).toHaveLength(2)
  })

  test('deduplicates identical commands', () => {
    const cmds = makeCommands({
      scopes: [
        makeScope({
          id: 'a',
          lint: [{ argv: ['eslint', '.'], mode: 'project' }],
        }),
        makeScope({
          id: 'b',
          lint: [{ argv: ['eslint', '.'], mode: 'project' }],
        }),
      ],
    })

    expect(allCommandPrefixes(cmds, 'lint')).toEqual(['eslint .'])
  })

  test('returns empty for no commands', () => {
    const cmds = makeCommands({ scopes: [makeScope()] })
    expect(allCommandPrefixes(cmds, 'typecheck')).toEqual([])
  })
})

// -- matchBashCommand --

describe('matchBashCommand', () => {
  const projectRoot = '/home/user/project'

  test('matches exact command in correct scope', () => {
    const cmds = makeCommands({
      projectRoot,
      scopes: [
        makeScope({
          id: 'api',
          cwd: 'packages/api',
          test: [{ argv: ['bun', 'test'], mode: 'project' }],
        }),
      ],
    })

    const result = matchBashCommand(
      'bun test',
      `${projectRoot}/packages/api`,
      cmds,
    )
    expect(result).toEqual({ type: 'test', scopeId: 'api' })
  })

  test('matches command with cd prefix', () => {
    const cmds = makeCommands({
      projectRoot,
      scopes: [
        makeScope({
          id: 'api',
          cwd: 'packages/api',
          test: [{ argv: ['bun', 'test'], mode: 'project' }],
        }),
      ],
    })

    const result = matchBashCommand(
      `cd ${projectRoot}/packages/api && bun test`,
      projectRoot,
      cmds,
    )
    expect(result).toEqual({ type: 'test', scopeId: 'api' })
  })

  test('returns null for unmatched command', () => {
    const cmds = makeCommands({
      projectRoot,
      scopes: [
        makeScope({
          id: 'root',
          cwd: '.',
          test: [{ argv: ['bun', 'test'], mode: 'project' }],
        }),
      ],
    })

    expect(matchBashCommand('git status', projectRoot, cmds)).toBeNull()
  })

  test('returns null when cwd does not match any scope', () => {
    const cmds = makeCommands({
      projectRoot,
      scopes: [
        makeScope({
          id: 'api',
          cwd: 'packages/api',
          test: [{ argv: ['bun', 'test'], mode: 'project' }],
        }),
      ],
    })

    expect(matchBashCommand('bun test', projectRoot, cmds)).toBeNull()
  })

  test('attributes to correct scope among multiple', () => {
    const cmds = makeCommands({
      projectRoot,
      scopes: [
        makeScope({
          id: 'api',
          cwd: 'packages/api',
          test: [{ argv: ['bun', 'test'], mode: 'project' }],
          lint: [{ argv: ['eslint', '.'], mode: 'project' }],
        }),
        makeScope({
          id: 'web',
          cwd: 'packages/web',
          test: [{ argv: ['bun', 'test'], mode: 'project' }],
        }),
      ],
    })

    expect(matchBashCommand(
      'eslint .',
      `${projectRoot}/packages/api`,
      cmds,
    )).toEqual({ type: 'lint', scopeId: 'api' })

    expect(matchBashCommand(
      'bun test',
      `${projectRoot}/packages/web`,
      cmds,
    )).toEqual({ type: 'test', scopeId: 'web' })
  })

  test('matches command with additional arguments', () => {
    const cmds = makeCommands({
      projectRoot,
      scopes: [
        makeScope({
          id: 'root',
          cwd: '.',
          test: [{ argv: ['bun', 'test'], mode: 'project' }],
        }),
      ],
    })

    expect(matchBashCommand(
      'bun test --bail',
      projectRoot,
      cmds,
    )).toEqual({ type: 'test', scopeId: 'root' })
  })

  test('matches root scope with cwd "."', () => {
    const cmds = makeCommands({
      projectRoot,
      scopes: [
        makeScope({
          id: 'root',
          cwd: '.',
          typecheck: [{ argv: ['tsc', '--noEmit'], mode: 'project' }],
        }),
      ],
    })

    expect(matchBashCommand(
      'tsc --noEmit',
      projectRoot,
      cmds,
    )).toEqual({ type: 'typecheck', scopeId: 'root' })
  })
})

// -- isTestFile --

describe('isTestFile', () => {
  test('matches default patterns when scope has no testFilePatterns', () => {
    const scope = makeScope()
    expect(isTestFile(scope, 'src/handler.test.ts')).toBe(true)
    expect(isTestFile(scope, 'src/handler.spec.ts')).toBe(true)
    expect(isTestFile(scope, 'src/handler_test.go')).toBe(true)
    expect(isTestFile(scope, 'src/__tests__/handler.ts')).toBe(true)
  })

  test('does not match source files with defaults', () => {
    const scope = makeScope()
    expect(isTestFile(scope, 'src/handler.ts')).toBe(false)
    expect(isTestFile(scope, 'src/test-utils.ts')).toBe(false)
  })

  test('uses custom testFilePatterns from scope', () => {
    const scope = makeScope({ testFilePatterns: ['**/*.check.ts', '**/e2e/**'] })
    expect(isTestFile(scope, 'src/handler.check.ts')).toBe(true)
    expect(isTestFile(scope, 'e2e/login.ts')).toBe(true)
    expect(isTestFile(scope, 'src/handler.test.ts')).toBe(false) // not in custom patterns
  })

  test('falls back to defaults when scope is null', () => {
    expect(isTestFile(null, 'src/handler.test.ts')).toBe(true)
    expect(isTestFile(null, 'src/handler.ts')).toBe(false)
  })
})

// -- isSourceFile --

describe('isSourceFile', () => {
  test('matches default extensions when scope has no sourceExtensions', () => {
    const scope = makeScope()
    expect(isSourceFile(scope, 'src/handler.ts')).toBe(true)
    expect(isSourceFile(scope, 'src/app.py')).toBe(true)
    expect(isSourceFile(scope, 'main.rs')).toBe(true)
  })

  test('rejects non-source files with defaults', () => {
    const scope = makeScope()
    expect(isSourceFile(scope, 'README.md')).toBe(false)
    expect(isSourceFile(scope, 'package.json')).toBe(false)
    expect(isSourceFile(scope, 'styles.css')).toBe(false)
  })

  test('uses custom sourceExtensions from scope', () => {
    const scope = makeScope({ sourceExtensions: ['rs', 'toml'] })
    expect(isSourceFile(scope, 'src/main.rs')).toBe(true)
    expect(isSourceFile(scope, 'Cargo.toml')).toBe(true)
    expect(isSourceFile(scope, 'src/handler.ts')).toBe(false) // not in custom list
  })

  test('falls back to defaults when scope is null', () => {
    expect(isSourceFile(null, 'src/handler.ts')).toBe(true)
    expect(isSourceFile(null, 'README.md')).toBe(false)
  })

  test('returns false for files without extension', () => {
    expect(isSourceFile(null, 'Makefile')).toBe(false)
  })

  test('accepts scope with valid testFilePatterns', () => {
    const raw = makeCommands({
      scopes: [makeScope({ testFilePatterns: ['**/*.test.ts'] })],
    })
    expect(parseProjectCommands(raw)).not.toBeNull()
  })

  test('rejects scope with non-string testFilePatterns', () => {
    const raw = makeCommands({
      scopes: [makeScope({ testFilePatterns: [123] } as never)],
    })
    expect(parseProjectCommands(raw)).toBeNull()
  })

  test('accepts scope with valid sourceExtensions', () => {
    const raw = makeCommands({
      scopes: [makeScope({ sourceExtensions: ['ts', 'tsx'] })],
    })
    expect(parseProjectCommands(raw)).not.toBeNull()
  })

  test('rejects scope with non-string sourceExtensions', () => {
    const raw = makeCommands({
      scopes: [makeScope({ sourceExtensions: [42] } as never)],
    })
    expect(parseProjectCommands(raw)).toBeNull()
  })
})
