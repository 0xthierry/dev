#!/usr/bin/env bun
import { getCommand, log, readStdin } from '../lib/io.ts'
import { recordVerification } from './codex-store.ts'
import { detectVerificationCommand, extractVerificationOutcome } from './shared.ts'

async function main(): Promise<void> {
  let input
  try {
    input = await readStdin()
  }
  catch { process.exit(0) }

  if (input.hook_event_name !== 'PostToolUse' || input.tool_name !== 'Bash')
    process.exit(0)

  const command = getCommand(input.tool_input || {})
  const result = detectVerificationCommand(command, input.cwd, 'codex')
  if (!result) {
    log(input, 'verify/codex-on-bash', 'skip', `not a verification command: ${command.slice(0, 60)}`)
    process.exit(0)
  }

  const toolResponse = (input as unknown as Record<string, unknown>).tool_response
  const { passed, errors } = extractVerificationOutcome(toolResponse)

  recordVerification(input.cwd, input.session_id || 'unknown', result.type, command, passed, errors)
  log(input, 'verify/codex-on-bash', passed ? 'pass' : 'fail', `${result.type}: ${command.slice(0, 80)}`)
  process.exit(0)
}

main().catch(() => process.exit(0))
