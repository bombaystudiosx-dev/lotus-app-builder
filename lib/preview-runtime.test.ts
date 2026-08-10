import { describe, expect, it } from 'vitest'
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
})
