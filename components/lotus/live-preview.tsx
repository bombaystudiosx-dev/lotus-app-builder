'use client'

interface LivePreviewProps {
  html: string
}

// Renders generated, self-contained HTML inside a sandboxed iframe that fills
// the device screen. Used inside the Lotus device frames.
export function LivePreview({ html }: LivePreviewProps) {
  return (
    <iframe
      title="App preview"
      srcDoc={html}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      className="w-full h-full border-0 bg-white"
      style={{ display: 'block' }}
    />
  )
}
