import { Worker } from 'node:worker_threads'
import { finalizePreviewDocument, type PreviewBuild, type PreviewDiagnostic } from '@/lib/preview-runtime'

interface BuildFile { path: string; content: string }
interface BundleOptions { timeoutMs?: number; maxOutputBytes?: number }
interface WorkerResult { code?: string; css?: string; html?: string; diagnostics: PreviewDiagnostic[] }

const MAX_INPUT_BYTES = 1_048_576
const DEFAULT_MAX_OUTPUT_BYTES = 5_242_880
const DEFAULT_TIMEOUT_MS = 5_000
const activeWorkers = new Set<Worker>()

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const esbuild = require('esbuild');
const path = require('node:path');
const files = new Map(workerData.files.map(file => [file.path.replace(/^\/+/, ''), file.content]));
const entryHtml = files.get(workerData.entryPath);
const scriptMatch = entryHtml && entryHtml.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*><\/script>/i);
const entryScript = scriptMatch && scriptMatch[1].replace(/^\/+/, '');
const loaderFor = file => {
  const ext = path.extname(file).slice(1).toLowerCase();
  return ({ js: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', css: 'css', json: 'json' })[ext] || 'text';
};
async function run() {
  if (!entryHtml || !entryScript || !files.has(entryScript)) {
    parentPort.postMessage({ diagnostics: [{ severity: 'error', path: workerData.entryPath, message: 'React preview requires an HTML entry with one local module script.' }] });
    return;
  }
  try {
    const result = await esbuild.build({
      absWorkingDir: workerData.cwd,
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
        build.onResolve({ filter: /.*/ }, args => {
          const request = args.path.replace(/^\/+/, '');
          if (!args.importer && files.has(request)) return { path: request, namespace: 'lotus' };
          if (args.namespace === 'lotus' && (args.path.startsWith('.') || args.path.startsWith('/'))) {
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path)).replace(/^\/+/, '');
            if (files.has(resolved)) return { path: resolved, namespace: 'lotus' };
            return { errors: [{ text: 'Local module not found: ' + args.path }] };
          }
          return undefined;
        });
        build.onLoad({ filter: /.*/, namespace: 'lotus' }, args => ({ contents: files.get(args.path), loader: loaderFor(args.path), resolveDir: workerData.cwd }));
      }}],
    });
    const javascript = result.outputFiles.find(file => file.path.endsWith('.js'))?.text || '';
    const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
    const html = entryHtml.replace(scriptMatch[0], '');
    parentPort.postMessage({ html, code: javascript, css, diagnostics: [] });
  } catch (error) {
    const errors = Array.isArray(error.errors) ? error.errors : [];
    const diagnostics = errors.length ? errors.map(item => ({
      severity: 'error',
      path: item.location && item.location.file ? item.location.file.replace(workerData.cwd, '').replace(/^lotus:/, '').replace(/^[/\\]+/, '') : workerData.entryPath,
      line: item.location && item.location.line || undefined,
      column: item.location && item.location.column === undefined ? undefined : item.location.column + 1,
      message: String(item.text || 'Build failed.').replaceAll(workerData.cwd, ''),
    })) : [{ severity: 'error', path: workerData.entryPath, message: 'Local build failed.' }];
    parentPort.postMessage({ diagnostics });
  }
}
run();
`

export function getActiveBuildCount() {
  return activeWorkers.size
}

export async function bundleReactProject(files: BuildFile[], entryPath: string, options: BundleOptions = {}): Promise<PreviewBuild> {
  if (!files.length || files.length > 250) throw new Error('Project exceeds the local build input limit.')
  const inputBytes = files.reduce((total, file) => total + Buffer.byteLength(file.path) + Buffer.byteLength(file.content), 0)
  if (inputBytes > MAX_INPUT_BYTES) throw new Error('Project exceeds the local build input limit.')

  const timeoutMs = Math.min(15_000, Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  const maxOutputBytes = Math.min(DEFAULT_MAX_OUTPUT_BYTES, Math.max(1_024, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES))
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { files, entryPath, cwd: process.cwd() },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
  })
  activeWorkers.add(worker)

  try {
    const result = await new Promise<WorkerResult>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Local build timed out after ${timeoutMs}ms.`)), timeoutMs)
      worker.once('message', (message: WorkerResult) => { clearTimeout(timeout); resolve(message) })
      worker.once('error', (error) => { clearTimeout(timeout); reject(new Error(`Local build worker failed: ${error.message}`)) })
      worker.once('exit', (code) => {
        if (code !== 0) { clearTimeout(timeout); reject(new Error('Local build worker stopped before completing.')) }
      })
    })
    if (result.diagnostics.length) return { html: '', diagnostics: result.diagnostics }
    const code = result.code ?? ''
    const css = result.css ?? ''
    const html = `${result.html ?? ''}<style data-lotus-bundle>${css.replace(/<\/style/gi, '<\\/style')}</style><script data-lotus-bundle>${code.replace(/<\/script/gi, '<\\/script')}</script>`
    if (Buffer.byteLength(html) > maxOutputBytes) throw new Error('Local build exceeds the output limit.')
    return { html: finalizePreviewDocument(html), diagnostics: [] }
  } finally {
    activeWorkers.delete(worker)
    await worker.terminate().catch(() => undefined)
  }
}
