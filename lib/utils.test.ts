import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('merges conflicting Tailwind classes and omits falsey values', () => {
    expect(cn('p-2', false && 'hidden', 'p-4', undefined)).toBe('p-4')
  })
})
