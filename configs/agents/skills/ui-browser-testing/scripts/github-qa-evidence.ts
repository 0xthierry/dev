#!/usr/bin/env bun
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

type Args = {
  manifest?: string
  urls?: string
  output?: string
  pr?: string
  repo?: string
  section?: string
}

type UrlValue =
  | string
  | UrlValue[]
  | {
    case?: string
    name?: string
    url?: UrlValue
    urls?: UrlValue
    video?: UrlValue
    videos?: UrlValue
    screenshot?: UrlValue
    screenshots?: UrlValue
    media?: UrlValue
  }

type RequestLike = {
  method?: string
  status?: number
  url?: string
  postData?: unknown
}

type Details = {
  expected?: unknown
  observed?: unknown
  action?: unknown
  workflowPost?: RequestLike
  workflowOk?: RequestLike
  pending?: {
    held?: RequestLike[]
  }
  guarded?: {
    creatingDraftState?: boolean
  }
  afterClick?: {
    workflowRequests?: RequestLike[]
  }
  recovered?: {
    runDisabled?: boolean | null
  }
}

type ManifestEntry = {
  case: string
  pass?: boolean
  proof?: string
  details?: Details
}

type Manifest = {
  passed?: number
  failed?: number
  unknown?: number
  entries: ManifestEntry[]
}

function usage() {
  console.error(`Usage:
  bun github-qa-evidence.ts --manifest manifest.json --urls uploaded-urls.json [--output section.md]
  bun github-qa-evidence.ts --manifest manifest.json --urls uploaded-urls.json --pr <number> [--repo owner/repo]

Renders a GitHub PR QA evidence section from a qa-manifest.ts manifest and a
case-to-uploaded-URLs JSON file. When --pr is provided, updates/replaces the
section in the PR body with gh. PR updates require every manifest case to have
at least one uploaded URL.`)
}

const args = parseArgs(process.argv.slice(2))

if (!args.manifest || !args.urls) {
  usage()
  process.exit(2)
}

const manifest = readJson<Manifest>(args.manifest)
validateManifest(manifest)
const uploadedUrls = normalizeUrls(readJson(args.urls))
const sectionTitle = args.section ?? 'UI QA Evidence'
const section = renderSection(manifest, uploadedUrls, sectionTitle)

const missing = manifest.entries
  .filter(entry => !uploadedUrls.get(entry.case)?.length)
  .map(entry => entry.case)

if (args.pr && missing.length > 0) {
  console.error(`Refusing to update PR; missing uploaded URLs for cases: ${missing.join(', ')}`)
  process.exit(1)
}

if (args.output)
  writeFile(args.output, section)

if (args.pr) {
  updatePrBody(args.pr, args.repo, section, sectionTitle)
  console.log(`Updated PR ${args.pr} ${args.repo ? `in ${args.repo} ` : ''}with ${sectionTitle}`)
}
else if (!args.output) {
  console.log(section)
  if (missing.length > 0)
    console.error(`Missing uploaded URLs for cases: ${missing.join(', ')}`)
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      console.error(`Unexpected argument: ${arg}`)
      process.exit(2)
    }

    const key = arg.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      console.error(`Missing value for ${arg}`)
      process.exit(2)
    }

    parsed[key as keyof Args] = value
    i += 1
  }

  return parsed
}

function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

function validateManifest(manifest: Manifest) {
  if (!Array.isArray(manifest.entries)) {
    console.error('Invalid manifest: entries must be an array')
    process.exit(1)
  }

  if (manifest.entries.length === 0) {
    console.error('Invalid manifest: no QA cases found')
    process.exit(1)
  }
}

