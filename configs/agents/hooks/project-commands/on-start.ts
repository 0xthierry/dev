#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { detectHookHarness } from '../lib/harness.ts'
import { readStdin, injectContext, log } from '../lib/io.ts'
import { getProjectCommandsPath } from './reader.ts'
import { checkFreshness } from './freshness.ts'

interface WorkspacePackage {
  path: string
  name: string
  scripts: string[]
  deps: string[]
}

interface ProjectInfo {
  root: string
  monorepo: boolean
  rootFiles: string[]
  rootScripts: string[]
  rootDeps: string[]
  packages: WorkspacePackage[]
}

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
  '.eslintrc.yml',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
  'prettier.config.mjs',
  'biome.json',
  'biome.jsonc',
  'tsconfig.json',
  'jsconfig.json',
  'deno.json',
  'deno.jsonc',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
]

const TOOLING_DEPS = [
  'eslint', 'prettier', 'biome', '@biomejs/biome',
  'vitest', 'jest', 'mocha', 'ava', 'tap',
  'typescript', 'tsc',
  '@typescript-eslint/eslint-plugin', '@typescript-eslint/parser',
]

function fileExists(dir: string, name: string): boolean {
  return existsSync(join(dir, name))
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function extractScripts(pkg: Record<string, unknown>): string[] {
  const scripts = pkg.scripts as Record<string, string> | undefined
  if (!scripts || typeof scripts !== 'object') return []
  return Object.keys(scripts)
}

function extractToolingDeps(pkg: Record<string, unknown>): string[] {
  const found: string[] = []
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[section] as Record<string, string> | undefined
    if (!deps || typeof deps !== 'object') continue
    for (const dep of TOOLING_DEPS) {
      if (dep in deps && !found.includes(dep)) found.push(dep)
    }
  }
  return found
}

function findWorkspacePackageDirs(root: string, pkg: Record<string, unknown>): string[] {
  const workspaces = pkg.workspaces as string[] | { packages?: string[] } | undefined
  let patterns: string[] = []

  if (Array.isArray(workspaces)) {
    patterns = workspaces
  } else if (workspaces && Array.isArray(workspaces.packages)) {
    patterns = workspaces.packages
  }

  // Also check pnpm-workspace.yaml
  if (patterns.length === 0) {
    const pnpmWs = readText(join(root, 'pnpm-workspace.yaml'))
    if (pnpmWs) {
      const matches = pnpmWs.match(/^\s*-\s*['"]?([^'"#\n]+)['"]?/gm)
      if (matches) {
        patterns = matches.map(m => m.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
      }
    }
  }

  if (patterns.length === 0) return []

  const dirs: string[] = []
  for (const pattern of patterns) {
    const base = pattern.replace(/\/?\*$/, '')
    const searchDir = join(root, base)
    if (!existsSync(searchDir) || !statSync(searchDir).isDirectory()) continue

    if (!pattern.includes('*')) {
      if (fileExists(searchDir, 'package.json')) dirs.push(searchDir)
      continue
    }

    try {
      for (const entry of readdirSync(searchDir)) {
        const full = join(searchDir, entry)
        if (statSync(full).isDirectory() && fileExists(full, 'package.json')) {
          dirs.push(full)
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  return dirs
}

function scanProject(root: string): ProjectInfo {
  const foundFiles = CONFIG_FILES.filter(f => fileExists(root, f))
  const rootPkg = readJson(join(root, 'package.json'))

  const rootScripts = rootPkg ? extractScripts(rootPkg) : []
  const rootDeps = rootPkg ? extractToolingDeps(rootPkg) : []

  const packageDirs = rootPkg ? findWorkspacePackageDirs(root, rootPkg) : []
  const packages: WorkspacePackage[] = []

  for (const dir of packageDirs) {
    const pkg = readJson(join(dir, 'package.json'))
    if (!pkg) continue
    const name = (pkg.name as string) || basename(dir)
    packages.push({
      path: relative(root, dir),
      name,
      scripts: extractScripts(pkg),
      deps: extractToolingDeps(pkg),
    })
  }

  return {
    root,
    monorepo: packages.length > 0,
    rootFiles: foundFiles,
    rootScripts,
    rootDeps,
    packages,
  }
}

function formatProjectSummary(info: ProjectInfo): string {
  const lines: string[] = []
  lines.push(`Project root: ${info.root}`)
  lines.push(`Config files: ${info.rootFiles.join(', ')}`)

  if (info.rootScripts.length > 0)
    lines.push(`Root scripts: ${info.rootScripts.join(', ')}`)
  if (info.rootDeps.length > 0)
    lines.push(`Root tooling deps: ${info.rootDeps.join(', ')}`)

  if (info.monorepo) {
    lines.push(`Monorepo: yes (${info.packages.length} packages)`)
    for (const pkg of info.packages) {
      let line = `  ${pkg.path} (${pkg.name})`
      if (pkg.scripts.length > 0) line += ` scripts: ${pkg.scripts.join(', ')}`
      if (pkg.deps.length > 0) line += ` deps: ${pkg.deps.join(', ')}`
      lines.push(line)
    }
  } else {
    lines.push('Monorepo: no')
  }

  return lines.join('\n')
}

function loadPromptTemplate(): string {
  const promptPath = join(dirname(new URL(import.meta.url).pathname), 'prompt.md')
  return readFileSync(promptPath, 'utf-8')
}

// Freshness is handled by content hashes in freshness.ts

async function main(): Promise<void> {
  const input = await readStdin()
  const cwd = input.cwd
  const harness = detectHookHarness(input)

  if (!cwd) {
    process.exit(0)
  }

  const { fresh, reasons } = checkFreshness(cwd, harness)
  if (fresh) {
    log(input, 'on-start', 'skip', 'project-commands.json is fresh')
    process.exit(0)
  }

  const targetPath = getProjectCommandsPath(cwd, harness)

  const info = scanProject(cwd)

  if (info.rootFiles.length === 0) {
    log(input, 'on-start', 'skip', 'no config files found')
    process.exit(0)
  }

  const summary = formatProjectSummary(info)
  const promptTemplate = loadPromptTemplate()
  const sourceFilesHint = info.rootFiles
    .filter(f => ['package.json', 'Makefile', 'tsconfig.json'].includes(f) || f.includes('eslint') || f.includes('prettier') || f.includes('biome'))
    .map(f => join(cwd, f))

  if (info.monorepo) {
    for (const pkg of info.packages) {
      sourceFilesHint.push(join(cwd, pkg.path, 'package.json'))
    }
  }

  const freshnessScript = join(dirname(new URL(import.meta.url).pathname), 'freshness.ts')

  const context = [
    promptTemplate,
    '',
    '## Detected Project Structure',
    '',
    summary,
    '',
    `## Target Path`,
    '',
    `Write the file to: ${targetPath}`,
    '',
    `## After Writing`,
    '',
    `Run this command to save the content hashes: \`bun ${freshnessScript} save --harness ${harness} ${cwd}\``,
    '',
    `## Source Files to Reference`,
    '',
    `Read these files for accurate command details:`,
    ...sourceFilesHint.map(f => `- ${f}`),
  ].join('\n')

  injectContext('SessionStart', context)
  log(input, 'on-start', 'injected', `${reasons.join(', ')} | ${info.rootFiles.length} configs, ${info.packages.length} packages`)
}

main()
