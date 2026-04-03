import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getSessionStateDir, type HookHarness } from '../lib/harness.ts'

function getStorePath(harness: HookHarness, cwd: string, sessionId: string): string {
  return join(getSessionStateDir(harness, cwd, sessionId), 'verify.json')
}

export function readVerifyState<T>(
  harness: HookHarness,
  cwd: string,
  sessionId: string,
  emptyState: () => T,
  mergeState?: (empty: T, raw: unknown) => T,
): T {
  const path = getStorePath(harness, cwd, sessionId)
  if (!existsSync(path))
    return emptyState()

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    return mergeState ? mergeState(emptyState(), raw) : raw as T
  }
  catch {
    return emptyState()
  }
}

export function writeVerifyState<T>(
  harness: HookHarness,
  cwd: string,
  sessionId: string,
  state: T,
): void {
  const path = getStorePath(harness, cwd, sessionId)
  const dir = dirname(path)
  if (!existsSync(dir))
    mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2))
}

