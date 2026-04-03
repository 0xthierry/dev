import type { HookHarness } from '../lib/harness.ts'
import { resolveCommandCwd } from '../lib/io.ts'
import { readProjectCommands } from '../project-commands/reader.ts'
import { matchBashCommand } from '../project-commands/schema.ts'

export type VerificationType = 'test' | 'lint' | 'typecheck'

export interface VerificationResult {
  at: number
  passed: boolean
  command: string
  errors: string | null
}

export interface VerificationMatch {
  type: VerificationType
  scopeId: string
}

const TEST_PATTERNS = [
  /\b(?:npm|bun|pnpm|yarn)\s+(?:run\s+)?test\b/,
  /\b(?:npx|bunx)\s+(?:vitest|jest)\b/,
  /\bbun\s+test\b/,
  /\bpytest\b/,
  /\bcargo\s+test\b/,
  /\bgo\s+test\b/,
  /\bmix\s+test\b/,
  /\bdeno\s+test\b/,
  /\bmake\s+test\b/,
]

const LINT_PATTERNS = [
  /\b(?:npm|bun|pnpm|yarn)\s+run\s+lint\b/,
  /\b(?:npx|bunx)\s+eslint\b/,
  /\b(?:npx|bunx)\s+@biomejs\/biome\s+(?:check|lint)\b/,
  /\bruff\s+check\b/,
  /\bcargo\s+clippy\b/,
  /\bgo\s+vet\b/,
  /\bmix\s+credo\b/,
  /\bdeno\s+lint\b/,
  /\bmake\s+lint\b/,
]

const TYPECHECK_PATTERNS = [
  /\b(?:npm|bun|pnpm|yarn)\s+run\s+(?:typecheck|type-check)\b/,
  /\b(?:npx|bunx)\s+tsc\s+--noEmit\b/,
  /\bmypy\b/,
  /\bpyright\b/,
]

export function detectVerificationCommand(
  command: string,
  cwd: string,
  harness: HookHarness,
): VerificationMatch | null {
  const commands = readProjectCommands(cwd, harness)
  if (commands) {
    const bashCwd = resolveCommandCwd(command, cwd)
    const match = matchBashCommand(command, bashCwd, commands)
    if (match)
      return match
  }

  for (const p of TEST_PATTERNS) {
    if (p.test(command))
      return { type: 'test', scopeId: 'unknown' }
  }
  for (const p of LINT_PATTERNS) {
    if (p.test(command))
      return { type: 'lint', scopeId: 'unknown' }
  }
  for (const p of TYPECHECK_PATTERNS) {
    if (p.test(command))
      return { type: 'typecheck', scopeId: 'unknown' }
  }

  return null
}

export function extractVerificationOutcome(toolResponse: unknown): { passed: boolean, errors: string | null } {
  const exitCode = extractExitCode(toolResponse)
  return {
    passed: exitCode === 0,
    errors: exitCode === 0 ? null : extractErrors(toolResponse),
  }
}

function extractExitCode(toolResponse: unknown): number {
  if (typeof toolResponse === 'string') {
    const match = /Exit code: (\d+)/.exec(toolResponse)
    if (match)
      return Number.parseInt(match[1]!, 10)
    return 0
  }

  if (typeof toolResponse === 'object' && toolResponse !== null) {
    const resp = toolResponse as Record<string, unknown>
    if (typeof resp.exitCode === 'number')
      return resp.exitCode
    if (typeof resp.exit_code === 'number')
      return resp.exit_code
    if (typeof resp.code === 'number')
      return resp.code
  }

  return 0
}

function extractErrors(toolResponse: unknown): string | null {
  if (typeof toolResponse !== 'string')
    return null
  return toolResponse.length > 2000 ? toolResponse.slice(-2000) : toolResponse
}

