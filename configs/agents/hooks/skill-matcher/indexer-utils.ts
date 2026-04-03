#!/usr/bin/env bun
/**
 * Indexer utilities - testable functions for skill parsing and hashing.
 */

import { createHash } from 'node:crypto'

export interface SkillFrontmatter {
  name: string
  description: string
  'user-invocable'?: boolean
}

/**
 * Parse YAML frontmatter from skill markdown.
 * Simple parser for flat key-value pairs. Does NOT support:
 * - Multi-line values (|, >)
 * - Nested objects
 * - Arrays
 * If you need complex YAML, use a library like 'gray-matter'.
 */
export function parseFrontmatter(content: string, skillName?: string): SkillFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) {
    if (skillName) console.warn(`  Warning: ${skillName} has no frontmatter`)
    return null
  }

  const yaml = match[1]
  if (!yaml) return null

  const result: Record<string, unknown> = {}

  try {
    // Simple YAML parser for flat key-value pairs
    for (const line of yaml.split('\n')) {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue

      const key = line.slice(0, colonIndex).trim()
      let value: unknown = line.slice(colonIndex + 1).trim()

      // Handle quoted strings (preserves colons inside quotes)
      if (typeof value === 'string') {
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        // Handle booleans
        if (value === 'true') value = true
        if (value === 'false') value = false
      }

      result[key] = value
    }
  } catch (error) {
    if (skillName) console.warn(`  Warning: ${skillName} frontmatter parse error: ${error}`)
    return null
  }

  if (!result.name || !result.description) {
    if (skillName) console.warn(`  Warning: ${skillName} missing required name or description`)
    return null
  }

  return result as unknown as SkillFrontmatter
}

/**
 * Compute SHA-256 hash of content.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
