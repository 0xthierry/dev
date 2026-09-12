import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiagnosticsProcessNamespace } from './owned-processes'
import {
  daemonNamespaceMarker,
  linuxProcessIsOwned,
  listOwnedLinuxProcesses,
  lostProcessRecovery,
  readLinuxProcessIdentity,
  shutdownStateDisposition,
} from './owned-processes'

const runtimeEntry = '/repo with spaces/browser-diagnostics/src/mcp-runtime.ts'
const backendEntry =
  '/repo with spaces/browser-diagnostics/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'
const namespaceA: DiagnosticsProcessNamespace = {
  runtimeEntry,
  backendEntry,
  stateRoot: '/home/test/state A/browser-diagnostics',
  generation: 'generation-a',
}
const namespaceB: DiagnosticsProcessNamespace = {
  runtimeEntry,
  backendEntry,
  stateRoot: '/home/test/state B/browser-diagnostics',
  generation: 'generation-b',
}
const expectedUid = process.getuid?.()
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createProcDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'owned-mcp-proc-'))
  directories.push(directory)
  return directory
}

function procStat({
  pid,
  state = 'S',
  startTicks = '4242',
}: {
  pid: number
  state?: string
  startTicks?: string
}): string {
  return `${pid} (fixture) ${state} 1 1 1 0 -1 0 0 0 0 0 0 0 0 20 0 1 0 0 ${startTicks} 0\n`
}

function writeProcess({
  procDirectory,
  pid,
  cmdline,
  state,
  startTicks,
}: {
  procDirectory: string
  pid: number
  cmdline: readonly string[]
  state?: string
  startTicks?: string
}): void {
  const directory = join(procDirectory, String(pid))
  mkdirSync(directory)
  writeFileSync(
    join(directory, 'stat'),
    procStat({
      pid,
      ...(state === undefined ? {} : { state }),
      ...(startTicks === undefined ? {} : { startTicks }),
    }),
  )
  writeFileSync(join(directory, 'cmdline'), `${cmdline.join('\0')}\0`)
}

function daemonArgs(namespace: DiagnosticsProcessNamespace): string[] {
  return [
    '/usr/bin/bun',
    namespace.runtimeEntry,
    '--daemon',
    namespace.generation,
    daemonNamespaceMarker(namespace.stateRoot),
  ]
}

function backendArgs(namespace: DiagnosticsProcessNamespace): string[] {
  return [
    '/usr/bin/node',
    namespace.backendEntry,
    '--browserUrl=http://127.0.0.1:9222',
    `--workspace=${namespace.stateRoot}`,
  ]
}

describe('shutdown state retention', () => {
  it('retains identities when a backend survives or Darwin cannot exclude an unrecorded startup child', () => {
    expect(
      shutdownStateDisposition({ platform: 'linux', backendAlive: true, unrecordedBackendMaySurvive: false }),
    ).toBe('retain-state')
    expect(
      shutdownStateDisposition({ platform: 'darwin', backendAlive: false, unrecordedBackendMaySurvive: true }),
    ).toBe('retain-state')
  })

  it('removes state only after backend termination is established', () => {
    expect(
      shutdownStateDisposition({ platform: 'linux', backendAlive: false, unrecordedBackendMaySurvive: false }),
    ).toBe('remove-state')
    expect(
      shutdownStateDisposition({ platform: 'darwin', backendAlive: false, unrecordedBackendMaySurvive: false }),
    ).toBe('remove-state')
  })
})

describe('platform-specific lost-process recovery', () => {
  it('retires only Linux processes eligible for namespace, UID, start-tick, and exact-argv verification', () => {
    expect(lostProcessRecovery({ platform: 'linux', daemonAlive: true, backendAlive: true })).toBe('retire-linux-owned')
  })

  it('refuses PID-only Darwin termination and uncertain startup cleanup', () => {
    expect(lostProcessRecovery({ platform: 'darwin', daemonAlive: true, backendAlive: false })).toBe(
      'refuse-unverified',
    )
    expect(
      lostProcessRecovery({
        platform: 'darwin',
        daemonAlive: false,
        backendAlive: false,
        unrecordedBackendPossible: true,
      }),
    ).toBe('refuse-unverified')
    expect(lostProcessRecovery({ platform: 'darwin', daemonAlive: false, backendAlive: false })).toBe(
      'clear-dead-state',
    )
  })
})

