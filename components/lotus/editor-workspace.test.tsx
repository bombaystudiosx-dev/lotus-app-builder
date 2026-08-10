// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({
  create: vi.fn(), rename: vi.fn(), update: vi.fn(), trash: vi.fn(), restore: vi.fn(),
}))

vi.mock('@/app/actions/projects', () => ({
  createProjectFileAction: actions.create,
  renameProjectFileAction: actions.rename,
  updateProjectFileAction: actions.update,
  trashProjectFileAction: actions.trash,
  restoreProjectFileAction: actions.restore,
}))

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange, onKeyDown, 'data-path': path }: { value: string; onChange: (value: string) => void; onKeyDown?: React.KeyboardEventHandler; 'data-path'?: string }) => (
    <textarea aria-label={`Code editor ${path ?? ''}`.trim()} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
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
    actions.rename.mockImplementation(async (_projectId, fileId, path) => ({ file: { ...files.find((file) => file.id === fileId), path }, entryPath: path === 'src/index.html' ? path : 'index.html' }))
  })

  it('shows a dirty tab, protects close, then saves through the normalized action', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onPreviewChange = vi.fn()
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={onPreviewChange} />)

    fireEvent.change(screen.getByLabelText('Code editor index.html'), { target: { value: '<main>Changed</main>' } })
    expect(screen.getByRole('tab', { name: /index\.html.*unsaved/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close index.html' }))
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /index\.html/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith('lotus', 'html', '<main>Changed</main>'))
    expect(onPreviewChange).toHaveBeenCalledWith(expect.stringContaining('<main>Changed</main>'))
  })

  it('preserves a dirty buffer while renaming by stable id', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('src/index.html')
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Code editor index.html'), { target: { value: '<main>Mine</main>' } })

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => expect(actions.rename).toHaveBeenCalledWith('lotus', 'html', 'src/index.html'))
    expect(screen.getByLabelText('Code editor src/index.html')).toHaveValue('<main>Mine</main>')
    expect(screen.getByRole('tab', { name: /src\/index\.html.*unsaved/i })).toBeInTheDocument()
  })

  it('reconciles clean external updates and blocks a stale dirty overwrite with a conflict', () => {
    const { rerender } = render(<EditorWorkspace projectId="lotus" files={files.map((file) => ({ ...file, version: 1 }))} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    const external = files.map((file) => file.id === 'html' ? { ...file, content: '<main>Server</main>', version: 2 } : { ...file, version: 1 })
    rerender(<EditorWorkspace projectId="lotus" files={external} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    expect(screen.getByLabelText('Code editor index.html')).toHaveValue('<main>Server</main>')

    fireEvent.change(screen.getByLabelText('Code editor index.html'), { target: { value: '<main>Mine</main>' } })
    rerender(<EditorWorkspace projectId="lotus" files={external.map((file) => file.id === 'html' ? { ...file, content: '<main>New server</main>', version: 3 } : file)} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)

    expect(screen.getByLabelText('Code editor index.html')).toHaveValue('<main>Mine</main>')
    expect(screen.getByRole('alert')).toHaveTextContent('changed outside this editor')
    expect(screen.getByRole('button', { name: 'Save file' })).toBeDisabled()
  })

  it('keeps each mounted editor buffer across tab keyboard navigation', () => {
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Code editor index.html'), { target: { value: '<main>Mine</main>' } })
    fireEvent.click(screen.getByRole('treeitem', { name: 'styles.css' }))
    fireEvent.keyDown(screen.getByRole('tab', { name: 'styles.css' }), { key: 'ArrowLeft' })

    expect(screen.getByRole('tab', { name: /index\.html.*unsaved/i })).toHaveFocus()
    expect(screen.getByLabelText('Code editor index.html')).toHaveValue('<main>Mine</main>')
    expect(screen.getAllByLabelText(/Code editor/)).toHaveLength(2)
  })

  it('supports tree roving focus, separator metadata, and persisted keyboard resize', () => {
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    const first = screen.getByRole('treeitem', { name: 'index.html' })
    first.focus()
    fireEvent.keyDown(first, { key: 'End' })
    expect(screen.getByRole('treeitem', { name: 'styles.css' })).toHaveFocus()

    const separator = screen.getByRole('separator', { name: 'Resize file tree' })
    expect(separator).toHaveAttribute('aria-valuemin', '160')
    expect(separator).toHaveAttribute('aria-valuenow', '210')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator).toHaveAttribute('aria-valuenow', '226')
    expect(JSON.parse(localStorage.getItem('lotus:editor:lotus') ?? '{}')).toMatchObject({ treeWidth: 226 })
  })

  it('opens, traps, escapes, and restores focus for the command palette shortcut', async () => {
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    const opener = screen.getByRole('button', { name: 'Open command palette' })
    opener.focus()
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true })

    const palette = screen.getByRole('dialog', { name: 'Command palette' })
    expect(palette).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save file' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find and replace' })).toHaveFocus())
    fireEvent.keyDown(palette, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
