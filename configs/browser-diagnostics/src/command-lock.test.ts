import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireNamedLock } from './command-lock'

describe('portable lifecycle locks', () => {
  it('rejects a lock owned by a live process without removing it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'diagnostics-lock-'))
    const lock = join(directory, 'recorder.lock')
    mkdirSync(lock, { mode: 0o700 })
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: crypto.randomUUID() }), {
      mode: 0o600,
    })
    try {
      expect(() =>
        acquireNamedLock({ directory, name: 'recorder.lock', activeMessage: 'A diagnostics recorder is active' }),
      ).toThrow('active')
      expect(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).pid).toBe(process.pid)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reconciles a dead owner and removes only its own replacement lock', () => {
    const directory = mkdtempSync(join(tmpdir(), 'diagnostics-lock-'))
    const lock = join(directory, 'recorder.lock')
    mkdirSync(lock, { mode: 0o700 })
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 2_147_483_647, token: crypto.randomUUID() }), {
      mode: 0o600,
    })
    try {
      const release = acquireNamedLock({
        directory,
        name: 'recorder.lock',
        activeMessage: 'A diagnostics recorder is active',
      })
      expect(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).pid).toBe(process.pid)
      release()
      expect(() => readFileSync(join(lock, 'owner.json'))).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
