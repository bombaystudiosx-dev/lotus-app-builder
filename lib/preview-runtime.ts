import { parse, parseFragment, serialize } from 'parse5'
import { hasBlockedBrowserCapability, hasStaticallyUnboundedLoop, instrumentJavaScript } from '@/lib/runtime-guard'

export type PreviewDevice = 'phone' | 'tablet' | 'desktop' | 'custom'
export type PreviewOrientation = 'portrait' | 'landscape'
export interface PreviewFile { id?: string; path: string; content: string; encoding?: 'utf-8' | 'utf-16le' }
export interface PreviewDiagnostic { severity: 'error' | 'warning'; message: string; path?: string; line?: number; column?: number }
export interface PreviewBuild { html: string; diagnostics: PreviewDiagnostic[]; revision?: number }
// Generated code is untrusted. Scripts run inside an opaque-origin iframe while
// navigation, same-origin access, forms, popups, and downloads remain denied.
export const PREVIEW_SANDBOX = 'allow-scripts'

type HtmlAttribute = { name: string; value: string }
type HtmlNode = { nodeName: string; tagName?: string; value?: string; attrs?: HtmlAttribute[]; childNodes?: HtmlNode[]; parentNode?: HtmlNode; content?: HtmlNode }
type AssemblyBudget = { bytes: number; nodes: number; references: number; queryWarnings: Set<string>; assetCache: Map<string, string> }

const EXTERNAL_REFERENCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i
const IMAGE_MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' }
const MAX_EXPANDED_BYTES = 5_242_880
const MAX_EXPANDED_NODES = 20_000
const MAX_EXPANDED_REFERENCES = 4_096

function reserveBudget(budget: AssemblyBudget, bytes = 0, nodes = 0, references = 0) {
  budget.bytes += bytes; budget.nodes += nodes; budget.references += references
  if (budget.bytes > MAX_EXPANDED_BYTES || budget.nodes > MAX_EXPANDED_NODES || budget.references > MAX_EXPANDED_REFERENCES) {
    const error = new Error('Preview expansion budget exceeded.')
    error.name = 'PreviewBudgetError'
    throw error
  }
}

