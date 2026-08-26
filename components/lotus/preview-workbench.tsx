'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Monitor, RefreshCw, RotateCw, Smartphone, Tablet } from 'lucide-react'
import { LivePreview } from '@/components/lotus/live-preview'
import { previewViewport, type PreviewDevice, type PreviewDiagnostic, type PreviewOrientation } from '@/lib/preview-runtime'

interface PreviewWorkbenchProps {
  html: string
  diagnostics?: PreviewDiagnostic[]
  initialDevice?: PreviewDevice
}

interface ConsoleEntry {
  id: number
  level: string
  text: string
}

interface RuntimeError {
  message: string
  source?: string
  line?: number
  column?: number
}

const DEVICE_OPTIONS: Array<{ value: PreviewDevice; label: string; icon: React.ReactNode }> = [
  { value: 'phone', label: 'Phone viewport', icon: <Smartphone size={13}/> },
  { value: 'tablet', label: 'Tablet viewport', icon: <Tablet size={13}/> },
  { value: 'desktop', label: 'Desktop viewport', icon: <Monitor size={13}/> },
  { value: 'custom', label: 'Custom viewport', icon: <span className="text-[10px] font-bold">W×H</span> },
]

export function PreviewWorkbench({ html, diagnostics = [], initialDevice = 'phone' }: PreviewWorkbenchProps) {
  const [device, setDevice] = useState<PreviewDevice>(initialDevice)
  const [orientation, setOrientation] = useState<PreviewOrientation>('portrait')
  const [zoom, setZoom] = useState(75)
  const [customWidth, setCustomWidth] = useState(390)
  const [customHeight, setCustomHeight] = useState(844)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [manualHtml, setManualHtml] = useState(html)
  const [revision, setRevision] = useState(0)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [runtimeError, setRuntimeError] = useState<RuntimeError | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const nextConsoleId = useRef(0)
  const messageBudget = useRef({ startedAt: 0, count: 0 })
  const runtimeChannel = useRef<string | null>(null)

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow || event.data?.type !== 'lotus-preview-event') return
      let encoded = ''
      try { encoded = JSON.stringify(event.data) } catch { return }
      if (encoded.length > 8_192) return
      if (event.data.kind === 'ready') {
        if (runtimeChannel.current || typeof event.data.channel !== 'string' || !/^[a-z\d-]{8,64}$/i.test(event.data.channel) || !event.data.payload || typeof event.data.payload !== 'object') return
        runtimeChannel.current = event.data.channel
        setRuntimeError(null)
        return
      }
      if (!runtimeChannel.current || event.data.channel !== runtimeChannel.current) return
      if (event.data.kind === 'navigation' && event.data.payload?.local === true) { runtimeChannel.current = null; return }
      const now = Date.now()
      if (now - messageBudget.current.startedAt > 1_000) messageBudget.current = { startedAt: now, count: 0 }
      if (messageBudget.current.count++ >= 40) return
      if (event.data.kind === 'console') {
        const payload = event.data.payload as { level?: string; args?: unknown[] }
        if (!['log', 'info', 'warn', 'error'].includes(payload?.level ?? '') || !Array.isArray(payload?.args) || payload.args.length > 10 || payload.args.some((item) => typeof item !== 'string' || item.length > 1_000)) return
        const text = payload.args.join(' ')
        setConsoleEntries((entries) => [...entries.slice(-199), { id: nextConsoleId.current++, level: payload.level ?? 'log', text }])
      }
      if (event.data.kind === 'error') {
        const payload = event.data.payload as RuntimeError
        if (!payload || typeof payload.message !== 'string' || payload.message.length > 1_000 || (payload.source !== undefined && (typeof payload.source !== 'string' || payload.source.length > 500)) || (payload.line !== undefined && !Number.isFinite(payload.line)) || (payload.column !== undefined && !Number.isFinite(payload.column))) return
        setRuntimeError(payload)
        setConsoleEntries((entries) => [...entries.slice(-199), { id: nextConsoleId.current++, level: 'error', text: payload.message }])
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const viewport = useMemo(() => previewViewport({ device, orientation, zoom, customWidth, customHeight }), [customHeight, customWidth, device, orientation, zoom])
  const displayHtml = autoRefresh ? html : manualHtml

  useEffect(() => {
    runtimeChannel.current = null
    messageBudget.current = { startedAt: 0, count: 0 }
  }, [displayHtml, revision])

  function refresh() {
    setManualHtml(html)
    setRevision((value) => value + 1)
    setRuntimeError(null)
  }

  function downloadPreview() {
    const url = URL.createObjectURL(new Blob([displayHtml], { type: 'text/html' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'lotus-preview.html'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return <section aria-label="Preview workbench" className="flex h-full min-h-0 flex-col bg-[var(--background)]">
    <div className="flex flex-wrap items-center gap-1 border-b bg-[var(--card)] px-2 py-1.5">
      <div role="group" aria-label="Preview device" className="flex items-center gap-0.5">
        {DEVICE_OPTIONS.map((option) => <button key={option.value} type="button" aria-label={option.label} aria-pressed={device === option.value} onClick={() => setDevice(option.value)} className="rounded-md p-1.5 text-[var(--muted-foreground)] aria-pressed:bg-[var(--muted)] aria-pressed:text-[var(--foreground)]">{option.icon}</button>)}
      </div>
      <button type="button" aria-label="Rotate viewport" onClick={() => setOrientation((value) => value === 'portrait' ? 'landscape' : 'portrait')} className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"><RotateCw size={13}/></button>
      {device === 'custom' && <div className="flex items-center gap-1">
        <input aria-label="Viewport width" type="number" min={240} max={2560} value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} className="w-16 rounded border bg-transparent px-1 py-0.5 text-[10px]"/>
        <span className="text-[10px] text-[var(--muted-foreground)]">×</span>
        <input aria-label="Viewport height" type="number" min={240} max={2560} value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} className="w-16 rounded border bg-transparent px-1 py-0.5 text-[10px]"/>
      </div>}
      <label className="ml-1 flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
        <span>Zoom</span><input aria-label="Preview zoom" type="range" min={25} max={200} step={25} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="w-20"/>
      </label>
      <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">{viewport.width} × {viewport.height} · {Math.round(viewport.scale * 100)}%</span>
      <div className="ml-auto flex items-center gap-1">
        <label className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]"><input aria-label="Auto-refresh preview" type="checkbox" checked={autoRefresh} onChange={(event) => { if (!event.target.checked) setManualHtml(html); setAutoRefresh(event.target.checked) }}/> Auto</label>
        <button type="button" aria-label="Refresh preview" onClick={refresh} className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"><RefreshCw size={13}/></button>
        <button type="button" aria-label="Download preview HTML" onClick={downloadPreview} className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"><Download size={13}/></button>
      </div>
    </div>

    <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle,rgba(44,34,20,0.08)_1px,transparent_1px)] bg-[length:22px_22px] p-6">
      <div
        role={device === 'phone' ? 'region' : undefined}
        aria-label={device === 'phone' ? 'Phone preview screen' : undefined}
        className={`relative mx-auto origin-top-left shadow-2xl ${device === 'phone' ? 'overflow-hidden rounded-[2.75rem] border-[10px] border-[#17120d] bg-[#17120d]' : ''}`}
        style={{ width: viewport.width, height: viewport.height, boxSizing: 'content-box', transform: `scale(${viewport.scale})`, marginBottom: viewport.height * (viewport.scale - 1), marginRight: viewport.width * (viewport.scale - 1) }}
      >
        <LivePreview ref={frameRef} html={displayHtml} revision={revision}/>
        {device === 'phone' && <>
          <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-2 z-20 h-7 w-28 -translate-x-1/2 rounded-full bg-[#17120d]" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-2 left-1/2 z-20 h-1.5 w-28 -translate-x-1/2 rounded-full bg-[#17120d]/80" />
        </>}
        {(runtimeError || diagnostics.some((item) => item.severity === 'error')) && <div role="alert" className="absolute inset-x-4 top-4 z-10 rounded-lg border border-red-400/40 bg-red-950/95 p-3 text-xs text-red-100 shadow-xl">
          <p className="font-semibold">Preview could not run</p>
          {runtimeError && <p>{runtimeError.message}{runtimeError.source ? ` · ${runtimeError.source}:${runtimeError.line ?? 0}:${runtimeError.column ?? 0}` : ''}</p>}
          {diagnostics.filter((item) => item.severity === 'error').slice(0, 3).map((item, index) => <p key={`${item.path}-${index}`}>{item.path ? `${item.path}: ` : ''}{item.message}</p>)}
        </div>}
      </div>
    </div>

    <div aria-label="Preview console" className="h-24 shrink-0 overflow-y-auto border-t bg-[#111] px-3 py-2 font-mono text-[10px] text-[#ddd]">
      <div className="mb-1 flex items-center justify-between text-[#999]"><span>Preview console</span><button type="button" onClick={() => setConsoleEntries([])} className="hover:text-white">Clear</button></div>
      {consoleEntries.length === 0 && <p className="text-[#777]">Console output will appear here.</p>}
      {consoleEntries.map((entry) => <p key={entry.id} className={entry.level === 'error' ? 'text-red-300' : entry.level === 'warn' ? 'text-amber-200' : ''}>[{entry.level}] {entry.text}</p>)}
    </div>
  </section>
}
