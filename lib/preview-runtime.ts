import { parse, parseFragment, serialize } from 'parse5'
import { hasBlockedBrowserCapability, hasStaticallyUnboundedLoop, instrumentJavaScript } from '@/lib/runtime-guard'

export type PreviewDevice = 'phone' | 'tablet' | 'desktop' | 'custom'
export type PreviewOrientation = 'portrait' | 'landscape'
export interface PreviewFile { id?: string; path: string; content: string; encoding?: 'utf-8' | 'utf-16le' }
export interface PreviewDiagnostic { severity: 'error' | 'warning'; message: string; path?: string; line?: number; column?: number }
export interface PreviewBuild { html: string; diagnostics: PreviewDiagnostic[]; revision?: number }
export const PREVIEW_SANDBOX = 'allow-scripts'

type HtmlAttribute = { name: string; value: string }
type HtmlNode = { nodeName: string; tagName?: string; value?: string; attrs?: HtmlAttribute[]; childNodes?: HtmlNode[]; parentNode?: HtmlNode; content?: HtmlNode }
type AssemblyBudget = { bytes: number; nodes: number; queryWarnings: Set<string> }

const PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; media-src data:; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const EXTERNAL_REFERENCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i
const IMAGE_MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' }
const MAX_EXPANDED_BYTES = 5_242_880
const MAX_EXPANDED_NODES = 20_000

function reserveBudget(budget: AssemblyBudget, bytes = 0, nodes = 0) {
  budget.bytes += bytes; budget.nodes += nodes
  if (budget.bytes > MAX_EXPANDED_BYTES || budget.nodes > MAX_EXPANDED_NODES) {
    const error = new Error('Preview expansion budget exceeded.')
    error.name = 'PreviewBudgetError'
    throw error
  }
}

function utf8Bytes(value: string) { return new TextEncoder().encode(value).byteLength }
function approximateMarkupNodes(value: string) {
  let count = 0; let index = value.indexOf('<')
  while (index >= 0) { count += 1; index = value.indexOf('<', index + 1) }
  return count
}

function resolveReference(fromPath: string, reference: string) {
  const clean = reference.split(/[?#]/, 1)[0]
  if (!clean || clean.startsWith('/') || clean.includes('\\') || EXTERNAL_REFERENCE.test(clean)) return null
  const normalized: string[] = []
  for (const part of [...fromPath.split('/').slice(0, -1), ...clean.split('/')]) {
    if (!part || part === '.') continue
    if (part === '..') { if (!normalized.length) return null; normalized.pop() } else normalized.push(part)
  }
  return normalized.join('/') || null
}

function base64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8_192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192))
  return btoa(binary)
}

function assetDataUrl(path: string, content: string) {
  if (/^data:/i.test(content.trim())) return content.trim()
  const extension = path.toLowerCase().split('.').pop() ?? ''
  const mime = IMAGE_MIME[extension] ?? 'application/octet-stream'
  const payload = extension === 'svg' ? base64Utf8(content) : content.replace(/\s+/g, '')
  return `data:${mime};base64,${payload}`
}

function attr(node: HtmlNode, name: string) { return node.attrs?.find((item) => item.name.toLowerCase() === name)?.value }
function setAttr(node: HtmlNode, name: string, value: string) {
  node.attrs ??= []
  const existing = node.attrs.find((item) => item.name.toLowerCase() === name)
  if (existing) existing.value = value
  else node.attrs.push({ name, value })
}
function removeAttr(node: HtmlNode, name: string) { node.attrs = node.attrs?.filter((item) => item.name.toLowerCase() !== name) }
function fragmentNode(markup: string) { return (parseFragment(markup) as unknown as HtmlNode).childNodes?.[0] as HtmlNode }
function replaceNode(node: HtmlNode, replacement: HtmlNode | null) {
  const siblings = node.parentNode?.childNodes
  const index = siblings?.indexOf(node) ?? -1
  if (!siblings || index < 0) return
  if (replacement) { replacement.parentNode = node.parentNode; siblings.splice(index, 1, replacement) } else siblings.splice(index, 1)
}

