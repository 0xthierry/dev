#!/usr/bin/env bun
import { block, getCommand, getCurrentBranch, getFilePath, log, readStdin, resolveCommandCwd, warn } from '../lib/io.ts'

const PROTECTED_BRANCHES = /^(?:main|master|production|prod)$/

// Dotfile repos that work directly on main — exempt from branch protection
const EXEMPT_PATHS = [
  /\/\.agents\/?$/,
  /\/\.claude\/?$/,
  /\/\.codex\/?$/,
  /\/dev\/?$/,
]

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[A-Za-qs-z]*r[A-Za-z]*f|--force)\b/,
  /\brm\s+-rf\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+push\s+(?:\S.*)?--force\b/,
  /\bgit\s+push\s+-f\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  /\bgit\s+checkout\s+--\s*\./,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\s+\w+\s*(?:;\s*)?$/i,
  /\b:\s*>\s*\//,
]

// Enforce declarative package lists — installs must go through install/packages/common.sh
const PACKAGE_INSTALL_PATTERNS = [
  /\bbrew\s+(?:install|reinstall)\b/,
  /\b(?:sudo\s+)?pacman\s+-S[yu]*\b/,
  /\b(?:sudo\s+)?yay\s+-S[yu]*\b/,
]

const GIT_PUSH_PATTERN = /\bgit\s+push\b/
const BRANCH_COMMIT_PATTERN = /\bgit\s+(?:commit|push|merge)\b/
const ENV_FILE_PATTERN = /\.env(?:$|\.)/
const ENV_FILE_ALLOWED = /^\.env\.(?:example|test)$/
const CONVENTIONAL_COMMIT = /^(?:feat|fix|refactor|test|chore|docs|perf|ci|build|style|revert)(?:\(.+\))?:\s.{1,72}/
const GIT_COMMIT_MSG = /\bgit\s+commit\s+(?:\S+\s+)*-m\s+["']([^"']+)["']/

const MIGRATION_DIR_PATTERNS = [
  /\/migrations?\//i,
  /\/migrate\//i,
  /\/db\/migrate\//i,
  /\/alembic\/versions\//i,
  /\/prisma\/migrations\//i,
  /\/drizzle\//i,
  /\/knex\/migrations\//i,
  /\/flyway\//i,
  /\/liquibase\//i,
]

async function main(): Promise<void> {
  let input
  try {
    input = await readStdin()
  }
  catch { process.exit(0) }
  if (input.hook_event_name !== 'PreToolUse')
    process.exit(0)

  const toolName = input.tool_name
  const toolInput = input.tool_input || {}

  if (toolName === 'Bash') {
    const command = getCommand(toolInput)

    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(command)) {
        log(input, 'guards', 'block', `destructive: ${command.slice(0, 80)}`)
        block(`Destructive command blocked: ${command.slice(0, 80)}`)
      }
    }

    for (const pattern of PACKAGE_INSTALL_PATTERNS) {
      if (pattern.test(command)) {
        log(input, 'guards', 'block', `package install: ${command.slice(0, 80)}`)
        block(`Package install blocked: ${command.slice(0, 80)}. Add to install/packages/common.sh (or host arrays) and run ./setup.sh instead.`)
      }
    }

    if (BRANCH_COMMIT_PATTERN.test(command)) {
      const effectiveCwd = resolveCommandCwd(command, input.cwd)
      const branch = await getCurrentBranch(effectiveCwd)
      const isExempt = EXEMPT_PATHS.some(p => p.test(effectiveCwd))
      if (branch && PROTECTED_BRANCHES.test(branch) && !isExempt) {
        if (GIT_PUSH_PATTERN.test(command)) {
          log(input, 'guards', 'block', `push to protected branch '${branch}'`)
          block(`Cannot push to protected branch '${branch}'`)
        }
      }
    }

    const commitMatch = GIT_COMMIT_MSG.exec(command)
    if (commitMatch) {
      const msg = commitMatch[1]!
      // Skip validation for HEREDOC/subshell messages — can't extract the actual text
      const isIndirect = /^\$\(/.test(msg)
      if (!isIndirect && !CONVENTIONAL_COMMIT.test(msg)) {
        log(input, 'guards', 'block', `bad commit msg: "${msg.slice(0, 50)}"`)
        block(`Commit message must follow conventional format: type(scope): description. Got: "${msg.slice(0, 50)}"`)
      }
    }

    const bashEdit = /\b(?:sed\s+-i|echo\s+(?:\S.*)?>|python\s+-c.*open|perl\s+-[pi])\b/
    if (bashEdit.test(command)) {
      for (const p of MIGRATION_DIR_PATTERNS) {
        if (p.test(command))
          warn('PreToolUse', `Editing migration file via Bash — verify not already applied: ${command.slice(0, 80)}`)
      }
    }
  }

  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    const filePath = getFilePath(toolInput)
    const fileName = filePath.split('/').pop() || ''
    if (ENV_FILE_PATTERN.test(fileName) && !ENV_FILE_ALLOWED.test(fileName)) {
      log(input, 'guards', 'block', `env file write: ${fileName}`)
      block(`Cannot write to env file: ${fileName}`)
    }
    for (const p of MIGRATION_DIR_PATTERNS) {
      if (p.test(filePath)) {
        log(input, 'guards', 'warn', `migration edit: ${filePath.split('/').slice(-2).join('/')}`)
        warn('PreToolUse', `Editing migration file — verify not already applied: ${filePath.split('/').slice(-2).join('/')}`)
      }
    }
  }

  if (toolName === 'Read') {
    const fileName = getFilePath(toolInput).split('/').pop() || ''
    if (ENV_FILE_PATTERN.test(fileName) && !ENV_FILE_ALLOWED.test(fileName)) {
      log(input, 'guards', 'warn', `env file read: ${fileName}`)
      warn('PreToolUse', `Reading env file: ${fileName} — do not log or expose its contents`)
    }
  }

  log(input, 'guards', 'allow')
  process.exit(0)
}

main().catch(() => process.exit(0))
