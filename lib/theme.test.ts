import { describe, expect, it } from 'vitest'
import { resolveThemePreference } from '@/lib/theme'

describe('resolveThemePreference', () => {
  it.each([
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
  ] as const)('resolves %s with system dark=%s as %s', (theme, systemPrefersDark, expected) => {
    expect(resolveThemePreference(theme, systemPrefersDark)).toBe(expected)
  })
})
