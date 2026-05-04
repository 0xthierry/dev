#!/usr/bin/env bun
import fs from 'node:fs'
import path from 'node:path'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type SummaryValue = undefined | null | boolean | number | string | SummaryValue[] | { [key: string]: SummaryValue }

const SENSITIVE_KEY_PATTERN = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|credential|private[-_]?key|session|bearer/i

type RequestLike = {
  type?: string
  method?: string
  status?: number
  url?: string
  postData?: string
}

type StateLike = {
  runDisabled?: boolean | null
  creatingDraftState?: boolean
  held?: RequestLike[]
  workflowRequests?: RequestLike[]
}

type AssertionData = {
  case?: string
  name?: string
  pass?: boolean
  proof?: string
  media?: unknown
  network?: RequestLike[]
  before?: StateLike
  after?: StateLike
  pending?: StateLike
  guarded?: StateLike
  afterClick?: StateLike
  recovered?: StateLike
  workflowPost?: RequestLike
  workflowOk?: RequestLike
  surface?: JsonValue
  route?: JsonValue
  precondition?: JsonValue
  action?: JsonValue
  expected?: JsonValue
  observed?: JsonValue
  cleanup?: JsonValue
  [key: string]: unknown
}

function usage() {
  console.error(`Usage:
  bun qa-manifest.ts <artifact-dir> [output.json]

Reads assertion JSON files from <artifact-dir>/assertions and writes a compact
QA manifest. Assertion files may use either a top-level pass boolean or a
case-specific structure; unknown fields are preserved under "details".`)
}

const artifactDir = process.argv[2]
const outputPath = process.argv[3]

if (!artifactDir) {
  usage()
  process.exit(2)
}

const assertionsDir = path.join(artifactDir, 'assertions')
if (!fs.existsSync(assertionsDir)) {
  console.error(`Assertions directory not found: ${assertionsDir}`)
  process.exit(1)
}

const files = fs.readdirSync(assertionsDir)
  .filter(file => file.endsWith('.json'))
  .filter(file => !file.includes('summary'))
  .sort()

if (files.length === 0) {
  console.error(`No assertion JSON files found in ${assertionsDir}`)
  process.exit(1)
}

const entries = files.map((file) => {
  const fullPath = path.join(assertionsDir, file)
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as AssertionData
  const caseName = data.case ?? data.name ?? path.basename(file, '.json')
  const pass = typeof data.pass === 'boolean' ? data.pass : inferPass(data)

  const entry = {
    case: caseName,
    pass,
    assertion: fullPath,
    media: buildMedia(data, artifactDir, caseName),
    network: extractNetwork(data),
    proof: typeof data.proof === 'string' ? data.proof : inferProof(data),
    details: compactDetails(data),
  }

  return entry
})

const manifest = {
  artifactDir,
  generatedAt: new Date().toISOString(),
  total: entries.length,
  passed: entries.filter(entry => entry.pass === true).length,
  failed: entries.filter(entry => entry.pass === false).length,
  unknown: entries.filter(entry => entry.pass === undefined).length,
  entries,
}

