#!/usr/bin/env bun
/**
 * Skills indexer for skill matcher.
 * Parses skill frontmatter, generates embeddings, and stores in SQLite.
 * Supports incremental indexing via content hashing.
 *
 * Usage: bun ~/.claude/bin/index-skills.ts [--force]
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Import from skill-matcher hook directory
const CLAUDE_DIR = join(homedir(), '.claude')
const HOOKS_DIR = join(CLAUDE_DIR, 'hooks', 'skill-matcher')
const SKILLS_DIR = join(CLAUDE_DIR, 'skills')
const INDEX_STATE_PATH = join(HOOKS_DIR, '.index-state.json')

interface IndexState {
  [skillName: string]: string // skill name -> content hash
}

// Dynamic imports to use modules from hooks directory
// Use pathToFileURL for ESM compatibility
async function loadModules() {
  const dbPath = pathToFileURL(join(HOOKS_DIR, 'db.ts')).href
  const embedPath = pathToFileURL(join(HOOKS_DIR, 'embed.ts')).href
  const configPath = pathToFileURL(join(HOOKS_DIR, 'config.ts')).href
  const utilsPath = pathToFileURL(join(HOOKS_DIR, 'indexer-utils.ts')).href

  const { upsertSkill, deleteSkill, getAllSkills, closeDb } = await import(dbPath)
  const { generateEmbedding, checkOllamaAvailable, getOllamaModelError } = await import(embedPath)
  const { CONFIG } = await import(configPath)
  const { parseFrontmatter, hashContent } = await import(utilsPath)
  return { upsertSkill, deleteSkill, getAllSkills, closeDb, generateEmbedding, checkOllamaAvailable, getOllamaModelError, CONFIG, parseFrontmatter, hashContent }
}

/**
 * Load index state from file.
 */
function loadIndexState(): IndexState {
  if (!existsSync(INDEX_STATE_PATH)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(INDEX_STATE_PATH, 'utf-8'))
  }
  catch {
    return {}
  }
}

/**
 * Save index state to file.
 */
function saveIndexState(state: IndexState): void {
  writeFileSync(INDEX_STATE_PATH, JSON.stringify(state, null, 2))
}

/**
 * Discover all skills in the skills directory.
 */
function discoverSkills(): Array<{ name: string, path: string }> {
  const skills: Array<{ name: string, path: string }> = []

  if (!existsSync(SKILLS_DIR)) {
    console.error(`Skills directory not found: ${SKILLS_DIR}`)
    return skills
  }

  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink())
      continue

    const skillPath = join(SKILLS_DIR, entry.name, 'SKILL.md')
    if (existsSync(skillPath)) {
      skills.push({ name: entry.name, path: skillPath })
    }
  }

  return skills
}

async function main() {
  const forceReindex = process.argv.includes('--force')

  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║   SKILL INDEXER: Building skill search database          ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log()

  // Load modules
  const { upsertSkill, deleteSkill, getAllSkills, closeDb, generateEmbedding, checkOllamaAvailable, CONFIG, parseFrontmatter, hashContent } = await loadModules()

  // Check Ollama availability (optional — FTS works without it)
  console.log('Checking Ollama availability...')
  const ollamaAvailable = await checkOllamaAvailable()
  if (!ollamaAvailable) {
    console.log('Ollama not available — indexing with FTS only (no semantic search)')
  }
  else {
    console.log(`Ollama is available with model: ${CONFIG.embeddingModel}`)
  }
  console.log()

  // Load current index state
  const indexState = forceReindex ? {} : loadIndexState()
  const newState: IndexState = {}

  // Discover skills
  const skills = discoverSkills()
  console.log(`Found ${skills.length} skills in ${SKILLS_DIR}`)
  console.log()

  let indexed = 0
  let skipped = 0
  let removed = 0

  // Process each skill
  for (const skill of skills) {
    const content = readFileSync(skill.path, 'utf-8')
    const frontmatter = parseFrontmatter(content, skill.name)

    if (!frontmatter) {
      console.log(`SKIP: ${skill.name} - invalid frontmatter`)
      skipped++
      continue
    }

    // Check if user-invocable is explicitly false
    if (frontmatter['user-invocable'] === false) {
      console.log(`SKIP: ${skill.name} - user-invocable: false`)
      skipped++
      continue
    }

    // Check if in exclude list
    if (CONFIG.excludeSkills.includes(frontmatter.name)) {
      console.log(`SKIP: ${skill.name} - in exclude list`)
      skipped++
      continue
    }

    // Compute hash for incremental indexing
    const indexableContent = `${frontmatter.name}\n${frontmatter.description}`
    const contentHash = hashContent(indexableContent)

    // Check if unchanged
    if (indexState[frontmatter.name] === contentHash) {
      console.log(`UNCHANGED: ${skill.name}`)
      newState[frontmatter.name] = contentHash
      skipped++
      continue
    }

    // Generate embedding (or use zero vector if Ollama unavailable)
    console.log(`INDEXING: ${skill.name}...`)
    try {
      let embedding: Float32Array
      if (ollamaAvailable) {
        embedding = await generateEmbedding(indexableContent)
        console.log(`  ✓ Indexed with ${embedding.length}-dimensional embedding`)
      }
      else {
        embedding = new Float32Array(1) // dummy — FTS handles search
        console.log(`  ✓ Indexed (FTS only)`)
      }
      upsertSkill(frontmatter.name, frontmatter.description, embedding)
      newState[frontmatter.name] = contentHash
      indexed++
    }
    catch (error) {
      console.error(`  ✗ Failed: ${error}`)
    }
  }

  // Remove skills no longer present
  const existingSkills = getAllSkills()
  const currentSkillNames = new Set(skills.map((s) => {
    const content = readFileSync(s.path, 'utf-8')
    const fm = parseFrontmatter(content)
    return fm?.name
  }).filter(Boolean))

  for (const existing of existingSkills) {
    if (!currentSkillNames.has(existing.name)) {
      console.log(`REMOVING: ${existing.name} - no longer exists`)
      deleteSkill(existing.name)
      removed++
    }
  }

  // Save new index state
  saveIndexState(newState)

  // Close database
  closeDb()

  console.log()
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║   INDEXING COMPLETE                                      ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log()
  console.log(`  Indexed: ${indexed}`)
  console.log(`  Skipped: ${skipped}`)
  console.log(`  Removed: ${removed}`)
  console.log()
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