function writeFile(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${content}\n`)
  console.log(file)
}

function normalizeUrls(raw: unknown) {
  const map = new Map<string, string[]>()

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object')
        continue
      const value = item as { case?: string; name?: string }
      const caseName = value.case ?? value.name
      if (!caseName)
        continue
      map.set(caseName, collectUrls(item as UrlValue))
    }
    return map
  }

  if (raw && typeof raw === 'object') {
    for (const [caseName, value] of Object.entries(raw))
      map.set(caseName, collectUrls(value as UrlValue))
  }

  return map
}

function collectUrls(value: UrlValue | undefined): string[] {
  if (typeof value === 'string') {
    const normalized = normalizeUploadedUrl(value)
    return normalized ? [normalized] : []
  }

  if (Array.isArray(value))
    return value.flatMap(collectUrls)

  if (value && typeof value === 'object') {
    return [
      ...collectUrls(value.url ?? []),
      ...collectUrls(value.urls ?? []),
      ...collectUrls(value.video ?? []),
      ...collectUrls(value.videos ?? []),
      ...collectUrls(value.screenshot ?? []),
      ...collectUrls(value.screenshots ?? []),
      ...collectUrls(value.media ?? []),
    ]
  }

  return []
}

function normalizeUploadedUrl(value: string) {
  const raw = value.trim()
  if (!raw)
    return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  }
  catch {
    throw new Error(`Invalid uploaded evidence URL: ${raw}`)
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'github.com'
    || parsed.search
    || parsed.hash
    || !/^\/user-attachments\/assets\/[A-Za-z0-9_-]+$/.test(parsed.pathname)
  ) {
    throw new Error(`Invalid uploaded evidence URL: ${raw}`)
  }

  return parsed.href
}

function renderSection(manifest: Manifest, uploadedUrls: Map<string, string[]>, sectionTitle: string) {
  const rows = manifest.entries.map((entry) => {
    const result = entry.pass === true ? 'Pass' : entry.pass === false ? 'Fail' : 'Unknown'
    const urls = uploadedUrls.get(entry.case) ?? []
    const evidence = urls.length > 0
      ? urls.map((url, index) => `[evidence ${index + 1}](${url})`).join('<br>')
      : 'Missing uploaded URL'
    const finding = summarizeFinding(entry)

    return `| ${escapeCell(entry.case)} | ${result} | ${escapeCell(finding)} | ${evidence} |`
  })

  const counts = countResults(manifest.entries)
  const summary = [
    `${counts.passed} passed`,
    `${counts.failed} failed`,
    `${counts.unknown} unknown`,
  ].join(', ')

  return [
    `## ${sectionTitle}`,
    '',
    `QA manifest summary: ${summary}.`,
    '',
    '| Case | Result | QA Finding | Evidence |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

function countResults(entries: ManifestEntry[]) {
  return {
    passed: entries.filter(entry => entry.pass === true).length,
    failed: entries.filter(entry => entry.pass === false).length,
    unknown: entries.filter(entry => entry.pass === undefined).length,
  }
}

function summarizeFinding(entry: ManifestEntry) {
  if (entry.pass === true)
    return summarizeProvenBehavior(entry)

  if (entry.pass === undefined && entry.proof)
    return `Not proven: ${entry.proof}`

  const details = entry.details ?? {}
  const expected = summarizeExpected(details)
  const observed = summarizeObserved(details)

  if (entry.pass === false) {
    if (expected === 'not recorded' && observed === 'not recorded' && entry.proof)
      return `Failed: ${entry.proof}`
    return `Expected: ${expected}; Observed: ${observed}`
  }

  return `Not proven: expected ${expected}; observed ${observed}`
}

function summarizeProvenBehavior(entry: ManifestEntry) {
  if (entry.proof)
    return entry.proof

  const details = entry.details ?? {}
  const expected = summarizeExpected(details)
  if (expected !== 'not recorded')
    return expected

  const observed = summarizeObserved(details)
  if (observed !== 'not recorded')
    return observed

  return summarizeDerivedBehavior(details)
}

function summarizeExpected(details: Details) {
  const expected = details.expected

  if (typeof expected === 'string')
    return expected

  if (expected && typeof expected === 'object')
    return Object.entries(expected).map(([key, value]) => `${key}: ${stringifyShort(value)}`).join('; ')

  return 'not recorded'
}

function summarizeObserved(details: Details) {
  const observed = details.observed

  if (typeof observed === 'string')
    return observed

  if (observed && typeof observed === 'object')
    return Object.entries(observed).map(([key, value]) => `${key}: ${stringifyShort(value)}`).join('; ')

  return 'not recorded'
}

function summarizeDerivedBehavior(details: Details) {
  const action = details.action

  if (details.workflowPost || details.workflowOk) {
    const method = details.workflowPost?.method ?? 'POST'
    const url = routeOnly(details.workflowPost?.url ?? '/workflow/test')
    const promptVersion = stringifyShort(details.workflowPost?.postData ?? '').includes('promptVersionId')
      ? ' with promptVersionId'
      : ''
    const status = details.workflowOk?.status ? ` and receives ${details.workflowOk.status}` : ''
    return `Run sends ${method} ${url}${promptVersion}${status}`
  }

  if (details.pending && details.afterClick && details.recovered) {
    const held = summarizeHeld(details.pending.held)
    const blocked = emptyArray(details.afterClick.workflowRequests)
      ? '; disabled click sends no workflow request'
      : ''
    const recovered = details.recovered.runDisabled === false
      ? '; Run re-enables after recovery'
      : ''
    return `Run disabled while ${held || 'save is pending'}${blocked}${recovered}`
  }

  if (details.guarded && details.afterClick && details.recovered) {
    const guardedState = details.guarded.creatingDraftState === true
      ? 'creating-draft state is active'
      : 'guarded state is active'
    const blocked = emptyArray(details.afterClick.workflowRequests)
      ? '; disabled click sends no workflow request'
      : ''
    const recovered = details.recovered.runDisabled === false
      ? '; Run re-enables after recovery'
      : ''
    return `Run disabled while ${guardedState}${blocked}${recovered}`
  }

  if (action)
    return `Action: ${stringifyShort(action)}`

  return 'See assertion artifact'
}

function routeOnly(value: string) {
  try {
    return new URL(value).pathname
  }
  catch {
    return value
  }
}

function summarizeHeld(held: RequestLike[] | undefined) {
  if (!Array.isArray(held) || held.length === 0)
    return null

  return held
    .slice(0, 2)
    .map(request => `${request.method ?? 'REQUEST'} ${routeOnly(request.url ?? '')}`.trim())
    .join(', ')
}

function emptyArray(value: unknown) {
  return Array.isArray(value) && value.length === 0
}

function stringifyShort(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 180 ? `${text.slice(0, 180)}...` : text
}

function escapeCell(value: unknown) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

function updatePrBody(pr: string, repo: string | undefined, section: string, sectionTitle: string) {
  const viewArgs = ['pr', 'view', pr, '--json', 'body', '--jq', '.body']
  if (repo)
    viewArgs.push('--repo', repo)

  const body = execFileSync('gh', viewArgs, { encoding: 'utf8' })
  const nextBody = replaceSection(body, section, sectionTitle)
  const tempFile = path.join(os.tmpdir(), `github-qa-evidence-${process.pid}.md`)

  fs.writeFileSync(tempFile, nextBody)

  try {
    const editArgs = ['pr', 'edit', pr, '--body-file', tempFile]
    if (repo)
      editArgs.push('--repo', repo)
    execFileSync('gh', editArgs, { stdio: 'inherit' })
  }
  finally {
    fs.rmSync(tempFile, { force: true })
  }
}

function replaceSection(body: string, section: string, sectionTitle: string) {
  const headingPattern = new RegExp(`^## ${escapeRegExp(sectionTitle)}\\s*$`, 'm')
  const match = headingPattern.exec(body)

  if (!match || match.index === undefined)
    return body.trimEnd() ? `${body.trimEnd()}\n\n${section}\n` : `${section}\n`

  const start = match.index
  const afterHeading = start + match[0].length
  const next = body.slice(afterHeading).search(/\n##\s+/)
  if (next === -1)
    return `${body.slice(0, start).trimEnd()}\n\n${section}\n`

  const end = afterHeading + next
  return `${body.slice(0, start).trimEnd()}\n\n${section}\n\n${body.slice(end).trimStart()}`
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
