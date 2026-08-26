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

  it.each([
    { projectFiles: [] },
    { projectFiles: Array.from({ length: 251 }, (_, index) => ({ path: `file-${index}.js`, content: '' })) },
  ])('rejects unsafe project file counts', async ({ projectFiles }) => {
    await expect(bundleReactProject(projectFiles, 'index.html')).rejects.toThrow('input limit')
  })

  it.each([
    '/absolute.js',
    'src\\windows.js',
    'src//empty.js',
    'src/./dot.js',
    'src/../escape.js',
    '',
  ])('rejects unsafe virtual path: %s', async (path) => {
    await expect(bundleReactProject([{ path, content: '' }], path)).rejects.toThrow('unsafe build path')
  })

  it.each([
    { projectFiles: [{ path: 'index.html', content: '<main>No module</main>' }] },
    { projectFiles: [{ path: 'index.html', content: '<script src="src/main.tsx"></script>' }, { path: 'src/main.tsx', content: '' }] },
    { projectFiles: [{ path: 'index.html', content: '<script type="module" src="https://example.com/app.js"></script>' }] },
    { projectFiles: [{ path: 'index.html', content: '<script type="module" src="src\\main.tsx"></script>' }, { path: 'src/main.tsx', content: '' }] },
    { projectFiles: [{ path: 'other.html', content: '<main>Wrong entry</main>' }] },
  ])('reports an unusable React HTML entry', async ({ projectFiles }) => {
    const result = await bundleReactProject(projectFiles, 'index.html')
    expect(result.html).toBe('')
    expect(result.diagnostics[0].message).toContain('HTML entry')
  })

  it('blocks browser capabilities before allocating a worker', async () => {
    const result = await bundleReactProject([
      reactStarter[0],
      { path: 'src/main.tsx', content: 'fetch("/private")' },
    ], 'index.html')

    expect(result.html).toBe('')
    expect(result.diagnostics[0].message).toContain('navigation or network access')
    expect(getActiveBuildCount()).toBe(0)
  })

  it('accepts a later valid module script and honors bounded custom build options', async () => {
    const result = await bundleReactProject([
      { path: 'index.html', content: '<script src="legacy.js"></script><div id="root"></div><script type="module" src="/src/main.tsx"></script>' },
      { path: 'src/main.tsx', content: 'document.getElementById("root")!.textContent = "ready"' },
    ], 'index.html', { timeoutMs: 20_000, maxOutputBytes: 10_000_000, ownerKey: 'lotus-test' })

    expect(result.diagnostics).toContainEqual(expect.objectContaining({ message: 'Missing local script: legacy.js' }))
    expect(result.html).not.toContain('legacy.js')
    expect(result.html).toContain('ready')
  })

  it.each(['./missing.js', '../../escape.js'])('reports blocked or missing relative imports: %s', async (request) => {
    const result = await bundleReactProject([
      reactStarter[0],
      { path: 'src/main.tsx', content: `import value from ${JSON.stringify(request)}; console.log(value)` },
    ], 'index.html')

    expect(result.html).toBe('')
    expect(result.diagnostics[0].severity).toBe('error')
  })

  it('bundles JSON, binary images, and text assets from virtual project files', async () => {
    const result = await bundleReactProject([
      reactStarter[0],
      { path: 'src/main.tsx', content: "import data from './data.json'; import image from './pixel.png'; import copy from './copy.txt'; document.getElementById('root')!.textContent = data.name + image + copy" },
      { path: 'src/data.json', content: '{"name":"Lotus"}' },
      { path: 'src/pixel.png', content: 'data:image/png;base64,iVBORw0KGgo=' },
      { path: 'src/copy.txt', content: 'ready' },
    ], 'index.html')

    expect(result.diagnostics).toEqual([])
    expect(result.html).toContain('Lotus')
    expect(result.html).toContain('data:image/png')
    expect(result.html).toContain('ready')
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
