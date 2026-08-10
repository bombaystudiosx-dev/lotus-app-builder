'use client'

import { useEffect, useState } from 'react'
import { resolveThemePreference, type ThemePreference } from '@/lib/theme'

export function useResolvedTheme(theme: ThemePreference) {
  const [systemPrefersDark, setSystemPrefersDark] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemPrefersDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return resolveThemePreference(theme, systemPrefersDark)
}
