// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({
  create: vi.fn(), rename: vi.fn(), update: vi.fn(), trash: vi.fn(),
}))

vi.mock('@/app/actions/projects', () => ({
  createProjectFileAction: actions.create,
  renameProjectFileAction: actions.rename,
  updateProjectFileAction: actions.update,
  trashProjectFileAction: actions.trash,
}))

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange, onKeyDown }: { value: string; onChange: (value: string) => void; onKeyDown?: React.KeyboardEventHandler }) => (
    <textarea aria-label="Code editor" value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
  ),
}))

import { EditorWorkspace } from '@/components/lotus/editor-workspace'

const files = [
  { id: 'html', path: 'index.html', content: '<main>Hello</main>', encoding: 'utf-8' as const },
  { id: 'css', path: 'styles.css', content: 'main { color: red; }', encoding: 'utf-8' as const },
]

describe('EditorWorkspace keyboard and data-loss boundaries', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    actions.update.mockImplementation(async (_projectId, fileId, content) => ({ ...files.find((file) => file.id === fileId), content }))
  })

  it('shows a dirty tab, protects close, then saves through the normalized action', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onPreviewChange = vi.fn()
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={onPreviewChange} />)

    fireEvent.change(screen.getByLabelText('Code editor'), { target: { value: '<main>Changed</main>' } })
    expect(screen.getByRole('tab', { name: /index\.html.*unsaved/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close index.html' }))
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /index\.html/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith('lotus', 'html', '<main>Changed</main>'))
    expect(onPreviewChange).toHaveBeenCalledWith(expect.stringContaining('<main>Changed</main>'))
  })

  it('opens an accessible command palette with the documented shortcut', () => {
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true })

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save file' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reopen closed file' })).toBeInTheDocument()
  })
})
