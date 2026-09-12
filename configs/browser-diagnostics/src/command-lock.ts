import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { DiagnosticsError } from './cdp'

const lockSchema = z.object({ pid: z.number().int().positive(), token: z.uuid() }).strict()

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

export function acquireNamedLock({
  directory,
  name,
  activeMessage,
}: {
  directory: string
  name: string
  activeMessage: string
}): () => void {
  const lockPath = join(directory, name)
  const token = randomUUID()
  try {
    mkdirSync(lockPath, { mode: 0o700 })
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    let owner: z.infer<typeof lockSchema>
    try {
      owner = lockSchema.parse(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8')))
    } catch {
      throw new DiagnosticsError('Another diagnostics command owns an unreadable lock; inspect it before recovery')
    }
    if (processExists(owner.pid)) throw new DiagnosticsError(activeMessage)
    const stalePath = `${lockPath}.stale-${randomUUID()}`
    try {
      renameSync(lockPath, stalePath)
      rmSync(stalePath, { recursive: true, force: true })
      mkdirSync(lockPath, { mode: 0o700 })
    } catch {
      throw new DiagnosticsError('Diagnostics lock recovery lost a race; retry without removing live state')
    }
  }
  writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, token }), { mode: 0o600, flag: 'wx' })
  return () => {
    try {
      const current = lockSchema.parse(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8')))
      if (current.pid === process.pid && current.token === token) rmSync(lockPath, { recursive: true, force: true })
    } catch {
      // A replaced or damaged lock is not ours to remove.
    }
  }
}

export function acquireCommandLock(directory: string): () => void {
  return acquireNamedLock({
    directory,
    name: 'command.lock',
    activeMessage: 'Another diagnostics CLI command is active',
  })
}
