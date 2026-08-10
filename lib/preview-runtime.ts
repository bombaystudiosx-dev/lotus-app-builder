export type PreviewDevice = 'phone' | 'tablet' | 'desktop' | 'custom'
export type PreviewOrientation = 'portrait' | 'landscape'

export interface PreviewFile {
  id?: string
  path: string
  content: string
  encoding?: 'utf-8' | 'utf-16le'
}

export interface PreviewDiagnostic {
  severity: 'error' | 'warning'
  message: string
  path?: string
  line?: number
  column?: number
}

export interface PreviewBuild {
  html: string
  diagnostics: PreviewDiagnostic[]
}

export const PREVIEW_SANDBOX = 'allow-scripts'

const PREVIEW_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; media-src data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const EXTERNAL_REFERENCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i
const IMAGE_MIME: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
}

function resolveReference(fromPath: string, reference: string) {
  const clean = reference.split(/[?#]/, 1)[0]
  if (!clean || clean.startsWith('/') || clean.includes('\\') || EXTERNAL_REFERENCE.test(clean)) return null
  const normalized: string[] = []
  for (const part of [...fromPath.split('/').slice(0, -1), ...clean.split('/')]) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!normalized.length) return null
      normalized.pop()
      continue
    }
    normalized.push(part)
  }
  return normalized.join('/') || null
}

function escapeAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

function base64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192))
  }
  return btoa(binary)
}

function assetDataUrl(path: string, content: string) {
  if (/^data:/i.test(content.trim())) return content.trim()
  const extension = path.toLowerCase().split('.').pop() ?? ''
  const mime = IMAGE_MIME[extension] ?? 'application/octet-stream'
  const payload = extension === 'svg' ? base64Utf8(content) : content.replace(/\s+/g, '')
  return `data:${mime};base64,${payload}`
}

function runtimeBridge() {
  return `<script data-lotus-runtime>(function(){
var send=function(kind,payload){parent.postMessage({type:'lotus-preview-event',kind:kind,payload:payload},'*')};
var clean=function(value){try{return typeof value==='string'?value:JSON.stringify(value)}catch(_){return String(value)}};
['log','info','warn','error'].forEach(function(level){var original=console[level];console[level]=function(){var args=Array.prototype.map.call(arguments,clean);send('console',{level:level,args:args});return original.apply(console,arguments)}});
window.onerror=function(message,source,line,column){send('error',{message:clean(message),source:source||'',line:line||0,column:column||0});return false};
window.addEventListener('unhandledrejection',function(event){send('error',{message:clean(event.reason&&event.reason.message||event.reason||'Unhandled promise rejection'),source:'promise',line:0,column:0})});
send('ready',{});
})();</script>`
}

