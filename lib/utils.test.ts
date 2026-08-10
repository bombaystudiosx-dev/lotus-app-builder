import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import { redactSensitiveValues } from '@/lib/safety'

describe('cn', () => {
  it('merges conflicting Tailwind classes and omits falsey values', () => {
    expect(cn('p-2', false && 'hidden', 'p-4', undefined)).toBe('p-4')
  })
})

describe('redactSensitiveValues', () => {
  it('removes common credential values before they can reach a preview or model prompt', () => {
    expect(redactSensitiveValues('VITE_API_KEY=not-for-the-browser Bearer token-value')).toBe(
      'VITE_API_KEY=[REDACTED] Bearer [REDACTED]',
    )
  })

  it('redacts credential families that do not use assignment syntax', () => {
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890'

    expect(redactSensitiveValues(`const client = { token: "${secret}" }`)).toBe(
      'const client = { token: "[REDACTED]" }',
    )
  })

  it('preserves quotes for assignments so generated JavaScript remains valid', () => {
    const source = 'const config = { VITE_API_KEY: "secret-value" }'
    const redacted = redactSensitiveValues(source)

    expect(redacted).toBe('const config = { VITE_API_KEY: "[REDACTED]" }')
    expect(() => new Function(redacted)).not.toThrow()
  })

  it('handles unquoted configuration assignments without exposing the secret', () => {
    expect(redactSensitiveValues('API_TOKEN=secret-value;')).toBe('API_TOKEN=[REDACTED];')
  })

  it('redacts camelCase configuration values while preserving valid JavaScript', () => {
    const source = 'const config = { apiKey: "plain-secret-value" }'
    const redacted = redactSensitiveValues(source)

    expect(redacted).toBe('const config = { apiKey: "[REDACTED]" }')
    expect(() => new Function(redacted)).not.toThrow()
  })
})
