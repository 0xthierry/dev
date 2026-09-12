import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function invoke(args: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, 'cli.ts'), ...args], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

describe('bounded capture CLI boundary', () => {
  it('documents all source capture and analysis commands', () => {
    const result = invoke(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('record --target ID --url URL --kind cpu|network|coverage')
    expect(result.stdout).toContain('heap --target ID --url URL')
    expect(result.stdout).toContain('targets')
    expect(result.stdout).toContain('doctor')
    expect(result.stdout).toContain('summarize')
    expect(result.stdout).toContain('compare')
  })

  it('rejects arbitrary endpoint controls and fixture ports outside test mode', () => {
    expect(invoke(['targets', '--port', '9333']).stderr).toContain('Unsupported CLI option')
    expect(invoke(['targets', '--browser-url', 'http://example.test']).stderr).toContain('Unsupported CLI option')
    expect(invoke(['targets', '--fixture-port', '9333']).stderr).toContain('only allowed in diagnostics test mode')
  })

  it('rejects incompatible heap and record controls before attaching', () => {
    const common = ['--target', 'ABC', '--url', 'https://example.test/', '--scenario', 'fixture']
    expect(invoke(['heap', ...common, '--duration-ms', '100']).stderr).toContain('does not accept --duration-ms')
    expect(
      invoke(['record', ...common, '--kind', 'cpu', '--duration-ms', '100', '--collect-garbage']).stderr,
    ).toContain('only supported in isolated heap captures')
  })

  it('resolves the browser-diagnostics wrapper through a symlink and a path with spaces', () => {
    const directory = mkdtempSync(join(tmpdir(), 'browser diagnostics wrapper '))
    try {
      const bin = join(directory, 'local bin')
      mkdirSync(bin)
      const link = join(bin, 'browser-diagnostics')
      symlinkSync(resolve(import.meta.dir, '../bin/browser-diagnostics'), link)

      const result = Bun.spawnSync([link, '--help'], { cwd: directory, stdout: 'pipe', stderr: 'pipe' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain('Browser diagnostics')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
