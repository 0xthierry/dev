import { expect, it } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startIsolatedBrowser } from './integration-harness'

interface McpResponse {
  daemon: { pid: number; generation: string; backend: { pid: number } | null }
  result?: { content: Array<{ type: string; text?: string }> }
  tools?: Array<{ name: string }>
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

it('keeps trace and heap state across invocations, then stops only the MCP client and leaves isolated Brave reachable', async () => {
  const harness = await startIsolatedBrowser()
  try {
    const catalogResult = await harness.invokeMcp(['list'])
    expect(catalogResult.code).toBe(0)
    const catalog = JSON.parse(catalogResult.stdout) as McpResponse
    expect(catalog.tools?.map((tool) => tool.name)).toHaveLength(24)
    const generation = catalog.daemon.generation
    const daemonPid = catalog.daemon.pid
    const backendPid = catalog.daemon.backend?.pid
    if (!backendPid) throw new Error('MCP backend PID was not reported')
    const runtimeEntries = readdirSync(harness.runtimeBase)
    expect(runtimeEntries).toHaveLength(1)
    const runtimeRoot = join(harness.runtimeBase, runtimeEntries[0] ?? '')
    const socketPath = join(runtimeRoot, 'client.sock')
    expect(lstatSync(runtimeRoot).mode & 0o777).toBe(0o700)
    expect(lstatSync(socketPath).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(harness.stateRoot, 'mcp-client', 'state.json')).mode & 0o777).toBe(0o600)

    const pagesResult = await harness.invokeMcp(['call', 'list_pages', '{}'])
    expect(pagesResult.code).toBe(0)
    const pages = JSON.parse(pagesResult.stdout) as McpResponse
    const pageText = pages.result?.content.find((item) => item.type === 'text')?.text ?? ''
    expect(pageText).toContain(`1: Workspace overview (${harness.url})`)
    expect(pages.daemon).toMatchObject({ pid: daemonPid, generation })

    const tracePath = join(harness.stateRoot, 'persistent trace.json.gz')
    const traceStart = await harness.invokeMcp([
      'call',
      'performance_start_trace',
      JSON.stringify({ pageId: 1, reload: false, autoStop: false }),
    ])
    expect(traceStart.code).toBe(0)
    const traceStartResponse = JSON.parse(traceStart.stdout) as McpResponse
    expect(traceStartResponse.result?.content[0]?.text).toContain('being recorded')
    expect(traceStartResponse.daemon).toMatchObject({ pid: daemonPid, generation })

    await harness.evaluatePrimitive('document.getElementById("summary").click(); true')
    const traceStop = await harness.invokeMcp([
      'call',
      'performance_stop_trace',
      JSON.stringify({ pageId: 1, filePath: tracePath }),
    ])
    expect(traceStop.code).toBe(0)
    const traceStopResponse = JSON.parse(traceStop.stdout) as McpResponse
    expect(traceStopResponse.result?.content[0]?.text).toContain('has been stopped')
    expect(traceStopResponse.daemon).toMatchObject({ pid: daemonPid, generation })
    expect(existsSync(tracePath)).toBe(true)

    const heapPath = join(harness.stateRoot, 'persistent heap.heapsnapshot')
    const heapCapture = await harness.invokeMcp([
      'call',
      'take_heapsnapshot',
      JSON.stringify({ pageId: 1, filePath: heapPath }),
    ])
    expect(heapCapture.code).toBe(0)
    expect((JSON.parse(heapCapture.stdout) as McpResponse).daemon).toMatchObject({ pid: daemonPid, generation })
    expect(existsSync(heapPath)).toBe(true)

    const heapSummary = await harness.invokeMcp([
      'call',
      'get_heapsnapshot_summary',
      JSON.stringify({ filePath: heapPath }),
    ])
    expect(heapSummary.code).toBe(0)
    const heapSummaryResponse = JSON.parse(heapSummary.stdout) as McpResponse
    expect(heapSummaryResponse.result?.content[0]?.text).toContain('Heap Snapshot Data')
    expect(heapSummaryResponse.daemon).toMatchObject({ pid: daemonPid, generation })

    const heapClose = await harness.invokeMcp(['call', 'close_heapsnapshot', JSON.stringify({ filePath: heapPath })])
    expect(heapClose.code).toBe(0)
    expect((JSON.parse(heapClose.stdout) as McpResponse).daemon).toMatchObject({ pid: daemonPid, generation })

    const status = await harness.invokeMcp(['status'])
    expect(status.code).toBe(0)
    expect(JSON.parse(status.stdout)).toMatchObject({ running: true, pid: daemonPid, generation, state: 'ready' })

    const failedCall = await harness.invokeMcp(['call', 'get_console_message', '{}'])
    expect(failedCall.code).toBe(1)
    expect((JSON.parse(failedCall.stdout) as { result: { isError: boolean } }).result.isError).toBe(true)
    const invalidatedStatus = await harness.invokeMcp(['status'])
    expect(JSON.parse(invalidatedStatus.stdout)).toMatchObject({ state: 'invalidated', generation })
    const replay = await harness.invokeMcp(['call', 'list_pages', '{}'])
    expect(replay.code).toBe(1)
    expect(replay.stderr).toContain('Explicitly stop before starting again')

    const stop = await harness.invokeMcp(['stop'])
    expect(stop.code).toBe(0)
    expect(JSON.parse(stop.stdout)).toEqual({ stopped: true })
    expect(existsSync(join(harness.stateRoot, 'mcp-client', 'state.json'))).toBe(false)
    expect(existsSync(socketPath)).toBe(false)
    expect(processExists(backendPid)).toBe(false)

    const stoppedStatus = await harness.invokeMcp(['status'])
    expect(stoppedStatus.code).toBe(0)
    expect(JSON.parse(stoppedStatus.stdout)).toEqual({ running: false })
    const versionResponse = await fetch(`http://127.0.0.1:${harness.port}/json/version`)
    expect(versionResponse.status).toBe(200)
    expect((await harness.driver.send('Browser.getVersion')).product).toContain('Chrome/')
  } finally {
    await harness.close()
  }
}, 180_000)

