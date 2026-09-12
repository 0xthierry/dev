#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import type { Protocol } from 'devtools-protocol'
import type { CaptureKind } from './artifacts'
import { compareRuns, readCaptureArtifact, readRun, summarizeCpu } from './artifacts'
import { capture, doctor } from './capture'
import { DiagnosticsError, listTargets, safeUrl, validatePageUrl } from './cdp'

const help = `Browser diagnostics (existing local browser, observation only)

  targets
  doctor --target ID --url URL
  record --target ID --url URL --kind cpu|network|coverage --duration-ms N --scenario NAME
         [--build REV] [--reload] [--disable-cache]
  heap --target ID --url URL --scenario NAME [--build REV] [--collect-garbage]
  summarize --run ABS_PATH
  compare --before ABS_PATH --after ABS_PATH

Endpoint: http://127.0.0.1:9222 only. Duration: 100–300000 ms. One capture at a time.
Wait for the JSON status "recording" before interacting through the approved browser tool.
Only status "complete" is valid evidence. SIGINT/SIGTERM attempt cleanup.
Artifacts: $HOME/.local/state/browser-diagnostics (0700), files 0600.
Each raw capture is limited to 512 MiB and may contain credentials or private page data.
The hidden --fixture-port option is accepted only with BROWSER_DIAGNOSTICS_TEST_MODE=1.
`

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new DiagnosticsError(`Missing --${name}`)
  return value
}

function boundedLabel(value: string, name: string): string {
  const hasControlCharacter = [...value].some((character) => character.charCodeAt(0) < 32)
  if (value.length > 256 || hasControlCharacter) {
    throw new DiagnosticsError(`--${name} must be at most 256 printable characters`)
  }
  return value
}

function rejectPresent(values: Record<string, unknown>, names: string[], command: string): void {
  const present = names.filter((name) => values[name] !== undefined)
  if (present.length > 0) throw new DiagnosticsError(`${command} does not accept --${present[0]}`)
}

function parseCliArgs(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean' },
      target: { type: 'string' },
      url: { type: 'string' },
      'fixture-port': { type: 'string' },
      kind: { type: 'string' },
      'duration-ms': { type: 'string' },
      scenario: { type: 'string' },
      build: { type: 'string' },
      reload: { type: 'boolean' },
      'disable-cache': { type: 'boolean' },
      'collect-garbage': { type: 'boolean' },
      run: { type: 'string' },
      before: { type: 'string' },
      after: { type: 'string' },
    },
  })
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  process.umask(0o077)
  let parsed: ReturnType<typeof parseCliArgs>
  try {
    parsed = parseCliArgs(args)
  } catch {
    throw new DiagnosticsError('Unsupported CLI option; see --help')
  }
  const { positionals, values } = parsed
  if (values.help) {
    if (positionals.length > 0) throw new DiagnosticsError('--help does not accept a command')
    process.stdout.write(help)
    return
  }
  const [command] = positionals
  if (positionals.length !== 1 || !command) throw new DiagnosticsError('Provide exactly one command; see --help')
  let port = 9222
  if (values['fixture-port'] !== undefined) {
    if (process.env.BROWSER_DIAGNOSTICS_TEST_MODE !== '1') {
      throw new DiagnosticsError('--fixture-port is only allowed in diagnostics test mode')
    }
    port = Number(values['fixture-port'])
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new DiagnosticsError('Fixture port must be an integer between 1 and 65535')
    }
  }
  const allCaptureOptions = [
    'target',
    'url',
    'kind',
    'duration-ms',
    'scenario',
    'build',
    'reload',
    'disable-cache',
    'collect-garbage',
  ]
  if (command === 'targets') {
    rejectPresent(values, [...allCaptureOptions, 'run', 'before', 'after'], command)
    process.stdout.write(
      `${JSON.stringify((await listTargets(port)).map((target) => ({ id: target.id, url: safeUrl(target.url) })))}\n`,
    )
    return
  }
  if (command === 'summarize') {
    rejectPresent(values, [...allCaptureOptions, 'before', 'after', 'fixture-port'], command)
    const path = required(values.run, 'run')
    const manifest = readRun(path)
    if (manifest.completion.status !== 'complete') {
      throw new DiagnosticsError('Capture is incomplete; inspect the private manifest and repeat it')
    }
    let cpu: ReturnType<typeof summarizeCpu> | null = null
    if (manifest.kind === 'cpu') {
      const profile = JSON.parse(readCaptureArtifact({ path, manifest })) as Protocol.Profiler.Profile
      cpu = summarizeCpu(profile)
    }
    process.stdout.write(`${JSON.stringify({ manifest, cpu }, null, 2)}\n`)
    return
  }
  if (command === 'compare') {
    rejectPresent(values, [...allCaptureOptions, 'run', 'fixture-port'], command)
    const result = compareRuns({
      before: readRun(required(values.before, 'before')),
      after: readRun(required(values.after, 'after')),
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (!['doctor', 'record', 'heap'].includes(command))
    throw new DiagnosticsError('Unknown diagnostic command; see --help')
  rejectPresent(values, ['run', 'before', 'after'], command)
  const targetId = required(values.target, 'target')
  if (!/^[\da-f]+$/iu.test(targetId))
    throw new DiagnosticsError('Target must be the browser target ID from targets, not a tab index')
  const url = validatePageUrl(required(values.url, 'url'))
  if (command === 'doctor') {
    rejectPresent(
      values,
      ['kind', 'duration-ms', 'scenario', 'build', 'reload', 'disable-cache', 'collect-garbage'],
      command,
    )
    process.stdout.write(`${JSON.stringify(await doctor({ targetId, url, port }), null, 2)}\n`)
    return
  }
  let kind: CaptureKind
  if (command === 'heap') {
    rejectPresent(values, ['kind', 'duration-ms', 'reload', 'disable-cache'], command)
    kind = 'heap'
  } else if (values.kind === 'cpu' || values.kind === 'network' || values.kind === 'coverage') {
    if (values['collect-garbage'])
      throw new DiagnosticsError('Garbage collection is only supported in isolated heap captures')
    kind = values.kind
  } else {
    throw new DiagnosticsError('Record kind must be cpu, network, or coverage')
  }
  const durationMs = kind === 'heap' ? 0 : Number(required(values['duration-ms'], 'duration-ms'))
  if (kind !== 'heap' && (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 300_000)) {
    throw new DiagnosticsError('Duration must be an integer between 100 and 300000 ms')
  }
  await capture({
    targetId,
    url,
    port,
    kind,
    scenario: boundedLabel(required(values.scenario, 'scenario'), 'scenario'),
    build: values.build === undefined ? null : boundedLabel(values.build, 'build'),
    settings: {
      durationMs,
      reload: values.reload ?? false,
      disableCache: values['disable-cache'] ?? false,
      collectGarbage: values['collect-garbage'] ?? false,
    },
  })
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof DiagnosticsError ? error.message : 'Diagnostics failed; check CLI usage, private artifacts, and browser readiness'}\n`,
    )
    process.exitCode = 1
  })
}
