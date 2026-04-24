#!/usr/bin/env bun
/**
 * Hybrid search implementation combining:
 * - Cosine similarity for semantic search
 * - FTS5 for keyword search
 * - Reciprocal Rank Fusion (RRF) to combine results
 */

import type { SkillRow } from './db.ts'
import { CONFIG } from './config.ts'
import { getAllSkills, getSkillByName, searchFts } from './db.ts'
import { generateEmbedding } from './embed.ts'

export interface SearchResult {
  name: string
  description: string
  score: number
  semanticRank: number | null
  ftsRank: number | null
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0)
    return 0

  return dotProduct / denominator
}

/**
 * Convert Uint8Array blob to Float32Array embedding.
 */
export function blobToFloat32Array(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
}

/**
 * Semantic search using cosine similarity.
 * Returns skills sorted by similarity score (descending).
 */
function semanticSearch(
  queryEmbedding: Float32Array,
  skills: SkillRow[],
  limit: number,
): Array<{ name: string, description: string, similarity: number }> {
  const results = skills.map(skill => ({
    name: skill.name,
    description: skill.description,
    similarity: cosineSimilarity(queryEmbedding, blobToFloat32Array(skill.embedding)),
  }))

  // Sort by similarity descending
  results.sort((a, b) => b.similarity - a.similarity)

  return results.slice(0, limit)
}

/**
 * Reciprocal Rank Fusion (RRF) to combine two ranked lists.
 * Score = sum of 1/(k + rank) for each list where item appears.
 */
export function reciprocalRankFusion(
  semanticResults: Array<{ name: string, description: string, similarity: number }>,
  ftsResults: Array<{ name: string, description: string, rank: number }>,
  k: number,
): Map<string, { description: string, score: number, semanticRank: number | null, ftsRank: number | null }> {
  const scores = new Map<string, {
    description: string
    score: number
    semanticRank: number | null
    ftsRank: number | null
  }>()

  // Add semantic search contributions
  semanticResults.forEach((result, index) => {
    const rank = index + 1
    const rrfScore = 1 / (k + rank)

    scores.set(result.name, {
      description: result.description,
      score: rrfScore,
      semanticRank: rank,
      ftsRank: null,
    })
  })

  // Add FTS contributions
  ftsResults.forEach((result, index) => {
    const rank = index + 1
    const rrfScore = 1 / (k + rank)

    const existing = scores.get(result.name)
    if (existing) {
      existing.score += rrfScore
      existing.ftsRank = rank
    }
    else {
      scores.set(result.name, {
        description: result.description,
        score: rrfScore,
        semanticRank: null,
        ftsRank: rank,
      })
    }
  })

  return scores
}

/**
 * Filter out excluded skills.
 */
export function filterExcluded(
  results: SearchResult[],
  excludeSkills: readonly string[],
): SearchResult[] {
  const excluded = new Set(excludeSkills)
  return results.filter(r => !excluded.has(r.name))
}

/**
 * Check hard triggers and return skills that MUST be included.
 * Hard triggers take priority over similarity-based search.
 */
export function hardTriggerSearch(query: string): SearchResult[] {
  const matchedSkills = new Set<string>()

  for (const trigger of CONFIG.hardTriggers) {
    if (trigger.pattern.test(query)) {
      matchedSkills.add(trigger.skill)
    }
  }

  const results: SearchResult[] = []
  for (const skillName of matchedSkills) {
    const skill = getSkillByName(skillName)
    if (skill) {
      results.push({
        name: skill.name,
        description: skill.description,
        score: 1.0, // Maximum score for hard triggers
        semanticRank: null,
        ftsRank: null,
      })
    }
  }

  return results
}

/**
 * Perform hybrid search combining semantic and keyword search.
 * Hard triggers are checked first and guaranteed in results.
 */
export async function hybridSearch(query: string): Promise<SearchResult[]> {
  const semanticEnabled = process.env.SKILL_MATCHER_SEMANTIC_ENABLED === 'true'

  // Phase 1: Check hard triggers (guaranteed inclusion)
  const hardTriggered = hardTriggerSearch(query)
  const hardTriggeredNames = new Set(hardTriggered.map(r => r.name))

  // Get all skills from database
  const skills = getAllSkills()

  if (skills.length === 0) {
    return hardTriggered.slice(0, CONFIG.topK)
  }

  // Phase 2 & 3: Hybrid search or FTS-only
  let results: SearchResult[]

  if (semanticEnabled) {
    // Generate embedding for query with instruction prefix (1-5% better matching)
    const queryEmbedding = await generateEmbedding(
      `Match this request to relevant skills: ${query}`,
    )

    // Semantic search
    const semanticResults = semanticSearch(queryEmbedding, skills, 20)

    // FTS search
    const ftsResults = searchFts(query, 20)

    // Combine with RRF
    const fusedScores = reciprocalRankFusion(semanticResults, ftsResults, CONFIG.rrfK)

    // Convert to array and sort by score
    results = Array.from(fusedScores.entries())
      .map(([name, data]) => ({
        name,
        description: data.description,
        score: data.score,
        semanticRank: data.semanticRank,
        ftsRank: data.ftsRank,
      }))
      .sort((a, b) => b.score - a.score)
  }
  else {
    // FTS-only fallback (no semantic search)
    const ftsResults = searchFts(query, 20)

    results = ftsResults.map(r => ({
      name: r.name,
      description: r.description,
      score: 1 / (CONFIG.rrfK + r.rank), // Use RRF scoring for consistency
      semanticRank: null,
      ftsRank: r.rank,
    }))
  }

  // Filter excluded skills
  const filtered = filterExcluded(results, CONFIG.excludeSkills)

  // Apply minimum score threshold
  const thresholded = filtered.filter(r => r.score >= CONFIG.minRrfScore)

  // Merge: hard-triggered skills first, then fill remaining slots
  const remainingSlots = CONFIG.topK - hardTriggered.length
  const additionalResults = thresholded
    .filter(r => !hardTriggeredNames.has(r.name))
    .slice(0, Math.max(0, remainingSlots))

  return [...hardTriggered, ...additionalResults]
}

/**
 * Format search results for Claude's context.
 * Compact format — detailed evaluation rules live in CLAUDE.md.
 */
export function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return ''
  }

  const skills = results
    .map(r => `- **${r.name}**: ${r.description.slice(0, 100)}`)
    .join('\n')

  return `Matched skills (evaluate internally — invoke only if user clearly wants the action NOW):\n${skills}`
}
