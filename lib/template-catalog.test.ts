import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { TEMPLATE_CATALOG } from '@/lib/template-catalog'
import { renderStarterTemplate } from '@/lib/template-html'

describe('starter template catalog', () => {
  it('ships a complete, searchable collection backed by local photography', () => {
    expect(TEMPLATE_CATALOG).toHaveLength(8)
    expect(new Set(TEMPLATE_CATALOG.map((template) => template.id)).size).toBe(TEMPLATE_CATALOG.length)
    for (const template of TEMPLATE_CATALOG) {
      expect(existsSync(join(process.cwd(), 'public', template.image))).toBe(true)
      expect(template.features).toHaveLength(3)
      expect(template.metrics).toHaveLength(3)
    }
  })

  it('renders a responsive multi-section site that references its project asset', () => {
    const html = renderStarterTemplate(TEMPLATE_CATALOG[0])
    expect(html).toContain('assets/hero.jpg')
    expect(html).toContain('id="features"')
    expect(html).toContain('id="story"')
    expect(html).toContain('id="start"')
    expect(html).toContain('@media(max-width:800px)')
    expect(html.match(/<section/g)?.length).toBeGreaterThanOrEqual(5)
  })
})
