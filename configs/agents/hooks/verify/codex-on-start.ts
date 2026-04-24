#!/usr/bin/env bun
import { log, readStdin } from '../lib/io.ts'
import { getGitStatus } from './codex-git.ts'
import { initializeState } from './codex-store.ts'

async function main(): Promise<void> {
  let input
  try {
    input = await readStdin()
  }
  catch { process.exit(0) }

  if (input.hook_event_name !== 'SessionStart')
    process.exit(0)

  const sessionId = input.session_id || 'unknown'
  const baseline = await getGitStatus(input.cwd)
  initializeState(input.cwd, sessionId, baseline)
  log(input, 'verify/codex-on-start', 'initialized', baseline === null ? 'not-git' : 'git-baseline-captured')
  process.exit(0)
}

main().catch(() => process.exit(0))
