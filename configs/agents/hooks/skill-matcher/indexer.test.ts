#!/usr/bin/env bun
/**
 * Tests for indexer utilities.
 * Focus on pure functions that don't require external dependencies.
 */

import { describe, test, expect } from 'bun:test'

// Import will be from the indexer utilities module
// Since index-skills.ts is an executable script, we'll extract testable functions

describe('parseFrontmatter', () => {
  test('parses valid frontmatter with name and description', async () => {
    const { parseFrontmatter } = await import('./indexer-utils.ts')

    const content = `---
name: writing-plans
description: Create detailed implementation plans
user-invocable: true
---

# Writing Plans Skill
`
    const result = parseFrontmatter(content)
    expect(result).not.toBeNull()
    expect(result?.name).toBe('writing-plans')
    expect(result?.description).toBe('Create detailed implementation plans')
    expect(result?.['user-invocable']).toBe(true)
  })

  test('handles user-invocable: false', async () => {
    const { parseFrontmatter } = await import('./indexer-utils.ts')

    const content = `---
name: manager-review
description: Internal review skill
user-invocable: false
---
`
    const result = parseFrontmatter(content)
    expect(result?.['user-invocable']).toBe(false)
  })

  test('returns null for missing frontmatter', async () => {
    const { parseFrontmatter } = await import('./indexer-utils.ts')

    const content = `# No Frontmatter
Just regular markdown.
`
    const result = parseFrontmatter(content)
    expect(result).toBeNull()
  })

  test('returns null for missing required fields', async () => {
    const { parseFrontmatter } = await import('./indexer-utils.ts')

    const content = `---
name: only-name
---
`
    const result = parseFrontmatter(content)
    expect(result).toBeNull()
  })

  test('handles quoted values with colons', async () => {
    const { parseFrontmatter } = await import('./indexer-utils.ts')

    const content = `---
name: test-skill
description: "A skill: with colon"
---
`
    const result = parseFrontmatter(content)
    expect(result?.description).toBe('A skill: with colon')
  })

  test('handles single-quoted values', async () => {
    const { parseFrontmatter } = await import('./indexer-utils.ts')

    const content = `---
name: test-skill
description: 'Single quoted description'
---
`
    const result = parseFrontmatter(content)
    expect(result?.description).toBe('Single quoted description')
  })
})

describe('hashContent', () => {
  test('returns consistent hash for same content', async () => {
    const { hashContent } = await import('./indexer-utils.ts')

    const content = 'test content'
    const hash1 = hashContent(content)
    const hash2 = hashContent(content)
    expect(hash1).toBe(hash2)
  })

  test('returns different hash for different content', async () => {
    const { hashContent } = await import('./indexer-utils.ts')

    const hash1 = hashContent('content A')
    const hash2 = hashContent('content B')
    expect(hash1).not.toBe(hash2)
  })

  test('returns hex string of correct length (64 chars for SHA-256)', async () => {
    const { hashContent } = await import('./indexer-utils.ts')

    const hash = hashContent('any content')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]+$/)
  })
})
