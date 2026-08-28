import { describe, expect, it } from 'vitest'
import { createProjectInputSchema, frameworkProjectSetup } from '@/lib/project-framework'

describe('project framework choices', () => {
  it('defaults safely to static HTML', () => {
    expect(createProjectInputSchema.parse({})).toEqual({ name: 'Untitled project', framework: 'static' })
    expect(frameworkProjectSetup('static')).toMatchObject({ runtime: 'static', framework: 'static', entryPath: 'index.html', targets: ['web'] })
  })

  it.each([
    ['react', 'react', 'vite'],
    ['nextjs', 'react', 'next'],
    ['expo', 'react', 'expo'],
  ] as const)('uses the React preview adapter for %s', (framework, runtime, buildTool) => {
    expect(frameworkProjectSetup(framework)).toMatchObject({ runtime, framework, buildTool, metadata: { generationEntry: 'src/App.jsx', previewAdapter: 'react' } })
  })
})
