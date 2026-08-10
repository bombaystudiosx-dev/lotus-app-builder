import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  PREVIEW_SANDBOX,
  assembleStaticPreview,
  previewViewport,
  type PreviewFile,
} from '@/lib/preview-runtime'

function files(entries: Record<string, string>): PreviewFile[] {
  return Object.entries(entries).map(([path, content], index) => ({ id: String(index), path, content, encoding: 'utf-8' }))
}

describe('safe static preview assembly', () => {
  it('inlines local styles, scripts, images and HTML links without retaining network-capable references', () => {
    const output = assembleStaticPreview(files({
      'index.html': '<link rel="stylesheet" href="styles/site.css"><img src="images/mark.svg"><a href="about.html">About</a><script src="scripts/app.js"></script>',
      'styles/site.css': '.hero{background:url(../images/mark.svg)}',
      'scripts/app.js': 'console.info("ready")',
      'images/mark.svg': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
      'about.html': '<h1>About Lotus</h1>',
    }), 'index.html')

    expect(output.html).toContain('<style data-lotus-path="styles/site.css">')
    expect(output.html).toContain('data:image/svg+xml;base64,')
    expect(output.html).toContain('<script data-lotus-path="scripts/app.js">')
    expect(output.html).toContain('data:text/html;base64,')
    expect(output.diagnostics).toEqual([])
    expect(output.html).not.toContain('src="images/mark.svg"')
  })

  it('executes an assembled static starter as a self-contained document', async () => {
    const output = assembleStaticPreview(files({
      'index.html': '<main id="root">Static starter</main><script src="app.js"></script>',
      'app.js': 'document.getElementById("root").dataset.ready = "true"',
    }), 'index.html')
    const dom = new JSDOM(output.html, { runScripts: 'dangerously' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(dom.window.document.getElementById('root')).toHaveProperty('dataset.ready', 'true')
    dom.window.close()
  })

  it('blocks unsafe and missing references and returns useful diagnostics', () => {
    const output = assembleStaticPreview(files({
      'index.html': '<script src="https://evil.example/a.js"></script><img src="missing.png"><a href="../secret.html">bad</a>',
    }), 'index.html')

    expect(output.html).not.toContain('evil.example')
    expect(output.html).not.toContain('../secret.html')
    expect(output.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('External script blocked'),
      expect.stringContaining('Missing local asset'),
      expect.stringContaining('Unsafe link blocked'),
    ]))
  })

  it('injects a restrictive CSP and runtime bridge while omitting same-origin iframe permission', () => {
    const output = assembleStaticPreview(files({ 'index.html': '<h1>Hello</h1>' }), 'index.html')

    expect(PREVIEW_SANDBOX.split(/\s+/)).not.toContain('allow-same-origin')
    expect(PREVIEW_SANDBOX).toBe('allow-scripts')
    expect(output.html).toContain("default-src 'none'")
    expect(output.html).toContain('window.onerror')
    expect(output.html).toContain('unhandledrejection')
    expect(output.html).toContain('lotus-preview-event')
  })

  it('removes statically unbounded loops before preview JavaScript reaches the browser thread', () => {
    const output = assembleStaticPreview(files({
      'index.html': '<script src="runaway.js"></script><script>for (;;) {}</script>',
      'runaway.js': 'while (true) {}',
    }), 'index.html')

    expect(output.html).not.toContain('while (true)')
    expect(output.html).not.toContain('for (;;)')
    expect(output.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('unbounded loop') })]))
  })

  it('calculates device, orientation, zoom, and bounded custom viewports', () => {
    expect(previewViewport({ device: 'phone', orientation: 'portrait', zoom: 100 })).toEqual({ width: 390, height: 844, scale: 1 })
    expect(previewViewport({ device: 'tablet', orientation: 'landscape', zoom: 75 })).toEqual({ width: 1024, height: 768, scale: 0.75 })
    expect(previewViewport({ device: 'custom', orientation: 'landscape', zoom: 500, customWidth: 99999, customHeight: -2 })).toEqual({ width: 2560, height: 240, scale: 2 })
  })

  it('constructs policy structurally before user scripts even when script text contains fake head markup', () => {
    const output = assembleStaticPreview(files({
      'index.html': `<script>const fake = '<head><meta http-equiv="Content-Security-Policy" content="default-src *">'; console.info('early')</script><img src=icon.svg>`,
      'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    }), 'index.html')
    const dom = new JSDOM(output.html)
    const children = [...dom.window.document.head.children]

    expect(children[0].getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(children[0].getAttribute('content')).toContain("default-src 'none'")
    expect(output.html.indexOf('data-lotus-runtime')).toBeLessThan(output.html.indexOf("console.info('early')"))
    expect(dom.window.document.querySelector('img')?.src).toMatch(/^data:image\/svg\+xml/)
  })

  it('instruments computed loops and recursively assembles safe local links while preserving reference metadata', () => {
    const output = assembleStaticPreview(files({
      'index.html': '<a href="pages/a.html?mode=one#section">A</a><script>while (Date.now()) console.info("running")</script>',
      'pages/a.html': '<a href="b.html">B</a>',
      'pages/b.html': '<p>Deep page</p>',
    }), 'index.html')

    expect(output.html).toContain('__lotusGuard')
    expect(output.html).toMatch(/\{__lotusGuard_[a-z\d]+\(\);console\.info\("running"\)\}/)
    expect(output.html).toContain('data-lotus-query="mode=one"')
    expect(output.html).toContain('data-lotus-fragment="section"')
    expect(output.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('metadata-only') })]))
    const linkedHref = new JSDOM(output.html).window.document.querySelector('a')?.getAttribute('href') ?? ''
    expect(atob(linkedHref.slice('data:text/html;base64,'.length).split('#', 1)[0])).toContain('data:text/html;base64,')
  })

  it('does not trust a user-authored runtime guard marker', () => {
    const output = assembleStaticPreview(files({
      'index.html': '<script>/* lotus-runtime-guard */ while (Date.now()) {}</script>',
    }), 'index.html')

    expect(output.html.match(/lotus-runtime-guard/g)?.length).toBe(2)
    expect(output.html).toMatch(/while \(Date\.now\(\)\) \{__lotusGuard_[a-z\d]+\(\);\}/)
  })

  it('removes document and script navigation, form targets, popup targets, and network hints', () => {
    const output = assembleStaticPreview(files({
      'index.html': '<meta http-equiv=refresh content="0;url=https://evil.example"><form action=https://evil.example><button formaction=https://evil.example>Go</button></form><a href=https://evil.example target=_blank ping=https://evil.example>Leave</a><img src=icon.svg srcset="https://evil.example/x 2x"><script>window.open("https://evil.example")</script>',
      'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    }), 'index.html')
    const dom = new JSDOM(output.html)

    expect(dom.window.document.querySelector('meta[http-equiv="refresh"]')).toBeNull()
    expect(dom.window.document.querySelector('form')?.hasAttribute('action')).toBe(false)
    expect(dom.window.document.querySelector('button')?.hasAttribute('formaction')).toBe(false)
    expect(dom.window.document.querySelector('a')?.getAttribute('href')).toBe('#')
    expect(dom.window.document.querySelector('a')?.hasAttribute('target')).toBe(false)
    expect(dom.window.document.querySelector('img')?.hasAttribute('srcset')).toBe(false)
    expect(output.html).not.toContain('window.open')
    expect(output.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('navigation or network') })]))
  })

  it('walks template content and blocks dynamic script, eval, Function, and import execution paths', () => {
    const output = assembleStaticPreview(files({
      'index.html': `<template id="payload"><script>while (Date.now()) console.log('template loop')</script></template>
        <script>const node = document['create' + 'Element']('script'); node.text = 'parent.postMessage(document.cookie,"*")'; document.body.appendChild(node); eval('alert(1)'); new Function('alert(2)')(); import('data:text/javascript,alert(3)')</script>`,
    }), 'index.html')
    const dom = new JSDOM(output.html)
    const templateCode = dom.window.document.querySelector('template')?.content.querySelector('script')?.textContent ?? ''

    expect(templateCode).toMatch(/__lotusGuard_[a-z\d]+/)
    expect(templateCode).toContain('template loop')
    expect(output.html).not.toContain("parent.postMessage(document.cookie")
    expect(output.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('dynamic code') })]))
    expect(output.html).toContain('Dynamic preview scripts are blocked')
  })

  it('runtime-guards computed dynamic script creation and sanitizes computed innerHTML', async () => {
    const output = assembleStaticPreview(files({
      'index.html': `<main id="root"></main><script>
        const tag = ['scr', 'ipt'].join('');
        let dynamicBlocked = false;
        try { document.createElement(tag) } catch (_) { dynamicBlocked = true }
        const sink = ['inner', 'HTML'].join('');
        document.body[sink] = '<p id="safe">ok</p><script id="pwned">document.body.dataset.pwned="true"<\\/script>';
        document.body.dataset.dynamicBlocked = String(dynamicBlocked);
        document.body.dataset.sanitized = String(!document.getElementById('pwned'));
      </script>`,
    }), 'index.html')
    const dom = new JSDOM(output.html, { runScripts: 'dangerously' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(dom.window.document.body.dataset.dynamicBlocked).toBe('true')
    expect(dom.window.document.body.dataset.sanitized).toBe('true')
    expect(dom.window.document.body.dataset.pwned).toBeUndefined()
    dom.window.close()
  })

  it('blocks computed global navigation members that evade a text blacklist', () => {
    const output = assembleStaticPreview(files({
      'index.html': `<script>const root = globalThis; const field = ['loc','ation'].join(''); root[field]['hr' + 'ef'] = 'https://evil.example'</script>`,
    }), 'index.html')

    expect(output.html).not.toContain('evil.example')
    expect(output.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('navigation') })]))
  })

  it('stops exponential linked-page expansion at a global byte or node budget', () => {
    const graph: Record<string, string> = {}
    for (let depth = 0; depth < 7; depth += 1) {
      graph[`p${depth}.html`] = depth === 6
        ? '<p>leaf</p>'
        : Array.from({ length: 4 }, (_, index) => `<a href="p${depth + 1}.html">${index}</a>`).join('')
    }

    const output = assembleStaticPreview(files(graph), 'p0.html')

    expect(output.html).toBe('')
    expect(output.diagnostics).toEqual([expect.objectContaining({ severity: 'error', message: expect.stringContaining('budget') })])
  })

  it('blocks intrinsic Function constructors, including computed constructor strings and prototype chains', async () => {
    const rejected = assembleStaticPreview(files({
      'index.html': `<script>(function safe(){})['con' + 'structor']('document.body.dataset.pwned="true"')(); Function['pro' + 'totype']['constructor']('void 0')()</script>`,
    }), 'index.html')
    expect(rejected.html).not.toContain('dataset.pwned')
    expect(rejected.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('dynamic code') })]))

    const runtimeGuarded = assembleStaticPreview(files({
      'index.html': `<main></main><script>const key=['con','structor'].join(''); try {(function(){})[key]('document.body.dataset.pwned="true"')()} catch (_) {document.body.dataset.constructorBlocked='true'}</script>`,
    }), 'index.html')
    const dom = new JSDOM(runtimeGuarded.html, { runScripts: 'dangerously' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dom.window.document.body.dataset.constructorBlocked).toBe('true')
    expect(dom.window.document.body.dataset.pwned).toBeUndefined()
    dom.window.close()
  })

  it('blocks destructured and reflective location aliases plus dynamic refresh metas', async () => {
    for (const code of [
      `const {location: nav}=globalThis; nav.href='https://evil.example/destructured'`,
      `const nav=Reflect.get(globalThis,'location'); nav['replace']('https://evil.example/reflected')`,
    ]) {
      const output = assembleStaticPreview(files({ 'index.html': `<script>${code}</script>` }), 'index.html')
      expect(output.html).not.toContain('evil.example')
      expect(output.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('navigation') })]))
    }

    const dynamicMeta = assembleStaticPreview(files({
      'index.html': `<main></main><script>try {const kind=['me','ta'].join(''); const meta=document.createElement(kind); meta.httpEquiv=['re','fresh'].join(''); meta.content='0;url=https://evil.example/meta'; document.head.appendChild(meta)} catch (_) {document.body.dataset.metaBlocked='true'}</script>`,
    }), 'index.html')
    const dom = new JSDOM(dynamicMeta.html, { runScripts: 'dangerously' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dom.window.document.querySelector('meta[http-equiv="refresh"]')).toBeNull()
    expect(dom.window.document.body.dataset.metaBlocked).toBe('true')
    dom.window.close()
  })

  it('structurally authenticates exact assembler-created page links rather than any data URL prefix', () => {
    const output = assembleStaticPreview(files({
      'index.html': `<a id="safe" href="about.html">Safe</a><a id="forged" href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Forged</a><script>document.getElementById('safe').setAttribute('href','data:text/html;base64,PHNjcmlwdD5hbGVydCgyKTwvc2NyaXB0Pg==')</script>`,
      'about.html': '<p>About</p>',
    }), 'index.html')
    const inertDom = new JSDOM(output.html)

    expect(inertDom.window.document.querySelector('#safe')?.hasAttribute('data-lotus-local-page')).toBe(true)
    expect(inertDom.window.document.querySelector('#forged')?.hasAttribute('data-lotus-local-page')).toBe(false)
    expect(inertDom.window.document.querySelector('#forged')?.getAttribute('href')).toBe('#')
    expect(output.html).toContain('new WeakMap')
    expect(output.html).toContain('localPages.get(target)')
    expect(output.html).not.toContain("href.indexOf('data:text/html;base64,')")

    const dom = new JSDOM(output.html, { runScripts: 'dangerously' })
    const mutated = dom.window.document.querySelector('#safe') as HTMLAnchorElement
    expect(mutated.getAttribute('href')).toContain('PHNjcmlwdD5hbGVydCgyK')
    expect(mutated.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false)
    dom.window.close()
  })

  it('reserves repeated asset and CSS data-url expansion before allocating the output', () => {
    const repeatedImages = Array.from({ length: 2_500 }, () => '<img src="small.svg">').join('')
    const repeatedCss = Array.from({ length: 2_500 }, (_, index) => `.asset-${index}{background:url(small.svg)}`).join('')
    const output = assembleStaticPreview(files({
      'index.html': `<style>${repeatedCss}</style>${repeatedImages}`,
      'small.svg': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>',
    }), 'index.html')

    expect(output.html).toBe('')
    expect(output.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('budget') })]))
  })
})