function runtimeBridge() {
  return `<script data-lotus-runtime>(function(){
var sent=0,windowStart=Date.now();
var randomValues=new Uint32Array(2);crypto.getRandomValues(randomValues);var channel=randomValues[0].toString(36).padStart(7,'0')+randomValues[1].toString(36).padStart(7,'0'),post=parent.postMessage.bind(parent);
var clean=function(value){var text='';try{text=typeof value==='string'?value:JSON.stringify(value)}catch(_){text=String(value)}return text.slice(0,1000)};
var send=function(kind,payload){var now=Date.now();if(now-windowStart>1000){sent=0;windowStart=now}if(sent++>=40)return;post({type:'lotus-preview-event',channel:channel,kind:kind,payload:payload},'*')};
var deny=function(){throw new Error('Dynamic preview scripts are blocked')};
var define=function(target,name,value){try{Object.defineProperty(target,name,{value:value,writable:false,configurable:false})}catch(_){try{target[name]=value}catch(__){}}};
['open','fetch','XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker','eval','Function'].forEach(function(name){define(window,name,deny)});
if(window.navigation)define(window.navigation,'navigate',deny);
['setTimeout','setInterval'].forEach(function(name){var original=window[name];define(window,name,function(callback){if(typeof callback!=='function')return deny();return original.apply(window,arguments)})});
var nativeCreate=document.createElement.bind(document),nativeCreateNS=document.createElementNS.bind(document);
define(Document.prototype,'createElement',function(name){if(String(name).toLowerCase()==='script')return deny();return nativeCreate.apply(document,arguments)});
define(Document.prototype,'createElementNS',function(namespace,name){if(String(name).toLowerCase()==='script')return deny();return nativeCreateNS.apply(document,arguments)});
var active=function(node){return !!node&&(String(node.nodeName).toLowerCase()==='script'||String(node.nodeName).toLowerCase()==='iframe'||!!(node.querySelector&&node.querySelector('script,iframe,frame,object,embed,portal')))};
['appendChild','insertBefore','replaceChild'].forEach(function(name){var original=Node.prototype[name];define(Node.prototype,name,function(node){if(active(node))return deny();return original.apply(this,arguments)})});
var protectMany=function(proto,name){if(!proto||typeof proto[name]!=='function')return;var original=proto[name];define(proto,name,function(){for(var index=0;index<arguments.length;index++){if(active(arguments[index]))return deny()}return original.apply(this,arguments)})};
[Element.prototype,Document.prototype,DocumentFragment.prototype,typeof ShadowRoot==='undefined'?null:ShadowRoot.prototype].forEach(function(proto){['append','prepend','replaceChildren'].forEach(function(name){protectMany(proto,name)})});
[Element.prototype,typeof CharacterData==='undefined'?null:CharacterData.prototype].forEach(function(proto){['before','after','replaceWith'].forEach(function(name){protectMany(proto,name)})});
if(typeof Range!=='undefined'&&Range.prototype.insertNode){var nativeInsertNode=Range.prototype.insertNode;define(Range.prototype,'insertNode',function(node){if(active(node))return deny();return nativeInsertNode.apply(this,arguments)})}
var htmlDescriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML'),outerDescriptor=Object.getOwnPropertyDescriptor(Element.prototype,'outerHTML');
var sanitize=function(markup){var template=nativeCreate('template');htmlDescriptor.set.call(template,String(markup));template.content.querySelectorAll('script,iframe,frame,object,embed,portal,meta[http-equiv="refresh"]').forEach(function(node){node.remove()});template.content.querySelectorAll('*').forEach(function(node){Array.prototype.slice.call(node.attributes).forEach(function(attribute){var name=attribute.name.toLowerCase();if(name.indexOf('on')===0||['srcdoc','formaction','ping','action','target'].indexOf(name)>=0)node.removeAttribute(attribute.name)})});return htmlDescriptor.get.call(template)};
if(htmlDescriptor&&htmlDescriptor.get&&htmlDescriptor.set)Object.defineProperty(Element.prototype,'innerHTML',{get:htmlDescriptor.get,set:function(value){return htmlDescriptor.set.call(this,sanitize(value))},configurable:false});
if(outerDescriptor&&outerDescriptor.get&&outerDescriptor.set)Object.defineProperty(Element.prototype,'outerHTML',{get:outerDescriptor.get,set:function(value){return outerDescriptor.set.call(this,sanitize(value))},configurable:false});
if(Element.prototype.insertAdjacentHTML){var nativeAdjacent=Element.prototype.insertAdjacentHTML;define(Element.prototype,'insertAdjacentHTML',function(position,value){return nativeAdjacent.call(this,position,sanitize(value))})}
define(Document.prototype,'write',deny);define(Document.prototype,'writeln',deny);
document.addEventListener('click',function(event){var target=event.target&&event.target.closest&&event.target.closest('a[href]');if(!target)return;var href=target.getAttribute('href')||'';if(href.indexOf('data:text/html;base64,')===0){event.preventDefault();if(!event.isTrusted)return;event.stopImmediatePropagation();send('navigation',{local:true});location.href=href;return}if(href.charAt(0)!=='#')event.preventDefault()},true);
['log','info','warn','error'].forEach(function(level){var original=console[level];console[level]=function(){var args=Array.prototype.slice.call(arguments,0,10).map(clean);send('console',{level:level,args:args});return original.apply(console,arguments)}});
window.onerror=function(message,source,line,column){send('error',{message:clean(message),source:clean(source||''),line:Number(line)||0,column:Number(column)||0});return false};
window.addEventListener('unhandledrejection',function(event){send('error',{message:clean(event.reason&&event.reason.message||event.reason||'Unhandled promise rejection'),source:'promise',line:0,column:0})});
document.addEventListener('submit',function(event){event.preventDefault()});
send('ready',{});
})();</script>`
}

