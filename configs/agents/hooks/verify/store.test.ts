import { afterEach, describe, expect, test } from 'bun:test'
import {
  addEditedFile,
  hasEdits,
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

describe('addEditedFile', () => {
  test('records first edited file', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts')

    const state = readState(TEST_CWD, sid)
    expect(state.editedFiles).toEqual(['/src/api/handler.ts'])
    expect(state.lastEditAt).toBeGreaterThan(0)
  })

  test('appends subsequent files', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts')
    addEditedFile(TEST_CWD, sid, '/src/api/router.ts')

    const state = readState(TEST_CWD, sid)
    expect(state.editedFiles).toEqual([
      '/src/api/handler.ts',
      '/src/api/router.ts',
    ])
  })

  test('does not duplicate the same file path', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts')
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts')

    const state = readState(TEST_CWD, sid)
    expect(state.editedFiles).toEqual(['/src/api/handler.ts'])
  })
})

describe('invalidation', () => {
  test('editing a file invalidates all recorded verifications', () => {
    const sid = uniqueSession()

    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts')
    recordVerification(TEST_CWD, sid, 'test', 'bun test', true, null)
    recordVerification(TEST_CWD, sid, 'lint', 'bun lint', true, null)
    recordVerification(TEST_CWD, sid, 'typecheck', 'tsc --noEmit', true, null)

    addEditedFile(TEST_CWD, sid, '/src/api/new-file.ts')

    const state = readState(TEST_CWD, sid)
    expect(state.verifications.test).toBeNull()
    expect(state.verifications.lint).toBeNull()
    expect(state.verifications.typecheck).toBeNull()
  })
})

describe('recordVerification', () => {
  test('records a passing verification', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts')

    recordVerification(TEST_CWD, sid, 'test', 'bun test', true, null)

    const v = readState(TEST_CWD, sid).verifications.test
    expect(v).not.toBeNull()
    expect(v!.passed).toBe(true)
    expect(v!.command).toBe('bun test')
    expect(v!.errors).toBeNull()
  })

  test('records a failing verification with errors', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts')

    recordVerification(TEST_CWD, sid, 'lint', 'eslint .', false, 'error: unused var')

    const v = readState(TEST_CWD, sid).verifications.lint
    expect(v).not.toBeNull()
    expect(v!.passed).toBe(false)
    expect(v!.errors).toBe('error: unused var')
  })
})

describe('hasEdits', () => {
  test('returns true when files have been edited', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts')
    expect(hasEdits(TEST_CWD, sid)).toBe(true)
  })

  test('returns false when no edits', () => {
    const sid = uniqueSession()
    expect(hasEdits(TEST_CWD, sid)).toBe(false)
  })
})

describe('resetState', () => {
  test('clears edits and verifications', () => {
    const sid = uniqueSession()
    addEditedFile(TEST_CWD, sid, '/src/api/handler.ts')
    recordVerification(TEST_CWD, sid, 'test', 'bun test', true, null)

    resetState(TEST_CWD, sid)

    const state = readState(TEST_CWD, sid)
    expect(state.editedFiles).toEqual([])
    expect(state.verifications.test).toBeNull()
    expect(hasEdits(TEST_CWD, sid)).toBe(false)
  })
})
