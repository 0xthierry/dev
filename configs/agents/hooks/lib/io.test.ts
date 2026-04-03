import { describe, expect, test } from 'bun:test'
import { resolveCommandCwd } from './io.ts'

describe('resolveCommandCwd', () => {
  const fallback = '/home/user/project-a'

  test('returns fallback when no cd prefix', () => {
    expect(resolveCommandCwd('git commit -m "fix"', fallback)).toBe(fallback)
  })

  test('extracts absolute path from cd && chain', () => {
    expect(resolveCommandCwd('cd /home/user/project-b && git commit -m "fix"', fallback))
      .toBe('/home/user/project-b')
  })

  test('extracts absolute path from cd ; chain', () => {
    expect(resolveCommandCwd('cd /home/user/project-b; git push', fallback))
      .toBe('/home/user/project-b')
  })

  test('extracts quoted path', () => {
    expect(resolveCommandCwd('cd "/home/user/my project" && git commit -m "fix"', fallback))
      .toBe('/home/user/my project')
  })

  test('extracts single-quoted path', () => {
    expect(resolveCommandCwd('cd \'/home/user/my project\' && git commit -m \'fix\'', fallback))
      .toBe('/home/user/my project')
  })

  test('resolves relative path against fallback', () => {
    expect(resolveCommandCwd('cd subdir && git commit -m "fix"', fallback))
      .toBe('/home/user/project-a/subdir')
  })

  test('handles leading whitespace', () => {
    expect(resolveCommandCwd('  cd /tmp/repo && git push', fallback))
      .toBe('/tmp/repo')
  })

  test('returns fallback for non-cd commands', () => {
    expect(resolveCommandCwd('git status', fallback)).toBe(fallback)
  })

  test('returns fallback for cd without separator', () => {
    // bare `cd /dir` with no && or ; — not a chained command
    expect(resolveCommandCwd('cd /tmp/repo', fallback)).toBe(fallback)
  })
})
