import { randomUUID } from 'node:crypto'
import { linkSync, unlinkSync, writeFileSync } from 'node:fs'
import { DiagnosticsError } from './cdp'

export function claimDaemonState({ statePath, serializedState }: { statePath: string; serializedState: string }): void {
  const candidatePath = `${statePath}.${randomUUID()}.tmp`
  writeFileSync(candidatePath, serializedState, { mode: 0o600, flag: 'wx' })
  try {
    linkSync(candidatePath, statePath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new DiagnosticsError('MCP daemon already exists; no replacement was started')
    }
    throw error
  } finally {
    unlinkSync(candidatePath)
  }
}