function utf8Bytes(value: string) {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1 }
    else bytes += 3
  }
  return bytes
}
function approximateMarkupNodes(value: string) {
  let count = 0; let index = value.indexOf('<')
  while (index >= 0) { count += 1; index = value.indexOf('<', index + 1) }
  return count
}
function estimateSerializedBytes(node: HtmlNode, parentTag = ''): number {
  let bytes = 0
  if (node.value !== undefined) bytes += utf8Bytes(node.value) * (parentTag === 'script' || parentTag === 'style' ? 1 : 6)
  if (node.tagName) {
    bytes += 5 + utf8Bytes(node.tagName) * 2
    for (const attribute of node.attrs ?? []) bytes += 4 + utf8Bytes(attribute.name) + utf8Bytes(attribute.value) * 6
  }
  for (const child of node.childNodes ?? []) bytes += estimateSerializedBytes(child, node.tagName ?? parentTag)
  if (node.content) bytes += estimateSerializedBytes(node.content, node.tagName ?? parentTag)
  return bytes
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

function assetDataUrl(path: string, content: string, budget: AssemblyBudget) {
  const cached = budget.assetCache.get(path)
  if (cached !== undefined) { reserveBudget(budget, utf8Bytes(cached), 0, 1); return cached }
  if (/^\s*data:/i.test(content)) {
    reserveBudget(budget, utf8Bytes(content), 0, 1)
    const url = content.trim(); budget.assetCache.set(path, url); return url
  }
  const extension = path.toLowerCase().split('.').pop() ?? ''
  const mime = IMAGE_MIME[extension] ?? 'application/octet-stream'
  const prefix = `data:${mime};base64,`
  let payloadLength = 0
  if (extension === 'svg') payloadLength = Math.ceil(utf8Bytes(content) / 3) * 4
  else for (let index = 0; index < content.length; index += 1) if (!/\s/.test(content[index])) payloadLength += 1
  reserveBudget(budget, prefix.length + payloadLength, 0, 1)
  const payload = extension === 'svg' ? base64Utf8(content) : content.replace(/\s+/g, '')
  const url = `${prefix}${payload}`
  budget.assetCache.set(path, url)
  return url
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

function randomRegistryName() {
  const values = new Uint32Array(2)
  globalThis.crypto.getRandomValues(values)
  return `__lotusRegister_${values[0].toString(36)}${values[1].toString(36)}`
}

function randomScriptNonce() {
  const values = new Uint32Array(4)
  globalThis.crypto.getRandomValues(values)
  return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('')
}

function previewCsp(scriptNonce: string) {
  return `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; font-src data:; connect-src 'none'; media-src data:; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
}

function runtimeBridge(registryName: string, scriptNonce: string) {
  return `<script data-lotus-runtime nonce="${scriptNonce}">(function(){
var sent=0,windowStart=Date.now(),localPages=new WeakMap(),registered=false;
var nativeDefineProperty=Object.defineProperty,nativeDefineProperties=Object.defineProperties,nativeReflectDefineProperty=Reflect.defineProperty,nativeGetOwnPropertyDescriptor=Object.getOwnPropertyDescriptor,nativeGetOwnPropertyNames=Object.getOwnPropertyNames,nativeGetPrototypeOf=Object.getPrototypeOf,nativeFunctionToString=Function.prototype.toString;
var randomValues=new Uint32Array(2);crypto.getRandomValues(randomValues);var channel=randomValues[0].toString(36).padStart(7,'0')+randomValues[1].toString(36).padStart(7,'0'),post=parent.postMessage.bind(parent);
var clean=function(value){var text='';try{text=typeof value==='string'?value:JSON.stringify(value)}catch(_){text=String(value)}return text.slice(0,1000)};
var send=function(kind,payload){var now=Date.now();if(now-windowStart>1000){sent=0;windowStart=now}if(sent++>=40)return;post({type:'lotus-preview-event',channel:channel,kind:kind,payload:payload},'*')};
var deny=function(){throw new Error('Dynamic preview scripts are blocked')};
var define=function(target,name,value){try{nativeDefineProperty(target,name,{value:value,writable:false,configurable:false})}catch(_){try{target[name]=value}catch(__){}}};
var constructorPrototypes=[Function.prototype];try{constructorPrototypes.push(nativeGetPrototypeOf(async function(){}),nativeGetPrototypeOf(function*(){}),nativeGetPrototypeOf(async function*(){}))}catch(_){}
['open','fetch','XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker','eval','Function'].forEach(function(name){define(window,name,deny)});
constructorPrototypes.forEach(function(prototype){define(prototype,'constructor',deny)});
if(window.navigation)define(window.navigation,'navigate',deny);
['setTimeout','setInterval'].forEach(function(name){var original=window[name];define(window,name,function(callback){if(typeof callback!=='function')return deny();return original.apply(window,arguments)})});
var nativeCreate=document.createElement.bind(document),nativeCreateNS=document.createElementNS.bind(document);
define(Document.prototype,'createElement',function(name){if(String(name).toLowerCase()==='script')return deny();return nativeCreate.apply(document,arguments)});
define(Document.prototype,'createElementNS',function(namespace,name){if(String(name).toLowerCase()==='script')return deny();return nativeCreateNS.apply(document,arguments)});
var active=function(node){return !!node&&(['script','iframe','frame','object','embed','portal','meta','link'].indexOf(String(node.nodeName).toLowerCase())>=0||!!(node.querySelector&&node.querySelector('script,iframe,frame,object,embed,portal,meta,link')))};
var nativeRemoveChild=Node.prototype.removeChild;
['appendChild','insertBefore','replaceChild'].forEach(function(name){var original=Node.prototype[name];define(Node.prototype,name,function(node){if(active(node))return deny();return original.apply(this,arguments)})});
var protectMany=function(proto,name){if(!proto||typeof proto[name]!=='function')return;var original=proto[name];define(proto,name,function(){for(var index=0;index<arguments.length;index++){if(active(arguments[index]))return deny()}return original.apply(this,arguments)})};
[Element.prototype,Document.prototype,DocumentFragment.prototype,typeof ShadowRoot==='undefined'?null:ShadowRoot.prototype].forEach(function(proto){['append','prepend','replaceChildren'].forEach(function(name){protectMany(proto,name)})});
[Element.prototype,typeof CharacterData==='undefined'?null:CharacterData.prototype].forEach(function(proto){['before','after','replaceWith'].forEach(function(name){protectMany(proto,name)})});
if(typeof Range!=='undefined'&&Range.prototype.insertNode){var nativeInsertNode=Range.prototype.insertNode;define(Range.prototype,'insertNode',function(node){if(active(node))return deny();return nativeInsertNode.apply(this,arguments)})}
var htmlDescriptor=nativeGetOwnPropertyDescriptor(Element.prototype,'innerHTML'),outerDescriptor=nativeGetOwnPropertyDescriptor(Element.prototype,'outerHTML');
var sanitize=function(markup){var template=nativeCreate('template');htmlDescriptor.set.call(template,String(markup));template.content.querySelectorAll('script,iframe,frame,object,embed,portal,meta,link').forEach(function(node){node.remove()});template.content.querySelectorAll('*').forEach(function(node){Array.prototype.slice.call(node.attributes).forEach(function(attribute){var name=attribute.name.toLowerCase();if(name.indexOf('on')===0||['srcdoc','formaction','ping','action','target'].indexOf(name)>=0)node.removeAttribute(attribute.name)})});return htmlDescriptor.get.call(template)};
if(htmlDescriptor&&htmlDescriptor.get&&htmlDescriptor.set)nativeDefineProperty(Element.prototype,'innerHTML',{get:htmlDescriptor.get,set:function(value){return htmlDescriptor.set.call(this,sanitize(value))},configurable:false});
if(outerDescriptor&&outerDescriptor.get&&outerDescriptor.set)nativeDefineProperty(Element.prototype,'outerHTML',{get:outerDescriptor.get,set:function(value){return outerDescriptor.set.call(this,sanitize(value))},configurable:false});
if(Element.prototype.insertAdjacentHTML){var nativeAdjacent=Element.prototype.insertAdjacentHTML;define(Element.prototype,'insertAdjacentHTML',function(position,value){return nativeAdjacent.call(this,position,sanitize(value))})}
var eventField=function(name){return /^on[a-z]/i.test(String(name).split(':').pop()||'')},sensitiveElement=function(element){var tag=String(element&&element.nodeName).toLowerCase();return tag==='meta'||tag==='link'},sensitiveMaps=new WeakSet();
var sensitiveAttribute=function(attribute){return !!attribute&&(eventField(attribute.name)||sensitiveElement(attribute.ownerElement))};
var rememberSensitive=function(root){if(!root)return;var nodes=[];if(sensitiveElement(root))nodes.push(root);if(root.querySelectorAll)nodes=nodes.concat(Array.prototype.slice.call(root.querySelectorAll('meta,link')));nodes.forEach(function(node){sensitiveMaps.add(node.attributes)})};
var nativeSetAttribute=Element.prototype.setAttribute,nativeSetAttributeNS=Element.prototype.setAttributeNS,nativeRemoveAttribute=Element.prototype.removeAttribute,nativeRemoveAttributeNS=Element.prototype.removeAttributeNS,nativeToggleAttribute=Element.prototype.toggleAttribute,nativeSetAttributeNode=Element.prototype.setAttributeNode,nativeSetAttributeNodeNS=Element.prototype.setAttributeNodeNS;
var blockedAttribute=function(element,name){return sensitiveElement(element)||eventField(name)};
define(Element.prototype,'setAttribute',function(name){if(blockedAttribute(this,name))return deny();return nativeSetAttribute.apply(this,arguments)});
define(Element.prototype,'setAttributeNS',function(namespace,name){if(blockedAttribute(this,name))return deny();return nativeSetAttributeNS.apply(this,arguments)});
define(Element.prototype,'removeAttribute',function(name){if(blockedAttribute(this,name))return deny();return nativeRemoveAttribute.apply(this,arguments)});
define(Element.prototype,'removeAttributeNS',function(namespace,name){if(blockedAttribute(this,name))return deny();return nativeRemoveAttributeNS.apply(this,arguments)});
define(Element.prototype,'toggleAttribute',function(name){if(blockedAttribute(this,name))return deny();return nativeToggleAttribute.apply(this,arguments)});
define(Element.prototype,'setAttributeNode',function(attribute){if(sensitiveElement(this)||sensitiveAttribute(attribute))return deny();return nativeSetAttributeNode.apply(this,arguments)});
define(Element.prototype,'setAttributeNodeNS',function(attribute){if(sensitiveElement(this)||sensitiveAttribute(attribute))return deny();return nativeSetAttributeNodeNS.apply(this,arguments)});
if(typeof NamedNodeMap!=='undefined'){
  ['setNamedItem','setNamedItemNS'].forEach(function(name){var original=NamedNodeMap.prototype[name];define(NamedNodeMap.prototype,name,function(attribute){if(sensitiveMaps.has(this)||sensitiveAttribute(attribute))return deny();return original.apply(this,arguments)})});
  ['removeNamedItem','removeNamedItemNS'].forEach(function(name){var original=NamedNodeMap.prototype[name];define(NamedNodeMap.prototype,name,function(){if(sensitiveMaps.has(this)||eventField(arguments[0]))return deny();return original.apply(this,arguments)})});
}
var protectAttributeSetter=function(prototype,name){if(!prototype)return;var descriptor=nativeGetOwnPropertyDescriptor(prototype,name);if(descriptor&&descriptor.get&&descriptor.set)try{nativeDefineProperty(prototype,name,{get:descriptor.get,set:function(value){if(sensitiveAttribute(this))return deny();return descriptor.set.call(this,value)},enumerable:descriptor.enumerable,configurable:false})}catch(_){}};
if(typeof Attr!=='undefined')protectAttributeSetter(Attr.prototype,'value');protectAttributeSetter(Node.prototype,'nodeValue');protectAttributeSetter(Node.prototype,'textContent');
var protectSetter=function(prototype,name){if(!prototype)return;var descriptor=nativeGetOwnPropertyDescriptor(prototype,name);if(descriptor&&descriptor.get&&descriptor.set)try{nativeDefineProperty(prototype,name,{get:descriptor.get,set:deny,enumerable:descriptor.enumerable,configurable:false})}catch(_){}};
if(typeof HTMLMetaElement!=='undefined'){protectSetter(HTMLMetaElement.prototype,'httpEquiv');protectSetter(HTMLMetaElement.prototype,'content')}
if(typeof HTMLFormElement!=='undefined'){define(HTMLFormElement.prototype,'submit',deny);define(HTMLFormElement.prototype,'requestSubmit',deny)}
define(Document.prototype,'write',deny);define(Document.prototype,'writeln',deny);
var neutralize=function(root){if(!root)return;var nodes=[];if(root.nodeType===1)nodes.push(root);if(root.querySelectorAll)nodes=nodes.concat(Array.prototype.slice.call(root.querySelectorAll('*')));nodes.forEach(function(node){Array.prototype.slice.call(node.attributes||[]).forEach(function(attribute){if(eventField(attribute.name))nativeRemoveAttribute.call(node,attribute.name)});if(String(node.nodeName).toLowerCase()==='meta'&&String(node.getAttribute('http-equiv')||'').trim().toLowerCase()==='refresh'){if(node.parentNode)nativeRemoveChild.call(node.parentNode,node);return}if(sensitiveElement(node))sensitiveMaps.add(node.attributes)})};
rememberSensitive(document);
if(typeof MutationObserver!=='undefined'){var observer=new MutationObserver(function(records){records.forEach(function(record){if(record.type==='attributes')neutralize(record.target);else Array.prototype.slice.call(record.addedNodes).forEach(neutralize)})});observer.observe(document,{subtree:true,childList:true,attributes:true})}
nativeDefineProperty(window,${JSON.stringify(registryName)},{value:function(){if(registered)return;registered=true;neutralize(document);rememberSensitive(document);document.querySelectorAll('a[data-lotus-local-page]').forEach(function(anchor){var href=anchor.getAttribute('href');if(href)localPages.set(anchor,href)})},writable:false,configurable:false});
window.addEventListener('click',function(event){var target=event.target&&event.target.closest&&event.target.closest('a[href]');if(!target)return;var localHref=localPages.get(target),href=target.getAttribute('href')||'';if(localHref){event.preventDefault();event.stopImmediatePropagation();event.stopPropagation();if(!event.isTrusted||href!==localHref)return;send('navigation',{local:true});location.href=localHref;return}if(href.charAt(0)!=='#'){event.preventDefault();event.stopImmediatePropagation();event.stopPropagation()}},true);
['log','info','warn','error'].forEach(function(level){var original=console[level];console[level]=function(){var args=Array.prototype.slice.call(arguments,0,10).map(clean);send('console',{level:level,args:args});return original.apply(console,arguments)}});
window.onerror=function(message,source,line,column){send('error',{message:clean(message),source:clean(source||''),line:Number(line)||0,column:Number(column)||0});return false};
window.addEventListener('unhandledrejection',function(event){send('error',{message:clean(event.reason&&event.reason.message||event.reason||'Unhandled promise rejection'),source:'promise',line:0,column:0})});
window.addEventListener('submit',function(event){event.preventDefault();event.stopImmediatePropagation();event.stopPropagation()},true);
var eventTarget=function(target){return typeof EventTarget!=='undefined'&&target instanceof EventTarget},blockedProperty=function(target,name){return eventTarget(target)&&eventField(name)},seenPrototypes=new WeakSet();
var safeInstrumentedHandler=function(value){if(typeof value!=='function')return false;var source='';try{source=nativeFunctionToString.call(value).split('').filter(function(character){return character>' '}).join('')}catch(_){return false}var marker=source.indexOf('__lotusGuard_');if(marker<0)return false;var prefix=source.slice(0,marker),suffix=source.slice(marker);return (prefix.charAt(prefix.length-1)==='{'||prefix.charAt(prefix.length-1)==='(')&&/^__lotusGuard_[a-z0-9]+[(][)](?:;|,)/i.test(suffix)};
var protectEventSetter=function(prototype,name){var descriptor=nativeGetOwnPropertyDescriptor(prototype,name);if(descriptor&&descriptor.get&&descriptor.set)try{nativeDefineProperty(prototype,name,{get:descriptor.get,set:function(value){if(this===window&&name==='onerror')return deny();if(value===null)return descriptor.set.call(this,value);if(!safeInstrumentedHandler(value))return deny();return descriptor.set.call(this,value)},enumerable:descriptor.enumerable,configurable:false})}catch(_){}};
var protectEventHandlers=function(value){for(var prototype=value;prototype&&prototype!==Object.prototype;prototype=nativeGetPrototypeOf(prototype)){if(seenPrototypes.has(prototype))continue;seenPrototypes.add(prototype);try{nativeGetOwnPropertyNames(prototype).forEach(function(name){if(eventField(name))protectEventSetter(prototype,name)})}catch(_){}}};
[window,document,document.documentElement,nativeCreate('div'),nativeCreateNS('http://www.w3.org/2000/svg','svg')].forEach(protectEventHandlers);
nativeGetOwnPropertyNames(window).forEach(function(name){try{var descriptor=nativeGetOwnPropertyDescriptor(window,name),constructor=descriptor&&descriptor.value;if(typeof constructor==='function'&&constructor.prototype&&eventTarget(constructor.prototype))protectEventHandlers(constructor.prototype)}catch(_){}});
define(Object,'defineProperty',function(target,name,descriptor){if(blockedProperty(target,name))return deny();return nativeDefineProperty(target,name,descriptor)});
define(Object,'defineProperties',function(target,descriptors){if(eventTarget(target)&&nativeGetOwnPropertyNames(Object(descriptors)).some(eventField))return deny();return nativeDefineProperties(target,descriptors)});
define(Reflect,'defineProperty',function(target,name,descriptor){if(blockedProperty(target,name))return deny();return nativeReflectDefineProperty(target,name,descriptor)});
['__defineGetter__','__defineSetter__'].forEach(function(name){var original=Object.prototype[name];if(typeof original==='function')define(Object.prototype,name,function(property){if(blockedProperty(this,property))return deny();return original.apply(this,arguments)})});
send('ready',{});
})();</script>`
}

function secureDocumentStructure(source: string, registryName: string, scriptNonce: string) {
  const document = parse(source) as unknown as HtmlNode
  const html = document.childNodes?.find((node) => node.tagName === 'html')
  const head = html?.childNodes?.find((node) => node.tagName === 'head')
  if (!head) throw new Error('Unable to construct preview document.')
  head.childNodes ??= []
  head.childNodes = head.childNodes.filter((node) => !(node.tagName === 'meta' && attr(node, 'http-equiv')?.toLowerCase() === 'content-security-policy') && node.tagName !== 'base')
  const policy = fragmentNode(`<meta http-equiv="Content-Security-Policy" content="${previewCsp(scriptNonce)}">`)
  const bridge = fragmentNode(runtimeBridge(registryName, scriptNonce))
  policy.parentNode = head
  bridge.parentNode = head
  head.childNodes.unshift(policy, bridge)
  return document
}

function moveUserScriptsAfterRegistration(document: HtmlNode, registryName: string, scriptNonce: string) {
  const html = document.childNodes?.find((node) => node.tagName === 'html')
  const body = html?.childNodes?.find((node) => node.tagName === 'body')
  if (!body) throw new Error('Unable to construct preview document body.')
  const scripts: HtmlNode[] = []
  const collect = (node: HtmlNode) => {
    for (const child of node.childNodes ?? []) {
      if (child.tagName === 'script' && attr(child, 'data-lotus-runtime') === undefined) scripts.push(child)
      else collect(child)
    }
  }
  collect(document)
  for (const script of scripts) replaceNode(script, null)
  const register = fragmentNode(`<script data-lotus-runtime nonce="${scriptNonce}">${registryName}()</script>`)
  register.parentNode = body
  body.childNodes ??= []
  body.childNodes.push(register)
  for (const script of scripts) { setAttr(script, 'nonce', scriptNonce); script.parentNode = body; body.childNodes.push(script) }
}

export function finalizePreviewDocument(html: string) {
  const registryName = randomRegistryName()
  const scriptNonce = randomScriptNonce()
  const document = secureDocumentStructure(html, registryName, scriptNonce)
  moveUserScriptsAfterRegistration(document, registryName, scriptNonce)
  return serialize(document as never)
}

function rewriteCss(css: string, cssPath: string, byPath: Map<string, string>, diagnostics: PreviewDiagnostic[], budget: AssemblyBudget) {
  return css.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (match, _quote, reference: string) => {
    if (/^(?:data:|#)/i.test(reference)) return match
    const path = resolveReference(cssPath, reference)
    const content = path ? byPath.get(path) : undefined
    if (!path || content === undefined) { diagnostics.push({ severity: 'warning', path: cssPath, message: `Missing or unsafe local CSS asset: ${reference}` }); return 'url(about:blank)' }
    return `url("${assetDataUrl(path, content, budget)}")`
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
  const registryName = randomRegistryName()
  const scriptNonce = randomScriptNonce()
  const document = secureDocumentStructure(source, registryName, scriptNonce)
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
      reserveBudget(budget, 0, 0, 1)
      const reference = attr(node, 'href') ?? ''
      if ((attr(node, 'rel') ?? '').toLowerCase() !== 'stylesheet' && !/\.css(?:[?#]|$)/i.test(reference)) { replaceNode(node, null); return }
      const path = resolveReference(entryPath, reference); const content = path ? byPath.get(path) : undefined
      if (!path || content === undefined) { diagnostics.push({ severity: 'error', path: entryPath, message: `${EXTERNAL_REFERENCE.test(reference) ? 'External stylesheet blocked' : 'Missing local stylesheet'}: ${reference}` }); replaceNode(node, null); return }
      reserveBudget(budget, utf8Bytes(content))
      replaceNode(node, fragmentNode(`<style data-lotus-path="${path}"></style>`)); const replacement = node.parentNode?.childNodes
      const style = replacement?.find((candidate) => candidate.tagName === 'style' && attr(candidate, 'data-lotus-path') === path)
      if (style) style.childNodes = [{ nodeName: '#text', value: rewriteCss(content, path, byPath, diagnostics, budget), parentNode: style }]
      return
    }
    if (node.tagName === 'script') {
      if (attr(node, 'data-lotus-runtime') !== undefined) return
      const reference = attr(node, 'src'); let path = entryPath; let code = node.childNodes?.map((child) => child.value ?? '').join('') ?? ''
      if (reference) { reserveBudget(budget, 0, 0, 1); const resolved = resolveReference(entryPath, reference); const content = resolved ? byPath.get(resolved) : undefined; if (!resolved || content === undefined) { diagnostics.push({ severity: 'error', path: entryPath, message: `${EXTERNAL_REFERENCE.test(reference) ? 'External script blocked' : 'Missing local script'}: ${reference}` }); replaceNode(node, null); return } path = resolved; code = content; reserveBudget(budget, utf8Bytes(content)); removeAttr(node, 'src'); setAttr(node, 'data-lotus-path', path) }
      if (attr(node, 'data-lotus-bundle') === undefined && hasStaticallyUnboundedLoop(code)) { diagnostics.push({ severity: 'error', path, message: 'Preview blocked a statically unbounded loop.' }); replaceNode(node, null); return }
      if (attr(node, 'data-lotus-bundle') === undefined && hasBlockedBrowserCapability(code)) { diagnostics.push({ severity: 'error', path, message: 'Preview blocked navigation or network access and dynamic code capabilities.' }); replaceNode(node, null); return }
      try { code = instrumentJavaScript(code) } catch { diagnostics.push({ severity: 'error', path, message: 'Preview blocked JavaScript that could not be safely instrumented.' }); replaceNode(node, null); return }
      node.childNodes = [{ nodeName: '#text', value: code.replace(/<\/script/gi, '<\\/script'), parentNode: node }]
      return
    }
    if (node.tagName === 'style') { const css = node.childNodes?.map((child) => child.value ?? '').join('') ?? ''; node.childNodes = [{ nodeName: '#text', value: rewriteCss(css, entryPath, byPath, diagnostics, budget), parentNode: node }] }
    if (node.tagName === 'img' || node.tagName === 'source') {
      removeAttr(node, 'srcset')
      const reference = attr(node, 'src') ?? ''
      if (reference.startsWith('data:')) return
      const path = resolveReference(entryPath, reference); const content = path ? byPath.get(path) : undefined
      if (!path || content === undefined) { diagnostics.push({ severity: 'warning', path: entryPath, message: `Missing local asset: ${reference}` }); setAttr(node, 'src', ''); return }
      setAttr(node, 'src', assetDataUrl(path, content, budget)); return
    }
    if (node.tagName === 'a') {
      removeAttr(node, 'target'); removeAttr(node, 'ping'); removeAttr(node, 'data-lotus-local-page')
      const reference = attr(node, 'href') ?? ''
      if (reference.startsWith('#')) return
      const parts = splitReference(reference); const path = resolveReference(entryPath, parts.path); const content = path ? byPath.get(path) : undefined
      if (!path || content === undefined || !/\.html?$/i.test(path) || visited.has(path) || visited.size >= 20) { diagnostics.push({ severity: 'warning', path: entryPath, message: `Unsafe link blocked or missing: ${reference}` }); setAttr(node, 'href', '#'); return }
      reserveBudget(budget, 0, 0, 1)
      const nextVisited = new Set(visited).add(path); const linked = assemblePage(path, content, byPath, diagnostics, nextVisited, budget)
      const linkedBytes = utf8Bytes(linked); reserveBudget(budget, Math.ceil(linkedBytes / 3) * 4)
      setAttr(node, 'href', `data:text/html;base64,${base64Utf8(linked)}${parts.fragment ? `#${encodeURIComponent(parts.fragment)}` : ''}`)
      setAttr(node, 'data-lotus-local-page', '')
      if (parts.query) {
        setAttr(node, 'data-lotus-query', parts.query)
        const warningKey = `${entryPath}:${reference}`
        if (!budget.queryWarnings.has(warningKey)) { budget.queryWarnings.add(warningKey); diagnostics.push({ severity: 'warning', path: entryPath, message: `Preview query is metadata-only and does not change the embedded page URL: ${parts.query}` }) }
      }
      if (parts.fragment) setAttr(node, 'data-lotus-fragment', parts.fragment)
    }
  }
  walk(document)
  moveUserScriptsAfterRegistration(document, registryName, scriptNonce)
  reserveBudget(budget, estimateSerializedBytes(document))
  const output = serialize(document as never)
  return output
}

export function assembleStaticPreview(files: PreviewFile[], entryPath: string): PreviewBuild {
  const diagnostics: PreviewDiagnostic[] = []; const byPath = new Map(files.map((file) => [file.path, file.content])); const entry = byPath.get(entryPath)
  if (entry === undefined) return { html: '', diagnostics: [{ severity: 'error', path: entryPath, message: 'Preview entry file is missing.' }] }
  try {
    const budget: AssemblyBudget = { bytes: 0, nodes: 0, references: 0, queryWarnings: new Set(), assetCache: new Map() }
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
