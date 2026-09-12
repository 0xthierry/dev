import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema, ToolSchema } from '@modelcontextprotocol/sdk/types.js'
import { serve, sleep } from 'bun'
import { z } from 'zod'
import { DiagnosticsError } from './cdp'
import { acquireCommandLock } from './command-lock'
import { claimDaemonState } from './daemon-ownership'
import { requireLocalBrowser } from './endpoint'
import type { DiagnosticsProcessNamespace, DiagnosticsProcessRole } from './owned-processes'
import {
  daemonNamespaceMarker,
  linuxProcessIsOwned,
  listOwnedLinuxProcesses,
  lostProcessRecovery,
  readLinuxProcessIdentity,
  shutdownStateDisposition,
} from './owned-processes'
import { diagnosticsRuntimeRoot, diagnosticsStateRoot, ensurePrivateDirectory, fixturePort, packageRoot } from './paths'
import { diagnosticsTools } from './tool-catalog'

const stateRoot = diagnosticsStateRoot()
const stateDirectory = join(stateRoot, 'mcp-client')
const socketPath = join(diagnosticsRuntimeRoot(), 'client.sock')
const statePath = join(stateDirectory, 'state.json')
const pendingPath = join(stateDirectory, 'pending.json')
const backendLogPath = join(stateDirectory, 'backend.log')
const daemonLogPath = join(stateDirectory, 'daemon.log')
const serverName = 'chrome_devtools'
const toolBudgetMs = 130_000
const maxOutputBytes = 8 * 1024 * 1024
const allowedTools = new Set<string>(diagnosticsTools)
const [command, tool, payload] = process.argv.slice(2)
const runtimeEntry = import.meta.filename
const backendEntry = join(
  packageRoot(),
  'node_modules',
  'chrome-devtools-mcp',
  'build',
  'src',
  'bin',
  'chrome-devtools-mcp.js',
)
const expectedUid = process.getuid?.()
process.umask(0o077)

const processIdentitySchema = z
  .object({ pid: z.number().int().positive(), startTicks: z.string().regex(/^\d+$/u).nullable() })
  .strict()
const daemonStateSchema = z
  .object({
    running: z.literal(true),
    pid: z.number().int().positive(),
    process: processIdentitySchema,
    namespace: z.literal(stateRoot),
    generation: z.uuid(),
    state: z.enum(['starting', 'ready', 'invalidated', 'stopping']),
    backend: processIdentitySchema.nullable(),
  })
  .strict()
const invocationRequestSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('list'), tool: z.enum(diagnosticsTools).optional() }).strict(),
  z
    .object({
      command: z.literal('call'),
      tool: z.enum(diagnosticsTools),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict(),
])
const invocationResponseSchema = z.union([
  z.object({ server: z.literal(serverName), tools: z.array(ToolSchema), daemon: daemonStateSchema }).strict(),
  z
    .object({
      server: z.literal(serverName),
      tool: z.enum(diagnosticsTools),
      result: CallToolResultSchema,
      daemon: daemonStateSchema,
    })
    .strict(),
])
type ProcessIdentity = z.infer<typeof processIdentitySchema>
type DaemonState = z.infer<typeof daemonStateSchema>

function initialize(): void {
  const metadata = lstatSync(diagnosticsStateRoot())
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new DiagnosticsError('Diagnostics state directory is not private')
  }
  ensurePrivateDirectory(stateDirectory)
  const stateMetadata = lstatSync(stateDirectory)
  if (!stateMetadata.isDirectory() || stateMetadata.isSymbolicLink() || (stateMetadata.mode & 0o077) !== 0) {
    throw new DiagnosticsError('MCP client directory must be private and owned by the current user')
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

function processIdentity(pid: number | null | undefined): ProcessIdentity | null {
  if (!pid) return null
  if (process.platform === 'linux') return readLinuxProcessIdentity({ pid, expectedUid })
  return processExists(pid) ? { pid, startTicks: null } : null
}

function processNamespace(generation: string): DiagnosticsProcessNamespace {
  return { runtimeEntry, backendEntry, stateRoot, generation }
}

function processIsAlive(
  identity: ProcessIdentity | null | undefined,
  role: DiagnosticsProcessRole,
  generation: string,
): boolean {
  if (!identity) return false
  if (process.platform === 'linux') {
    if (identity.startTicks === null) return false
    return linuxProcessIsOwned({
      identity: { pid: identity.pid, startTicks: identity.startTicks },
      role,
      expectedUid,
      namespace: processNamespace(generation),
    })
  }
  return processExists(identity.pid)
}

function readState(): DaemonState | null {
  if (!existsSync(statePath)) return null
  try {
    const metadata = lstatSync(statePath)
    const currentUid = process.getuid?.()
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (currentUid !== undefined && metadata.uid !== currentUid) ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size > 16_384
    ) {
      throw new Error('invalid metadata')
    }
    const parsed: unknown = JSON.parse(readFileSync(statePath, 'utf8'))
    const result = daemonStateSchema.safeParse(parsed)
    if (!result.success) throw new Error('invalid schema')
    return result.data
  } catch {
    throw new DiagnosticsError(
      'Invalid private MCP client state; state was retained. Inspect the state and owned processes before manual recovery',
    )
  }
}

