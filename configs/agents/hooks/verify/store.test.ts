import { afterEach, describe, expect, test } from 'bun:test'
import {
  addEditedFile,
  getEditedScopes,
  readState,
  recordVerification,
  resetState,
} from './store.ts'

const TEST_CWD = `/tmp/verify-store-test-${Date.now()}`
let sessionCounter = 0

function uniqueSession(): string {
  return `test-session-${Date.now()}-${sessionCounter++}`
}

afterEach(() => {
  // Clean up any state files created during tests
})

describe('addEditedFile with scopeId', () => {
  test('creates scope entry when adding first file', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')

    const state = readState(TEST_CWD, sid)
    expect(state.scopes.api).toBeDefined()
    expect(state.scopes.api!.editedFiles).toEqual(['/src/api/handler.ts'])
    expect(state.scopes.api!.lastEditAt).toBeGreaterThan(0)
  })

  test('multiple files in same scope share state', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')
    addEditedFile(TEST_CWD, sid, '/src/api/router.ts', 'api')

    const state = readState(TEST_CWD, sid)
    expect(state.scopes.api!.editedFiles).toEqual([
      '/src/api/handler.ts',
      '/src/api/router.ts',
    ])
  })

  test('does not duplicate the same file path', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')

    const state = readState(TEST_CWD, sid)
    expect(state.scopes.api!.editedFiles).toEqual(['/src/api/handler.ts'])
  })

  test('files in different scopes have independent state', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')
    addEditedFile(TEST_CWD, sid, '/src/workflow/step.ts', 'workflow')

    const state = readState(TEST_CWD, sid)
    expect(state.scopes.api!.editedFiles).toEqual(['/src/api/handler.ts'])
    expect(state.scopes.workflow!.editedFiles).toEqual(['/src/workflow/step.ts'])
  })
})

describe('invalidation per scope', () => {
  test('editing a file invalidates only that scope verifications', () => {
    const sid = uniqueSession()

    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')
    addEditedFile(TEST_CWD, sid, '/src/workflow/step.ts', 'workflow')

    recordVerification(TEST_CWD, sid, 'test', 'api', 'bun test api', true, null)
    recordVerification(TEST_CWD, sid, 'test', 'workflow', 'bun test workflow', true, null)

    const before = readState(TEST_CWD, sid)
    expect(before.scopes.api!.verifications.test).not.toBeNull()
    expect(before.scopes.workflow!.verifications.test).not.toBeNull()

    // Edit a file in api scope — should invalidate api but not workflow
    addEditedFile(TEST_CWD, sid, '/src/api/routes.ts', 'api')

    const after = readState(TEST_CWD, sid)
    expect(after.scopes.api!.verifications.test).toBeNull()
    expect(after.scopes.workflow!.verifications.test).not.toBeNull()
  })

  test('invalidation clears all verification types in the edited scope', () => {
    const sid = uniqueSession()

    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')
    recordVerification(TEST_CWD, sid, 'test', 'api', 'bun test', true, null)
    recordVerification(TEST_CWD, sid, 'lint', 'api', 'bun lint', true, null)
    recordVerification(TEST_CWD, sid, 'typecheck', 'api', 'tsc --noEmit', true, null)

    addEditedFile(TEST_CWD, sid, '/src/api/new-file.ts', 'api')

    const state = readState(TEST_CWD, sid)
    expect(state.scopes.api!.verifications.test).toBeNull()
    expect(state.scopes.api!.verifications.lint).toBeNull()
    expect(state.scopes.api!.verifications.typecheck).toBeNull()
  })
})

describe('recordVerification with scopeId', () => {
  test('records verification for specific scope', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')

    recordVerification(TEST_CWD, sid, 'test', 'api', 'bun test api', true, null)

    const state = readState(TEST_CWD, sid)
    const v = state.scopes.api!.verifications.test
    expect(v).not.toBeNull()
    expect(v!.passed).toBe(true)
    expect(v!.command).toBe('bun test api')
    expect(v!.errors).toBeNull()
  })

  test('records failed verification with errors', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')

    recordVerification(TEST_CWD, sid, 'lint', 'api', 'eslint .', false, 'error: unused var')

    const state = readState(TEST_CWD, sid)
    const v = state.scopes.api!.verifications.lint
    expect(v).not.toBeNull()
    expect(v!.passed).toBe(false)
    expect(v!.errors).toBe('error: unused var')
  })

  test('creates scope entry if it does not exist yet', () => {
    const sid = uniqueSession()

    recordVerification(TEST_CWD, sid, 'test', 'new-scope', 'bun test', true, null)

    const state = readState(TEST_CWD, sid)
    expect(state.scopes['new-scope']).toBeDefined()
    expect(state.scopes['new-scope']!.verifications.test!.passed).toBe(true)
  })
})

describe('getEditedScopes', () => {
  test('returns only scopes with edited files', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')
    addEditedFile(TEST_CWD, sid, '/src/workflow/step.ts', 'workflow')

    // Record a verification for a third scope (no edits)
    recordVerification(TEST_CWD, sid, 'test', 'empty-scope', 'bun test', true, null)

    const scopes = getEditedScopes(TEST_CWD, sid)
    expect(scopes).toContain('api')
    expect(scopes).toContain('workflow')
    expect(scopes).not.toContain('empty-scope')
  })

  test('returns empty array when no edits', () => {
    const sid = uniqueSession()
    expect(getEditedScopes(TEST_CWD, sid)).toEqual([])
  })
})

describe('resetState', () => {
  test('clears all scopes', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts', 'api')
    addEditedFile(TEST_CWD, sid, '/src/workflow/step.ts', 'workflow')
    recordVerification(TEST_CWD, sid, 'test', 'api', 'bun test', true, null)

    resetState(TEST_CWD, sid)

    const state = readState(TEST_CWD, sid)
    expect(state.scopes).toEqual({})
    expect(getEditedScopes(TEST_CWD, sid)).toEqual([])
  })
})
