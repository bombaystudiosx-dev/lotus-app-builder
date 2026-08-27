'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Expand, Maximize2, Monitor, Move, RefreshCw, RotateCw, Smartphone, Tablet } from 'lucide-react'
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

const DESKTOP_PRESETS = [
  { label: 'Sm', width: 640, height: 800 },
  { label: 'Md', width: 768, height: 900 },
  { label: 'Lg', width: 1024, height: 768 },
  { label: 'XL', width: 1280, height: 800 },
  { label: '2XL', width: 1440, height: 900 },
]

export function PreviewWorkbench({ html, diagnostics = [], initialDevice = 'phone' }: PreviewWorkbenchProps) {
  const [device, setDevice] = useState<PreviewDevice>(initialDevice)
  const [orientation, setOrientation] = useState<PreviewOrientation>(initialDevice === 'desktop' ? 'landscape' : 'portrait')
  const [zoom, setZoom] = useState(75)
  const [fitToStage, setFitToStage] = useState(true)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [customWidth, setCustomWidth] = useState(390)
  const [customHeight, setCustomHeight] = useState(844)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [manualHtml, setManualHtml] = useState(html)
  const [revision, setRevision] = useState(0)
  const [, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [runtimeError, setRuntimeError] = useState<RuntimeError | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const frameRef = useRef<HTMLIFrameElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
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
  const browserChromeHeight = device === 'desktop' || device === 'custom' ? 38 : 0
  const frameBorder = device === 'phone' ? 20 : 2
  const frameOuterWidth = viewport.width + frameBorder
  const frameOuterHeight = viewport.height + browserChromeHeight + frameBorder
  const displayScale = fitToStage && stageSize.width > 0 && stageSize.height > 0
    ? Math.min(1, Math.max(0.1, Math.min((stageSize.width - 32) / frameOuterWidth, (stageSize.height - 32) / frameOuterHeight)))
    : viewport.scale
  const renderedWidth = frameOuterWidth * displayScale
  const renderedHeight = frameOuterHeight * displayScale
  const displayHtml = autoRefresh ? html : manualHtml

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

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

  function beginMove(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY, position }
    const move = (pointerEvent: PointerEvent) => setPosition({
      x: start.position.x + pointerEvent.clientX - start.x,
      y: start.position.y + pointerEvent.clientY - start.y,
    })
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }

  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setFitToStage(false)
    const start = { x: event.clientX, y: event.clientY, zoom }
    const move = (pointerEvent: PointerEvent) => {
      const delta = ((pointerEvent.clientX - start.x) + (pointerEvent.clientY - start.y)) / 2
      setZoom(Math.max(25, Math.min(200, Math.round(start.zoom + delta / 2))))
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }

  function chooseDevice(nextDevice: PreviewDevice) {
    setDevice(nextDevice)
    setOrientation(nextDevice === 'desktop' ? 'landscape' : 'portrait')
    setPosition({ x: 0, y: 0 })
    setFitToStage(true)
  }

  function choosePreset(width: number, height: number) {
    setDevice('custom')
    setOrientation(width >= height ? 'landscape' : 'portrait')
    setCustomWidth(width)
    setCustomHeight(height)
    setPosition({ x: 0, y: 0 })
    setFitToStage(true)
  }

  return <section aria-label="Preview workbench" className="flex h-full min-h-0 flex-col bg-white">
    <div className="flex min-h-[64px] flex-col gap-2 border-b border-[#f0e5de] bg-white px-3 py-2 sm:min-h-[78px] sm:flex-row sm:items-center sm:gap-3 sm:px-5 sm:py-3 lg:px-7">
      <div className="flex min-w-0 items-start gap-3 sm:mr-auto sm:min-w-[190px]">
        <span className="mt-1.5 h-3.5 w-3.5 rounded-full bg-[#ffad7d]" aria-hidden="true" />
        <div><h2 className="text-base font-semibold text-[#211914]">Live Preview</h2><p className="mt-1 text-xs text-[#806b60]">Preview updated in real-time</p></div>
      </div>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5 sm:overflow-visible sm:pb-0">
        <div role="group" aria-label="Preview device" className="flex flex-shrink-0 overflow-hidden rounded-xl border border-[#eadfd8] bg-[#fffdfb] shadow-sm">
          {DEVICE_OPTIONS.slice(0, 3).map((option) => <button key={option.value} type="button" aria-label={option.label} aria-pressed={device === option.value} onClick={() => chooseDevice(option.value)} className="inline-flex h-9 min-w-[74px] items-center justify-center gap-1.5 border-r border-[#eadfd8] px-2 text-xs font-medium text-[#332721] transition-colors last:border-r-0 hover:bg-[#fff2e8] aria-pressed:bg-[#ffe2ce] sm:h-10 sm:min-w-[86px] sm:gap-2 sm:px-3 sm:text-sm">{option.icon}<span>{option.value[0].toUpperCase() + option.value.slice(1)}</span></button>)}
        </div>
        <button type="button" aria-label="Refresh preview" onClick={refresh} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-[#eadfd8] bg-white text-[#332721] shadow-sm hover:bg-[#fff4ed] sm:h-10 sm:w-10"><RefreshCw size={17}/></button>
      </div>
    </div>
    <div className="flex min-h-11 flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-[#f0e5de] bg-[#fffdfb] px-3 py-1.5 sm:px-4">
      <button type="button" aria-label="Custom viewport" aria-pressed={device === 'custom'} onClick={() => chooseDevice('custom')} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold text-[#806b60] hover:bg-[#fff0e5] aria-pressed:bg-[#ffe2ce] aria-pressed:text-[#332721]">W×H <span className="hidden sm:inline">Responsive</span></button>
      <div className="hidden items-center gap-0.5 border-l border-[var(--border)] pl-1.5 lg:flex" aria-label="Desktop breakpoint presets">
        {DESKTOP_PRESETS.map((preset) => <button key={preset.label} type="button" aria-label={`${preset.width} pixel viewport`} onClick={() => choosePreset(preset.width, preset.height)} className={`h-8 rounded-md px-2 text-[10px] font-semibold transition-colors hover:bg-[var(--muted)] ${viewport.width === preset.width && viewport.height === preset.height ? 'bg-[var(--muted)] text-[var(--accent)]' : 'text-[var(--muted-foreground)]'}`}>{preset.label}<span className="ml-1 hidden 2xl:inline font-normal">{preset.width}</span></button>)}
      </div>
      <button type="button" aria-label="Rotate viewport" onClick={() => setOrientation((value) => value === 'portrait' ? 'landscape' : 'portrait')} className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"><RotateCw size={14}/></button>
      {device === 'custom' && <div className="flex items-center gap-1">
        <input aria-label="Viewport width" type="number" min={240} max={2560} value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} className="w-16 rounded border bg-transparent px-1 py-0.5 text-[10px]"/>
        <span className="text-[10px] text-[var(--muted-foreground)]">×</span>
        <input aria-label="Viewport height" type="number" min={240} max={2560} value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} className="w-16 rounded border bg-transparent px-1 py-0.5 text-[10px]"/>
      </div>}
      <span className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[11px] font-medium tabular-nums text-[var(--foreground)]">{viewport.width} × {viewport.height}</span>
      <button type="button" aria-label="Fit preview to stage" aria-pressed={fitToStage} onClick={() => setFitToStage((value) => !value)} className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[10px] font-semibold text-[var(--muted-foreground)] aria-pressed:bg-[var(--muted)] aria-pressed:text-[var(--foreground)]"><Expand size={12}/> Fit</button>
      <label className="flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[10px] text-[var(--muted-foreground)]">
        <span>{fitToStage ? `${Math.round(displayScale * 100)}%` : `${zoom}%`}</span><input aria-label="Preview zoom" type="range" min={25} max={200} step={1} value={fitToStage ? Math.round(displayScale * 100) : zoom} onChange={(event) => { setFitToStage(false); setZoom(Number(event.target.value)) }} className="w-16"/>
      </label>
      <div className="ml-auto flex flex-shrink-0 items-center gap-1">
        <label className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]"><input aria-label="Auto-refresh preview" type="checkbox" checked={autoRefresh} onChange={(event) => { if (!event.target.checked) setManualHtml(html); setAutoRefresh(event.target.checked) }}/> Auto</label>
        <button type="button" aria-label="Download preview HTML" onClick={downloadPreview} className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"><Download size={13}/></button>
      </div>
    </div>

    <div ref={stageRef} data-testid="preview-stage" className="relative min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_48%_20%,rgba(255,255,255,0.96),transparent_28%),radial-gradient(circle_at_15%_80%,rgba(248,187,149,0.5),transparent_38%),radial-gradient(circle_at_88%_75%,rgba(255,215,190,0.66),transparent_42%),linear-gradient(135deg,#fff9f5_0%,#f8dfd0_55%,#fff7f1_100%)] p-4 sm:p-6">
      <div data-testid="preview-frame-slot" className="relative mx-auto" style={{ width: renderedWidth, height: renderedHeight }}>
       <div
        role="region"
        aria-label={device === 'phone' ? 'Phone preview screen' : device === 'tablet' ? 'Tablet preview screen' : 'Desktop preview screen'}
        className={`relative origin-top-left shadow-2xl ${device === 'phone' ? 'overflow-hidden rounded-[2.75rem] border-[10px] border-[#17120d] bg-[#17120d]' : 'overflow-hidden rounded-lg border border-black/20 bg-white'}`}
        style={{ width: viewport.width, height: viewport.height + browserChromeHeight, boxSizing: 'content-box', transform: `translate(${position.x}px, ${position.y}px) scale(${displayScale})` }}
      >
        {browserChromeHeight > 0 && <div className="flex h-[38px] items-center gap-2 border-b border-black/10 bg-[#f4f1eb] px-3 text-[#6b6258]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ef6b5b]"/><span className="h-2.5 w-2.5 rounded-full bg-[#e8b64f]"/><span className="h-2.5 w-2.5 rounded-full bg-[#65bd69]"/>
          <div className="ml-2 flex h-6 flex-1 items-center rounded-md bg-white/90 px-3 text-[10px] text-[#8a8178]">https://preview.lotus.local</div>
          <Maximize2 size={13}/>
        </div>}
        <div style={{ width: viewport.width, height: viewport.height }}><LivePreview ref={frameRef} html={displayHtml} revision={revision}/></div>
        {device === 'phone' && <>
          <button
            type="button"
            aria-label="Move phone preview"
            title="Drag to move phone preview"
            onPointerDown={beginMove}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setPosition((value) => ({ ...value, x: value.x - 10 }))
              if (event.key === 'ArrowRight') setPosition((value) => ({ ...value, x: value.x + 10 }))
              if (event.key === 'ArrowUp') setPosition((value) => ({ ...value, y: value.y - 10 }))
              if (event.key === 'ArrowDown') setPosition((value) => ({ ...value, y: value.y + 10 }))
            }}
            className="absolute left-1/2 top-2 z-20 h-7 w-28 -translate-x-1/2 cursor-move touch-none rounded-full bg-[#17120d] outline-none ring-[var(--accent)] focus-visible:ring-2"
          />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-2 left-1/2 z-20 h-1.5 w-28 -translate-x-1/2 rounded-full bg-[#17120d]/80" />
          <button
            type="button"
            aria-label="Resize phone preview"
            title="Drag to resize phone preview"
            onPointerDown={beginResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') setZoom((value) => Math.max(25, value - 5))
              if (event.key === 'ArrowDown' || event.key === 'ArrowRight') setZoom((value) => Math.min(200, value + 5))
            }}
            className="absolute bottom-1 right-1 z-30 h-8 w-8 cursor-nwse-resize touch-none rounded-br-[2rem] outline-none ring-[var(--accent)] focus-visible:ring-2"
          >
            <span aria-hidden="true" className="absolute bottom-2 right-2 h-3 w-3 border-b-2 border-r-2 border-white/80" />
          </button>
        </>}
        {device !== 'phone' && <button type="button" aria-label="Move desktop preview" title="Drag to move preview" onPointerDown={beginMove} className="absolute right-2 top-1 z-30 inline-flex h-7 w-7 cursor-move touch-none items-center justify-center rounded-md text-[#6b6258] hover:bg-black/5"><Move size={13}/></button>}
        {(runtimeError || diagnostics.some((item) => item.severity === 'error')) && <div role="alert" className="absolute inset-x-4 top-4 z-10 rounded-lg border border-red-400/40 bg-red-950/95 p-3 text-xs text-red-100 shadow-xl">
          <p className="font-semibold">Preview could not run</p>
          {runtimeError && <p>{runtimeError.message}{runtimeError.source ? ` · ${runtimeError.source}:${runtimeError.line ?? 0}:${runtimeError.column ?? 0}` : ''}</p>}
          {diagnostics.filter((item) => item.severity === 'error').slice(0, 3).map((item, index) => <p key={`${item.path}-${index}`}>{item.path ? `${item.path}: ` : ''}{item.message}</p>)}
        </div>}
       </div>
      </div>
    </div>

  </section>
}
