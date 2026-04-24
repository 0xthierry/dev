import type { VerificationResult, VerificationType } from './shared.ts'
import { readVerifyState, writeVerifyState } from './store-io.ts'

export type { VerificationResult, VerificationType } from './shared.ts'

export interface CodexVerifyState {
  sessionStartedAt: number
  baselineGitStatus: string | null
  verifications: {
    test: VerificationResult | null
    lint: VerificationResult | null
    typecheck: VerificationResult | null
  }
}

function emptyState(): CodexVerifyState {
  return {
    sessionStartedAt: 0,
    baselineGitStatus: null,
    verifications: {
      test: null,
      lint: null,
      typecheck: null,
    },
  }
}

export function readState(cwd: string, sessionId: string): CodexVerifyState {
  return readVerifyState('codex', cwd, sessionId, emptyState, (empty, raw) => ({
    ...empty,
    ...raw as Partial<CodexVerifyState>,
  }))
}

export function writeState(cwd: string, sessionId: string, state: CodexVerifyState): void {
  writeVerifyState('codex', cwd, sessionId, state)
}

export function initializeState(cwd: string, sessionId: string, baselineGitStatus: string | null): void {
  writeState(cwd, sessionId, {
    sessionStartedAt: Date.now(),
    baselineGitStatus,
    verifications: {
      test: null,
      lint: null,
      typecheck: null,
    },
  })
}

export function recordVerification(
  cwd: string,
  sessionId: string,
  type: VerificationType,
  command: string,
  passed: boolean,
  errors: string | null,
): void {
  const state = readState(cwd, sessionId)
  state.verifications[type] = {
    at: Date.now(),
    passed,
    command,
    errors,
  }
  writeState(cwd, sessionId, state)
}
