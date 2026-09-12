import { expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

it('stops an interrupted client while browser readiness is pending without reviving startup state', async () => {
  // Arrange: hold the fixture response so the daemon cannot finish its readiness check.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'browser diagnostics pending startup ')))
  const home = join(root, 'home')
  const stateBase = join(root, 'state')
  const runtimeBase = join(root, 'runtime')
  for (const directory of [home, stateBase, runtimeBase]) mkdirSync(directory, { mode: 0o700 })
  let requested = false
  let releaseResponse = () => {}
  const responseReleased = new Promise<void>((resolveResponse) => {
    releaseResponse = resolveResponse
  })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch() {
      requested = true
      await responseReleased
      return new Response('fixture readiness was cancelled', { status: 503 })
    },
  })
  const env = {
    HOME: home,
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    BROWSER_DIAGNOSTICS_TEST_MODE: '1',
    BROWSER_DIAGNOSTICS_STATE_DIR: stateBase,
    BROWSER_DIAGNOSTICS_RUNTIME_DIR: runtimeBase,
    BROWSER_DIAGNOSTICS_FIXTURE_PORT: String(server.port),
  }
  const cli = resolve(import.meta.dir, '../bin/chrome-devtools-cli')
  const statePath = join(stateBase, 'browser-diagnostics', 'mcp-client', 'state.json')
  const starter = Bun.spawn([cli, 'list'], { env, stdout: 'pipe', stderr: 'pipe', timeout: 10_000 })
  const stop = () => Bun.spawn([cli, 'stop'], { env, stdout: 'pipe', stderr: 'pipe', timeout: 10_000 })
  let cleanupError: Error | undefined
  try {
    for (let attempt = 0; attempt < 300 && !requested; attempt++) await Bun.sleep(10)
    expect(requested).toBe(true)
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toMatchObject({ state: 'starting', backend: null })

    // Act: interrupt the foreground starter, then use the public stop command.
    starter.kill('SIGTERM')
    expect(await starter.exited).not.toBe(0)
    const stopping = stop()
    const stopCode = await stopping.exited
    const stopOutput = await new Response(stopping.stdout).text()
    const stopError = await new Response(stopping.stderr).text()
    releaseResponse()
    await server.stop(true)

    // Assert: cancellation is complete, with no stale state or late revival.
    expect(stopError).toBe('')
    expect(stopCode).toBe(0)
    expect(JSON.parse(stopOutput)).toEqual({ stopped: true })
    expect(existsSync(statePath)).toBe(false)
    const status = Bun.spawn([cli, 'status'], { env, stdout: 'pipe', stderr: 'pipe', timeout: 10_000 })
    expect(await status.exited).toBe(0)
    expect(JSON.parse(await new Response(status.stdout).text())).toMatchObject({ running: false })
  } finally {
    releaseResponse()
    if (starter.exitCode === null) starter.kill('SIGTERM')
    await starter.exited
    const cleanup = stop()
    const cleanupCode = await cleanup.exited
    await server.stop(true)
    if (cleanupCode !== 0) {
      cleanupError = new Error(`Fixture diagnostics cleanup failed; state retained at ${root}`)
    } else {
      rmSync(root, { recursive: true, force: true })
    }
  }
  if (cleanupError) throw cleanupError
}, 30_000)
