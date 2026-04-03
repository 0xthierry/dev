import type { ProjectCommands } from './schema.ts'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { alternateHookHarness, getProjectStateDir, type HookHarness } from '../lib/harness.ts'
import { parseProjectCommands } from './schema.ts'

export function readProjectCommands(cwd: string, harness: HookHarness = 'claude'): ProjectCommands | null {
  for (const path of getProjectCommandsPaths(cwd, harness)) {
    if (!existsSync(path))
      continue
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'))
      return parseProjectCommands(raw)
    }
    catch {}
  }
  return null
}

export function getProjectCommandsPath(cwd: string, harness: HookHarness = 'claude'): string {
  return join(getProjectStateDir(harness, cwd), 'project-commands.json')
}

function getProjectCommandsPaths(cwd: string, harness: HookHarness): string[] {
  const preferred = getProjectCommandsPath(cwd, harness)
  const fallback = getProjectCommandsPath(cwd, alternateHookHarness(harness))
  return preferred === fallback ? [preferred] : [preferred, fallback]
}