function secureDocumentStructure(source: string) {
  const document = parse(source) as unknown as HtmlNode
  const html = document.childNodes?.find((node) => node.tagName === 'html')
  const head = html?.childNodes?.find((node) => node.tagName === 'head')
  if (!head) throw new Error('Unable to construct preview document.')
  head.childNodes ??= []
  head.childNodes = head.childNodes.filter((node) => !(node.tagName === 'meta' && attr(node, 'http-equiv')?.toLowerCase() === 'content-security-policy') && node.tagName !== 'base')
  const policy = fragmentNode(`<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`)
  const bridge = fragmentNode(runtimeBridge())
  policy.parentNode = head
  bridge.parentNode = head
  head.childNodes.unshift(policy, bridge)
  return document
}

export function finalizePreviewDocument(html: string) { return serialize(secureDocumentStructure(html) as never) }

function rewriteCss(css: string, cssPath: string, byPath: Map<string, string>, diagnostics: PreviewDiagnostic[]) {
  return css.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (match, _quote, reference: string) => {
    if (/^(?:data:|#)/i.test(reference)) return match
    const path = resolveReference(cssPath, reference)
    const content = path ? byPath.get(path) : undefined
    if (!path || content === undefined) { diagnostics.push({ severity: 'warning', path: cssPath, message: `Missing or unsafe local CSS asset: ${reference}` }); return 'url(about:blank)' }
    return `url("${assetDataUrl(path, content)}")`
  })
}

function splitReference(reference: string) {
  const hashIndex = reference.indexOf('#')
  const queryIndex = reference.indexOf('?')
  const end = Math.min(...[queryIndex, hashIndex].filter((value) => value >= 0), reference.length)
  const query = queryIndex >= 0 ? reference.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined) : ''
  const fragment = hashIndex >= 0 ? reference.slice(hashIndex + 1) : ''
  return { path: reference.slice(0, end), query, fragment }
}

