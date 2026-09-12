import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Protocol } from 'devtools-protocol'
import { z } from 'zod'
import { DiagnosticsError, safeUrl } from './cdp'
import { acquireNamedLock } from './command-lock'
import { diagnosticsStateRoot } from './paths'

const measurementSchema = z.object({
  jsHeapBytes: z.number().finite(),
  domNodes: z.number().finite(),
  eventListeners: z.number().finite(),
  taskSeconds: z.number().finite(),
  scriptSeconds: z.number().finite(),
  timestamp: z.number().finite(),
})
const captureManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string(),
    kind: z.enum(['cpu', 'network', 'coverage', 'heap']),
    scenario: z.string(),
    build: z.string().nullable(),
    target: z.object({ id: z.string(), url: z.string(), urlHash: z.string() }),
    browser: z.object({ product: z.string(), revision: z.string(), userAgent: z.string() }),
    viewport: z.object({
      width: z.number().finite(),
      height: z.number().finite(),
      deviceScaleFactor: z.number().finite(),
      visibility: z.string(),
    }),
    settings: z.object({
      durationMs: z.number().finite(),
      reload: z.boolean(),
      disableCache: z.boolean(),
      collectGarbage: z.boolean(),
    }),
    startedAt: z.string(),
    before: measurementSchema.nullable(),
    after: measurementSchema.nullable(),
    artifact: z.string(),
    completion: z.discriminatedUnion('status', [
      z.object({ status: z.literal('recording') }),
      z.object({ status: z.literal('complete'), finishedAt: z.string() }),
      z.object({ status: z.literal('incomplete'), finishedAt: z.string(), reason: z.string() }),
    ]),
  })
  .refine(
    (manifest) => manifest.completion.status !== 'complete' || (manifest.before !== null && manifest.after !== null),
    {
      message: 'Complete captures require initial and final measurements',
    },
  )
  .refine(
    (manifest) =>
      manifest.artifact ===
      `capture.${manifest.kind === 'cpu' ? 'cpuprofile' : manifest.kind === 'heap' ? 'heapsnapshot' : 'jsonl'}`,
    { message: 'Capture artifact name does not match its kind' },
  )

export type CaptureManifest = z.infer<typeof captureManifestSchema>
export type CaptureKind = CaptureManifest['kind']
export type CaptureSettings = CaptureManifest['settings']
export type Measurement = z.infer<typeof measurementSchema>

export function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
    throw new DiagnosticsError('Diagnostics directory must be owned by the current user with mode 0700')
  }
}

export function artifactRoot(): string {
  return diagnosticsStateRoot()
}

export function createRun(): { path: string; runId: string } {
  const runId = randomUUID()
  const path = join(artifactRoot(), runId)
  mkdirSync(path, { mode: 0o700 })
  return { path, runId }
}

export function lockRecorder(): () => void {
  return acquireNamedLock({
    directory: artifactRoot(),
    name: 'recorder.lock',
    activeMessage: 'A diagnostics recorder is active; do not overlap captures',
  })
}

