import { setTimeout as delay } from 'node:timers/promises'
import type { CaptureKind, CaptureManifest, CaptureSettings, Measurement } from './artifacts'
import { createRun, lockRecorder, openArtifact, urlHash, writeManifest } from './artifacts'
import { CdpConnection, DiagnosticsError, requireTarget, safeUrl } from './cdp'

interface CaptureInput {
  targetId: string
  url: string
  port: number
  kind: CaptureKind
  scenario: string
  build: string | null
  settings: CaptureSettings
}

async function measure(connection: CdpConnection): Promise<Measurement> {
  const { metrics } = await connection.send('Performance.getMetrics')
  const values = new Map(metrics.map((metric) => [metric.name, metric.value]))
  const heap = await connection.send('Runtime.getHeapUsage')
  const dom = await connection.send('Memory.getDOMCounters')
  const required = (name: string) => {
    const value = values.get(name)
    if (value === undefined) {
      throw new DiagnosticsError('Chromium omitted a required performance metric')
    }
    return value
  }
  return {
    jsHeapBytes: heap.usedSize,
    domNodes: dom.nodes,
    eventListeners: dom.jsEventListeners,
    taskSeconds: required('TaskDuration'),
    scriptSeconds: required('ScriptDuration'),
    timestamp: required('Timestamp'),
  }
}

async function viewport(connection: CdpConnection): Promise<CaptureManifest['viewport']> {
  const result = await connection.send('Runtime.evaluate', {
    expression:
      '({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio,visibility:document.visibilityState})',
    returnByValue: true,
  })
  const value: unknown = result.result.value
  if (
    result.exceptionDetails ||
    typeof value !== 'object' ||
    value === null ||
    !('width' in value) ||
    typeof value.width !== 'number' ||
    !('height' in value) ||
    typeof value.height !== 'number' ||
    !('deviceScaleFactor' in value) ||
    typeof value.deviceScaleFactor !== 'number' ||
    !('visibility' in value) ||
    typeof value.visibility !== 'string'
  ) {
    throw new DiagnosticsError('Cannot measure the selected page viewport')
  }
  return {
    width: value.width,
    height: value.height,
    deviceScaleFactor: value.deviceScaleFactor,
    visibility: value.visibility,
  }
}

export async function doctor({ targetId, url, port }: { targetId: string; url: string; port: number }) {
  const target = await requireTarget({ id: targetId, url, port })
  const connection = await CdpConnection.connect(target)
  try {
    const browser = await connection.send('Browser.getVersion')
    const heap = await connection.send('Runtime.getHeapUsage')
    const dom = await connection.send('Memory.getDOMCounters')
    return {
      status: 'ready',
      target: { id: target.id, url: safeUrl(target.url), urlHash: urlHash(target.url) },
      browser: { product: browser.product, revision: browser.revision },
      viewport: await viewport(connection),
      jsHeapBytes: heap.usedSize,
      domNodes: dom.nodes,
      eventListeners: dom.jsEventListeners,
    }
  } finally {
    connection.close()
  }
}

