#!/usr/bin/env bun
/**
 * SQLite database operations for skill matcher.
 * Uses bun:sqlite for high-performance synchronous access.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Database } from 'bun:sqlite'
import { CONFIG } from './config.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, CONFIG.dbFilename)

let _db: Database | null = null

export interface SkillRow {
  name: string
  description: string
  embedding: Uint8Array
  updated_at: number
}

export interface FtsMatch {
  name: string
  description: string
  rank: number
}

/**
 * Get or create database connection (singleton).
 */
export function getDb(): Database {
  if (!_db) {
    _db = new Database(DB_PATH, { create: true })
    _db.run('PRAGMA journal_mode = WAL')
    initSchema(_db)
  }
  return _db
}

/**
 * Initialize database schema if not exists.
 */
function initSchema(db: Database): void {
  // Main skills table
  db.run(`
    CREATE TABLE IF NOT EXISTS skills (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      embedding BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // FTS5 virtual table for full-text search
  // Check if FTS table exists first
  const ftsExists = db.query(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='skills_fts'
  `).get()

  if (!ftsExists) {
    db.run(`
      CREATE VIRTUAL TABLE skills_fts USING fts5(
        name,
        description,
        content='skills',
        content_rowid='rowid',
        tokenize='porter unicode61'
      )
    `)

    // Triggers to keep FTS in sync
    db.run(`
      CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
        INSERT INTO skills_fts(rowid, name, description)
        VALUES (NEW.rowid, NEW.name, NEW.description);
      END
    `)

    db.run(`
      CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.description);
      END
    `)

    db.run(`
      CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.description);
        INSERT INTO skills_fts(rowid, name, description)
        VALUES (NEW.rowid, NEW.name, NEW.description);
      END
    `)
  }
}

/**
 * Upsert a skill into the database.
 */
export function upsertSkill(
  name: string,
  description: string,
  embedding: Float32Array,
): void {
  const db = getDb()
  const embeddingBlob = new Uint8Array(embedding.buffer)

  db.run(`
    INSERT INTO skills (name, description, embedding, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      embedding = excluded.embedding,
      updated_at = excluded.updated_at
  `, [name, description, embeddingBlob, Date.now()])
}

/**
 * Delete a skill from the database.
 */
export function deleteSkill(name: string): void {
  const db = getDb()
  db.run('DELETE FROM skills WHERE name = ?', [name])
}

/**
 * Get all skills with embeddings.
 */
export function getAllSkills(): SkillRow[] {
  const db = getDb()
  return db.query('SELECT name, description, embedding, updated_at FROM skills').all() as SkillRow[]
}

/**
 * Get a single skill by name.
 */
export function getSkillByName(name: string): { name: string, description: string } | null {
  const db = getDb()
  const result = db.query('SELECT name, description FROM skills WHERE name = ?').get(name)
  return result as { name: string, description: string } | null
}

/**
 * Full-text search on skills.
 * Returns skills ranked by FTS5 BM25 score.
 */
export function searchFts(query: string, limit: number = 20): FtsMatch[] {
  const db = getDb()

  // Sanitize query: keep only alphanumeric and spaces, then create prefix search
  const sanitized = query
    .replace(/[^a-z0-9\s]/gi, ' ') // Replace non-alphanumeric with space
    .split(/\s+/)
    .filter(term => term.length > 1) // Skip single chars
    .map(term => `"${term}"*`)
    .join(' OR ')

  if (!sanitized)
    return []

  try {
    const results = db.query(`
      SELECT
        s.name,
        s.description,
        bm25(skills_fts) as rank
      FROM skills_fts
      JOIN skills s ON s.rowid = skills_fts.rowid
      WHERE skills_fts MATCH $query
      ORDER BY rank
      LIMIT $limit
    `).all({ $query: sanitized, $limit: limit })

    return results as FtsMatch[]
  }
  catch (error) {
    // FTS query errors (malformed query) - return empty results
    console.error(`FTS search error: ${error}`)
    return []
  }
}

/**
 * Check if database exists and has data.
 */
export function dbExists(): boolean {
  return existsSync(DB_PATH)
}

/**
 * Close database connection.
 */
export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
