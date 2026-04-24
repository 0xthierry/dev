import type { HookInput } from './io.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type HookHarness = 'claude' | 'codex'

export function detectHookHarness(input: Partial<Pick<HookInput, 'permission_mode'>>): HookHarness {
  return typeof input.permission_mode === 'string' ? 'codex' : 'claude'
}

export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}

export function getProjectsBaseDir(harness: HookHarness): string {
  return join(homedir(), harness === 'codex' ? '.codex' : '.claude', 'projects')
}

export function getProjectStateDir(harness: HookHarness, cwd: string): string {
  return join(getProjectsBaseDir(harness), encodeProjectPath(cwd))
}

export function getSessionStateDir(harness: HookHarness, cwd: string, sessionId: string): string {
  return join(getProjectStateDir(harness, cwd), sessionId)
}

export function alternateHookHarness(harness: HookHarness): HookHarness {
  return harness === 'codex' ? 'claude' : 'codex'
}
