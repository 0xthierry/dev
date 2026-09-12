import { expect, it } from 'bun:test'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Protocol } from 'devtools-protocol'
import { parseManifest } from './artifacts'
import { startIsolatedBrowser } from './integration-harness'

it('captures CPU, network, coverage, heap, comparison, interruption, and cleanup against isolated Brave', async () => {
  const harness = await startIsolatedBrowser()
  const fixturePort = ['--fixture-port', String(harness.port)]
  const target = ['--target', harness.target.id, '--url', harness.url]
  const record = (kind: 'cpu' | 'network' | 'coverage', durationMs: number) => [
    'record',
    ...target,
    '--kind',
    kind,
    '--duration-ms',
    String(durationMs),
    '--scenario',
    'isolated-fixture',
    '--build',
    'fixture-v1',
    ...fixturePort,
  ]
  const heap = [
    'heap',
    ...target,
    '--scenario',
    'isolated-fixture-heap',
    '--build',
    'fixture-v1',
    '--collect-garbage',
    ...fixturePort,
  ]
  const manifest = (path: string) => parseManifest(JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')))
  try {
    const targets = await harness.invokeCapture(['targets', ...fixturePort])
    expect(targets.code).toBe(0)
    expect(JSON.parse(targets.stdout)).toEqual([{ id: harness.target.id, url: harness.url }])

    const doctor = await harness.invokeCapture(['doctor', ...target, ...fixturePort])
    expect(doctor.code).toBe(0)
    expect(JSON.parse(doctor.stdout).status).toBe('ready')
    const wrongTarget = await harness.invokeCapture([
      'doctor',
      '--target',
      harness.target.id,
      '--url',
      `${harness.url}wrong`,
      ...fixturePort,
    ])
    expect(wrongTarget.code).toBe(1)
    expect(wrongTarget.stderr).toContain('exact URL changed')

    const cpu = harness.startCapture(record('cpu', 1_200))
    const cpuPath = await harness.waitForRecording(cpu)
    await harness.evaluatePrimitive(
      'document.getElementById("summary").click(); document.getElementById("summary").click(); true',
    )
    const cpuResult = await harness.finish(cpu)
    expect(cpuResult.code).toBe(0)
    const cpuManifest = manifest(cpuPath)
    expect(cpuManifest.completion.status).toBe('complete')
    const profile = JSON.parse(readFileSync(join(cpuPath, cpuManifest.artifact), 'utf8')) as Protocol.Profiler.Profile
    const hotIds = new Set(
      profile.nodes.filter((node) => node.callFrame.functionName === 'calculateSummary').map((node) => node.id),
    )
    expect(profile.samples?.some((id) => hotIds.has(id))).toBe(true)
    const summary = await harness.invokeCapture(['summarize', '--run', cpuPath])
    expect(summary.code).toBe(0)
    expect(
      (JSON.parse(summary.stdout) as { cpu: Array<{ function: string }> }).cpu.some(
        (entry) => entry.function === 'calculateSummary',
      ),
    ).toBe(true)

    const network = harness.startCapture([...record('network', 900), '--reload', '--disable-cache'])
    const networkPath = await harness.waitForRecording(network)
    const overlapping = await harness.invokeCapture(record('coverage', 200))
    expect(overlapping.code).toBe(1)
    expect(overlapping.stderr).toContain('recorder is active')
    expect((await harness.finish(network)).code).toBe(0)
    const networkManifest = manifest(networkPath)
    const networkEvents = readFileSync(join(networkPath, networkManifest.artifact), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string; url?: string })
    expect(
      networkEvents.some((event) => event.event === 'request' && event.url === `${harness.url}workspace-data.js`),
    ).toBe(true)

    const coverage = harness.startCapture(record('coverage', 700))
    const coveragePath = await harness.waitForRecording(coverage)
    await harness.evaluatePrimitive(
      'document.getElementById("summary").click(); document.getElementById("details").click(); true',
    )
    expect((await harness.finish(coverage)).code).toBe(0)
    const coverageManifest = manifest(coveragePath)
    const coverageData = JSON.parse(
      readFileSync(join(coveragePath, coverageManifest.artifact), 'utf8'),
    ) as Protocol.Profiler.TakePreciseCoverageResponse
    const fixtureScript = coverageData.result.find((entry) => entry.url === `${harness.url}fixture.js`)
    expect(
      fixtureScript?.functions.some(
        (fn) => fn.functionName === 'refreshDetailsPreview' && fn.ranges.some((range) => range.count > 0),
      ),
    ).toBe(true)

    const baseline = harness.startCapture(heap)
    const baselinePath = await harness.waitForRecording(baseline)
    expect((await harness.finish(baseline)).code).toBe(0)
    await harness.evaluatePrimitive(
      'for (let index = 0; index < 6; index++) document.getElementById("activity").click(); true',
    )
    const after = harness.startCapture(heap)
    const afterPath = await harness.waitForRecording(after)
    expect((await harness.finish(after)).code).toBe(0)
    expect(lstatSync(join(afterPath, manifest(afterPath).artifact)).size).toBeGreaterThan(1_000)
    const comparison = await harness.invokeCapture(['compare', '--before', baselinePath, '--after', afterPath])
    expect(comparison.code).toBe(0)
    expect(JSON.parse(comparison.stdout).delta.eventListeners).toBe(6)

    const interrupted = harness.startCapture([...record('network', 10_000), '--disable-cache'])
    const interruptedPath = await harness.waitForRecording(interrupted)
    interrupted.child.kill('SIGINT')
    expect((await harness.finish(interrupted)).code).toBe(1)
    expect(manifest(interruptedPath).completion.status).toBe('incomplete')
    expect((await harness.invokeCapture(['summarize', '--run', interruptedPath])).code).toBe(1)
    expect(existsSync(join(harness.stateRoot, 'recorder.lock'))).toBe(false)

    expect(lstatSync(harness.stateRoot).mode & 0o777).toBe(0o700)
    for (const entry of readdirSync(harness.stateRoot)) {
      const runPath = join(harness.stateRoot, entry)
      expect(lstatSync(runPath).mode & 0o777).toBe(0o700)
      for (const filename of readdirSync(runPath)) expect(lstatSync(join(runPath, filename)).mode & 0o777).toBe(0o600)
    }
  } finally {
    await harness.close()
  }
}, 120_000)