describe('Linux owned MCP process fingerprint', () => {
  it('accepts the exact daemon namespace, PID, start ticks, UID, and paths with spaces', () => {
    const procDirectory = createProcDirectory()
    writeProcess({ procDirectory, pid: 33, cmdline: daemonArgs(namespaceA), startTicks: '123' })

    expect(
      linuxProcessIsOwned({
        identity: { pid: 33, startTicks: '123' },
        role: 'daemon',
        expectedUid,
        namespace: namespaceA,
        procDirectory,
      }),
    ).toBe(true)
  })

  it.each([
    { name: 'PID reuse', startTicks: '124', state: 'S', cmdline: daemonArgs(namespaceA), role: 'daemon' as const },
    { name: 'a zombie', startTicks: '123', state: 'Z', cmdline: daemonArgs(namespaceA), role: 'daemon' as const },
    {
      name: 'Brave',
      startTicks: '123',
      state: 'S',
      cmdline: ['/usr/bin/brave', '--remote-debugging-port=9222'],
      role: 'daemon' as const,
    },
    {
      name: 'a substring',
      startTicks: '123',
      state: 'S',
      cmdline: daemonArgs({ ...namespaceA, runtimeEntry: `${runtimeEntry}.other` }),
      role: 'daemon' as const,
    },
    {
      name: 'another generation',
      startTicks: '123',
      state: 'S',
      cmdline: daemonArgs({ ...namespaceA, generation: 'generation-other' }),
      role: 'daemon' as const,
    },
    {
      name: 'another state root',
      startTicks: '123',
      state: 'S',
      cmdline: backendArgs(namespaceB),
      role: 'backend' as const,
    },
  ])('rejects $name', ({ startTicks, state, cmdline, role }) => {
    const procDirectory = createProcDirectory()
    writeProcess({ procDirectory, pid: 33, cmdline, startTicks, state })

    expect(
      linuxProcessIsOwned({
        identity: { pid: 33, startTicks: '123' },
        role,
        expectedUid,
        namespace: namespaceA,
        procDirectory,
      }),
    ).toBe(false)
  })

  it('fails closed when identity data disappears', () => {
    const procDirectory = createProcDirectory()
    writeProcess({ procDirectory, pid: 33, cmdline: daemonArgs(namespaceA), startTicks: '123' })
    unlinkSync(join(procDirectory, '33', 'cmdline'))

    expect(
      linuxProcessIsOwned({
        identity: { pid: 33, startTicks: '123' },
        role: 'daemon',
        expectedUid,
        namespace: namespaceA,
        procDirectory,
      }),
    ).toBe(false)
  })

  it('scopes recovery inventory to one namespace and leaves another namespace and Brave ineligible', () => {
    const procDirectory = createProcDirectory()
    writeProcess({ procDirectory, pid: 11, cmdline: [runtimeEntry, 'stop'], startTicks: '11' })
    writeProcess({
      procDirectory,
      pid: 22,
      cmdline: ['/usr/bin/brave', '--remote-debugging-port=9222'],
      startTicks: '22',
    })
    writeProcess({ procDirectory, pid: 31, cmdline: daemonArgs(namespaceA), startTicks: '31' })
    writeProcess({ procDirectory, pid: 32, cmdline: backendArgs(namespaceA), startTicks: '32' })
    writeProcess({ procDirectory, pid: 41, cmdline: daemonArgs(namespaceB), startTicks: '41' })
    writeProcess({ procDirectory, pid: 42, cmdline: backendArgs(namespaceB), startTicks: '42' })

    expect(listOwnedLinuxProcesses({ currentPid: 11, expectedUid, namespace: namespaceA, procDirectory })).toEqual([
      { pid: 31, startTicks: '31', role: 'daemon' },
      { pid: 32, startTicks: '32', role: 'backend' },
    ])
    expect(listOwnedLinuxProcesses({ currentPid: 11, expectedUid, namespace: namespaceB, procDirectory })).toEqual([
      { pid: 41, startTicks: '41', role: 'daemon' },
      { pid: 42, startTicks: '42', role: 'backend' },
    ])
    expect(readLinuxProcessIdentity({ pid: 22, expectedUid, procDirectory })).toEqual({ pid: 22, startTicks: '22' })
  })
})
