#!/usr/bin/env bun
/**
 * Content-hash freshness check for project-commands.json.
 *
 * Stores SHA-256 hashes of source config files in a companion .hashes file.
 * Compares current file content against stored hashes — mtime changes without
 * content changes (pnpm install, git pull) don't trigger regeneration.
 *
 * CLI usage:
 *   bun freshness.ts check <cwd>   → exits 0 if fresh, 1 if stale (prints reason)
 *   bun freshness.ts save <cwd>    → saves current hashes
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { HookHarness } from '../lib/harness.ts'
import { getProjectCommandsPath } from './reader.ts'

const CONFIG_FILES = [
  'package.json',
  'Makefile',
  'pnpm-workspace.yaml',
  'turbo.json',
  'nx.json',
  'lerna.json',
  'eslint.config.mjs',
  'eslint.config.js',
  'eslint.config.ts',
  '.eslintrc.json',
  '.eslintrc.js',
  'biome.json',
  'biome.jsonc',
  '.prettierrc',
  '.prettierrc.json',
  'tsconfig.json',
  'deno.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
]

const TOOLING_DEPS = [
  'eslint', 'prettier', 'biome', '@biomejs/biome',
  'vitest', 'jest', 'mocha', 'ava', 'tap',
  'typescript', 'tsc',
  '@typescript-eslint/eslint-plugin', '@typescript-eslint/parser',
]

function hashFile(path: string): string {
  const content = readFileSync(path)
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function hashPackageJson(path: string): string {
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf-8'))
    const relevant: Record<string, unknown> = {}

    if (pkg.scripts) relevant.scripts = pkg.scripts

    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (pkg[section] && typeof pkg[section] === 'object') {
        const found = TOOLING_DEPS.filter(d => d in pkg[section]).sort()
        if (found.length > 0) relevant[section] = found
      }
    }

    return createHash('sha256').update(JSON.stringify(relevant)).digest('hex').slice(0, 16)
  } catch {
    return hashFile(path)
  }
}

function getHashesPath(cwd: string, harness: HookHarness): string {
  const commandsPath = getProjectCommandsPath(cwd, harness)
  return commandsPath.replace(/\.json$/, '.hashes.json')
}

export function computeHashes(cwd: string): Record<string, string> {
  const hashes: Record<string, string> = {}

  for (const file of CONFIG_FILES) {
    const abs = join(cwd, file)
    if (existsSync(abs)) {
      hashes[file] = file === 'package.json' ? hashPackageJson(abs) : hashFile(abs)
    }
  }

  // Check for monorepo package.json files
  const rootPkg = join(cwd, 'package.json')
  if (existsSync(rootPkg)) {
    try {
      const pkg = JSON.parse(readFileSync(rootPkg, 'utf-8'))
      const workspaces = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : Array.isArray(pkg.workspaces?.packages)
          ? pkg.workspaces.packages
          : []

      // Also check pnpm-workspace.yaml
      let patterns = [...workspaces]
      const pnpmWs = join(cwd, 'pnpm-workspace.yaml')
      if (patterns.length === 0 && existsSync(pnpmWs)) {
        const content = readFileSync(pnpmWs, 'utf-8')
        const matches = content.match(/^\s*-\s*['"]?([^'"#\n]+)['"]?/gm)
        if (matches) {
          patterns = matches.map(m => m.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
        }
      }

      for (const pattern of patterns) {
        const base = pattern.replace(/\/?\*$/, '')
        const searchDir = join(cwd, base)
        if (!existsSync(searchDir)) continue
        try {
          if (pattern.includes('*')) {
            for (const entry of readdirSync(searchDir)) {
              const pkgPath = join(searchDir, entry, 'package.json')
              if (existsSync(pkgPath)) {
                const relPath = `${base}/${entry}/package.json`
                hashes[relPath] = hashPackageJson(pkgPath)
              }
            }
          } else if (existsSync(join(searchDir, 'package.json'))) {
            const relPath = `${base}/package.json`
            hashes[relPath] = hashPackageJson(join(searchDir, 'package.json'))
          }
        } catch {}
      }
    } catch {}
  }

  return hashes
}

function readStoredHashes(cwd: string, harness: HookHarness): Record<string, string> | null {
  const path = getHashesPath(cwd, harness)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function saveHashes(cwd: string, harness: HookHarness = 'claude'): void {
  const path = getHashesPath(cwd, harness)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(computeHashes(cwd), null, 2))
}

export interface FreshnessResult {
  fresh: boolean
  reasons: string[]
}

export function checkFreshness(cwd: string, harness: HookHarness = 'claude'): FreshnessResult {
  const commandsPath = getProjectCommandsPath(cwd, harness)
  if (!existsSync(commandsPath)) {
    return { fresh: false, reasons: ['project-commands.json does not exist'] }
  }

  const stored = readStoredHashes(cwd, harness)
  if (!stored) {
    return { fresh: false, reasons: ['no stored hashes (first run or hashes deleted)'] }
  }

  const current = computeHashes(cwd)
  const reasons: string[] = []

  for (const [file, hash] of Object.entries(current)) {
    if (!(file in stored)) {
      reasons.push(`new file: ${file}`)
    } else if (stored[file] !== hash) {
      reasons.push(`changed: ${file}`)
    }
  }

  for (const file of Object.keys(stored)) {
    if (!(file in current)) {
      reasons.push(`removed: ${file}`)
    }
  }

  return { fresh: reasons.length === 0, reasons }
}

// CLI mode
if (import.meta.main) {
  const args = process.argv.slice(2)
  const [action] = args
  let harness: HookHarness = 'claude'
  let cwd = args[1]

  if (args[1] === '--harness') {
    if (args[2] === 'claude' || args[2] === 'codex')
      harness = args[2]
    cwd = args[3]
  }

  if (!action || !cwd) {
    console.error('Usage: bun freshness.ts <check|save> [--harness claude|codex] <cwd>')
    process.exit(1)
  }

  if (action === 'check') {
    const result = checkFreshness(cwd, harness)
    if (result.fresh) {
      console.log('fresh')
    } else {
      console.log(`stale: ${result.reasons.join(', ')}`)
      process.exit(1)
    }
  } else if (action === 'save') {
    saveHashes(cwd, harness)
    console.log('hashes saved')
  } else {
    console.error(`Unknown action: ${action}. Use "check" or "save".`)
    process.exit(1)
  }
}
