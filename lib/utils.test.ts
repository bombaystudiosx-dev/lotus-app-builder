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
})
