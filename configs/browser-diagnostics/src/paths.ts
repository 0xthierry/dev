import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { DiagnosticsError } from './cdp'

const testMode = process.env.BROWSER_DIAGNOSTICS_TEST_MODE === '1'

function ownedByCurrentUser(uid: number): boolean {
  const currentUid = process.getuid?.()
  return currentUid === undefined || uid === currentUid
}

export function ensurePrivateDirectory(path: string, rejectTraversedSymlinks = false): string {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  let metadata = lstatSync(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !ownedByCurrentUser(metadata.uid)) {
    throw new DiagnosticsError('Diagnostics directory must be owned by the current user with mode 0700')
  }
  if ((metadata.mode & 0o077) !== 0) {
    chmodSync(path, 0o700)
    metadata = lstatSync(path)
    if ((metadata.mode & 0o077) !== 0) {
      throw new DiagnosticsError('Diagnostics directory must be owned by the current user with mode 0700')
    }
  }
  if (rejectTraversedSymlinks && realpathSync(path) !== resolve(path)) {
    throw new DiagnosticsError('Diagnostics directory must not traverse symlinks')
  }
  return path
}

export function diagnosticsStateRoot(): string {
  const override = process.env.BROWSER_DIAGNOSTICS_STATE_DIR
  if (override && !testMode) {
    throw new DiagnosticsError('The diagnostics state directory cannot be overridden outside fixture tests')
  }
  const base = override ?? join(homedir(), '.local', 'state')
  return ensurePrivateDirectory(join(base, 'browser-diagnostics'), true)
}

export function diagnosticsRuntimeRoot(): string {
  const override = process.env.BROWSER_DIAGNOSTICS_RUNTIME_DIR
  if (override && !testMode) {
    throw new DiagnosticsError('The diagnostics runtime directory cannot be overridden outside fixture tests')
  }
  const xdgRuntime = process.env.XDG_RUNTIME_DIR
  const base = override ?? (xdgRuntime && isAbsolute(xdgRuntime) ? xdgRuntime : tmpdir())
  const uid = process.getuid?.() ?? 0
  const homeTag = createHash('sha256').update(homedir()).digest('hex').slice(0, 10)
  return ensurePrivateDirectory(join(base, `browser-diagnostics-${uid}-${homeTag}`))
}

export function fixturePort(defaultPort = 9222): number {
  const value = process.env.BROWSER_DIAGNOSTICS_FIXTURE_PORT
  if (value === undefined) return defaultPort
  if (!testMode) throw new DiagnosticsError('A fixture port is only allowed in diagnostics test mode')
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DiagnosticsError('Fixture port must be an integer between 1 and 65535')
  }
  return port
}

export function packageRoot(): string {
  return resolve(import.meta.dir, '..')
}
