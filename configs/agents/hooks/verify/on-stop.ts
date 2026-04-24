#!/usr/bin/env bun
import type { VerifyState } from './store.ts'
import { log, readStdin } from '../lib/io.ts'
import { readState, resetState, REVIEW_FILE_PATH, REVIEW_TOKEN } from './store.ts'

function buildFeedback(state: VerifyState): string | null {
  const missing: string[] = []
  const failed: string[] = []

  for (const type of ['test', 'lint', 'typecheck'] as const) {
    const v = state.verifications[type]
    if (!v) {
      missing.push(type)
    }
    else if (!v.passed) {
      const errorCtx = v.errors ? `:\n${v.errors}` : ''
      failed.push(`${type} (\`${v.command}\`) failed${errorCtx}`)
    }
  }

  if (missing.length === 0 && failed.length === 0)
    return null

  const details: string[] = []
  details.push(`Edited: ${state.editedFiles.join(', ')}`)

  for (const f of failed)
    details.push(`  ✘ ${f}`)

  if (missing.length > 0)
    details.push(`  Potentially relevant checks: ${missing.join(', ')}`)

  return [
    'Review your latest changes and decide whether verification is materially required.',
    'Use this standard:',
    '- Run tests if behavior changed or could have changed.',
    '- Run typecheck if types, signatures, imports, or executable code changed.',
    '- Run lint if the edited files are covered by lint and the change could affect style or static rules.',
    '- If a check is unnecessary for this change, just return your response to the message.',
    '',
    ...details,
    '',
    'Before completing, run the relevant checks and report the results.',
  ].join('\n')
}

async function main(): Promise<void> {
  let input
  try {
    input = await readStdin()
  }
  catch { process.exit(0) }
  if (input.hook_event_name !== 'Stop')
    process.exit(0)

  const stopHookActive = !!(input as unknown as Record<string, unknown>).stop_hook_active

  const sessionId = input.session_id || 'unknown'
  const state = readState(input.cwd, sessionId)

  if (state.editedFiles.length === 0)
    process.exit(0)

  const lastMsg = (input as unknown as Record<string, unknown>).last_assistant_message
  const lastMsgStr = typeof lastMsg === 'string' ? lastMsg : ''
  const hasToken = lastMsgStr.includes(REVIEW_TOKEN)

  // Second attempt — only check token, skip verifications
  if (stopHookActive) {
    if (hasToken) {
      resetState(input.cwd, sessionId)
      log(input, 'verify/on-stop', 'allow-token-verified')
      process.exit(0)
    }
    // Circuit breaker — let it go
    resetState(input.cwd, sessionId)
    log(input, 'verify/on-stop', 'allow-circuit-breaker')
    process.exit(0)
  }

  // First attempt — combine verifications + review token in one message
  const parts: string[] = []

  const feedback = buildFeedback(state)
  if (feedback) {
    parts.push(feedback)
  }

  if (!hasToken) {
    parts.push(`\nBefore completing, read the review checklist at \`${REVIEW_FILE_PATH}\` and include the review token in your final message.`)
  }

  if (parts.length > 0) {
    const msg = parts.join('\n')
    log(input, 'verify/on-stop', 'block', msg.slice(0, 200))
    process.stderr.write(msg)
    process.exit(2)
  }

  resetState(input.cwd, sessionId)
  log(input, 'verify/on-stop', 'allow')
  process.exit(0)
}

main().catch(() => process.exit(0))
