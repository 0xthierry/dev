import { join } from 'node:path'

async function readCommandOutput(argv: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(argv, {
      cwd,
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode !== 0)
      return null
    return output.trimEnd()
  }
  catch {
    return null
  }
}

export async function getGitRoot(cwd: string): Promise<string | null> {
  const output = await readCommandOutput(['git', 'rev-parse', '--show-toplevel'], cwd)
  return output && output.trim() ? output.trim() : null
}

export async function getGitStatus(cwd: string): Promise<string | null> {
  const root = await getGitRoot(cwd)
  if (!root)
    return null
  return await readCommandOutput(['git', 'status', '--porcelain', '--untracked-files=normal'], root)
}

async function listRelativePaths(root: string, argv: string[]): Promise<string[]> {
  const output = await readCommandOutput(argv, root)
  if (!output)
    return []

  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

export async function listChangedFiles(cwd: string): Promise<string[]> {
  const root = await getGitRoot(cwd)
  if (!root)
    return []

  const [unstaged, staged, untracked] = await Promise.all([
    listRelativePaths(root, ['git', 'diff', '--name-only', '--relative']),
    listRelativePaths(root, ['git', 'diff', '--cached', '--name-only', '--relative']),
    listRelativePaths(root, ['git', 'ls-files', '--others', '--exclude-standard']),
  ])

  const paths = new Set<string>()
  for (const rel of [...unstaged, ...staged, ...untracked]) {
    paths.add(join(root, rel))
  }
  return [...paths]
}