export async function capture(input: CaptureInput): Promise<string> {
  const target = await requireTarget({ id: input.targetId, url: input.url, port: input.port })
  const unlock = lockRecorder()
  let connection: CdpConnection | undefined
  let artifact: ReturnType<typeof openArtifact> | undefined
  let run: ReturnType<typeof createRun> | undefined
  let manifest: CaptureManifest | undefined
  const abort = new AbortController()
  const interrupt = () => {
    abort.abort()
    connection?.close()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  let succeeded = false
  let cleaned = false
  let cacheChanged = false
  try {
    connection = await CdpConnection.connect(target)
    await connection.send('Page.enable')
    await connection.send('Performance.enable')
    const browser = await connection.send('Browser.getVersion')
    const pageViewport = await viewport(connection)
    if (pageViewport.visibility !== 'visible') {
      throw new DiagnosticsError(
        'Bring the target page to the foreground with the browser controller selected for this session; do not switch controllers',
      )
    }
    const extension = input.kind === 'cpu' ? 'cpuprofile' : input.kind === 'heap' ? 'heapsnapshot' : 'jsonl'
    run = createRun()
    manifest = {
      schemaVersion: 1,
      runId: run.runId,
      kind: input.kind,
      scenario: input.scenario,
      build: input.build,
      target: { id: target.id, url: safeUrl(target.url), urlHash: urlHash(target.url) },
      browser: { product: browser.product, revision: browser.revision, userAgent: browser.userAgent },
      viewport: pageViewport,
      settings: input.settings,
      startedAt: new Date().toISOString(),
      before: null,
      after: null,
      artifact: `capture.${extension}`,
      completion: { status: 'recording' },
    }
    writeManifest({ path: run.path, manifest })
    artifact = openArtifact({ path: run.path, filename: manifest.artifact })
    const output = artifact
    const { frameTree } = await connection.send('Page.getFrameTree')
    let navigatedAway = false
    connection.on('Page.frameNavigated', ({ frame }) => {
      if (!frame.parentId && `${frame.url}${frame.urlFragment ?? ''}` !== target.url) {
        navigatedAway = true
      }
    })
    connection.on('Page.navigatedWithinDocument', ({ url, frameId }) => {
      if (frameId === frameTree.frame.id && url !== target.url) {
        navigatedAway = true
      }
    })
    if (input.settings.disableCache) {
      await connection.send('Network.enable')
      await connection.send('Network.setCacheDisabled', { cacheDisabled: true })
      cacheChanged = true
    }
    if (input.kind === 'heap') {
      await connection.send('HeapProfiler.enable')
      if (input.settings.collectGarbage) {
        await connection.send('HeapProfiler.collectGarbage')
      }
    }
    manifest.before = await measure(connection)
    if (input.kind === 'cpu') {
      await connection.send('Profiler.enable')
      await connection.send('Profiler.start')
    } else if (input.kind === 'coverage') {
      await connection.send('Profiler.enable')
      await connection.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
    } else if (input.kind === 'network') {
      await connection.send('Network.enable')
      connection.on('Network.requestWillBeSent', (event) =>
        output.write(
          `${JSON.stringify({ event: 'request', id: event.requestId, timestamp: event.timestamp, method: event.request.method, url: safeUrl(event.request.url), type: event.type, initiator: event.initiator.type })}\n`,
        ),
      )
      connection.on('Network.responseReceived', (event) =>
        output.write(
          `${JSON.stringify({ event: 'response', id: event.requestId, timestamp: event.timestamp, status: event.response.status, mimeType: event.response.mimeType, protocol: event.response.protocol, fromDiskCache: event.response.fromDiskCache ?? false, fromServiceWorker: event.response.fromServiceWorker ?? false, timing: event.response.timing })}\n`,
        ),
      )
      connection.on('Network.loadingFinished', (event) =>
        output.write(
          `${JSON.stringify({ event: 'finished', id: event.requestId, timestamp: event.timestamp, encodedBytes: event.encodedDataLength })}\n`,
        ),
      )
      connection.on('Network.loadingFailed', (event) =>
        output.write(
          `${JSON.stringify({ event: 'failed', id: event.requestId, timestamp: event.timestamp, canceled: event.canceled ?? false, blockedReason: event.blockedReason ?? null })}\n`,
        ),
      )
    } else {
      connection.on('HeapProfiler.addHeapSnapshotChunk', (event) => output.write(event.chunk))
    }
    writeManifest({ path: run.path, manifest })
    process.stdout.write(
      `${JSON.stringify({ status: 'recording', run: run.path, targetId: target.id, kind: input.kind })}\n`,
    )
    if (input.settings.reload) {
      await connection.send('Page.reload', { ignoreCache: input.settings.disableCache })
    }
    if (input.kind === 'heap') {
      await connection.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
    } else {
      await delay(input.settings.durationMs, undefined, { signal: abort.signal })
    }
    connection.assertHealthy()
    if (input.kind === 'cpu') {
      const { profile } = await connection.send('Profiler.stop')
      output.write(JSON.stringify(profile))
    } else if (input.kind === 'coverage') {
      const coverage = await connection.send('Profiler.takePreciseCoverage')
      output.write(`${JSON.stringify(coverage)}\n`)
      await connection.send('Profiler.stopPreciseCoverage')
    }
    manifest.after = await measure(connection)
    await requireTarget({ id: target.id, url: target.url, port: input.port })
    if (navigatedAway || JSON.stringify(await viewport(connection)) !== JSON.stringify(pageViewport)) {
      throw new DiagnosticsError('Target navigated, changed viewport, or became hidden; capture is not comparable')
    }
    succeeded = true
  } finally {
    try {
      if (connection) {
        try {
          if (cacheChanged) {
            await connection.send('Network.setCacheDisabled', { cacheDisabled: false })
          }
          if (input.kind === 'cpu' || input.kind === 'coverage') {
            await connection.send('Profiler.disable')
          }
          if (input.kind === 'heap') {
            await connection.send('HeapProfiler.disable')
          }
          await connection.send('Performance.disable')
          cleaned = true
        } catch {
          cleaned = false
        } finally {
          // Detach even when cleanup commands fail. Never change another session's overrides.
          connection.close()
        }
      }
      // CDP listeners must be detached before their output descriptor is closed.
      artifact?.close()
      if (run && manifest) {
        manifest.completion =
          succeeded && cleaned
            ? { status: 'complete', finishedAt: new Date().toISOString() }
            : {
                status: 'incomplete',
                finishedAt: new Date().toISOString(),
                reason: cleaned
                  ? 'Recording failed or was interrupted; do not use as proof'
                  : 'Recording or cleanup failed; verify browser settings before another capture',
              }
        writeManifest({ path: run.path, manifest })
        process.stdout.write(`${JSON.stringify({ status: manifest.completion.status, run: run.path })}\n`)
      }
    } finally {
      connection?.close()
      try {
        artifact?.close()
      } finally {
        process.removeListener('SIGINT', interrupt)
        process.removeListener('SIGTERM', interrupt)
        unlock()
      }
    }
  }
  if (!run || !succeeded || !cleaned) {
    throw new DiagnosticsError('Recording did not complete and clean up successfully')
  }
  return run.path
}
