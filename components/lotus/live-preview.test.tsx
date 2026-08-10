// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LivePreview } from '@/components/lotus/live-preview'

afterEach(cleanup)

describe('LivePreview navigation containment', () => {
  it('recreates the sandboxed srcdoc after an unexpected second iframe load', () => {
    render(<LivePreview html="<p>contained</p>" />)
    const firstFrame = screen.getByTitle('App preview')

    fireEvent.load(firstFrame)
    fireEvent.load(firstFrame)

    expect(screen.getByTitle('App preview')).not.toBe(firstFrame)
    expect(screen.getByTitle('App preview')).toHaveAttribute('srcdoc', '<p>contained</p>')
  })
})