function saveState(state: DaemonState): void {
  const temporary = join(stateDirectory, `state-${randomUUID()}.tmp`)
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
  renameSync(temporary, statePath)
}

function remove(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2048) : 'MCP diagnostics failed'
}

function output(value: unknown): string {
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > maxOutputBytes) {
    throw new DiagnosticsError('MCP result exceeds 8 MiB; narrow the requested analysis')
  }
  return text
}

async function request({
  path,
  state,
  body,
  timeout = 5_000,
  signal,
}: {
  path: string
  state: DaemonState
  body?: unknown
  timeout?: number
  signal?: AbortSignal
}): Promise<unknown> {
  const init: BunFetchRequestInit = {
    unix: socketPath,
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-diagnostics-generation': state.generation, 'content-type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  const response = await fetch(`http://localhost${path}`, init)
  const text = await response.text()
  if (Buffer.byteLength(text) > maxOutputBytes)
    throw new DiagnosticsError('MCP response exceeds the client output budget')
  let result: unknown
  try {
    result = JSON.parse(text)
  } catch {
    throw new DiagnosticsError('MCP client returned invalid JSON')
  }
  if (!response.ok) {
    const failure = z.object({ error: z.string() }).safeParse(result)
    throw new DiagnosticsError(
      failure.success ? failure.data.error : `MCP client rejected request (${response.status})`,
    )
  }
  return result
}

async function retireOwnedLinuxProcess({
  identity,
  role,
  generation,
}: {
  identity: ProcessIdentity | null
  role: DiagnosticsProcessRole
  generation: string
}): Promise<void> {
  if (
    process.platform !== 'linux' ||
    !identity ||
    identity.startTicks === null ||
    !processIsAlive(identity, role, generation)
  ) {
    return
  }
  process.kill(identity.pid, 'SIGTERM')
  for (let attempt = 0; attempt < 30 && processIsAlive(identity, role, generation); attempt++) await sleep(100)
  if (processIsAlive(identity, role, generation)) process.kill(identity.pid, 'SIGKILL')
  for (let attempt = 0; attempt < 20 && processIsAlive(identity, role, generation); attempt++) await sleep(100)
  if (processIsAlive(identity, role, generation)) {
    throw new DiagnosticsError('Owned MCP process did not stop; state was retained')
  }
}

async function retireOwnedLinuxNamespace(generation: string): Promise<void> {
  for (const owned of listOwnedLinuxProcesses({
    currentPid: process.pid,
    expectedUid,
    namespace: processNamespace(generation),
  })) {
    await retireOwnedLinuxProcess({ identity: owned, role: owned.role, generation })
  }
}

async function recoverLostState(state: DaemonState): Promise<{ stopped: true; recovered: true }> {
  const recovery = lostProcessRecovery({
    platform: process.platform,
    daemonAlive: processIsAlive(state.process, 'daemon', state.generation),
    backendAlive: processIsAlive(state.backend, 'backend', state.generation),
    unrecordedBackendPossible: state.state === 'starting' && state.backend === null,
  })
  if (recovery === 'retire-linux-owned') {
    await retireOwnedLinuxProcess({ identity: state.backend, role: 'backend', generation: state.generation })
    await retireOwnedLinuxProcess({ identity: state.process, role: 'daemon', generation: state.generation })
    await retireOwnedLinuxNamespace(state.generation)
  } else if (recovery === 'refuse-unverified') {
    throw new DiagnosticsError(
      'MCP ownership cannot be re-authenticated on this platform; state was retained and no process was signaled',
    )
  }
  remove(socketPath)
  remove(pendingPath)
  remove(statePath)
  return { stopped: true, recovered: true }
}

async function stop(state: DaemonState | null): Promise<{ stopped: true; recovered?: true }> {
  if (!state) {
    if (existsSync(socketPath)) throw new DiagnosticsError('An unowned MCP socket exists; it was not removed')
    return { stopped: true }
  }
  try {
    await request({ path: '/stop', state, body: {}, timeout: 10_000 })
  } catch {
    return await recoverLostState(state)
  }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && (existsSync(statePath) || existsSync(socketPath))) await sleep(50)
  if (existsSync(statePath) || existsSync(socketPath)) {
    throw new DiagnosticsError(
      'Authenticated MCP shutdown did not finish; state was retained and no process was force-killed',
    )
  }
  for (let attempt = 0; attempt < 20 && processIsAlive(state.backend, 'backend', state.generation); attempt++) {
    await sleep(50)
  }
  if (processIsAlive(state.backend, 'backend', state.generation) && process.platform === 'linux') {
    try {
      await retireOwnedLinuxProcess({ identity: state.backend, role: 'backend', generation: state.generation })
    } catch (error) {
      state.state = 'invalidated'
      saveState(state)
      throw error
    }
  }
  if (processIsAlive(state.backend, 'backend', state.generation)) {
    state.state = 'invalidated'
    saveState(state)
    throw new DiagnosticsError('MCP backend survived shutdown; state was restored and no unverified process was killed')
  }
  return { stopped: true }
}

