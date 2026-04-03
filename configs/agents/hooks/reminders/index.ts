#!/usr/bin/env bun
import { readStdin, injectContext, getFilePath, log } from '../lib/io.ts'
import { dirname, resolve } from 'node:path'

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|py|rs|go|java|rb|ex|exs|c|cpp|h|hpp|swift|kt)$/

const PROJECT_MARKERS = [
  'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml',
  'deno.json', 'deno.jsonc', 'Makefile', 'mix.exs', 'build.gradle',
  'pom.xml', 'CMakeLists.txt', 'Package.swift',
]

const WORKSPACE_MARKERS = [
  'pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json',
]

interface ProjectRoots {
  packageRoot: string
  workspaceRoot: string | null
}

async function findProjectRoots(filePath: string, cwd: string): Promise<ProjectRoots> {
  let dir = dirname(filePath)
  const root = resolve('/')
  let packageRoot: string | null = null

  while (dir !== root) {
    // First project marker we hit is the package root
    if (!packageRoot) {
      for (const marker of PROJECT_MARKERS) {
        try { if (await Bun.file(`${dir}/${marker}`).exists()) { packageRoot = dir; break } } catch {}
      }
    }

    // Keep walking up to find a workspace root
    if (packageRoot) {
      for (const marker of WORKSPACE_MARKERS) {
        try { if (await Bun.file(`${dir}/${marker}`).exists()) return { packageRoot, workspaceRoot: dir } } catch {}
      }
      // package.json with "workspaces" field
      try {
        const pkgFile = Bun.file(`${dir}/package.json`)
        if (await pkgFile.exists()) {
          const pkg = await pkgFile.json()
          if (pkg.workspaces) return { packageRoot, workspaceRoot: dir }
        }
      } catch {}
    }

    dir = dirname(dir)
  }

  return { packageRoot: packageRoot || cwd, workspaceRoot: null }
}

async function fileExists(path: string): Promise<boolean> {
  try { return await Bun.file(path).exists() } catch { return false }
}

interface DetectedTools {
  testCmds: string[]
  lintCmds: string[]
}

