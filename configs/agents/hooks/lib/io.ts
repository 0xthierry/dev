/**
 * Shared I/O utilities for hooks — platform-agnostic (Claude Code + Codex).
 *
 * Both platforms send JSON on stdin with compatible fields:
 *   hook_event_name, tool_name, tool_input, cwd, session_id
 *
 * Both platforms accept:
 *   exit 0 = allow (stdout is context)
 *   exit 2 = block (stderr is reason)
 *   JSON with hookSpecificOutput.additionalContext = inject context
 */

import { appendFileSync, mkdirSync } from 'node:fs'

export interface HookInput {
  hook_event_name: string
  tool_name: string
  tool_input: Record<string, unknown>
  cwd: string
  session_id?: string
  transcript_path?: string
  model?: string
  permission_mode?: string
  // Codex-specific
  tool_use_id?: string
  tool_response?: unknown
  prompt?: string
  message?: string
  source?: string
  // Stop hook
  stop_hook_active?: boolean
  last_assistant_message?: string
}

export async function readStdin(): Promise<HookInput> {
  const chunks: string[] = []
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk).toString())
  }
  return JSON.parse(chunks.join(''))
}

/**
 * Block tool execution. Works on both Claude Code (exit 2) and Codex (exit 2 + stderr).
 */
export function block(reason: string): never {
  process.stderr.write(reason)
  process.exit(2)
}

/**
 * Inject context visible to the model. Works on both platforms via additionalContext.
 */
export function injectContext(eventName: string, context: string): void {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: context,
    },
  }))
}

/**
 * Warn: inject a warning as additional context (does not block).
 */
export function warn(eventName: string, message: string): void {
  injectContext(eventName, `\u26A0 ${message}`)
}

/**
 * Modify tool input before execution. Only works in PreToolUse hooks.
 * Optionally inject context explaining the modification.
 */
export function modifyInput(updates: Record<string, unknown>, context?: string): void {
  const output: Record<string, unknown> = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: updates,
    },
  }
  if (context) {
    (output.hookSpecificOutput as Record<string, unknown>).additionalContext = context
  }
  console.log(JSON.stringify(output))
}

const LOG_PATH = `${process.env.HOME}/.agents/hooks/.logs/hooks.jsonl`

/**
 * Append a JSONL log entry. Fire-and-forget — never throws.
 */
export function log(input: HookInput, hook: string, outcome: string, detail?: string): void {
  try {
    mkdirSync(`${process.env.HOME}/.agents/hooks/.logs`, { recursive: true })
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      session: input.session_id ?? 'unknown',
      event: input.hook_event_name,
      tool: input.tool_name,
      hook,
      outcome,
      ...(detail ? { detail } : {}),
    })
    appendFileSync(LOG_PATH, `${entry}\n`)
  }
  catch {}
}

/**
 * Extract file_path from tool_input (works for Write, Edit, MultiEdit, Read).
 */
export function getFilePath(toolInput: Record<string, unknown>): string {
  return String(toolInput.file_path ?? '')
}

/**
 * Extract command from Bash tool_input.
 */
export function getCommand(toolInput: Record<string, unknown>): string {
  return String(toolInput.command ?? '').trim()
}

/**
 * Extract user prompt from UserPromptSubmit input.
 */
export function getPrompt(input: HookInput): string {
  return input.prompt || input.message || ''
}

/**
 * Check if a file path matches any of the given patterns.
 */
export function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(value))
}

/**
 * Extract the effective working directory from a bash command.
 * Handles `cd <dir> &&` and `cd <dir>;` prefixes.
 * Returns the resolved directory, or the fallback cwd if no cd is found.
 */
export function resolveCommandCwd(command: string, fallbackCwd: string): string {
  const match = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*[;&]/.exec(command)
  if (!match)
    return fallbackCwd
  const dir = (match[1] ?? match[2] ?? match[3])!.trim()
  if (dir.startsWith('/'))
    return dir
  return `${fallbackCwd}/${dir}`
}

/**
 * Detect project's current branch.
 */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    return output.trim() || null
  }
  catch {
    return null
  }
}
