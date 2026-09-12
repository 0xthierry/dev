import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { diagnosticsTools } from './tool-catalog'

function invoke(args: string[]) {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, 'mcp-cli.ts'), ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

describe('diagnostics MCP CLI argument boundary', () => {
  it('documents the fixed skill-driven commands without connecting to a backend', () => {
    const result = invoke(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('list [TOOL] | call TOOL')
    expect(result.stdout).toContain('status | stop')
  })

  it('keeps exactly the 24 diagnostic tools and excludes alternate controllers', () => {
    expect(diagnosticsTools).toHaveLength(24)
    expect(new Set(diagnosticsTools).size).toBe(24)
    expect(diagnosticsTools).not.toContain('click')
    expect(diagnosticsTools).not.toContain('evaluate_script')
    expect(diagnosticsTools).not.toContain('navigate_page')
  })

  for (const args of [
    [],
    ['--config', '/tmp/other.json'],
    ['list', '--stdio'],
    ['status', '--http-url'],
    ['call', 'click', '{}'],
    ['call', 'evaluate_script', '{}'],
    ['call', 'navigate_page', '{}'],
    ['call', 'chrome_devtools.list_pages', '{}'],
    ['call', 'list_pages', '{}', '--server', 'other'],
    ['call', 'list_pages', 'null'],
    ['call', 'list_pages', '[]'],
    ['call', 'list_pages', '1'],
    ['call', 'list_pages', '{'],
    ['list', 'list_pages', 'extra'],
    ['stop', 'extra'],
  ]) {
    it(`rejects unsupported arguments before starting an MCP process: ${JSON.stringify(args)}`, () => {
      const result = invoke(args)
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('error')
    })
  }
})

describe('installed wrapper resolution', () => {
  it('resolves a relative symlink when the repository path contains spaces', () => {
    const directory = mkdtempSync(join(tmpdir(), 'browser diagnostics wrapper '))
    try {
      const bin = join(directory, 'local bin')
      mkdirSync(bin)
      const link = join(bin, 'chrome-devtools-cli')
      symlinkSync(resolve(import.meta.dir, '../bin/chrome-devtools-cli'), link)

      const result = Bun.spawnSync([link, '--help'], { cwd: directory, stdout: 'pipe', stderr: 'pipe' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain('chrome-devtools-cli list')
      expect(existsSync(link)).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
