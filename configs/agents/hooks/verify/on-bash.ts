#!/usr/bin/env bun
import { getCommand, log, readStdin } from '../lib/io.ts'
import { detectVerificationCommand, extractVerificationOutcome } from './shared.ts'
import { getEditedScopes, recordVerification } from './store.ts'

async function main(): Promise<void> {
  let input
  try {
    input = await readStdin()
  }
  catch { process.exit(0) }
  if (input.hook_event_name !== 'PostToolUse')
    process.exit(0)
  if (input.tool_name !== 'Bash')
    process.exit(0)

  const command = getCommand(input.tool_input || {})
  const sessionId = input.session_id || 'unknown'
  const result = detectVerificationCommand(command, input.cwd, 'claude')
  if (!result) {
    log(input, 'verify/on-bash', 'skip', `not a verification command: ${command.slice(0, 60)}`)
    process.exit(0)
  }

  const { type, scopeId } = result
  const editedScopes = getEditedScopes(input.cwd, sessionId)

  if (editedScopes.length === 0) {
    log(input, 'verify/on-bash', 'skip', 'no edited files')
    process.exit(0)
  }

  const toolResponse = (input as unknown as Record<string, unknown>).tool_response
  const { passed, errors } = extractVerificationOutcome(toolResponse)

  recordVerification(input.cwd, sessionId, type, scopeId, command, passed, errors)
  log(input, 'verify/on-bash', passed ? 'pass' : 'fail', `${type}[${scopeId}]: ${command.slice(0, 80)}`)
  process.exit(0)
}

main().catch(() => process.exit(0))
