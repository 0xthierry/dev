import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { DiagnosticsError } from './cdp'

export interface LinuxProcessIdentity {
  pid: number
  startTicks: string
}

export type DiagnosticsProcessRole = 'daemon' | 'backend'

export interface DiagnosticsProcessNamespace {
  runtimeEntry: string
  backendEntry: string
  stateRoot: string
  generation: string
}

export interface OwnedLinuxProcess extends LinuxProcessIdentity {
  role: DiagnosticsProcessRole
}

export type LostProcessRecovery = 'retire-linux-owned' | 'clear-dead-state' | 'refuse-unverified'
export type ShutdownStateDisposition = 'remove-state' | 'retain-state'

export function shutdownStateDisposition({
  platform,
  backendAlive,
  unrecordedBackendMaySurvive,
}: {
  platform: NodeJS.Platform
  backendAlive: boolean
  unrecordedBackendMaySurvive: boolean
}): ShutdownStateDisposition {
  if (backendAlive) return 'retain-state'
  if (platform !== 'linux' && unrecordedBackendMaySurvive) return 'retain-state'
  return 'remove-state'
}

export function lostProcessRecovery({
  platform,
  daemonAlive,
  backendAlive,
  unrecordedBackendPossible = false,
}: {
  platform: NodeJS.Platform
  daemonAlive: boolean
  backendAlive: boolean
  unrecordedBackendPossible?: boolean
}): LostProcessRecovery {
  if (platform === 'linux') return 'retire-linux-owned'
  return daemonAlive || backendAlive || unrecordedBackendPossible ? 'refuse-unverified' : 'clear-dead-state'
}

export function daemonNamespaceMarker(stateRoot: string): string {
  return `--diagnostics-state-root=${stateRoot}`
}

function commandLineRole(args: string[], namespace: DiagnosticsProcessNamespace): DiagnosticsProcessRole | null {
  if (
    args.includes(namespace.runtimeEntry) &&
    args.includes('--daemon') &&
    args.includes(namespace.generation) &&
    args.includes(daemonNamespaceMarker(namespace.stateRoot))
  ) {
    return 'daemon'
  }
  if (args.includes(namespace.backendEntry) && args.includes(`--workspace=${namespace.stateRoot}`)) {
    return 'backend'
  }
  return null
}

export function readLinuxProcessIdentity({
  pid,
  expectedUid,
  procDirectory = '/proc',
}: {
  pid: number
  expectedUid: number | undefined
  procDirectory?: string
}): LinuxProcessIdentity | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  try {
    if (lstatSync(`${procDirectory}/${pid}`).uid !== expectedUid) return null
    const stat = readFileSync(`${procDirectory}/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const startTicks = fields[19]
    return fields[0] === 'Z' || !startTicks ? null : { pid, startTicks }
  } catch {
    return null
  }
}

export function linuxProcessIsOwned({
  identity,
  role,
  expectedUid,
  namespace,
  procDirectory = '/proc',
}: {
  identity: LinuxProcessIdentity | null | undefined
  role: DiagnosticsProcessRole
  expectedUid: number | undefined
  namespace: DiagnosticsProcessNamespace
  procDirectory?: string
}): boolean {
  if (
    !identity ||
    !isDeepStrictEqual(readLinuxProcessIdentity({ pid: identity.pid, expectedUid, procDirectory }), identity)
  ) {
    return false
  }
  try {
    const args = readFileSync(`${procDirectory}/${identity.pid}/cmdline`, 'utf8').split('\0')
    return commandLineRole(args, namespace) === role
  } catch {
    return false
  }
}

export function listOwnedLinuxProcesses({
  currentPid,
  expectedUid,
  namespace,
  procDirectory = '/proc',
}: {
  currentPid: number
  expectedUid: number | undefined
  namespace: DiagnosticsProcessNamespace
  procDirectory?: string
}): OwnedLinuxProcess[] {
  let entries: string[]
  try {
    entries = readdirSync(procDirectory)
  } catch {
    throw new DiagnosticsError('Cannot inspect owned MCP processes')
  }
  const owned: OwnedLinuxProcess[] = []
  for (const entry of entries) {
    if (!/^[1-9]\d*$/u.test(entry)) continue
    const pid = Number(entry)
    if (pid === currentPid) continue
    const identity = readLinuxProcessIdentity({ pid, expectedUid, procDirectory })
    if (!identity) continue
    try {
      const args = readFileSync(`${procDirectory}/${pid}/cmdline`, 'utf8').split('\0')
      const role = commandLineRole(args, namespace)
      if (role) owned.push({ ...identity, role })
    } catch {
      // A process can exit between inventory reads.
    }
  }
  return owned.sort((left, right) => left.pid - right.pid)
}
