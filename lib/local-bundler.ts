import { Worker } from 'node:worker_threads'
import { parse, serialize } from 'parse5'
import { assembleStaticPreview, type PreviewBuild, type PreviewDiagnostic } from '@/lib/preview-runtime'
import { hasBlockedBrowserCapability, hasStaticallyUnboundedLoop } from '@/lib/runtime-guard'

interface BuildFile { path: string; content: string }
interface BundleOptions { timeoutMs?: number; maxOutputBytes?: number; ownerKey?: string; signal?: AbortSignal }
interface WorkerResult { code?: string; css?: string; html?: string; diagnostics: PreviewDiagnostic[] }
type HtmlNode = { tagName?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: HtmlNode[]; parentNode?: HtmlNode }

const MAX_INPUT_BYTES = 1_048_576
const DEFAULT_MAX_OUTPUT_BYTES = 5_242_880
const DEFAULT_TIMEOUT_MS = 5_000
const activeWorkers = new Set<Worker>()
let activeBuildSlots = 0
const activeOwners = new Map<string, number>()
const waiters: Array<() => void> = []
const MAX_GLOBAL_BUILDS = 4
const MAX_OWNER_BUILDS = 2
const MAX_QUEUED_BUILDS = 16

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');
const files = new Map(workerData.files.map(file => [file.path, file.content]));
const allowedPackages = new Set(['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','scheduler']);
const vendorRoots = ['react/package.json','react-dom/package.json','scheduler/package.json'].map(request => path.dirname(require.resolve(request)));
const entryHtml = workerData.entryHtml;
const entryScript = workerData.entryScript;
const withinVendor = candidate => vendorRoots.some(root => candidate === root || candidate.startsWith(root + path.sep));
const loaderFor = file => {
  const ext = path.extname(file).slice(1).toLowerCase();
  return ({ js: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', css: 'css', json: 'json', svg:'dataurl', png:'dataurl', jpg:'dataurl', jpeg:'dataurl', gif:'dataurl', webp:'dataurl', woff:'dataurl', woff2:'dataurl', ttf:'dataurl', otf:'dataurl' })[ext] || 'text';
};
async function run() {
  if (!entryHtml || !entryScript || !files.has(entryScript)) {
    parentPort.postMessage({ diagnostics: [{ severity: 'error', path: workerData.entryPath, message: 'React preview requires an HTML entry with one local module script.' }] });
    return;
  }
  try {
    const result = await esbuild.build({
      bundle: true,
      write: false,
      entryPoints: [entryScript],
      outfile: 'bundle.js',
      platform: 'browser',
      format: 'iife',
      target: ['es2020'],
      jsx: 'automatic',
      sourcemap: false,
      logLevel: 'silent',
      plugins: [{ name: 'lotus-memory-files', setup(build) {
        build.onResolve({ filter: /.*/, namespace: 'lotus' }, args => {
          if (allowedPackages.has(args.path)) return { path: require.resolve(args.path), namespace: 'lotus-vendor' };
          if (args.path.startsWith('file:') || /^[a-zA-Z]:[\\/]/.test(args.path) || args.path.startsWith('\\\\') || !args.path.startsWith('.')) return { errors: [{ text: 'Non-project import blocked: ' + args.path }] };
          const request = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
          if (!request || request.startsWith('../') || path.posix.isAbsolute(request)) return { errors: [{ text: 'Non-project import blocked: ' + args.path }] };
          if (files.has(request)) return { path: request, namespace: 'lotus' };
          return { errors: [{ text: 'Local module not found: ' + args.path }] };
        });
        build.onResolve({ filter: /.*/, namespace: 'lotus-vendor' }, args => {
          try {
            const candidate = allowedPackages.has(args.path) ? require.resolve(args.path) : args.path.startsWith('.') ? require.resolve(path.resolve(path.dirname(args.importer), args.path)) : '';
            if (!candidate || !withinVendor(candidate)) return { errors: [{ text: 'Non-allowlisted vendor import blocked: ' + args.path }] };
            return { path: candidate, namespace: 'lotus-vendor' };
          } catch { return { errors: [{ text: 'Non-allowlisted vendor import blocked: ' + args.path }] }; }
        });
        build.onResolve({ filter: /.*/ }, args => {
          const request = args.path.replace(/^\/+/, '');
          if (!args.importer && files.has(request)) return { path: request, namespace: 'lotus' };
          return { errors: [{ text: 'Non-project import blocked: ' + args.path }] };
        });
        build.onLoad({ filter: /.*/, namespace: 'lotus' }, args => {
          const loader = loaderFor(args.path); const raw = files.get(args.path) || '';
          const binary = ['woff','woff2','ttf','otf','png','jpg','jpeg','gif','webp'].includes(path.extname(args.path).slice(1).toLowerCase());
          return { contents: binary ? Buffer.from(raw.replace(/^data:[^,]+,/, ''), 'base64') : raw, loader };
        });
        build.onLoad({ filter: /.*/, namespace: 'lotus-vendor' }, args => {
          if (!withinVendor(args.path)) return { errors: [{ text: 'Vendor path escaped its allowlist.' }] };
          return { contents: fs.readFileSync(args.path), loader: path.extname(args.path) === '.json' ? 'json' : 'js' };
        });
      }}],
    });
    const javascript = result.outputFiles.find(file => file.path.endsWith('.js'))?.text || '';
    const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
    parentPort.postMessage({ html: entryHtml, code: javascript, css, diagnostics: [] });
  } catch (error) {
    const errors = Array.isArray(error.errors) ? error.errors : [];
    const diagnostics = errors.length ? errors.map(item => ({
      severity: 'error',
      path: item.location && item.location.file ? item.location.file.replace(/^lotus:/, '').replace(/^[/\\]+/, '') : workerData.entryPath,
      line: item.location && item.location.line || undefined,
      column: item.location && item.location.column === undefined ? undefined : item.location.column + 1,
      message: String(item.text || 'Build failed.').replace(/[A-Za-z]:[\\/][^\s"']+/g, '[path]'),
    })) : [{ severity: 'error', path: workerData.entryPath, message: 'Local build failed.' }];
    parentPort.postMessage({ diagnostics });
  }
}
run();
`

function extractReactEntry(files: BuildFile[], entryPath: string) {
  const source = files.find((file) => file.path === entryPath)?.content
  if (source === undefined) return null
  const document = parse(source) as unknown as HtmlNode
  let entryScript = ''
  const walk = (node: HtmlNode) => {
    for (const child of [...(node.childNodes ?? [])]) walk(child)
    if (entryScript || node.tagName !== 'script') return
    const type = node.attrs?.find((item) => item.name.toLowerCase() === 'type')?.value.toLowerCase()
    const src = node.attrs?.find((item) => item.name.toLowerCase() === 'src')?.value ?? ''
    const normalized = src.replace(/^\/+/, '')
    if (type !== 'module' || !normalized || src.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(src) || !files.some((file) => file.path === normalized)) return
    entryScript = normalized
    const siblings = node.parentNode?.childNodes
    const index = siblings?.indexOf(node) ?? -1
    if (siblings && index >= 0) siblings.splice(index, 1)
  }
  walk(document)
  return entryScript ? { entryScript, entryHtml: serialize(document as never) } : null
}

export function getActiveBuildCount() {
  return activeBuildSlots
}

async function acquireBuildSlot(ownerKey: string, signal?: AbortSignal) {
  if (waiters.length >= MAX_QUEUED_BUILDS) throw new Error('Local build queue is full.')
  while (activeBuildSlots >= MAX_GLOBAL_BUILDS || (activeOwners.get(ownerKey) ?? 0) >= MAX_OWNER_BUILDS) {
    await new Promise<void>((resolve, reject) => {
      const resume = () => { signal?.removeEventListener('abort', abort); resolve() }
      const abort = () => { const index = waiters.indexOf(resume); if (index >= 0) waiters.splice(index, 1); reject(new Error('Local build cancelled.')) }
      waiters.push(resume)
      signal?.addEventListener('abort', abort, { once: true })
    })
  }
  if (signal?.aborted) throw new Error('Local build cancelled.')
  activeBuildSlots += 1
  activeOwners.set(ownerKey, (activeOwners.get(ownerKey) ?? 0) + 1)
  return () => {
    activeBuildSlots -= 1
    const remaining = (activeOwners.get(ownerKey) ?? 1) - 1
    if (remaining) activeOwners.set(ownerKey, remaining); else activeOwners.delete(ownerKey)
    waiters.shift()?.()
  }
}

export async function bundleReactProject(files: BuildFile[], entryPath: string, options: BundleOptions = {}): Promise<PreviewBuild> {
  if (!files.length || files.length > 250) throw new Error('Project exceeds the local build input limit.')
  if (files.some((file) => !file.path || file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').some((part) => !part || part === '.' || part === '..'))) throw new Error('Project contains an unsafe build path.')
  const inputBytes = files.reduce((total, file) => total + Buffer.byteLength(file.path) + Buffer.byteLength(file.content), 0)
  if (inputBytes > MAX_INPUT_BYTES) throw new Error('Project exceeds the local build input limit.')
  const unsafeSource = files.find((file) => /\.[cm]?[jt]sx?$/.test(file.path) && hasStaticallyUnboundedLoop(file.content))
  if (unsafeSource) return { html: '', diagnostics: [{ severity: 'error', path: unsafeSource.path, message: 'Preview blocked a statically unbounded loop.' }] }
  const networkSource = files.find((file) => /\.[cm]?[jt]sx?$/.test(file.path) && hasBlockedBrowserCapability(file.content))
  if (networkSource) return { html: '', diagnostics: [{ severity: 'error', path: networkSource.path, message: 'Preview blocked source access to navigation or network capabilities.' }] }
  const entry = extractReactEntry(files, entryPath)
  if (!entry) return { html: '', diagnostics: [{ severity: 'error', path: entryPath, message: 'React preview requires an HTML entry with one local module script.' }] }

  const timeoutMs = Math.min(15_000, Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  const maxOutputBytes = Math.min(DEFAULT_MAX_OUTPUT_BYTES, Math.max(1_024, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES))
  const releaseSlot = await acquireBuildSlot(options.ownerKey ?? 'anonymous', options.signal)
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { files, entryPath, ...entry },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
  })
  activeWorkers.add(worker)

  try {
    const result = await new Promise<WorkerResult>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Local build timed out after ${timeoutMs}ms.`)), timeoutMs)
      const abort = () => { clearTimeout(timeout); reject(new Error('Local build cancelled.')) }
      options.signal?.addEventListener('abort', abort, { once: true })
      worker.once('message', (message: WorkerResult) => { clearTimeout(timeout); resolve(message) })
      worker.once('error', (error) => { clearTimeout(timeout); reject(new Error(`Local build worker failed: ${error.message.replaceAll(process.cwd(), '')}`)) })
      worker.once('exit', (code) => {
        if (code !== 0) { clearTimeout(timeout); reject(new Error('Local build worker stopped before completing.')) }
      })
    })
    if (result.diagnostics.length) return { html: '', diagnostics: result.diagnostics }
    const code = result.code ?? ''
    const css = result.css ?? ''
    const assets = `<style data-lotus-bundle>${css.replace(/<\/style/gi, '<\\/style')}</style><script data-lotus-bundle>${code.replace(/<\/script/gi, '<\\/script')}</script>`
    const sourceHtml = result.html ?? ''
    const closingBody = sourceHtml.toLowerCase().lastIndexOf('</body')
    const html = closingBody >= 0 ? `${sourceHtml.slice(0, closingBody)}${assets}${sourceHtml.slice(closingBody)}` : `${sourceHtml}${assets}`
    if (Buffer.byteLength(html) > maxOutputBytes) throw new Error('Local build exceeds the output limit.')
    const assembled = assembleStaticPreview(files.map((file) => file.path === entryPath ? { ...file, content: html } : file), entryPath)
    if (Buffer.byteLength(assembled.html) > maxOutputBytes) throw new Error('Local build exceeds the output limit.')
    return assembled
  } finally {
    activeWorkers.delete(worker)
    await worker.terminate().catch(() => undefined)
    releaseSlot()
  }
}