it('fails an unavailable local attach without starting an alternate browser', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'browser diagnostics attach failure ')))
  const home = join(root, 'home')
  const state = join(root, 'state')
  const runtime = join(root, 'runtime')
  mkdirSync(home, { mode: 0o700 })
  mkdirSync(state, { mode: 0o700 })
  mkdirSync(runtime, { mode: 0o700 })
  const reservation = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  const port = reservation.port
  reservation.stop(true)
  const env = {
    HOME: home,
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    BROWSER_DIAGNOSTICS_TEST_MODE: '1',
    BROWSER_DIAGNOSTICS_STATE_DIR: state,
    BROWSER_DIAGNOSTICS_RUNTIME_DIR: runtime,
    BROWSER_DIAGNOSTICS_FIXTURE_PORT: String(port),
  }
  const cli = resolve(import.meta.dir, '../bin/chrome-devtools-cli')
  const invoke = (args: string[]) =>
    Bun.spawnSync([cli, ...args], { env, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 })
  try {
    await expect(fetch(`http://127.0.0.1:${port}/json/version`)).rejects.toThrow()
    const attach = invoke(['list'])
    expect(attach.exitCode).toBe(1)
    expect(attach.stderr.toString()).toContain('explicitly stop')
    await expect(fetch(`http://127.0.0.1:${port}/json/version`)).rejects.toThrow()
    const status = invoke(['status'])
    expect(JSON.parse(status.stdout.toString())).toMatchObject({ state: 'invalidated' })
    const stop = invoke(['stop'])
    expect(stop.exitCode).toBe(0)
    expect(JSON.parse(stop.stdout.toString())).toEqual({ stopped: true })
    await expect(fetch(`http://127.0.0.1:${port}/json/version`)).rejects.toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 60_000)

it.skipIf(process.platform !== 'linux')(
  'recovers one lost Linux namespace without stopping another namespace from the same package',
  async () => {
    const harness = await startIsolatedBrowser()
    const cli = resolve(import.meta.dir, '../bin/chrome-devtools-cli')
    const namespaceRoot = join(harness.evidence, 'parallel namespaces')
    const stateA = join(namespaceRoot, 'state A')
    const runtimeA = join(namespaceRoot, 'runtime A')
    const stateB = join(namespaceRoot, 'state B')
    const runtimeB = join(namespaceRoot, 'runtime B')
    for (const directory of [stateA, runtimeA, stateB, runtimeB]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
    }
    const namespaceEnv = (state: string, runtime: string) => ({
      ...harness.env,
      BROWSER_DIAGNOSTICS_STATE_DIR: state,
      BROWSER_DIAGNOSTICS_RUNTIME_DIR: runtime,
    })
    const invoke = (env: Record<string, string>, args: string[]) =>
      Bun.spawnSync([cli, ...args], { env, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 })
    const envA = namespaceEnv(stateA, runtimeA)
    const envB = namespaceEnv(stateB, runtimeB)
    try {
      const startedA = invoke(envA, ['list'])
      const startedB = invoke(envB, ['list'])
      expect(startedA.exitCode).toBe(0)
      expect(startedB.exitCode).toBe(0)
      const daemonA = (JSON.parse(startedA.stdout.toString()) as McpResponse).daemon
      const daemonB = (JSON.parse(startedB.stdout.toString()) as McpResponse).daemon
      const backendA = daemonA.backend?.pid
      const backendB = daemonB.backend?.pid
      if (!backendA || !backendB) throw new Error('Parallel namespace backend PID was not reported')
      expect(processExists(daemonA.pid)).toBe(true)
      expect(processExists(backendA)).toBe(true)
      expect(processExists(daemonB.pid)).toBe(true)
      expect(processExists(backendB)).toBe(true)

      const runtimeEntriesA = readdirSync(runtimeA)
      expect(runtimeEntriesA).toHaveLength(1)
      unlinkSync(join(runtimeA, runtimeEntriesA[0] ?? '', 'client.sock'))
      const recoveredA = invoke(envA, ['stop'])
      expect(recoveredA.exitCode).toBe(0)
      expect(JSON.parse(recoveredA.stdout.toString())).toEqual({ stopped: true, recovered: true })
      expect(processExists(daemonA.pid)).toBe(false)
      expect(processExists(backendA)).toBe(false)

      expect(processExists(daemonB.pid)).toBe(true)
      expect(processExists(backendB)).toBe(true)
      const pagesB = invoke(envB, ['call', 'list_pages', '{}'])
      expect(pagesB.exitCode).toBe(0)
      expect(pagesB.stdout.toString()).toContain(harness.url)
      const statusB = invoke(envB, ['status'])
      expect(JSON.parse(statusB.stdout.toString())).toMatchObject({
        pid: daemonB.pid,
        generation: daemonB.generation,
        state: 'ready',
      })
      const stoppedB = invoke(envB, ['stop'])
      expect(stoppedB.exitCode).toBe(0)
      expect(processExists(backendB)).toBe(false)
    } finally {
      invoke(envA, ['stop'])
      invoke(envB, ['stop'])
      await harness.close()
    }
  },
  120_000,
)
