import { describe, expect, test } from 'bun:test'
import {
  alternateHookHarness,
  detectHookHarness,
  encodeProjectPath,
  getProjectStateDir,
  getProjectsBaseDir,
  getSessionStateDir,
} from './harness.ts'

describe('detectHookHarness', () => {
  test('detects Claude when permission_mode is absent', () => {
    expect(detectHookHarness({})).toBe('claude')
  })

  test('detects Codex when permission_mode is present', () => {
    expect(detectHookHarness({ permission_mode: 'default' })).toBe('codex')
  })
})

describe('path helpers', () => {
  const cwd = '/tmp/my.project'
  const encoded = '-tmp-my-project'

  test('encodes project paths consistently', () => {
    expect(encodeProjectPath(cwd)).toBe(encoded)
  })

  test('returns harness-specific project roots', () => {
    expect(getProjectsBaseDir('claude')).toEndWith('/.claude/projects')
    expect(getProjectsBaseDir('codex')).toEndWith('/.codex/projects')
  })

  test('builds project and session state dirs', () => {
    expect(getProjectStateDir('claude', cwd)).toEndWith(`/.claude/projects/${encoded}`)
    expect(getProjectStateDir('codex', cwd)).toEndWith(`/.codex/projects/${encoded}`)
    expect(getSessionStateDir('codex', cwd, 'abc')).toEndWith(`/.codex/projects/${encoded}/abc`)
  })
})

describe('alternateHookHarness', () => {
  test('swaps claude and codex', () => {
    expect(alternateHookHarness('claude')).toBe('codex')
    expect(alternateHookHarness('codex')).toBe('claude')
  })
})

