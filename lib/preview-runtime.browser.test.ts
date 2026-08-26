import { existsSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { assembleStaticPreview, PREVIEW_SANDBOX, type PreviewFile } from '@/lib/preview-runtime'

function files(entries: Record<string, string>): PreviewFile[] {
  return Object.entries(entries).map(([path, content], index) => ({ id: String(index), path, content, encoding: 'utf-8' }))
}

function browserExecutable() {
  const candidates = [
    process.env.LOTUS_CHROME_PATH,
    process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((candidate): candidate is string => Boolean(candidate))
  const executable = candidates.find((candidate) => existsSync(candidate))
  if (!executable) throw new Error('Chrome is required for the preview security regression. Set LOTUS_CHROME_PATH to its executable.')
  return executable
}

async function serializedPage(page: Page) {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('DOM.enable')
    const { root } = await session.send('DOM.getDocument', { depth: 0 })
    return (await session.send('DOM.getOuterHTML', { nodeId: root.nodeId })).outerHTML
  } finally {
    await session.detach()
  }
}

describe('safe preview browser containment', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true })
  }, 15_000)

  afterAll(async () => {
    await browser?.close()
  })

  it('executes generated JavaScript while keeping it in an opaque origin away from Lotus', async () => {
    const output = assembleStaticPreview(files({
      'index.html': `<main id="content">App runs</main><script>
        document.body.dataset.executed='true';
        document.body.dataset.origin=location.origin;
        try { parent.document.getElementById('host').textContent = 'escaped' } catch (_) { document.body.dataset.parentBlocked='true' }
        try { localStorage.setItem('escaped', 'true') } catch (_) { document.body.dataset.storageBlocked='true' }
      </script>`,
    }), 'index.html')
    const page = await browser.newPage()
    try {
      await page.setContent('<main id="host">Lotus host</main>')
      await page.evaluate(({ html, sandbox }) => {
        const messages: unknown[] = []
        window.addEventListener('message', (event) => messages.push(event.data))
        Object.assign(window, { __lotusMessages: messages })
        const frame = document.createElement('iframe')
        frame.id = 'preview'
        frame.setAttribute('sandbox', sandbox)
        frame.srcdoc = html
        document.body.appendChild(frame)
      }, { html: output.html, sandbox: PREVIEW_SANDBOX })
      const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
      expect(frame).toBeTruthy()
      await frame?.waitForSelector('#content')
      await page.waitForTimeout(100)

      expect(await frame?.locator('#content').textContent()).toBe('App runs')
      expect(await frame?.locator('body').getAttribute('data-executed')).toBe('true')
      expect(await frame?.locator('body').getAttribute('data-parent-blocked')).toBe('true')
      expect(await frame?.locator('body').getAttribute('data-storage-blocked')).toBe('true')
      expect(await page.locator('#host').textContent()).toBe('Lotus host')
      expect(await frame?.locator('body').getAttribute('data-origin')).toBe('null')
    } finally {
      await page.close()
    }
  }, 10_000)

  it('allows instrumented function handlers while blocking string-backed handlers', async () => {
    const output = assembleStaticPreview(files({
      'index.html': `<button id="attribute">Attribute</button><button id="namespaced">Namespaced</button><button id="property">Property</button><video id="specialized"></video><script>
        const attribute = document.getElementById('attribute');
        const namespaced = document.getElementById('namespaced');
        const property = document.getElementById('property');
        const specialized = document.getElementById('specialized');
        try { attribute.setAttribute('onclick', 'document.body.dataset.attributeExecuted="true"') } catch (_) {}
        try { namespaced.setAttributeNS(null, ['on', 'click'].join(''), 'document.body.dataset.namespacedExecuted="true"') } catch (_) {}
        property.onclick = function () { document.body.dataset.propertyExecuted = 'true'; document.body.dataset.handlerTailExecuted = 'true' };
        document.body.dataset.assignmentContinued = 'true';
        try { specialized.onencrypted = 'document.body.dataset.specializedExecuted="true"' } catch (_) {}
        attribute.click(); namespaced.click(); property.click(); specialized.dispatchEvent(new Event('encrypted'));
        document.body.dataset.clickContinued = 'true';
      </script>`,
    }), 'index.html')
    expect(output.html).toMatch(/onclick = function \(\) \{__lotusGuard_[a-z\d]+\(\);/)
    const page = await browser.newPage()
    try {
      await page.setContent(output.html, { waitUntil: 'load' })
      const dom = new JSDOM(await serializedPage(page))
      const state = {
        assignmentContinued: dom.window.document.body.dataset.assignmentContinued,
        clickContinued: dom.window.document.body.dataset.clickContinued,
        attributeExecuted: dom.window.document.body.dataset.attributeExecuted,
        namespacedExecuted: dom.window.document.body.dataset.namespacedExecuted,
        propertyExecuted: dom.window.document.body.dataset.propertyExecuted,
        handlerTailExecuted: dom.window.document.body.dataset.handlerTailExecuted,
        specializedExecuted: dom.window.document.body.dataset.specializedExecuted,
        attributeHandler: dom.window.document.getElementById('attribute')?.getAttribute('onclick'),
        namespacedHandler: dom.window.document.getElementById('namespaced')?.getAttribute('onclick'),
        propertyHandler: dom.window.document.getElementById('property')?.getAttribute('onclick'),
      }

      expect(state).toEqual({
        assignmentContinued: 'true',
        clickContinued: 'true',
        attributeExecuted: undefined,
        namespacedExecuted: undefined,
        propertyExecuted: 'true',
        handlerTailExecuted: 'true',
        specializedExecuted: undefined,
        attributeHandler: null,
        namespacedHandler: null,
        propertyHandler: null,
      })
    } finally {
      await page.close()
    }
  }, 10_000)

  it('removes parameter-reflection and navigation-handler escapes before Chrome execution', async () => {
    const attempts = [
      `(function ({get: read}) { read(globalThis, 'location').href = 'about:blank#reflect-parameter-escaped' })(Reflect)`,
      `(({getOwnPropertyDescriptor: describe}) => describe(globalThis, 'location').set.call(globalThis, 'about:blank#descriptor-parameter-escaped'))(Object)`,
      `document.getElementById('handler').onclick = function () { globalThis.location.href = 'about:blank#navigation-handler-escaped' }; document.getElementById('handler').click()`,
    ]

    for (const code of attempts) {
      const output = assembleStaticPreview(files({
        'index.html': `<button id="handler">Run</button><script>${code}</script><script>document.body.dataset.safeTailExecuted='true'</script>`,
      }), 'index.html')
      const page = await browser.newPage()
      try {
        await page.setContent(output.html, { waitUntil: 'load' })
        const dom = new JSDOM(await serializedPage(page))
        expect(page.url()).not.toContain('escaped')
        expect(dom.window.document.body.dataset.safeTailExecuted).toBe('true')
        expect(output.diagnostics).toEqual(expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('navigation') }),
        ]))
      } finally {
        await page.close()
      }
    }
  }, 10_000)

  it('keeps benign metas from becoming refresh directives through DOM mutation APIs', async () => {
    const output = assembleStaticPreview(files({
      'index.html': `<meta id="namespace" name="description" content="safe"><meta id="attribute-node" name="description" content="safe"><meta id="named-map" name="description" content="safe"><meta id="attribute-value" http-equiv="x-lotus" content="safe"><script>
        const target = '0;url=about:blank#refresh-escaped';
        try { const meta = document.getElementById('namespace'); meta.setAttributeNS(null, 'http-equiv', 'refresh'); meta.setAttributeNS(null, 'content', target) } catch (_) {}
        try { const meta = document.getElementById('attribute-node'); const mode = document.createAttribute('http-equiv'); mode.value = 'refresh'; const content = document.createAttribute('content'); content.value = target; meta.setAttributeNode(mode); meta.setAttributeNode(content) } catch (_) {}
        try { const attributes = document.getElementById('named-map').attributes; const mode = document.createAttribute('http-equiv'); mode.value = 'refresh'; const content = document.createAttribute('content'); content.value = target; attributes.setNamedItem(mode); attributes.setNamedItem(content) } catch (_) {}
        try { const attributes = document.getElementById('attribute-value').attributes; attributes.getNamedItem('http-equiv').value = 'refresh'; attributes.getNamedItem('content').nodeValue = target } catch (_) {}
        document.body.dataset.metaProbeComplete = 'true';
      </script>`,
    }), 'index.html')
    const page = await browser.newPage()
    try {
      await page.setContent(output.html, { waitUntil: 'load' })
      const dom = new JSDOM(await serializedPage(page))
      expect(dom.window.document.body.dataset.metaProbeComplete).toBe('true')
      expect(page.url()).not.toContain('refresh-escaped')
      const refreshMetas = [...dom.window.document.querySelectorAll('meta[http-equiv]')]
        .filter((meta) => meta.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh')
        .map((meta) => meta.id)

      expect(refreshMetas).toEqual([])
    } finally {
      await page.close()
    }
  }, 10_000)
})
