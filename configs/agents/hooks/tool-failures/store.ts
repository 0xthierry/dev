import type { HookHarness } from '../lib/harness.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { encodeProjectPath, getProjectsBaseDir } from '../lib/harness.ts'

const EXPIRY_MS = 4 * 60 * 60 * 1000 // 4 hours
const MAX_INJECT = 3
const MAX_INJECT_CHARS = 300

export interface FailureRecord {
  signature: string
  tool_name: string
  tool_input_summary: string
  error: string
  count: number
  first_seen: string
  last_seen: string
  session_id?: string
  transcript_path?: string
}

export { encodeProjectPath } from '../lib/harness.ts'

export function getStorePath(cwd: string, baseDir?: string, harness: HookHarness = 'claude'): string {
  const base = baseDir ?? getProjectsBaseDir(harness)
  return join(base, encodeProjectPath(cwd), 'tool-failures.json')
}

export function makeSignature(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash') {
    const cmd = String(toolInput.command ?? '').slice(0, 100)
    return `Bash:${cmd}`
  }
  if (toolName === 'Edit' || toolName === 'Write') {
    return `${toolName}:${String(toolInput.file_path ?? '')}`
  }
  if (toolName === 'Grep') {
    return `Grep:${String(toolInput.pattern ?? '')}`
  }
  if (toolName === 'Glob') {
    return `Glob:${String(toolInput.pattern ?? '')}`
  }
  return toolName
}

export function makeInputSummary(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash')
    return String(toolInput.command ?? '').slice(0, 200)
  if (toolName === 'Edit')
    return `Edit ${toolInput.file_path ?? ''}`
  if (toolName === 'Write')
    return `Write ${toolInput.file_path ?? ''}`
  if (toolName === 'Grep')
    return `Grep ${toolInput.pattern ?? ''}`
  if (toolName === 'Glob')
    return `Glob ${toolInput.pattern ?? ''}`
  return toolName
}

function isExpired(record: FailureRecord): boolean {
  const lastSeen = new Date(record.last_seen).getTime()
  return (Date.now() - lastSeen) > EXPIRY_MS
}

export function readStore(cwd: string, baseDir?: string, harness: HookHarness = 'claude'): FailureRecord[] {
  const path = getStorePath(cwd, baseDir, harness)
  if (!existsSync(path))
    return []

  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (!Array.isArray(data))
      return []
    return (data as FailureRecord[]).filter(r => !isExpired(r))
  }
  catch {
    return []
  }
}

export function writeStore(cwd: string, records: FailureRecord[], baseDir?: string, harness: HookHarness = 'claude'): void {
  const path = getStorePath(cwd, baseDir, harness)
  const dir = dirname(path)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(path, JSON.stringify(records, null, 2))
}

export interface FailureArtifacts {
  session_id?: string
  transcript_path?: string
}

export function addFailure(
  cwd: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  error: string,
  baseDir?: string,
  artifacts?: FailureArtifacts,
  harness: HookHarness = 'claude',
): void {
  const records = readStore(cwd, baseDir, harness)
  const sig = makeSignature(toolName, toolInput)
  const now = new Date().toISOString()

  const existing = records.find(r => r.signature === sig)
  if (existing) {
    existing.count += 1
    existing.last_seen = now
    existing.error = error
    existing.session_id = artifacts?.session_id
    existing.transcript_path = artifacts?.transcript_path
  }
  else {
    records.push({
      signature: sig,
      tool_name: toolName,
      tool_input_summary: makeInputSummary(toolName, toolInput),
      error,
      count: 1,
      first_seen: now,
      last_seen: now,
      session_id: artifacts?.session_id,
      transcript_path: artifacts?.transcript_path,
    })
  }

  writeStore(cwd, records, baseDir, harness)
}

export function resolveFailure(
  cwd: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  baseDir?: string,
  harness: HookHarness = 'claude',
): void {
  const records = readStore(cwd, baseDir, harness)
  if (records.length === 0)
    return

  const sig = makeSignature(toolName, toolInput)
  const filtered = records.filter(r => r.signature !== sig)

  if (filtered.length !== records.length) {
    writeStore(cwd, filtered, baseDir, harness)
  }
}

export function getMatchingFailures(
  cwd: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  baseDir?: string,
  harness: HookHarness = 'claude',
): FailureRecord[] {
  const records = readStore(cwd, baseDir, harness)
  if (records.length === 0)
    return []

  const sig = makeSignature(toolName, toolInput)

  return records.filter(r => r.signature === sig).slice(0, MAX_INJECT)
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1)
    return 'just now'
  if (hours < 24)
    return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatInjection(failures: FailureRecord[]): string {
  if (failures.length === 0)
    return ''

  const lines = ['\u26A0 Known failures for this tool:']
  for (const f of failures) {
    const ago = timeAgo(f.last_seen)
    const errorSnippet = f.error.slice(0, 150)
    lines.push(`- "${errorSnippet}" (seen ${f.count}x, last: ${ago})`)
  }
  lines.push('Consider these before proceeding.')

  const result = lines.join('\n')
  return result.slice(0, MAX_INJECT_CHARS)
}