function daemonEnvironment(): Record<string, string> {
  const names = [
    'HOME',
    'PATH',
    'XDG_STATE_HOME',
    'XDG_RUNTIME_DIR',
    'BROWSER_DIAGNOSTICS_TEST_MODE',
    'BROWSER_DIAGNOSTICS_STATE_DIR',
    'BROWSER_DIAGNOSTICS_RUNTIME_DIR',
    'BROWSER_DIAGNOSTICS_FIXTURE_PORT',
  ]
  return Object.fromEntries(
    names.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name] as string]])),
  )
}

async function runClient(): Promise<unknown> {
  const unlock = acquireCommandLock(stateDirectory)
  try {
    let state = readState()
    if (command === 'status') {
      if (!state) return { running: false }
      try {
        return daemonStateSchema.parse(await request({ path: '/status', state }))
      } catch {
        if (
          !processIsAlive(state.process, 'daemon', state.generation) &&
          !processIsAlive(state.backend, 'backend', state.generation)
        ) {
          return { running: false, state: 'lost', recoverableWithStop: true, generation: state.generation }
        }
        return { running: false, state: 'unverified', recoverableWithStop: false, generation: state.generation }
      }
    }
    if (command === 'stop') return await stop(state)
    const input = invocationRequestSchema.parse(
      command === 'call' ? { command, tool, arguments: JSON.parse(payload ?? '') } : { command, tool },
    )
    if (existsSync(pendingPath)) {
      throw new DiagnosticsError(
        'Previous MCP operation has an unknown outcome; stop before a new investigation. Do not retry the tool call',
      )
    }
    if (state && state.state === 'invalidated') {
      throw new DiagnosticsError(
        'MCP state was invalidated; traces and heap handles are unusable. Explicitly stop before starting again',
      )
    }
    const startupDeadline = Date.now() + 125_000
    if (!state) {
      if (existsSync(socketPath)) throw new DiagnosticsError('Unowned MCP socket exists; inspect it before recovery')
      const generation = randomUUID()
      const fd = openSync(daemonLogPath, 'a', 0o600)
      const child = spawn(
        process.execPath,
        [import.meta.filename, '--daemon', generation, daemonNamespaceMarker(stateRoot)],
        {
          detached: true,
          cwd: homedir(),
          env: daemonEnvironment(),
          stdio: ['ignore', fd, fd],
        },
      )
      closeSync(fd)
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      child.unref()
      while (Date.now() < startupDeadline) {
        state = readState()
        if (state) break
        if (child.exitCode !== null)
          throw new DiagnosticsError('MCP daemon failed before startup; inspect its private log')
        await sleep(100)
      }
      if (!state || state.generation !== generation) {
        throw new DiagnosticsError('MCP daemon startup identity was not established; no replacement call was attempted')
      }
    }
    while (true) {
      let current: DaemonState
      try {
        current = daemonStateSchema.parse(await request({ path: '/status', state }))
      } catch (error) {
        if (Date.now() >= startupDeadline) throw error
        await sleep(100)
        continue
      }
      if (current.state === 'ready') break
      if (current.state !== 'starting' || Date.now() >= startupDeadline) {
        throw new DiagnosticsError('MCP daemon is unavailable; inspect its private log and explicitly stop')
      }
      await sleep(100)
    }
    writeFileSync(pendingPath, JSON.stringify({ generation: state.generation, command, tool }), {
      mode: 0o600,
      flag: 'wx',
    })
    const controller = new AbortController()
    const interrupt = () => controller.abort(new DiagnosticsError('MCP invocation interrupted'))
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', interrupt)
    try {
      const result = invocationResponseSchema.parse(
        await request({
          path: '/invoke',
          state,
          body: input,
          timeout: toolBudgetMs + 10_000,
          signal: controller.signal,
        }),
      )
      remove(pendingPath)
      if ('result' in result && result.result.isError === true) process.exitCode = 1
      return result
    } catch (error) {
      try {
        await request({ path: '/invalidate', state, body: {}, timeout: 10_000 })
      } catch {
        // The pending marker prevents blind replay when invalidation cannot be confirmed.
      }
      throw error
    } finally {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', interrupt)
    }
  } finally {
    unlock()
  }
}

