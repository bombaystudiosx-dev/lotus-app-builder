'use client'

import { forwardRef } from 'react'
import { PREVIEW_SANDBOX } from '@/lib/preview-runtime'

interface LivePreviewProps {
  html: string
  revision?: number
}

export const LivePreview = forwardRef<HTMLIFrameElement, LivePreviewProps>(function LivePreview({ html, revision = 0 }, ref) {
  return (
    <iframe
      key={revision}
      ref={ref}
      title="App preview"
      srcDoc={html}
      sandbox={PREVIEW_SANDBOX}
      referrerPolicy="no-referrer"
      className="w-full h-full border-0 bg-white"
      style={{ display: 'block' }}
    />
  )
})
