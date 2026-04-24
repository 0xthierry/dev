#!/usr/bin/env bun
import { statSync } from 'node:fs'
import { log, readStdin } from '../lib/io.ts'
import { getGitStatus, listChangedFiles } from './codex-git.ts'
import { readState } from './codex-store.ts'
import { REVIEW_FILE_PATH, REVIEW_TOKEN } from './store.ts'

function changedAfter(timestamp: number, changedFiles: string[]): boolean {
  for (const file of changedFiles) {
    try {
      if (statSync(file).mtimeMs > timestamp)
        return true
    }
    catch {
      return true
    }
  }
  return false
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

  const currentStatus = await getGitStatus(input.cwd)
  const repoChanged = currentStatus !== state.baselineGitStatus
  if (!repoChanged) {
    log(input, 'verify/codex-on-stop', 'skip', 'no repo changes since session start')
    process.exit(0)
  }

  const changedFiles = await listChangedFiles(input.cwd)
  const issues: string[] = []
  const missing: string[] = []

  for (const type of ['test', 'lint', 'typecheck'] as const) {
    const verification = state.verifications[type]
    if (!verification) {
      missing.push(type)
      continue
    }
    if (!verification.passed) {
      const errorCtx = verification.errors ? `\n${verification.errors}` : ''
      issues.push(`${type} (\`${verification.command}\`) failed.${errorCtx}`)
      continue
    }
    if (changedAfter(verification.at, changedFiles)) {
      issues.push(`${type} is stale. Re-run \`${verification.command}\` after the latest file changes.`)
    }
  }

  const lastMsg = (input as unknown as Record<string, unknown>).last_assistant_message
  const lastMsgStr = typeof lastMsg === 'string' ? lastMsg : ''
  const hasToken = lastMsgStr.includes(REVIEW_TOKEN)

  if (stopHookActive) {
    if (hasToken) {
      log(input, 'verify/codex-on-stop', 'allow-token-verified')
      process.exit(0)
    }
    log(input, 'verify/codex-on-stop', 'allow-circuit-breaker')
    process.exit(0)
  }

  if (missing.length > 0) {
    issues.push(`Potentially relevant checks: ${missing.join(', ')}`)
  }

  if (issues.length > 0) {
    issues.unshift(
      'Review your latest changes and decide whether verification is materially required.',
      'Use this standard:',
      '- Run tests if behavior changed or could have changed.',
      '- Run typecheck if types, signatures, imports, or executable code changed.',
      '- Run lint if the edited files are covered by lint and the change could affect style or static rules.',
      '- If a check is unnecessary for this change, just return your response to the message.',
      '',
    )
    issues.push(
      '',
      'Before completing, run the relevant checks and report the results.',
    )
  }

  if (!hasToken) {
    issues.push(`Before completing, read the review checklist at \`${REVIEW_FILE_PATH}\` and include the review token in your final message.`)
  }

  if (issues.length > 0) {
    const msg = issues.join('\n')
    log(input, 'verify/codex-on-stop', 'block', msg.slice(0, 200))
    process.stderr.write(msg)
    process.exit(2)
  }

  log(input, 'verify/codex-on-stop', 'allow')
  process.exit(0)
}

main().catch(() => process.exit(0))
