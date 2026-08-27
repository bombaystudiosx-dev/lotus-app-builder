'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { PREVIEW_SANDBOX } from '@/lib/preview-runtime'

interface LivePreviewProps {
  html: string
  revision?: number
}

export const LivePreview = forwardRef<HTMLIFrameElement, LivePreviewProps>(function LivePreview({ html, revision = 0 }, forwardedRef) {
  const [containmentRevision, setContainmentRevision] = useState(0)
  const expectedLoads = useRef(1)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const runtimeChannel = useRef<string | null>(null)

  useEffect(() => {
    expectedLoads.current = 1
    runtimeChannel.current = null
  }, [containmentRevision, html, revision])

  useEffect(() => {
    function trustLocalNavigation(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow || event.data?.type !== 'lotus-preview-event') return
      let encoded = ''
      try { encoded = JSON.stringify(event.data) } catch { return }
      if (encoded.length > 2_048) return
      if (event.data.kind === 'ready' && !runtimeChannel.current && typeof event.data.channel === 'string' && /^[a-z\d-]{8,64}$/i.test(event.data.channel)) { runtimeChannel.current = event.data.channel; return }
      if (event.data.kind === 'navigation' && event.data.channel === runtimeChannel.current && event.data.payload?.local === true) { expectedLoads.current = 1; runtimeChannel.current = null }
    }
    window.addEventListener('message', trustLocalNavigation)
    return () => window.removeEventListener('message', trustLocalNavigation)
  }, [])

  function setFrame(node: HTMLIFrameElement | null) {
    frameRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }

  function containNavigation() {
    if (expectedLoads.current > 0) { expectedLoads.current -= 1; runtimeChannel.current = null; return }
    expectedLoads.current = 1
    setContainmentRevision((value) => value + 1)
  }

  return (
    <iframe
      key={`${revision}:${containmentRevision}`}
      ref={setFrame}
      title="App preview"
      srcDoc={html}
      suppressHydrationWarning
      onLoad={containNavigation}
      sandbox={PREVIEW_SANDBOX}
      referrerPolicy="no-referrer"
      className="w-full h-full border-0 bg-white"
      style={{ display: 'block' }}
    />
  )
})
