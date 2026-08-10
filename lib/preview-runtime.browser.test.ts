import { existsSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { assembleStaticPreview, type PreviewFile } from '@/lib/preview-runtime'

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

  it('prevents dynamic event attributes and handler properties from executing outside instrumentation', async () => {
    const output = assembleStaticPreview(files({
      'index.html': `<button id="attribute">Attribute</button><button id="namespaced">Namespaced</button><button id="property">Property</button><script>
        const attribute = document.getElementById('attribute');
        const namespaced = document.getElementById('namespaced');
        const property = document.getElementById('property');
        try { attribute.setAttribute('onclick', 'document.body.dataset.attributeExecuted="true"') } catch (_) {}
        try { namespaced.setAttributeNS(null, ['on', 'click'].join(''), 'document.body.dataset.namespacedExecuted="true"') } catch (_) {}
        try { property.onclick = function () { document.body.dataset.propertyExecuted = 'true' } } catch (_) {}
        attribute.click(); namespaced.click(); property.click();
        document.body.dataset.handlerProbeComplete = 'true';
      </script>`,
    }), 'index.html')
    const page = await browser.newPage()
    try {
      await page.setContent(output.html, { waitUntil: 'load' })
      const dom = new JSDOM(await serializedPage(page))
      const state = {
        attributeExecuted: dom.window.document.body.dataset.attributeExecuted,
        namespacedExecuted: dom.window.document.body.dataset.namespacedExecuted,
        propertyExecuted: dom.window.document.body.dataset.propertyExecuted,
        attributeHandler: dom.window.document.getElementById('attribute')?.getAttribute('onclick'),
        namespacedHandler: dom.window.document.getElementById('namespaced')?.getAttribute('onclick'),
        propertyHandler: dom.window.document.getElementById('property')?.getAttribute('onclick'),
      }

      expect(state).toEqual({
        attributeExecuted: undefined,
        namespacedExecuted: undefined,
        propertyExecuted: undefined,
        attributeHandler: null,
        namespacedHandler: null,
        propertyHandler: null,
      })
    } finally {
      await page.close()
    }
  }, 10_000)

  it('keeps benign metas from becoming refresh directives through DOM mutation APIs', async () => {
    const output = assembleStaticPreview(files({
      'index.html': `<meta id="namespace" name="description" content="safe"><meta id="attribute-node" name="description" content="safe"><meta id="named-map" name="description" content="safe"><meta id="attribute-value" http-equiv="x-lotus" content="safe"><script>
        const target = '3600;url=https://evil.example/refresh';
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
      const refreshMetas = [...dom.window.document.querySelectorAll('meta[http-equiv]')]
        .filter((meta) => meta.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh')
        .map((meta) => meta.id)

      expect(refreshMetas).toEqual([])
    } finally {
      await page.close()
    }
  }, 10_000)
})
