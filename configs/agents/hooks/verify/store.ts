import type { VerificationResult, VerificationType } from './shared.ts'
import { homedir } from 'node:os'
import { readVerifyState, writeVerifyState } from './store-io.ts'

export const REVIEW_TOKEN = 'review-checklist-complete'
export const REVIEW_FILE_PATH = `${homedir()}/.agents/hooks/verify/review.md`
export type { VerificationResult, VerificationType } from './shared.ts'

export interface VerifyState {
  editedFiles: string[]
  lastEditAt: number
  verifications: {
    test: VerificationResult | null
    lint: VerificationResult | null
    typecheck: VerificationResult | null
  }
}

function emptyState(): VerifyState {
  return {
    editedFiles: [],
    lastEditAt: 0,
    verifications: { test: null, lint: null, typecheck: null },
  }
}

export function readState(cwd: string, sessionId: string): VerifyState {
  return readVerifyState('claude', cwd, sessionId, emptyState)
}

export function writeState(cwd: string, sessionId: string, state: VerifyState): void {
  writeVerifyState('claude', cwd, sessionId, state)
}

export function resetState(cwd: string, sessionId: string): void {
  writeState(cwd, sessionId, emptyState())
}

export function addEditedFile(cwd: string, sessionId: string, filePath: string): void {
  const state = readState(cwd, sessionId)
  if (!state.editedFiles.includes(filePath)) {
    state.editedFiles.push(filePath)
  }
  state.lastEditAt = Date.now()
  for (const key of ['test', 'lint', 'typecheck'] as const) {
    const v = state.verifications[key]
    if (v && v.at <= state.lastEditAt) {
      state.verifications[key] = null
    }
  }
  writeState(cwd, sessionId, state)
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

export function hasEdits(cwd: string, sessionId: string): boolean {
  return readState(cwd, sessionId).editedFiles.length > 0
}