function assemblePage(entryPath: string, source: string, byPath: Map<string, string>, diagnostics: PreviewDiagnostic[], visited: Set<string>, budget: AssemblyBudget): string {
  reserveBudget(budget, utf8Bytes(source), approximateMarkupNodes(source))
  const document = secureDocumentStructure(source)
  const walk = (node: HtmlNode) => {
    reserveBudget(budget, 0, 1)
    for (const child of [...(node.childNodes ?? [])]) walk(child)
    if (node.content) walk(node.content)
    if (!node.tagName) return
    node.attrs = node.attrs?.filter((item) => !item.name.toLowerCase().startsWith('on') && !['formaction', 'ping', 'srcdoc'].includes(item.name.toLowerCase()))
    if (['iframe', 'frame', 'object', 'embed', 'portal'].includes(node.tagName)) { replaceNode(node, null); return }
    if (node.tagName === 'meta' && attr(node, 'http-equiv')?.toLowerCase() === 'refresh') { replaceNode(node, null); return }
    if (node.tagName === 'form') { removeAttr(node, 'action'); removeAttr(node, 'target'); removeAttr(node, 'method') }
    if (node.tagName === 'link') {
      const reference = attr(node, 'href') ?? ''
      if ((attr(node, 'rel') ?? '').toLowerCase() !== 'stylesheet' && !/\.css(?:[?#]|$)/i.test(reference)) { replaceNode(node, null); return }
      const path = resolveReference(entryPath, reference); const content = path ? byPath.get(path) : undefined
      if (!path || content === undefined) { diagnostics.push({ severity: 'error', path: entryPath, message: `${EXTERNAL_REFERENCE.test(reference) ? 'External stylesheet blocked' : 'Missing local stylesheet'}: ${reference}` }); replaceNode(node, null); return }
      replaceNode(node, fragmentNode(`<style data-lotus-path="${path}"></style>`)); const replacement = node.parentNode?.childNodes
      const style = replacement?.find((candidate) => candidate.tagName === 'style' && attr(candidate, 'data-lotus-path') === path)
      if (style) style.childNodes = [{ nodeName: '#text', value: rewriteCss(content, path, byPath, diagnostics), parentNode: style }]
      return
    }
    if (node.tagName === 'script') {
      if (attr(node, 'data-lotus-runtime') !== undefined) return
      const reference = attr(node, 'src'); let path = entryPath; let code = node.childNodes?.map((child) => child.value ?? '').join('') ?? ''
      if (reference) { const resolved = resolveReference(entryPath, reference); const content = resolved ? byPath.get(resolved) : undefined; if (!resolved || content === undefined) { diagnostics.push({ severity: 'error', path: entryPath, message: `${EXTERNAL_REFERENCE.test(reference) ? 'External script blocked' : 'Missing local script'}: ${reference}` }); replaceNode(node, null); return } path = resolved; code = content; removeAttr(node, 'src'); setAttr(node, 'data-lotus-path', path) }
      if (attr(node, 'data-lotus-bundle') === undefined && hasStaticallyUnboundedLoop(code)) { diagnostics.push({ severity: 'error', path, message: 'Preview blocked a statically unbounded loop.' }); replaceNode(node, null); return }
      if (attr(node, 'data-lotus-bundle') === undefined && hasBlockedBrowserCapability(code)) { diagnostics.push({ severity: 'error', path, message: 'Preview blocked navigation or network access and dynamic code capabilities.' }); replaceNode(node, null); return }
      try { code = instrumentJavaScript(code) } catch { diagnostics.push({ severity: 'error', path, message: 'Preview blocked JavaScript that could not be safely instrumented.' }); replaceNode(node, null); return }
      node.childNodes = [{ nodeName: '#text', value: code.replace(/<\/script/gi, '<\\/script'), parentNode: node }]
      return
    }
    if (node.tagName === 'style') { const css = node.childNodes?.map((child) => child.value ?? '').join('') ?? ''; node.childNodes = [{ nodeName: '#text', value: rewriteCss(css, entryPath, byPath, diagnostics), parentNode: node }] }
    if (node.tagName === 'img' || node.tagName === 'source') {
      removeAttr(node, 'srcset')
      const reference = attr(node, 'src') ?? ''
      if (reference.startsWith('data:')) return
      const path = resolveReference(entryPath, reference); const content = path ? byPath.get(path) : undefined
      if (!path || content === undefined) { diagnostics.push({ severity: 'warning', path: entryPath, message: `Missing local asset: ${reference}` }); setAttr(node, 'src', ''); return }
      setAttr(node, 'src', assetDataUrl(path, content)); return
    }
    if (node.tagName === 'a') {
      removeAttr(node, 'target'); removeAttr(node, 'ping')
      const reference = attr(node, 'href') ?? ''
      if (reference.startsWith('#')) return
      const parts = splitReference(reference); const path = resolveReference(entryPath, parts.path); const content = path ? byPath.get(path) : undefined
      if (!path || content === undefined || !/\.html?$/i.test(path) || visited.has(path) || visited.size >= 20) { diagnostics.push({ severity: 'warning', path: entryPath, message: `Unsafe link blocked or missing: ${reference}` }); setAttr(node, 'href', '#'); return }
      const nextVisited = new Set(visited).add(path); const linked = assemblePage(path, content, byPath, diagnostics, nextVisited, budget)
      const linkedBytes = utf8Bytes(linked); reserveBudget(budget, Math.ceil(linkedBytes / 3) * 4)
      setAttr(node, 'href', `data:text/html;base64,${base64Utf8(linked)}${parts.fragment ? `#${encodeURIComponent(parts.fragment)}` : ''}`)
      if (parts.query) {
        setAttr(node, 'data-lotus-query', parts.query)
        const warningKey = `${entryPath}:${reference}`
        if (!budget.queryWarnings.has(warningKey)) { budget.queryWarnings.add(warningKey); diagnostics.push({ severity: 'warning', path: entryPath, message: `Preview query is metadata-only and does not change the embedded page URL: ${parts.query}` }) }
      }
      if (parts.fragment) setAttr(node, 'data-lotus-fragment', parts.fragment)
    }
  }
  walk(document)
  const output = serialize(document as never)
  reserveBudget(budget, utf8Bytes(output))
  return output
}

export function assembleStaticPreview(files: PreviewFile[], entryPath: string): PreviewBuild {
  const diagnostics: PreviewDiagnostic[] = []; const byPath = new Map(files.map((file) => [file.path, file.content])); const entry = byPath.get(entryPath)
  if (entry === undefined) return { html: '', diagnostics: [{ severity: 'error', path: entryPath, message: 'Preview entry file is missing.' }] }
  try {
    const budget: AssemblyBudget = { bytes: 0, nodes: 0, queryWarnings: new Set() }
    return { html: assemblePage(entryPath, entry, byPath, diagnostics, new Set([entryPath]), budget), diagnostics }
  } catch (error) {
    const message = error instanceof Error && error.name === 'PreviewBudgetError' ? error.message : 'Preview document assembly failed safely.'
    return { html: '', diagnostics: [...diagnostics, { severity: 'error', path: entryPath, message }] }
  }
}

const DEVICE_DIMENSIONS: Record<Exclude<PreviewDevice, 'custom'>, [number, number]> = { phone: [390, 844], tablet: [768, 1024], desktop: [1440, 900] }
export function previewViewport(input: { device: PreviewDevice; orientation: PreviewOrientation; zoom: number; customWidth?: number; customHeight?: number }) {
  const dimensions = input.device === 'custom' ? [input.customWidth ?? 390, input.customHeight ?? 844] : DEVICE_DIMENSIONS[input.device]
  const width = Math.min(2560, Math.max(240, Math.round(dimensions[0]))); const height = Math.min(2560, Math.max(240, Math.round(dimensions[1])))
  const oriented = input.orientation === 'landscape' && height > width || input.orientation === 'portrait' && width > height ? [height, width] : [width, height]
  return { width: oriented[0], height: oriented[1], scale: Math.min(2, Math.max(0.25, input.zoom / 100)) }
}