export function finalizePreviewDocument(html: string) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`
  const withPolicy = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (head) => `${head}${policy}`)
    : `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`
  return /<\/body\s*>/i.test(withPolicy)
    ? withPolicy.replace(/<\/body\s*>/i, `${runtimeBridge()}</body>`)
    : `${withPolicy}${runtimeBridge()}`
}

function rewriteCss(css: string, cssPath: string, byPath: Map<string, string>, diagnostics: PreviewDiagnostic[]) {
  return css.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (match, _quote, reference: string) => {
    if (/^(?:data:|#)/i.test(reference)) return match
    const path = resolveReference(cssPath, reference)
    const content = path ? byPath.get(path) : undefined
    if (!path || content === undefined) {
      diagnostics.push({ severity: 'warning', path: cssPath, message: `Missing or unsafe local CSS asset: ${reference}` })
      return 'url(about:blank)'
    }
    return `url("${assetDataUrl(path, content)}")`
  })
}

function assembleHtml(entryPath: string, source: string, byPath: Map<string, string>, diagnostics: PreviewDiagnostic[], linkDepth = 0) {
  let html = source
  html = html.replace(/<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (tag, before: string, reference: string, after: string) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(`${before}${after}`) && !/\.css(?:[?#]|$)/i.test(reference)) return ''
    const path = resolveReference(entryPath, reference)
    const content = path ? byPath.get(path) : undefined
    if (!path || content === undefined) {
      diagnostics.push({ severity: 'error', path: entryPath, message: `${EXTERNAL_REFERENCE.test(reference) ? 'External stylesheet blocked' : 'Missing local stylesheet'}: ${reference}` })
      return ''
    }
    return `<style data-lotus-path="${escapeAttribute(path)}">${rewriteCss(content, path, byPath, diagnostics).replace(/<\/style/gi, '<\\/style')}</style>`
  })
  html = html.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi, (_tag, _before: string, reference: string) => {
    const path = resolveReference(entryPath, reference)
    const content = path ? byPath.get(path) : undefined
    if (!path || content === undefined) {
      diagnostics.push({ severity: 'error', path: entryPath, message: `${EXTERNAL_REFERENCE.test(reference) ? 'External script blocked' : 'Missing local script'}: ${reference}` })
      return ''
    }
    return `<script data-lotus-path="${escapeAttribute(path)}">${content.replace(/<\/script/gi, '<\\/script')}</script>`
  })
  html = html.replace(/<(img|source)\b([^>]*?)src=["']([^"']+)["']([^>]*)>/gi, (tag, element: string, before: string, reference: string, after: string) => {
    if (/^(?:data:|blob:)/i.test(reference)) return tag
    const path = resolveReference(entryPath, reference)
    const content = path ? byPath.get(path) : undefined
    if (!path || content === undefined) {
      diagnostics.push({ severity: 'warning', path: entryPath, message: `Missing local asset: ${reference}` })
      return `<${element}${before}src=""${after}>`
    }
    return `<${element}${before}src="${assetDataUrl(path, content)}"${after}>`
  })
  html = html.replace(/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (tag, before: string, reference: string, after: string) => {
    if (/^(?:#|mailto:|tel:)/i.test(reference)) return tag
    const path = resolveReference(entryPath, reference)
    const content = path ? byPath.get(path) : undefined
    if (!path) {
      diagnostics.push({ severity: 'warning', path: entryPath, message: `Unsafe link blocked: ${reference}` })
      return `<a${before}href="#"${after}>`
    }
    if (content === undefined || !/\.html?$/i.test(path)) {
      diagnostics.push({ severity: 'warning', path: entryPath, message: `Missing local page: ${reference}` })
      return `<a${before}href="#"${after}>`
    }
    const linked = linkDepth < 1 ? assembleHtml(path, content, byPath, diagnostics, linkDepth + 1) : content
    const safePage = finalizePreviewDocument(linked)
    return `<a${before}href="data:text/html;base64,${base64Utf8(safePage)}"${after}>`
  })
  return html
}

export function assembleStaticPreview(files: PreviewFile[], entryPath: string): PreviewBuild {
  const diagnostics: PreviewDiagnostic[] = []
  const byPath = new Map(files.map((file) => [file.path, file.content]))
  const entry = byPath.get(entryPath)
  if (entry === undefined) {
    return { html: finalizePreviewDocument('<h1>Preview unavailable</h1><p>The configured entry file is missing.</p>'), diagnostics: [{ severity: 'error', path: entryPath, message: 'Preview entry file is missing.' }] }
  }
  return { html: finalizePreviewDocument(assembleHtml(entryPath, entry, byPath, diagnostics)), diagnostics }
}

const DEVICE_DIMENSIONS: Record<Exclude<PreviewDevice, 'custom'>, [number, number]> = {
  phone: [390, 844],
  tablet: [768, 1024],
  desktop: [1440, 900],
}

export function previewViewport(input: { device: PreviewDevice; orientation: PreviewOrientation; zoom: number; customWidth?: number; customHeight?: number }) {
  const dimensions = input.device === 'custom'
    ? [input.customWidth ?? 390, input.customHeight ?? 844]
    : DEVICE_DIMENSIONS[input.device]
  const width = Math.min(2560, Math.max(240, Math.round(dimensions[0])))
  const height = Math.min(2560, Math.max(240, Math.round(dimensions[1])))
  const oriented = input.orientation === 'landscape' && height > width || input.orientation === 'portrait' && width > height
    ? [height, width]
    : [width, height]
  return { width: oriented[0], height: oriented[1], scale: Math.min(2, Math.max(0.25, input.zoom / 100)) }
}
