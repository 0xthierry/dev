#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { DiagnosticsError } from './cdp'
import { diagnosticsTools } from './tool-catalog'

const usage = "Usage: chrome-devtools-cli list [TOOL] | call TOOL '<JSON object>' | status | stop"
const args = process.argv.slice(2)
const [command, tool, payload] = args
const allowedTools = new Set<string>(diagnosticsTools)
const allowed = (value: string | undefined) => value !== undefined && allowedTools.has(value)

try {
  if (command === '--help' && args.length === 1) {
    process.stdout.write(`${usage}\n`)
  } else {
    const valid =
      (command === 'list' && (args.length === 1 || (args.length === 2 && allowed(tool)))) ||
      (command === 'call' && args.length === 3 && allowed(tool)) ||
      ((command === 'status' || command === 'stop') && args.length === 1)
    if (!valid) throw new DiagnosticsError(usage)
    if (command === 'call') {
      if (!payload || Buffer.byteLength(payload) > 1024 * 1024) {
        throw new DiagnosticsError('Tool arguments require a JSON object of at most 1 MiB')
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        throw new DiagnosticsError('Tool arguments must be valid JSON')
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new DiagnosticsError('Tool arguments must be a JSON object')
      }
    }
    const child = spawn(process.execPath, [join(import.meta.dir, 'mcp-runtime.ts'), ...args], { stdio: 'inherit' })
    const forward = (signal: NodeJS.Signals) => child.kill(signal)
    const interrupt = () => forward('SIGINT')
    const terminate = () => forward('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
    process.exitCode = code ?? 1
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : 'MCP client invocation failed' })}\n`,
  )
  process.exitCode = 1
}
