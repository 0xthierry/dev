#!/usr/bin/env bun
/**
 * Skill Matcher UserPromptSubmit Hook
 *
 * Reads user prompt from stdin, performs hybrid search,
 * and outputs skill suggestions for Claude to evaluate.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbExists } from './db.ts'
import { hybridSearch, formatResults } from './search.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOGS_DIR = join(__dirname, '..', '.logs')
const LOG_FILE = join(LOGS_DIR, 'skill-matcher.log')

interface HookInput {
  prompt?: string
  message?: string
  cwd?: string
}

// Track start time for latency measurement
const startTime = performance.now()

/**
 * Log event to file with elapsed time.
 */
function logEvent(status: string, message: string): void {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true })
  }
  const timestamp = new Date().toISOString()
  const elapsed = (performance.now() - startTime).toFixed(1)
  const entry = `${timestamp} | ${status.padEnd(7)} | ${elapsed.padStart(6)}ms | ${message}\n`
  appendFileSync(LOG_FILE, entry)
}

/**
 * Read all input from stdin.
 */
async function readStdin(): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk).toString())
  }
  return chunks.join('')
}

async function main(): Promise<void> {
  logEvent('START', 'Hook executed')

  // Check if database exists
  if (!dbExists()) {
    logEvent('SKIP', 'Database not found - run indexer first')
    process.exit(0)
  }

  // Read and parse stdin
  let input: HookInput
  try {
    const stdin = await readStdin()
    input = JSON.parse(stdin)
  } catch (error) {
    logEvent('ERROR', `Failed to parse stdin: ${error}`)
    process.exit(0) // Fail open
  }

  // Extract user prompt
  const userPrompt = input.prompt || input.message || ''
  if (!userPrompt.trim()) {
    logEvent('SKIP', 'Empty prompt')
    process.exit(0)
  }

  logEvent('SEARCH', `Query: ${userPrompt.slice(0, 50)}...`)

  // Perform hybrid search
  try {
    const results = await hybridSearch(userPrompt)

    if (results.length === 0) {
      logEvent('RESULT', 'No relevant skills found')
      process.exit(0)
    }

    logEvent('RESULT', `Found ${results.length} relevant skills`)

    // Output formatted results to stdout
    const output = formatResults(results)
    console.log(output)

    process.exit(0)
  } catch (error) {
    logEvent('ERROR', `Search failed: ${error}`)
    process.exit(0) // Fail open
  }
}

main()
