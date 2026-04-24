import type { VerificationResult, VerificationType } from './shared.ts'
import { homedir } from 'node:os'
import { readVerifyState, writeVerifyState } from './store-io.ts'

export const REVIEW_TOKEN = 'review-checklist-complete'
export const REVIEW_FILE_PATH = `${homedir()}/.agents/hooks/verify/review.md`
export type { VerificationResult, VerificationType } from './shared.ts'

export interface ScopeState {
  editedFiles: string[]
  lastEditAt: number
  verifications: {
    test: VerificationResult | null
    lint: VerificationResult | null
    typecheck: VerificationResult | null
  }
}

export interface VerifyState {
  scopes: Record<string, ScopeState>
}

function emptyState(): VerifyState {
  return { scopes: {} }
}

function emptyScopeState(): ScopeState {
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

export function addEditedFile(cwd: string, sessionId: string, filePath: string, scopeId: string): void {
  const state = readState(cwd, sessionId)
  if (!state.scopes[scopeId]) {
    state.scopes[scopeId] = emptyScopeState()
  }
  const scope = state.scopes[scopeId]!
  if (!scope.editedFiles.includes(filePath)) {
    scope.editedFiles.push(filePath)
  }
  scope.lastEditAt = Date.now()
  for (const key of ['test', 'lint', 'typecheck'] as const) {
    const v = scope.verifications[key]
    if (v && v.at <= scope.lastEditAt) {
      scope.verifications[key] = null
    }
  }
  writeState(cwd, sessionId, state)
}

export function recordVerification(
  cwd: string,
  sessionId: string,
  type: VerificationType,
  scopeId: string,
  command: string,
  passed: boolean,
  errors: string | null,
): void {
  const state = readState(cwd, sessionId)
  if (!state.scopes[scopeId]) {
    state.scopes[scopeId] = emptyScopeState()
  }
  state.scopes[scopeId]!.verifications[type] = {
    at: Date.now(),
    passed,
    command,
    errors,
  }
  writeState(cwd, sessionId, state)
}

export function getEditedScopes(cwd: string, sessionId: string): string[] {
  const state = readState(cwd, sessionId)
  return Object.entries(state.scopes)
    .filter(([_, s]) => s.editedFiles.length > 0)
    .map(([id]) => id)
}
