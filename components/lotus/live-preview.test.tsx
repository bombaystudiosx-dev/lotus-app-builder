// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LivePreview } from '@/components/lotus/live-preview'

afterEach(cleanup)

describe('LivePreview navigation containment', () => {
  it('uses the full browser sandbox without granting generated scripts permission', () => {
    render(<LivePreview html={'<script>parent.postMessage("escaped", "*")</script><p>safe</p>'} />)

    expect(screen.getByTitle('App preview')).toHaveAttribute('sandbox', '')
  })

  it('recreates the sandboxed srcdoc after an unexpected second iframe load', () => {
    render(<LivePreview html="<p>contained</p>" />)
    const firstFrame = screen.getByTitle('App preview')

    fireEvent.load(firstFrame)
    fireEvent.load(firstFrame)

    expect(screen.getByTitle('App preview')).not.toBe(firstFrame)
    expect(screen.getByTitle('App preview')).toHaveAttribute('srcdoc', '<p>contained</p>')
  })

  it('allows one bridge-authenticated local data-page navigation', () => {
    render(<LivePreview html="<p>contained</p>" />)
    const frame = screen.getByTitle('App preview') as HTMLIFrameElement
    const source = frame.contentWindow
    const dispatch = (data: unknown) => {
      const event = new MessageEvent('message', { data })
      Object.defineProperty(event, 'source', { value: source })
      fireEvent(window, event)
    }

    fireEvent.load(frame)
    dispatch({ type: 'lotus-preview-event', channel: 'trusted-channel', kind: 'ready', payload: {} })
    dispatch({ type: 'lotus-preview-event', channel: 'trusted-channel', kind: 'navigation', payload: { local: true } })
    fireEvent.load(frame)

    expect(screen.getByTitle('App preview')).toBe(frame)
    fireEvent.load(frame)
    expect(screen.getByTitle('App preview')).not.toBe(frame)
  })
})