async function detectTools(projectRoot: string): Promise<DetectedTools> {
  const result: DetectedTools = { testCmds: [], lintCmds: [] }

  // --- Node / Bun projects ---
  try {
    const pkgFile = Bun.file(`${projectRoot}/package.json`)
    if (await pkgFile.exists()) {
      const pkg = await pkgFile.json()
      const scripts = pkg.scripts || {}
      const deps = { ...pkg.devDependencies, ...pkg.dependencies }
      const isBun = deps?.['bun-types'] || deps?.['bun']
      const prefix = isBun ? 'bun' : 'npm'
      const scriptNames = Object.keys(scripts)

      // Test commands — collect all matching scripts
      for (const name of scriptNames) {
        if (name === 'test' || name === 'vitest' || name === 'jest' || /^test[:\-_]/.test(name))
          result.testCmds.push(`${prefix} run ${name}`)
      }

      // Lint/typecheck commands — collect all matching scripts
      for (const name of scriptNames) {
        if (/^(?:lint|typecheck|type-check|check|verify)(?:$|[:\-_])/.test(name))
          result.lintCmds.push(`${prefix} run ${name}`)
      }

      // Fallback: detect tools from config files when no scripts matched
      if (result.testCmds.length === 0) {
        const runner = prefix === 'bun' ? 'bunx' : 'npx'
        if (deps?.vitest || await fileExists(`${projectRoot}/vitest.config.ts`) || await fileExists(`${projectRoot}/vitest.config.js`))
          result.testCmds.push(`${runner} vitest run`)
        else if (deps?.jest || await fileExists(`${projectRoot}/jest.config.ts`) || await fileExists(`${projectRoot}/jest.config.js`))
          result.testCmds.push(`${runner} jest`)
        else if (isBun)
          result.testCmds.push('bun test')
      }

      if (result.lintCmds.length === 0) {
        const runner = prefix === 'bun' ? 'bunx' : 'npx'
        if (await fileExists(`${projectRoot}/biome.json`) || await fileExists(`${projectRoot}/biome.jsonc`))
          result.lintCmds.push(`${runner} @biomejs/biome check .`)
        else if (deps?.eslint || await fileExists(`${projectRoot}/eslint.config.js`) || await fileExists(`${projectRoot}/eslint.config.ts`) || await fileExists(`${projectRoot}/.eslintrc.json`) || await fileExists(`${projectRoot}/.eslintrc.js`))
          result.lintCmds.push(`${runner} eslint .`)
        else if (await fileExists(`${projectRoot}/tsconfig.json`))
          result.lintCmds.push(`${runner} tsc --noEmit`)
      }
    }
  } catch {}

  // --- Makefile ---
  if (result.testCmds.length === 0 || result.lintCmds.length === 0) {
    try {
      const makefile = Bun.file(`${projectRoot}/Makefile`)
      if (await makefile.exists()) {
        const content = await makefile.text()
        if (result.testCmds.length === 0 && /^test:/m.test(content)) result.testCmds.push('make test')
        if (result.lintCmds.length === 0 && /^lint:/m.test(content)) result.lintCmds.push('make lint')
        if (result.lintCmds.length === 0 && /^check:/m.test(content)) result.lintCmds.push('make check')
      }
    } catch {}
  }

  // --- Language-specific ---
  if (result.testCmds.length === 0 || result.lintCmds.length === 0) {
    for (const [file, test, lint] of [
      ['pyproject.toml', 'pytest', 'ruff check .'],
      ['Cargo.toml', 'cargo test', 'cargo clippy'],
      ['go.mod', 'go test ./...', 'go vet ./...'],
      ['deno.json', 'deno test', 'deno lint'],
      ['deno.jsonc', 'deno test', 'deno lint'],
      ['mix.exs', 'mix test', 'mix credo'],
    ] as const) {
      try {
        if (await Bun.file(`${projectRoot}/${file}`).exists()) {
          if (result.testCmds.length === 0) result.testCmds.push(test)
          if (result.lintCmds.length === 0) result.lintCmds.push(lint)
          break
        }
      } catch {}
    }
  }

  return result
}

async function main(): Promise<void> {
  let input
  try { input = await readStdin() } catch { process.exit(0) }
  if (input.hook_event_name !== 'PostToolUse') process.exit(0)
  if (input.tool_name !== 'Write' && input.tool_name !== 'Edit' && input.tool_name !== 'MultiEdit') process.exit(0)

  const filePath = getFilePath(input.tool_input || {})
  if (!SOURCE_EXTENSIONS.test(filePath)) process.exit(0)
  if (/\.(test|spec|_test)\./i.test(filePath) || /\/__tests__\//i.test(filePath)) process.exit(0)

  const { packageRoot, workspaceRoot } = await findProjectRoots(filePath, input.cwd)
  const tools = await detectTools(packageRoot)

  // In monorepos, fill gaps from workspace root (lint/typecheck often lives there)
  if (workspaceRoot && workspaceRoot !== packageRoot) {
    const wsTools = await detectTools(workspaceRoot)
    if (tools.testCmds.length === 0) tools.testCmds = wsTools.testCmds
    if (tools.lintCmds.length === 0) tools.lintCmds = wsTools.lintCmds
  }

  if (tools.testCmds.length === 0 && tools.lintCmds.length === 0) {
    log(input, 'reminders', 'generic', filePath)
    injectContext('PostToolUse', 'Source file modified. Identify and run the project test suite and linter before considering this change complete.')
  } else {
    const parts = ['Source file modified.']
    if (tools.testCmds.length > 0) parts.push(`Run tests: ${tools.testCmds.map(c => `\`${c}\``).join(', ')}`)
    if (tools.lintCmds.length > 0) parts.push(`Run lint: ${tools.lintCmds.map(c => `\`${c}\``).join(', ')}`)
    log(input, 'reminders', 'detected', `test=${tools.testCmds.length} lint=${tools.lintCmds.length}`)
    injectContext('PostToolUse', parts.join(' '))
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
