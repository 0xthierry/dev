#!/usr/bin/env bun
import fs from 'node:fs'
import path from 'node:path'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type SummaryValue = undefined | null | boolean | number | string | SummaryValue[] | { [key: string]: SummaryValue }

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
  [key: string]: JsonValue | RequestLike | RequestLike[] | StateLike | undefined
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

const entries = files.map((file) => {
  const fullPath = path.join(assertionsDir, file)
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as AssertionData
  const caseName = data.case ?? data.name ?? path.basename(file, '.json')
  const pass = typeof data.pass === 'boolean' ? data.pass : inferPass(data)
  const videoPath = path.join(artifactDir, 'videos', `${caseName}.webm`)

  const entry = {
    case: caseName,
    pass,
    assertion: fullPath,
    media: {
      video: fs.existsSync(videoPath) ? videoPath : undefined,
      screenshots: collectScreenshots(artifactDir, caseName),
    },
    network: extractNetwork(data),
    proof: inferProof(data),
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
    .filter((event): event is RequestLike & { url: string } => Boolean(event?.url && (
      event.url.includes('/api/')
      || event.url.includes('/workflow')
      || event.url.includes('/prompt-version')
      || event.url.includes('/graphql')
    )))
    .map(event => ({
      type: event.type,
      method: event.method,
      status: event.status,
      url: event.url,
    }))
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
    const hasHeldRequest = Array.isArray(data.pending.held) && data.pending.held.length > 0
    const blockedRun = Array.isArray(data.afterClick.workflowRequests) && data.afterClick.workflowRequests.length === 0
    const recovered = data.recovered.runDisabled === false
    if (hasHeldRequest && data.pending.runDisabled === true && blockedRun && recovered)
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
  const keys = [
    'surface',
    'route',
    'precondition',
    'action',
    'expected',
    'observed',
    'before',
    'after',
    'pending',
    'guarded',
    'afterClick',
    'recovered',
    'workflowPost',
    'workflowOk',
    'cleanup',
  ]

  return Object.fromEntries(
    keys
      .filter(key => data[key] !== undefined)
      .map(key => [key, summarize(data[key])]),
  )
}

function summarize(value: JsonValue | RequestLike | RequestLike[] | StateLike | undefined): SummaryValue {
  if (value === null || typeof value !== 'object')
    return value

  if (Array.isArray(value))
    return value.slice(0, 10).map(summarize)

  const summary: Record<string, SummaryValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string')
      summary[key] = item.length > 500 ? `${item.slice(0, 500)}...` : item
    else if (Array.isArray(item))
      summary[key] = item.slice(0, 10).map(summarize)
    else if (item && typeof item === 'object')
      summary[key] = summarize(item)
    else
      summary[key] = item
  }
  return summary
}
