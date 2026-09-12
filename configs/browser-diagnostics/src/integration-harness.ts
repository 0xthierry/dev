import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { CdpConnection, listTargets } from './cdp'
import { handleFixtureRequest } from './fixtures/app'

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface RunningCommand {
  child: ReturnType<typeof Bun.spawn>
  stdoutPath: string
  stderrPath: string
}

export interface IsolatedBrowserHarness {
  evidence: string
  home: string
  stateRoot: string
  runtimeBase: string
  port: number
  url: string
  target: Awaited<ReturnType<typeof listTargets>>[number]
  driver: CdpConnection
  env: Record<string, string>
  startCapture: (args: string[]) => RunningCommand
  invokeCapture: (args: string[]) => Promise<CommandResult>
  invokeMcp: (args: string[]) => Promise<CommandResult>
  waitForRecording: (command: RunningCommand) => Promise<string>
  finish: (command: RunningCommand) => Promise<CommandResult>
  evaluatePrimitive: (expression: string) => Promise<unknown>
  close: () => Promise<void>
}

function isolatedBrowserExecutable(): string {
  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
          join(homedir(), 'Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'),
        ]
      : process.platform === 'linux'
        ? ['/usr/bin/brave']
        : []
  const executable = candidates.find((candidate) => existsSync(candidate))
  if (!executable) {
    throw new Error(`An isolated Brave executable is required for diagnostics E2E on ${process.platform}`)
  }
  return executable
}

export async function startIsolatedBrowser(): Promise<IsolatedBrowserHarness> {
  process.umask(0o077)
  const evidence = realpathSync(mkdtempSync(join(tmpdir(), 'browser diagnostics e2e ')))
  const home = join(evidence, 'home with spaces')
  const stateBase = join(evidence, 'state base')
  const runtimeBase = join(evidence, 'runtime base')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(stateBase, { recursive: true, mode: 0o700 })
  mkdirSync(runtimeBase, { recursive: true, mode: 0o700 })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handleFixtureRequest })
  const url = `http://127.0.0.1:${server.port}/`
  const reservation = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  const port = reservation.port
  reservation.stop(true)
  const browserLog = join(evidence, 'brave.stderr')
  writeFileSync(browserLog, '', { mode: 0o600 })
  const browser = Bun.spawn(
    [
      isolatedBrowserExecutable(),
      '--headless=new',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(evidence, 'brave profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      url,
    ],
    {
      env: { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin' },
      stdout: 'ignore',
      stderr: Bun.file(browserLog),
    },
  )
  const children = new Set<ReturnType<typeof Bun.spawn>>()
  children.add(browser)
  let target: Awaited<ReturnType<typeof listTargets>>[number] | undefined
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (browser.exitCode !== null) throw new Error(`Isolated Brave exited; inspect ${browserLog}`)
      try {
        target = (await listTargets(port)).find((candidate) => candidate.url === url)
      } catch {
        // The owned fixture browser may not have bound its port yet.
      }
      if (target) break
      await delay(50)
    }
    if (!target) throw new Error(`Isolated Brave target did not become ready; inspect ${browserLog}`)
    const driver = await CdpConnection.connect(target)
    const env = {
      HOME: home,
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      BROWSER_DIAGNOSTICS_TEST_MODE: '1',
      BROWSER_DIAGNOSTICS_STATE_DIR: stateBase,
      BROWSER_DIAGNOSTICS_RUNTIME_DIR: runtimeBase,
      BROWSER_DIAGNOSTICS_FIXTURE_PORT: String(port),
    }
    let sequence = 0
    const captureCli = resolve(import.meta.dir, '../bin/browser-diagnostics')
    const mcpCli = resolve(import.meta.dir, '../bin/chrome-devtools-cli')
    const start = (executable: string, args: string[]): RunningCommand => {
      const stdoutPath = join(evidence, `command-${++sequence}.stdout`)
      const stderrPath = join(evidence, `command-${sequence}.stderr`)
      writeFileSync(stdoutPath, '', { mode: 0o600 })
      writeFileSync(stderrPath, '', { mode: 0o600 })
      const child = Bun.spawn([executable, ...args], {
        env,
        stdout: Bun.file(stdoutPath),
        stderr: Bun.file(stderrPath),
      })
      children.add(child)
      return { child, stdoutPath, stderrPath }
    }
    const finish = async (command: RunningCommand): Promise<CommandResult> => {
      const timeout = setTimeout(() => command.child.kill('SIGTERM'), 150_000)
      try {
        const code = await command.child.exited
        children.delete(command.child)
        return {
          code,
          stdout: readFileSync(command.stdoutPath, 'utf8'),
          stderr: readFileSync(command.stderrPath, 'utf8'),
        }
      } finally {
        clearTimeout(timeout)
      }
    }
    const invoke = async (executable: string, args: string[]) => await finish(start(executable, args))
    const waitForRecording = async (command: RunningCommand): Promise<string> => {
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        for (const line of readFileSync(command.stdoutPath, 'utf8').split('\n').filter(Boolean)) {
          const event: unknown = JSON.parse(line)
          if (
            typeof event === 'object' &&
            event !== null &&
            'status' in event &&
            event.status === 'recording' &&
            'run' in event &&
            typeof event.run === 'string'
          ) {
            return event.run
          }
        }
        if (command.child.exitCode !== null) {
          throw new Error(`Capture exited before readiness: ${readFileSync(command.stderrPath, 'utf8')}`)
        }
        await delay(25)
      }
      throw new Error(`Capture readiness timed out: ${command.stderrPath}`)
    }
    const evaluatePrimitive = async (expression: string): Promise<unknown> => {
      const response = await driver.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        objectGroup: 'fixture-primitives',
      })
      if (response.exceptionDetails || response.result.objectId) throw new Error('Fixture expression was not primitive')
      await driver.send('Runtime.releaseObjectGroup', { objectGroup: 'fixture-primitives' })
      return response.result.value
    }
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluatePrimitive('window.fixtureReady === true && window.fixtureDataReady === true')) break
      await delay(25)
    }
    if ((await evaluatePrimitive('window.fixtureDataReady === true')) !== true)
      throw new Error('Fixture did not become ready')
    return {
      evidence,
      home,
      stateRoot: join(stateBase, 'browser-diagnostics'),
      runtimeBase,
      port,
      url,
      target,
      driver,
      env,
      startCapture: (args) => start(captureCli, args),
      invokeCapture: async (args) => await invoke(captureCli, args),
      invokeMcp: async (args) => await invoke(mcpCli, args),
      waitForRecording,
      finish,
      evaluatePrimitive,
      close: async () => {
        driver.close()
        await server.stop(true)
        for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
        await Promise.race([Promise.all([...children].map(async (child) => await child.exited)), delay(2_000)])
        for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
        await Promise.all([...children].map(async (child) => await child.exited))
        if (existsSync(evidence)) rmSync(evidence, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (browser.exitCode === null) browser.kill('SIGTERM')
    await browser.exited
    await server.stop(true)
    throw error
  }
}
