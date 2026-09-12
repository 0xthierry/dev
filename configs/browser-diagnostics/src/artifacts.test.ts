import { describe, expect, spyOn, test } from 'bun:test'
import type { Protocol } from 'devtools-protocol'
import type { CaptureManifest } from './artifacts'
import { compareRuns, parseManifest, summarizeCpu, urlHash } from './artifacts'
import { requireTarget, safeUrl, validatePageUrl } from './cdp'

function manifest(): CaptureManifest {
  return {
    schemaVersion: 1,
    runId: 'first',
    kind: 'heap',
    scenario: 'open-close-20-times',
    build: 'revision-a',
    target: {
      id: 'ABC123',
      url: 'https://example.test/dashboard',
      urlHash: urlHash('https://example.test/dashboard?workspace=123'),
    },
    browser: { product: 'Chrome/150', revision: 'revision', userAgent: 'fixture' },
    viewport: { width: 1200, height: 800, deviceScaleFactor: 1, visibility: 'visible' },
    settings: { durationMs: 0, reload: false, disableCache: false, collectGarbage: true },
    startedAt: '2026-09-10T10:00:00Z',
    before: { jsHeapBytes: 1000, domNodes: 20, eventListeners: 10, taskSeconds: 1, scriptSeconds: 0.5, timestamp: 1 },
    after: { jsHeapBytes: 1100, domNodes: 20, eventListeners: 10, taskSeconds: 2, scriptSeconds: 0.6, timestamp: 2 },
    artifact: 'capture.heapsnapshot',
    completion: { status: 'complete', finishedAt: '2026-09-10T10:00:01Z' },
  }
}

describe('diagnostic evidence comparison', () => {
  test('compares compatible builds without asserting a leak', () => {
    const before = manifest()
    const after = manifest()
    after.runId = 'second'
    after.build = 'revision-b'
    after.after = {
      jsHeapBytes: 1300,
      domNodes: 20,
      eventListeners: 30,
      taskSeconds: 3,
      scriptSeconds: 0.8,
      timestamp: 3,
    }
    expect(compareRuns({ before, after })).toEqual({
      beforeRun: 'first',
      afterRun: 'second',
      builds: { before: 'revision-a', after: 'revision-b' },
      delta: { jsHeapBytes: 200, domNodes: 0, eventListeners: 20 },
      interpretation:
        'Measurement deltas only; heap growth is not proof of a leak. Inspect retaining paths and repeat with released DevTools handles.',
    })
  })

  test.each(['recording', 'incomplete'] as const)('rejects %s captures', (status) => {
    const after = manifest()
    after.completion = status === 'recording' ? { status } : { status, finishedAt: 'now', reason: 'lost connection' }
    expect(() => compareRuns({ before: manifest(), after })).toThrow('Only complete captures')
  })

  test.each([
    (m: CaptureManifest) => {
      m.settings.collectGarbage = false
    },
    (m: CaptureManifest) => {
      m.settings.durationMs = 123
    },
    (m: CaptureManifest) => {
      m.settings.reload = true
    },
    (m: CaptureManifest) => {
      m.settings.disableCache = true
    },
    (m: CaptureManifest) => {
      m.viewport.width = 800
    },
    (m: CaptureManifest) => {
      m.viewport.visibility = 'hidden'
    },
    (m: CaptureManifest) => {
      m.browser.revision = 'different'
    },
    (m: CaptureManifest) => {
      m.target.urlHash = urlHash('https://example.test/dashboard?workspace=other')
    },
    (m: CaptureManifest) => {
      m.scenario = 'different'
    },
    (m: CaptureManifest) => {
      m.kind = 'coverage'
    },
  ])('rejects incompatible measurement conditions', (change) => {
    const after = manifest()
    change(after)
    expect(() => compareRuns({ before: manifest(), after })).toThrow('differ')
  })

  test('rejects a complete manifest without final metrics', () => {
    const after = manifest()
    after.after = null
    expect(() => compareRuns({ before: manifest(), after })).toThrow('Only complete captures')
  })

  test('decodes the persisted owned contract', () => {
    const value = manifest()
    expect(parseManifest(JSON.parse(JSON.stringify(value)))).toEqual(value)
  })

  test.each([
    'before',
    'after',
  ] as const)('rejects a complete manifest without %s measurements at admission', (field) => {
    expect(() => parseManifest({ ...manifest(), [field]: null })).toThrow('Invalid diagnostic artifact manifest')
  })

  test.each([
    { completion: { status: 'recording' }, before: null, after: null },
    { completion: { status: 'recording' }, before: manifest().before, after: null },
    { completion: { status: 'incomplete', finishedAt: 'now', reason: 'interrupted' }, before: null, after: null },
    {
      completion: { status: 'incomplete', finishedAt: 'now', reason: 'interrupted' },
      before: manifest().before,
      after: null,
    },
    {
      completion: { status: 'incomplete', finishedAt: 'now', reason: 'cleanup failed' },
      before: manifest().before,
      after: manifest().after,
    },
  ])('preserves unfinished capture evidence', (state) => {
    const value = { ...manifest(), ...state }
    expect(parseManifest(JSON.parse(JSON.stringify(value)))).toEqual(value)
  })

  test('strips unknown fields without changing the persisted owned shape', () => {
    const value = manifest()
    expect(parseManifest({ ...value, extra: 'ignored', target: { ...value.target, extra: 'ignored' } })).toEqual(value)
  })

  test.each(
    [
      null,
      [],
      { ...manifest(), schemaVersion: 2 },
      { ...manifest(), kind: 'unknown' },
      { ...manifest(), completion: { status: 'success-ish' } },
      { ...manifest(), settings: { collectGarbage: 'yes' } },
      { ...manifest(), after: { ...manifest().after, jsHeapBytes: Number.NaN } },
      { ...manifest(), after: { ...manifest().after, timestamp: Number.POSITIVE_INFINITY } },
      { ...manifest(), before: undefined },
      { ...manifest(), build: undefined },
      { ...manifest(), completion: { status: 'complete' } },
      { ...manifest(), completion: { status: 'incomplete', finishedAt: 'now' } },
    ].map((value) => ({ value })),
  )('rejects invalid artifact boundaries', ({ value }) => {
    expect(() => parseManifest(value)).toThrow()
  })
})

