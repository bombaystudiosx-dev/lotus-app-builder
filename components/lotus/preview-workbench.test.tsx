// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewWorkbench } from '@/components/lotus/preview-workbench'

afterEach(() => cleanup())

describe('PreviewWorkbench', () => {
  it('provides working device, orientation, zoom, and bounded custom viewport controls', () => {
    render(<PreviewWorkbench html="<h1>Ready</h1>" initialDevice="phone" />)

    fireEvent.click(screen.getByRole('button', { name: 'Custom viewport' }))
    fireEvent.change(screen.getByLabelText('Viewport width'), { target: { value: '900' } })
    fireEvent.change(screen.getByLabelText('Viewport height'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rotate viewport' }))
    fireEvent.change(screen.getByLabelText('Preview zoom'), { target: { value: '75' } })

    const frame = screen.getByTitle('App preview')
    expect(frame.parentElement).toHaveStyle({ width: '500px', height: '900px' })
    expect(screen.getByText('500 × 900 · 75%')).toBeInTheDocument()
  })

  it('holds incoming HTML while auto-refresh is off and applies it on manual refresh', () => {
    const { rerender } = render(<PreviewWorkbench html="<h1>One</h1>" />)
    const frame = screen.getByTitle('App preview')
    fireEvent.click(screen.getByLabelText('Auto-refresh preview'))

    rerender(<PreviewWorkbench html="<h1>Two</h1>" />)
    expect(frame).toHaveAttribute('srcdoc', '<h1>One</h1>')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }))
    expect(frame).toHaveAttribute('srcdoc', '<h1>Two</h1>')
  })

  it('captures scoped console and runtime errors and exposes a useful error overlay', () => {
    render(<PreviewWorkbench html="<script>throw new Error('boom')</script>" />)
    const frame = screen.getByTitle('App preview') as HTMLIFrameElement
    const source = frame.contentWindow

    window.dispatchEvent(new MessageEvent('message', { source, data: { type: 'lotus-preview-event', kind: 'console', payload: { level: 'info', args: ['started'] } } }))
    window.dispatchEvent(new MessageEvent('message', { source, data: { type: 'lotus-preview-event', kind: 'error', payload: { message: 'boom', source: 'app.js', line: 4, column: 2 } } }))

    expect(screen.getByText('started')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByRole('alert')).toHaveTextContent('app.js:4:2')
  })

  it('opens the preview in an opaque data URL without exposing an opener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<PreviewWorkbench html="<h1>Safe</h1>" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open preview in new window' }))

    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html/), '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })
})
