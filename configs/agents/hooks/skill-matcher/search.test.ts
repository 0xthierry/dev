#!/usr/bin/env bun
/**
 * Tests for hybrid search implementation.
 * Focus on pure algorithmic functions that don't require external dependencies.
 */

import { describe, expect, test } from 'bun:test'

// We'll test the exported functions and some internal logic
// Import will be added after implementation

describe('cosineSimilarity', () => {
  test('identical vectors return 1', async () => {
    const { cosineSimilarity } = await import('./search.ts')
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([1, 0, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
  })

  test('orthogonal vectors return 0', async () => {
    const { cosineSimilarity } = await import('./search.ts')
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([0, 1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
  })

  test('opposite vectors return -1', async () => {
    const { cosineSimilarity } = await import('./search.ts')
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([-1, 0, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5)
  })

  test('handles non-unit vectors correctly', async () => {
    const { cosineSimilarity } = await import('./search.ts')
    // [3, 4] and [6, 8] are parallel (same direction, different magnitude)
    const a = new Float32Array([3, 4])
    const b = new Float32Array([6, 8])
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
  })

  test('throws on dimension mismatch', async () => {
    const { cosineSimilarity } = await import('./search.ts')
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([1, 0])
    expect(() => cosineSimilarity(a, b)).toThrow('dimension mismatch')
  })

  test('returns 0 for zero vectors', async () => {
    const { cosineSimilarity } = await import('./search.ts')
    const a = new Float32Array([0, 0, 0])
    const b = new Float32Array([1, 0, 0])
    expect(cosineSimilarity(a, b)).toBe(0)
  })
})

describe('reciprocalRankFusion', () => {
  test('combines results from two lists', async () => {
    const { reciprocalRankFusion } = await import('./search.ts')

    const semanticResults = [
      { name: 'skill-a', description: 'Skill A', similarity: 0.9 },
      { name: 'skill-b', description: 'Skill B', similarity: 0.8 },
    ]

    const ftsResults = [
      { name: 'skill-b', description: 'Skill B', rank: -1.5 },
      { name: 'skill-c', description: 'Skill C', rank: -1.2 },
    ]

    const k = 60
    const result = reciprocalRankFusion(semanticResults, ftsResults, k)

    // skill-a: only in semantic (rank 1) -> 1/(60+1) = 0.0164
    expect(result.get('skill-a')?.score).toBeCloseTo(1 / 61, 4)

    // skill-b: in both (semantic rank 2, fts rank 1) -> 1/(60+2) + 1/(60+1) = 0.0328
    expect(result.get('skill-b')?.score).toBeCloseTo(1 / 62 + 1 / 61, 4)

    // skill-c: only in fts (rank 2) -> 1/(60+2) = 0.0161
    expect(result.get('skill-c')?.score).toBeCloseTo(1 / 62, 4)
  })

  test('tracks source ranks correctly', async () => {
    const { reciprocalRankFusion } = await import('./search.ts')

    const semanticResults = [
      { name: 'skill-a', description: 'A', similarity: 0.9 },
    ]

    const ftsResults = [
      { name: 'skill-b', description: 'B', rank: -1.5 },
    ]

    const result = reciprocalRankFusion(semanticResults, ftsResults, 60)

    // skill-a: semantic only
    expect(result.get('skill-a')?.semanticRank).toBe(1)
    expect(result.get('skill-a')?.ftsRank).toBeNull()

    // skill-b: fts only
    expect(result.get('skill-b')?.semanticRank).toBeNull()
    expect(result.get('skill-b')?.ftsRank).toBe(1)
  })
})

describe('filterExcluded', () => {
  test('removes excluded skills', async () => {
    const { filterExcluded } = await import('./search.ts')

    const results = [
      { name: 'getting-started', description: 'A', score: 0.5, semanticRank: 1, ftsRank: null },
      { name: 'writing-plans', description: 'B', score: 0.4, semanticRank: 2, ftsRank: null },
      { name: 'manager-review', description: 'C', score: 0.3, semanticRank: 3, ftsRank: null },
    ]

    const excluded = ['getting-started', 'manager-review']
    const filtered = filterExcluded(results, excluded)

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.name).toBe('writing-plans')
  })
})

describe('blobToFloat32Array', () => {
  test('converts Uint8Array to Float32Array', async () => {
    const { blobToFloat32Array } = await import('./search.ts')

    // Create a Float32Array, convert to Uint8Array, then back
    const original = new Float32Array([1.0, 2.0, 3.0])
    const blob = new Uint8Array(original.buffer)
    const restored = blobToFloat32Array(blob)

    expect(restored[0]).toBeCloseTo(1.0, 5)
    expect(restored[1]).toBeCloseTo(2.0, 5)
    expect(restored[2]).toBeCloseTo(3.0, 5)
  })
})

describe('hardTriggers config patterns', () => {
  test('matches "implement the plan" variations', async () => {
    const { CONFIG } = await import('./config.ts')
    const patterns = CONFIG.hardTriggers.filter(t => t.skill === 'implement-plan')

    expect(patterns[0]!.pattern.test('implement the plan')).toBe(true)
    expect(patterns[0]!.pattern.test('implement plan')).toBe(true)
    expect(patterns[0]!.pattern.test('implementing the plan')).toBe(true)
    expect(patterns[0]!.pattern.test('IMPLEMENT THE PLAN')).toBe(true)
  })

  test('matches ai_docs/tasks/ path', async () => {
    const { CONFIG } = await import('./config.ts')
    const patterns = CONFIG.hardTriggers.filter(t => t.skill === 'implement-plan')

    expect(patterns[1]!.pattern.test('ai_docs/tasks/my-task.md')).toBe(true)
    expect(patterns[1]!.pattern.test('implement ai_docs/tasks/2025-01-14-feature.md')).toBe(true)
  })

  test('matches debugging triggers', async () => {
    const { CONFIG } = await import('./config.ts')
    const pattern = CONFIG.hardTriggers.find(t => t.skill === 'systematic-debugging')!.pattern

    expect(pattern.test('fix the bug')).toBe(true)
    expect(pattern.test('there is an error')).toBe(true)
    expect(pattern.test('the test is failing')).toBe(true)
    expect(pattern.test('app crashed')).toBe(true)
    expect(pattern.test('build failure')).toBe(true)
    expect(pattern.test('it is broken')).toBe(true)
    expect(pattern.test('not working')).toBe(true)
  })

  test('matches commit triggers', async () => {
    const { CONFIG } = await import('./config.ts')
    const patterns = CONFIG.hardTriggers.filter(t => t.skill === 'ci-commit')

    expect(patterns[0]!.pattern.test('/commit')).toBe(true)
    expect(patterns[1]!.pattern.test('commit the changes')).toBe(true)
    expect(patterns[1]!.pattern.test('commit code')).toBe(true)
  })

  test('matches handoff triggers', async () => {
    const { CONFIG } = await import('./config.ts')
    const patterns = CONFIG.hardTriggers.filter(t => t.skill === 'handoff')

    expect(patterns[0]!.pattern.test('handoff')).toBe(true)
    expect(patterns[1]!.pattern.test('continue later')).toBe(true)
  })

  test('does not false-positive on unrelated text', async () => {
    const { CONFIG } = await import('./config.ts')
    const implementPattern = CONFIG.hardTriggers.find(t => t.pattern.source.includes('implement'))!.pattern

    expect(implementPattern.test('tell me about implementation details')).toBe(false)
    expect(implementPattern.test('what is a plan')).toBe(false)
  })
})
