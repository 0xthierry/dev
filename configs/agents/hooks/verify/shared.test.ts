import { describe, expect, test } from 'bun:test'
import { detectVerificationCommand, extractVerificationOutcome } from './shared.ts'

describe('detectVerificationCommand', () => {
  test('recognizes test commands', () => {
    expect(detectVerificationCommand('pytest')).toEqual({ type: 'test' })
    expect(detectVerificationCommand('npm test')).toEqual({ type: 'test' })
    expect(detectVerificationCommand('bun test')).toEqual({ type: 'test' })
  })

  test('recognizes lint commands', () => {
    expect(detectVerificationCommand('npm run lint')).toEqual({ type: 'lint' })
    expect(detectVerificationCommand('npx eslint src/')).toEqual({ type: 'lint' })
    expect(detectVerificationCommand('ruff check')).toEqual({ type: 'lint' })
  })

  test('recognizes typecheck commands', () => {
    expect(detectVerificationCommand('npm run typecheck')).toEqual({ type: 'typecheck' })
    expect(detectVerificationCommand('npx tsc --noEmit')).toEqual({ type: 'typecheck' })
    expect(detectVerificationCommand('mypy src/')).toEqual({ type: 'typecheck' })
  })

  test('returns null for unrelated commands', () => {
    expect(detectVerificationCommand('ls -la')).toBeNull()
    expect(detectVerificationCommand('git status')).toBeNull()
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
