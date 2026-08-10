import { afterEach, describe, expect, it } from 'vitest'
import { bundleReactProject, getActiveBuildCount } from '@/lib/local-bundler'

const reactStarter = [
  { path: 'index.html', content: '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>' },
  { path: 'src/main.tsx', content: "import React from 'react'; import { createRoot } from 'react-dom/client'; import './style.css'; const App = () => <main className='card'>React starter ready</main>; createRoot(document.getElementById('root')!).render(<App />)" },
  { path: 'src/style.css', content: '.card { color: rebeccapurple; }' },
]

afterEach(() => expect(getActiveBuildCount()).toBe(0))

describe('isolated local React bundler', () => {
  it('bundles a React/Vite-style starter into self-contained preview HTML', async () => {
    const result = await bundleReactProject(reactStarter, 'index.html')

    expect(result.html).toContain('React starter ready')
    expect(result.html).toContain('.card {')
    expect(result.html).not.toContain('src="/src/main.tsx"')
    expect(result.diagnostics).toEqual([])
  })

  it('reports broken source without leaking worker details', async () => {
    const result = await bundleReactProject([
      ...reactStarter.slice(0, 1),
      { path: 'src/main.tsx', content: 'const App = () => <main>broken' },
    ], 'index.html')

    expect(result.html).toBe('')
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', path: 'src/main.tsx' })
    expect(result.diagnostics[0].message).not.toContain(process.cwd())
  })

  it('terminates and cleans up workers that exceed deterministic time limits', async () => {
    await expect(bundleReactProject(reactStarter, 'index.html', { timeoutMs: 1 })).rejects.toThrow('timed out')
    expect(getActiveBuildCount()).toBe(0)
  })

  it('rejects input and output beyond fixed limits before it can exhaust memory', async () => {
    await expect(bundleReactProject([{ path: 'src/main.tsx', content: 'x'.repeat(1_100_000) }], 'src/main.tsx')).rejects.toThrow('input limit')
  })
})
