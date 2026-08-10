import { afterEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
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
    const dom = new JSDOM(result.html, { runScripts: 'dangerously' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(dom.window.document.getElementById('root')?.textContent).toBe('React starter ready')
    dom.window.close()
  })

  it('structurally recognizes an unquoted local module entry without enabling filesystem resolution', async () => {
    const result = await bundleReactProject([
      { ...reactStarter[0], content: '<main id=root></main><script type=module src=/src/main.tsx></script>' },
      { path: 'src/main.tsx', content: "document.getElementById('root').textContent = 'unquoted entry'" },
    ], 'index.html')

    expect(result.diagnostics).toEqual([])
    expect(result.html).toContain('unquoted entry')
    expect(result.html).not.toContain('src="/src/main.tsx"')
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

  it('cancels a requested build before allocating a worker slot', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(bundleReactProject(reactStarter, 'index.html', { signal: controller.signal })).rejects.toThrow('cancelled')
  })

  it('rejects input and output beyond fixed limits before it can exhaust memory', async () => {
    await expect(bundleReactProject([{ path: 'src/main.tsx', content: 'x'.repeat(1_100_000) }], 'src/main.tsx')).rejects.toThrow('input limit')
  })

  it('rejects an obvious unbounded loop before shipping the bundle to the browser thread', async () => {
    const result = await bundleReactProject([
      reactStarter[0],
      { path: 'src/main.tsx', content: 'while (true) {}' },
    ], 'index.html')

    expect(result.html).toBe('')
    expect(result.diagnostics[0].message).toContain('unbounded loop')
  })

  it('blocks absolute, file URL, UNC, Windows drive, and non-allowlisted bare imports without filesystem disclosure', async () => {
    for (const request of ['C:/package.json', 'file:///C:/package.json', '\\\\server\\share\\secret.js', '/etc/passwd', 'not-allowed-package']) {
      const result = await bundleReactProject([
        reactStarter[0],
        { path: 'src/main.tsx', content: `import secret from ${JSON.stringify(request)}; console.log(secret)` },
      ], 'index.html')
      expect(result.html).toBe('')
      expect(result.diagnostics[0].message).toContain('Non-project import blocked')
      expect(result.diagnostics.map((item) => item.message).join(' ')).not.toContain('lotus-app-builder')
      expect(result.diagnostics.map((item) => item.message).join(' ')).not.toContain('"name"')
    }
  })

  it('instruments computed loops so a Date-based runaway aborts within the runtime budget', async () => {
    const result = await bundleReactProject([
      reactStarter[0],
      { path: 'src/main.tsx', content: 'while (Date.now()) {}' },
    ], 'index.html')

    expect(result.html).toContain('__lotusGuard')
    expect(result.html).toContain('execution budget exceeded')
  })

  it('bundles virtual SVG and font assets without exposing filesystem paths', async () => {
    const result = await bundleReactProject([
      reactStarter[0],
      { path: 'src/main.tsx', content: "import icon from './icon.svg'; import './font.css'; document.getElementById('root')!.innerHTML = `<img src='${icon}'>`" },
      { path: 'src/icon.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>' },
      { path: 'src/font.css', content: "@font-face{font-family:x;src:url('./font.woff2')}" },
      { path: 'src/font.woff2', content: 'AAECAwQ=' },
    ], 'index.html')

    expect(result.diagnostics).toEqual([])
    expect(result.html).toContain('data:image/svg+xml')
    expect(result.html).toContain('data:font/woff2')
    expect(result.html).not.toContain(process.cwd())
  })
})
