import { expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

it('fails closed and retains corrupt MCP state for explicit inspection', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'browser-diagnostics-corrupt-state-')))
  const home = join(root, 'home')
  const stateBase = join(root, 'state')
  const runtimeBase = join(root, 'runtime')
  const clientDirectory = join(stateBase, 'browser-diagnostics', 'mcp-client')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(clientDirectory, { recursive: true, mode: 0o700 })
  mkdirSync(runtimeBase, { recursive: true, mode: 0o700 })
  const statePath = join(clientDirectory, 'state.json')
  writeFileSync(statePath, '{not valid json', { mode: 0o600 })
  const env = {
    HOME: home,
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    BROWSER_DIAGNOSTICS_TEST_MODE: '1',
    BROWSER_DIAGNOSTICS_STATE_DIR: stateBase,
    BROWSER_DIAGNOSTICS_RUNTIME_DIR: runtimeBase,
  }
  const cli = resolve(import.meta.dir, '../bin/chrome-devtools-cli')
  try {
    const stopped = Bun.spawnSync([cli, 'stop'], { env, stdout: 'pipe', stderr: 'pipe' })

    expect(stopped.exitCode).toBe(1)
    expect(stopped.stdout.toString()).toBe('')
    expect(stopped.stderr.toString()).toContain('state was retained')
    expect(stopped.stderr.toString()).toContain('Inspect the state and owned processes')
    expect(readFileSync(statePath, 'utf8')).toBe('{not valid json')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
