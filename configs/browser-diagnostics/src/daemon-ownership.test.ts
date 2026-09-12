import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimDaemonState } from './daemon-ownership'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-admission-'))
  directories.push(directory)
  return directory
}

describe('MCP daemon ownership admission', () => {
  it('admits one of two separate cold-start contenders without overwriting state or shared temporary files', async () => {
    const directory = createDirectory()
    const statePath = join(directory, 'state.json')
    const temporaryPath = join(directory, 'state.tmp')
    writeFileSync(temporaryPath, 'existing temporary state')
    const contenderSource = `
            import { existsSync } from 'node:fs';
            import { claimDaemonState } from ${JSON.stringify(join(import.meta.dir, 'daemon-ownership.ts'))};
            const statePath = ${JSON.stringify(statePath)};
            if (existsSync(statePath)) throw new Error('Not a cold start');
            process.stdout.write('ready');
            await Bun.stdin.text();
            try {
                claimDaemonState({ statePath, serializedState: JSON.stringify({ pid: process.pid }) });
                process.stdout.write('winner');
            } catch (error) {
                process.stderr.write(error.message);
                process.exitCode = 1;
            }
        `
    const first = Bun.spawn([process.execPath, '--eval', contenderSource], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const second = Bun.spawn([process.execPath, '--eval', contenderSource], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    try {
      const firstReader = first.stdout.getReader()
      const secondReader = second.stdout.getReader()
      const ready = await Promise.all([firstReader.read(), secondReader.read()])
      firstReader.releaseLock()
      secondReader.releaseLock()
      expect(ready.map((item) => new TextDecoder().decode(item.value))).toEqual(['ready', 'ready'])
      expect(existsSync(statePath)).toBe(false)

      await Promise.all([first.stdin.end(), second.stdin.end()])
      const exitCodes = await Promise.all([first.exited, second.exited])

      expect([...exitCodes].sort()).toEqual([0, 1])
      const winnerPid = exitCodes[0] === 0 ? first.pid : second.pid
      expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({ pid: winnerPid })
      expect(
        (await Promise.all([new Response(first.stderr).text(), new Response(second.stderr).text()])).filter(Boolean),
      ).toEqual(['MCP daemon already exists; no replacement was started'])
      expect(readFileSync(temporaryPath, 'utf8')).toBe('existing temporary state')
      expect(lstatSync(statePath).mode & 0o777).toBe(0o600)
      expect(readdirSync(directory).sort()).toEqual(['state.json', 'state.tmp'])
    } finally {
      first.kill()
      second.kill()
      await Promise.all([first.exited, second.exited])
    }
  })

  it('retains lost ownership until explicit recovery removes the state', () => {
    const directory = createDirectory()
    const statePath = join(directory, 'state.json')
    claimDaemonState({ statePath, serializedState: '{"generation":"previous"}' })

    expect(() => claimDaemonState({ statePath, serializedState: '{"generation":"next"}' })).toThrow(
      'MCP daemon already exists',
    )

    expect(readFileSync(statePath, 'utf8')).toBe('{"generation":"previous"}')
    expect(readdirSync(directory)).toEqual(['state.json'])
  })

  it('admits a fresh owner after explicit state removal', () => {
    const directory = createDirectory()
    const statePath = join(directory, 'state.json')
    claimDaemonState({ statePath, serializedState: '{"generation":"previous"}' })
    rmSync(statePath)

    claimDaemonState({ statePath, serializedState: '{"generation":"next"}' })

    expect(readFileSync(statePath, 'utf8')).toBe('{"generation":"next"}')
    expect(readdirSync(directory)).toEqual(['state.json'])
  })
})