const json = JSON.stringify(manifest, null, 2)
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${json}\n`)
  console.log(outputPath)
}
else {
  console.log(json)
}

function extractNetwork(data: AssertionData) {
  const network = data.network ?? []
  return network
    .filter((event): event is RequestLike & { url: string } => Boolean(event?.url))
    .map(summarizeRequest)
}

function summarizeRequest(event: RequestLike & { url: string }) {
  return {
    type: event.type,
    method: event.method,
    status: event.status,
    url: event.url,
    ...(typeof event.postData === 'string' ? { postData: summarizePostData(event.postData) } : {}),
  }
}

function summarizePostData(postData: string) {
  const parsed = tryParseJson(postData)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return {
      redacted: true,
      hasPostData: true,
      jsonKeys: Object.keys(parsed).slice(0, 25).map(redactSensitiveKeyName),
    }
  }

  return {
    redacted: true,
    hasPostData: postData.length > 0,
    bytes: postData.length,
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  }
  catch {
    return undefined
  }
}

function buildMedia(data: AssertionData, artifactDir: string, caseName: string) {
  const media = toSummaryRecord(summarize(data.media))
  const videoPath = path.join(artifactDir, 'videos', `${caseName}.webm`)
  if (fs.existsSync(videoPath) && typeof media.video !== 'string')
    media.video = videoPath

  media.screenshots = uniqueStrings([
    ...stringsFrom(media.screenshot),
    ...stringsFrom(media.screenshots),
    ...collectScreenshots(artifactDir, caseName),
  ])

  return media
}

function toSummaryRecord(value: SummaryValue): Record<string, SummaryValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {}

  return { ...value }
}

function stringsFrom(value: SummaryValue): string[] {
  if (typeof value === 'string')
    return [value]

  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string')

  return []
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

function collectScreenshots(artifactDir: string, caseName: string) {
  return [
    ...collectScreenshotsFromDir(path.join(artifactDir, 'screenshots'), caseName),
    ...collectScreenshotsFromDir(artifactDir, caseName),
  ]
}

function collectScreenshotsFromDir(dir: string, caseName: string) {
  if (!fs.existsSync(dir))
    return []

  return fs.readdirSync(dir)
    .filter(name => name.startsWith(`${caseName}-`) && /\.(png|jpe?g)$/i.test(name))
    .sort()
    .map(name => path.join(dir, name))
}

function inferPass(data: AssertionData) {
  if (data.pending && data.afterClick && data.recovered) {
    const startedEnabled = data.before?.runDisabled === false
    const hasHeldRequest = Array.isArray(data.pending.held) && data.pending.held.length > 0
    const blockedRun = Array.isArray(data.afterClick.workflowRequests) && data.afterClick.workflowRequests.length === 0
    const recovered = data.recovered.runDisabled === false
    if (startedEnabled && hasHeldRequest && data.pending.runDisabled === true && blockedRun && recovered)
      return true
  }

  if (data.guarded && data.afterClick && data.recovered) {
    const startedEnabled = data.before?.runDisabled === false
    const guardedDisabled = data.guarded.runDisabled === true
    const blockedRun = Array.isArray(data.afterClick.workflowRequests) && data.afterClick.workflowRequests.length === 0
    const recovered = data.recovered.runDisabled === false
    if (startedEnabled && guardedDisabled && blockedRun && recovered)
      return true
  }

  if (data.workflowPost || data.workflowOk) {
    const startedEnabled = data.before?.runDisabled === false
    const sentPromptVersion = typeof data.workflowPost?.postData === 'string' && data.workflowPost.postData.includes('promptVersionId')
    const okResponse = data.workflowOk?.status === 200
    if (startedEnabled && sentPromptVersion && okResponse)
      return true
  }

  return undefined
}

function inferProof(data: AssertionData) {
  if (data.pending && data.afterClick && data.recovered) {
    const held = summarizeHeld(data.pending.held)
    const blocked = Array.isArray(data.afterClick.workflowRequests) && data.afterClick.workflowRequests.length === 0
      ? '; disabled click sends no workflow request'
      : ''
    const recovered = data.recovered.runDisabled === false
      ? '; Run re-enables after recovery'
      : ''
    return `Run disabled while ${held || 'save is pending'}${blocked}${recovered}`
  }

  if (data.guarded && data.afterClick && data.recovered) {
    const guardedState = data.guarded.creatingDraftState === true
      ? 'creating-draft state is active'
      : 'guarded state is active'
    const blocked = Array.isArray(data.afterClick.workflowRequests) && data.afterClick.workflowRequests.length === 0
      ? '; disabled click sends no workflow request'
      : ''
    const recovered = data.recovered.runDisabled === false
      ? '; Run re-enables after recovery'
      : ''
    return `Run disabled while ${guardedState}${blocked}${recovered}`
  }

  if (data.workflowPost || data.workflowOk) {
    const method = data.workflowPost?.method ?? 'POST'
    const url = routeOnly(data.workflowPost?.url ?? '/workflow/test')
    const promptVersion = typeof data.workflowPost?.postData === 'string' && data.workflowPost.postData.includes('promptVersionId')
      ? ' with promptVersionId'
      : ''
    const status = data.workflowOk?.status ? ` and receives ${data.workflowOk.status}` : ''
    return `Run sends ${method} ${url}${promptVersion}${status}`
  }

  return undefined
}

function summarizeHeld(held: RequestLike[] | undefined) {
  if (!Array.isArray(held) || held.length === 0)
    return null

  return held
    .slice(0, 2)
    .map(request => `${request.method ?? 'REQUEST'} ${routeOnly(request.url ?? '')}`.trim())
    .join(', ')
}

function routeOnly(value: string) {
  try {
    return new URL(value).pathname
  }
  catch {
    return value
  }
}

function compactDetails(data: AssertionData) {
  const excludedKeys = new Set(['case', 'name', 'pass', 'proof', 'media', 'network'])

  return Object.fromEntries(
    Object.entries(data)
      .filter(([key, value]) => !excludedKeys.has(key) && value !== undefined)
      .map(([key, value]) => [key, SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : summarize(value)]),
  )
}

function summarize(value: unknown): SummaryValue {
  if (value === null || typeof value !== 'object')
    return typeof value === 'string' ? summarizeString(value) : value as SummaryValue

  if (Array.isArray(value))
    return value.slice(0, 10).map(summarize)

  const summary: Record<string, SummaryValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'postData' && typeof item === 'string')
      summary[key] = summarizePostData(item)
    else if (SENSITIVE_KEY_PATTERN.test(key))
      summary[key] = '[REDACTED]'
    else if (typeof item === 'string')
      summary[key] = summarizeString(item)
    else if (Array.isArray(item))
      summary[key] = item.slice(0, 10).map(summarize)
    else if (item && typeof item === 'object')
      summary[key] = summarize(item)
    else
      summary[key] = item
  }
  return summary
}

function summarizeString(value: string) {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value
}

function redactSensitiveKeyName(key: string) {
  return SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED_KEY]' : key
}
