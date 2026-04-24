import { resolve } from 'node:path'
import picomatch from 'picomatch'
import { resolveCommandCwd } from '../lib/io.ts'

export interface Command {
  argv: string[]
  mode: 'file' | 'project'
  extensions?: string[]
}

export interface Scope {
  id: string
  pattern: string
  cwd: string
  test: Command[]
  lint: Command[]
  typecheck: Command[]
  format: Command[]
  testFilePatterns?: string[] // globs for test files, e.g. ["**/*.test.ts", "**/__tests__/**"]
  sourceExtensions?: string[] // source extensions this scope cares about, e.g. ["ts", "tsx"]
}

export interface ProjectCommands {
  schemaVersion: number
  projectRoot: string
  sourceFiles: string[]
  scopes: Scope[]
}

const COMMAND_TYPES = ['test', 'lint', 'typecheck', 'format'] as const

function isCommand(v: unknown): v is Command {
  if (typeof v !== 'object' || v === null)
    return false
  const obj = v as Record<string, unknown>
  if (!Array.isArray(obj.argv) || obj.argv.length === 0)
    return false
  if (!obj.argv.every((a: unknown) => typeof a === 'string'))
    return false
  if (obj.mode !== 'file' && obj.mode !== 'project')
    return false
  if (obj.extensions !== undefined) {
    if (!Array.isArray(obj.extensions))
      return false
    if (!obj.extensions.every((e: unknown) => typeof e === 'string'))
      return false
  }
  return true
}

function isScope(v: unknown): v is Scope {
  if (typeof v !== 'object' || v === null)
    return false
  const obj = v as Record<string, unknown>
  if (typeof obj.id !== 'string' || obj.id === '')
    return false
  if (typeof obj.pattern !== 'string')
    return false
  if (typeof obj.cwd !== 'string')
    return false
  for (const type of COMMAND_TYPES) {
    if (!Array.isArray(obj[type]))
      return false
    if (!(obj[type] as unknown[]).every(isCommand))
      return false
  }
  if (obj.testFilePatterns !== undefined) {
    if (!Array.isArray(obj.testFilePatterns))
      return false
    if (!obj.testFilePatterns.every((p: unknown) => typeof p === 'string'))
      return false
  }
  if (obj.sourceExtensions !== undefined) {
    if (!Array.isArray(obj.sourceExtensions))
      return false
    if (!obj.sourceExtensions.every((e: unknown) => typeof e === 'string'))
      return false
  }
  return true
}

export function parseProjectCommands(raw: unknown): ProjectCommands | null {
  if (typeof raw !== 'object' || raw === null)
    return null
  const obj = raw as Record<string, unknown>
  if (obj.schemaVersion !== 1)
    return null
  if (typeof obj.projectRoot !== 'string')
    return null
  if (!Array.isArray(obj.sourceFiles))
    return null
  if (!Array.isArray(obj.scopes))
    return null
  if (!obj.scopes.every(isScope))
    return null
  return obj as unknown as ProjectCommands
}

export function findScope(commands: ProjectCommands, absoluteFilePath: string): Scope | null {
  const root = commands.projectRoot.endsWith('/')
    ? commands.projectRoot
    : `${commands.projectRoot}/`
  const relative = absoluteFilePath.startsWith(root)
    ? absoluteFilePath.slice(root.length)
    : absoluteFilePath
  // Normalize to POSIX (no leading slash, forward slashes)
  const posix = relative.replace(/\\/g, '/')

  for (const scope of commands.scopes) {
    const isMatch = picomatch(scope.pattern)
    if (isMatch(posix))
      return scope
  }
  return null
}

const DEFAULT_TEST_PATTERNS = ['**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/__tests__/**']
const DEFAULT_SOURCE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'rb', 'ex', 'exs', 'c', 'cpp', 'h', 'hpp', 'swift', 'kt']

export function isTestFile(scope: Scope | null, repoRelativePath: string): boolean {
  const posix = repoRelativePath.replace(/\\/g, '/')
  const patterns = scope?.testFilePatterns ?? DEFAULT_TEST_PATTERNS
  return patterns.some(p => picomatch(p)(posix))
}

export function isSourceFile(scope: Scope | null, filePath: string): boolean {
  const ext = filePath.match(/\.([^.]+)$/)?.pop()
  if (!ext)
    return false
  const extensions = scope?.sourceExtensions ?? DEFAULT_SOURCE_EXTENSIONS
  return extensions.includes(ext)
}

export function buildCommandArgs(cmd: Command, filePath?: string): string[] {
  if (cmd.mode === 'file' && filePath) {
    return [...cmd.argv, filePath]
  }
  return [...cmd.argv]
}

export function allCommandPrefixes(
  commands: ProjectCommands,
  type: 'test' | 'lint' | 'typecheck',
): string[] {
  const seen = new Set<string>()
  for (const scope of commands.scopes) {
    for (const cmd of scope[type]) {
      seen.add(cmd.argv.join(' '))
    }
  }
  return [...seen]
}

export function matchBashCommand(
  bashCommand: string,
  bashCwd: string,
  commands: ProjectCommands,
): { type: 'test' | 'lint' | 'typecheck', scopeId: string } | null {
  const effectiveCwd = resolveCommandCwd(bashCommand, bashCwd)
  const types = ['test', 'lint', 'typecheck'] as const

  for (const scope of commands.scopes) {
    const scopeCwd = resolve(commands.projectRoot, scope.cwd)
    if (effectiveCwd !== scopeCwd)
      continue

    for (const type of types) {
      for (const cmd of scope[type]) {
        const prefix = cmd.argv.join(' ')
        // Strip the cd prefix to get the actual command being run
        const stripped = bashCommand.replace(/^\s*cd\s+(?:"[^"]+"|'[^']+'|\S+)\s*(?:&&|;)\s*/, '')
        if (stripped.startsWith(prefix)) {
          return { type, scopeId: scope.id }
        }
      }
    }
  }
  return null
}