async function runDaemon(generation: string | undefined, namespaceMarker: string | undefined): Promise<void> {
  if (namespaceMarker !== daemonNamespaceMarker(stateRoot)) {
    throw new DiagnosticsError('MCP daemon namespace marker does not match its private state root')
  }
  if (existsSync(statePath) || existsSync(socketPath))
    throw new DiagnosticsError('MCP daemon already exists; no replacement was started')
  const self = processIdentity(process.pid)
  if (!self) throw new DiagnosticsError('MCP daemon could not establish its process identity')
  const state = daemonStateSchema.parse({
    running: true,
    pid: process.pid,
    process: self,
    namespace: stateRoot,
    generation,
    state: 'starting',
    backend: null,
  })
  claimDaemonState({ statePath, serializedState: JSON.stringify(state) })
  let busy = false
  let active: AbortController | undefined
  let closing: Promise<void> | undefined
  let listener: ReturnType<typeof serve> | undefined
  const client = new Client({ name: 'browser-diagnostics-cli', version: '1.0.0' }, { capabilities: {} })
  const port = fixturePort()
  const root = stateRoot
  const transport = new StdioClientTransport({
    command: 'node',
    args: [
      backendEntry,
      `--browserUrl=http://127.0.0.1:${port}`,
      `--workspace=${root}`,
      '--no-usage-statistics',
      '--no-performance-crux',
      '--memory-debugging',
      '--redact-network-headers',
    ],
    cwd: homedir(),
    env: { ...daemonEnvironment(), TMPDIR: root },
    stderr: 'pipe',
  })
  const close = async () => {
    if (!closing) closing = client.close()
    await closing
  }
  const invalidate = async () => {
    if (state.state === 'stopping') return
    state.state = 'invalidated'
    saveState(state)
    active?.abort()
    await close()
  }
  client.onclose = () => {
    if (state.state !== 'stopping') {
      state.state = 'invalidated'
      saveState(state)
    }
  }
  client.onerror = () => {
    void invalidate().catch(() => {})
  }
  const shutdown = async () => {
    const stateBeforeStop = state.state
    state.state = 'stopping'
    saveState(state)
    active?.abort()
    let closeFailed = false
    try {
      await close()
    } catch {
      closeFailed = true
    }
    if (process.platform === 'linux') await retireOwnedLinuxNamespace(state.generation)
    const backendAlive = processIsAlive(state.backend, 'backend', state.generation)
    const unrecordedBackendMaySurvive = closeFailed && stateBeforeStop === 'starting' && state.backend === null
    if (
      shutdownStateDisposition({ platform: process.platform, backendAlive, unrecordedBackendMaySurvive }) ===
      'retain-state'
    ) {
      state.state = 'invalidated'
      saveState(state)
      throw new DiagnosticsError('MCP backend termination was not verified; state was retained for explicit recovery')
    }
    await listener?.stop(true)
    remove(socketPath)
    remove(pendingPath)
    remove(statePath)
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown()
        .then(() => process.exit(0))
        .catch(() => {})
    })
  }
  listener = serve({
    unix: socketPath,
    maxRequestBodySize: 1024 * 1024,
    async fetch(incoming) {
      if (incoming.headers.get('x-diagnostics-generation') !== generation) {
        return Response.json({ error: 'Wrong MCP daemon generation' }, { status: 403 })
      }
      const path = new URL(incoming.url).pathname
      if (path === '/status' && incoming.method === 'GET') return Response.json(state)
      if (incoming.method !== 'POST') return Response.json({ error: 'Unsupported MCP client request' }, { status: 405 })
      if (path === '/stop') {
        setTimeout(
          () =>
            void shutdown()
              .then(() => process.exit(0))
              .catch(() => {}),
          50,
        )
        return Response.json({ stopping: true })
      }
      if (path === '/invalidate') {
        await invalidate()
        return Response.json({ invalidated: true })
      }
      if (path !== '/invoke') return Response.json({ error: 'Unknown MCP client endpoint' }, { status: 404 })
      if (state.state !== 'ready' || busy) {
        return Response.json({ error: 'MCP client unavailable or busy; no tool was invoked' }, { status: 409 })
      }
      busy = true
      active = new AbortController()
      try {
        const input = invocationRequestSchema.parse(await incoming.json())
        let response: z.infer<typeof invocationResponseSchema>
        if (input.command === 'list') {
          const catalog = await client.listTools({}, { timeout: toolBudgetMs, signal: active.signal })
          let tools = catalog.tools.filter((item) => allowedTools.has(item.name))
          if (!isDeepStrictEqual(tools.map((item) => item.name).sort(), [...diagnosticsTools].sort())) {
            throw new DiagnosticsError('Incomplete diagnostics tool catalog')
          }
          if (input.tool) tools = tools.filter((item) => item.name === input.tool)
          response = { server: serverName, tools, daemon: state }
        } else {
          const result = CallToolResultSchema.parse(
            await client.callTool({ name: input.tool, arguments: input.arguments }, undefined, {
              timeout: toolBudgetMs,
              signal: active.signal,
            }),
          )
          if (result.isError === true) await invalidate()
          response = { server: serverName, tool: input.tool, result, daemon: state }
        }
        return new Response(output(response), { headers: { 'content-type': 'application/json' } })
      } catch (error) {
        await invalidate()
        return Response.json({ error: failureMessage(error), invalidated: true, retry: false }, { status: 502 })
      } finally {
        busy = false
        active = undefined
      }
    },
  })
  chmodSync(socketPath, 0o600)
  let logged = 0
  writeFileSync(backendLogPath, '', { mode: 0o600 })
  transport.stderr?.on('data', (chunk: Buffer) => {
    const remaining = Math.max(0, 128 * 1024 - logged)
    if (remaining > 0) {
      const bounded = Buffer.from(chunk).subarray(0, remaining)
      writeFileSync(backendLogPath, bounded, { flag: 'a', mode: 0o600 })
      logged += bounded.length
    }
  })
  try {
    await requireLocalBrowser(port)
    if (closing || state.state !== 'starting') return
    const connection = client.connect(transport, { timeout: 120_000 })
    state.backend = processIdentity(transport.pid)
    if (!state.backend) throw new DiagnosticsError('MCP backend process identity was not established')
    saveState(state)
    await connection
    if (closing || state.state !== 'starting') return
    state.backend = processIdentity(transport.pid)
    if (!state.backend) throw new DiagnosticsError('MCP backend process identity was lost during startup')
    state.state = 'ready'
    saveState(state)
  } catch {
    if (!closing && state.state !== 'stopping') await invalidate()
  }
}

try {
  initialize()
  if (command === '--daemon') await runDaemon(tool, payload)
  else process.stdout.write(`${output(await runClient())}\n`)
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: failureMessage(error), retry: false })}\n`)
  process.exitCode = 1
}