describe('CPU evidence summary', () => {
  const frame: Protocol.Runtime.CallFrame = {
    functionName: 'fixtureHotPath',
    scriptId: '1',
    url: 'https://example.test/app.js?secret=value#fragment',
    lineNumber: 5,
    columnNumber: 7,
  }
  const profile: Protocol.Profiler.Profile = {
    nodes: [
      { id: 1, callFrame: frame },
      { id: 2, callFrame: { ...frame, functionName: 'idle' } },
    ],
    startTime: 0,
    endTime: 10000,
    samples: [1, 2, 1],
    timeDeltas: [2000, 1000, 3000],
  }
  test('ranks sampled self time with one-based source locations and redacted URLs', () => {
    expect(summarizeCpu(profile)).toEqual([
      { function: 'fixtureHotPath', url: 'https://example.test/app.js', line: 6, column: 8, sampledSelfMs: 5 },
      { function: 'idle', url: 'https://example.test/app.js', line: 6, column: 8, sampledSelfMs: 1 },
    ])
  })
  test('rejects incomplete or inconsistent CPU samples', () => {
    expect(() => summarizeCpu({ ...profile, timeDeltas: [1] })).toThrow('aligned samples')
    expect(() => summarizeCpu({ ...profile, samples: [1, 2, 999] })).toThrow('absent node')
  })
})

describe('target identity and privacy', () => {
  test('normalizes equivalent URL spellings at the discovery boundary', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            type: 'page',
            id: 'ABC123',
            url: 'https://example.test',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/ABC123',
          },
        ]),
      ),
    )
    try {
      expect(await requireTarget({ id: 'ABC123', url: 'https://example.test/', port: 9222 })).toEqual({
        id: 'ABC123',
        url: 'https://example.test/',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/ABC123',
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })
  test('strips credentials, queries, and fragments from displayed URLs', () => {
    expect(safeUrl('https://user:password@example.test/page?token=secret#session')).toBe('https://example.test/page')
    expect(safeUrl('data:text/plain,secret')).toBe('[non-http resource]')
    expect(safeUrl('not a URL')).toBe('[invalid URL]')
  })
  test('retains full-URL differences in fingerprints without displaying the raw URL', () => {
    expect(urlHash('https://example.test/?x=a')).not.toBe(urlHash('https://example.test/?x=b'))
    expect(urlHash('https://example.test/?x=a')).toMatch(/^[\da-f]{64}$/)
  })
  test('rejects targets outside the supported page URL contract', () => {
    expect(validatePageUrl('https://example.test')).toBe('https://example.test/')
    expect(() => validatePageUrl('file:///etc/passwd')).toThrow('HTTP(S)')
    expect(() => validatePageUrl('https://user:password@example.test')).toThrow('credentials')
  })
})