export function writeManifest({ path, manifest }: { path: string; manifest: CaptureManifest }): void {
  const temporary = join(path, `manifest-${randomUUID()}.tmp`)
  writeFileSync(temporary, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' })
  renameSync(temporary, join(path, 'manifest.json'))
}

export function openArtifact({ path, filename }: { path: string; filename: string }): {
  write: (chunk: string) => void
  close: () => void
} {
  const fd = openSync(join(path, filename), 'wx', 0o600)
  let bytes = 0
  let closed = false
  return {
    write(chunk) {
      const buffer = Buffer.from(chunk)
      bytes += buffer.byteLength
      // Bound one recording, not the workload filesystem. Never label an evicted/truncated capture complete.
      if (bytes > 512 * 1024 * 1024) {
        throw new DiagnosticsError('Recording exceeds 512 MiB; narrow the scenario')
      }
      let offset = 0
      while (offset < buffer.length) {
        offset += writeSync(fd, buffer, offset, buffer.length - offset)
      }
    },
    close() {
      if (!closed) {
        closeSync(fd)
        closed = true
      }
    },
  }
}

export function readRun(path: string): CaptureManifest {
  if (
    dirname(resolve(path)) !== artifactRoot() ||
    basename(path) === 'recorder.lock' ||
    basename(path) === 'mcp-client'
  ) {
    throw new DiagnosticsError('Run must be a direct child of the private diagnostics directory')
  }
  privateDirectory(path)
  const fd = openSync(join(path, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o077) !== 0) {
      throw new DiagnosticsError('Invalid private run manifest')
    }
    const manifest = parseManifest(JSON.parse(readFileSync(fd, 'utf8')))
    if (manifest.runId !== basename(path))
      throw new DiagnosticsError('Run directory does not match its manifest identity')
    return manifest
  } finally {
    closeSync(fd)
  }
}

export function readCaptureArtifact({ path, manifest }: { path: string; manifest: CaptureManifest }): string {
  const artifactPath = join(path, manifest.artifact)
  const fd = openSync(artifactPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024 || (stat.mode & 0o077) !== 0) {
      throw new DiagnosticsError('Invalid private capture artifact')
    }
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

export function parseManifest(value: unknown): CaptureManifest {
  const result = captureManifestSchema.safeParse(value)
  if (!result.success) {
    throw new DiagnosticsError('Invalid diagnostic artifact manifest')
  }
  return result.data
}

export function compareRuns({ before, after }: { before: CaptureManifest; after: CaptureManifest }) {
  if (
    before.completion.status !== 'complete' ||
    after.completion.status !== 'complete' ||
    !before.after ||
    !after.after
  ) {
    throw new DiagnosticsError('Only complete captures with final measurements can be compared')
  }
  if (
    before.kind !== after.kind ||
    before.scenario !== after.scenario ||
    before.target.urlHash !== after.target.urlHash ||
    JSON.stringify(before.settings) !== JSON.stringify(after.settings) ||
    JSON.stringify(before.browser) !== JSON.stringify(after.browser) ||
    JSON.stringify(before.viewport) !== JSON.stringify(after.viewport)
  ) {
    throw new DiagnosticsError('Capture scenarios, URLs, browser, viewport, or measurement settings differ')
  }
  return {
    beforeRun: before.runId,
    afterRun: after.runId,
    builds: { before: before.build, after: after.build },
    delta: {
      jsHeapBytes: after.after.jsHeapBytes - before.after.jsHeapBytes,
      domNodes: after.after.domNodes - before.after.domNodes,
      eventListeners: after.after.eventListeners - before.after.eventListeners,
    },
    interpretation:
      'Measurement deltas only; heap growth is not proof of a leak. Inspect retaining paths and repeat with released DevTools handles.',
  }
}

export function summarizeCpu(profile: Protocol.Profiler.Profile) {
  if (!profile.samples || !profile.timeDeltas || profile.samples.length !== profile.timeDeltas.length) {
    throw new DiagnosticsError('CPU profile is missing aligned samples and timestamps')
  }
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]))
  const totals = new Map<number, number>()
  for (const [index, id] of profile.samples.entries()) {
    const frame = nodes.get(id)
    const timeDelta = profile.timeDeltas[index]
    if (!frame || timeDelta === undefined) {
      throw new DiagnosticsError('CPU profile references an absent node')
    }
    totals.set(id, (totals.get(id) ?? 0) + timeDelta)
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id, microseconds]) => {
      const frame = nodes.get(id)
      if (!frame) throw new DiagnosticsError('CPU profile references an absent node')
      return {
        function: frame.functionName,
        url: safeUrl(frame.url),
        line: frame.lineNumber + 1,
        column: frame.columnNumber + 1,
        sampledSelfMs: microseconds / 1000,
      }
    })
}
