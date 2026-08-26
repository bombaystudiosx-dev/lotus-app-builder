// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    actions.create.mockResolvedValue({ id: 'new', path: 'new.txt', content: '', encoding: 'utf-8', version: 1 })
    actions.restore.mockResolvedValue({ id: 'new', path: 'new.txt', content: 'restored by server', encoding: 'utf-8', version: 3 })
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
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith('lotus', 'html', '<main>Changed</main>', undefined))
    expect(onPreviewChange).toHaveBeenCalledWith(expect.stringContaining('<main>Changed</main>'))
  })

  it('never sends raw React TSX through the static preview assembler', async () => {
    const reactFiles = [{ id: 'tsx', path: 'src/main.tsx', content: 'const App = () => <main>React</main>', encoding: 'utf-8' as const }]
    actions.update.mockResolvedValue({ ...reactFiles[0], content: 'const App = () => <main>Changed</main>' })
    const onPreviewChange = vi.fn()
    const onFilesChange = vi.fn()
    render(<EditorWorkspace runtime="react" projectId="lotus" files={reactFiles} entryPath="src/main.tsx" initialFontSize={14} onPreviewChange={onPreviewChange} onFilesChange={onFilesChange} />)

    expect(onPreviewChange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Code editor src/main.tsx'), { target: { value: 'const App = () => <main>Changed</main>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))

    await waitFor(() => expect(onFilesChange).toHaveBeenCalled())
    expect(onPreviewChange).not.toHaveBeenCalled()
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

  it('preserves dirty buffers when the mounted workspace is hidden for preview or deployed views', () => {
    function ViewHarness() {
      const [codeVisible, setCodeVisible] = React.useState(true)
      return <>
        <button type="button" onClick={() => setCodeVisible((visible) => !visible)}>Toggle view</button>
        <div hidden={!codeVisible}><EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} /></div>
      </>
    }
    render(<ViewHarness />)
    fireEvent.change(screen.getByLabelText('Code editor index.html'), { target: { value: '<main>Still here</main>' } })

    fireEvent.click(screen.getByRole('button', { name: 'Toggle view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle view' }))

    expect(screen.getByLabelText('Code editor index.html')).toHaveValue('<main>Still here</main>')
    expect(screen.getByRole('tab', { name: /unsaved changes/i })).toBeInTheDocument()
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
    expect(screen.getAllByRole('textbox', { name: /Code editor/, hidden: true })).toHaveLength(2)
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

  it('protects dirty created files during operation undo and replays the returned server record', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('new.txt')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create file' }))
    await screen.findByRole('tab', { name: 'new.txt' })
    fireEvent.change(screen.getByLabelText('Code editor new.txt'), { target: { value: 'unsaved' } })

    fireEvent.click(screen.getByRole('button', { name: 'Undo file operation' }))
    expect(confirm).toHaveBeenCalled()
    expect(actions.trash).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Undo file operation' }))
    await waitFor(() => expect(actions.trash).toHaveBeenCalledWith('lotus', 'new'))
    fireEvent.click(screen.getByRole('button', { name: 'Redo file operation' }))
    await screen.findByRole('treeitem', { name: 'new.txt' })
    fireEvent.click(screen.getByRole('treeitem', { name: 'new.txt' }))
    expect(screen.getByLabelText('Code editor new.txt')).toHaveValue('restored by server')
  })

  it('restores a persisted zero-tab state without silently reopening a file', () => {
    localStorage.setItem('lotus:editor:lotus', JSON.stringify({ openFileIds: [], activeFileId: null }))
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByText('Open a file to start editing.')).toBeInTheDocument()
  })

  it('falls back safely when persisted editor state is malformed', () => {
    localStorage.setItem('lotus:editor:lotus', '{malformed')
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'index.html' })).toBeInTheDocument()
    expect(screen.getByLabelText('Code editor index.html')).toHaveValue('<main>Hello</main>')
  })

  it('opens a plain JavaScript file with the non-JSX language mode', () => {
    const javascriptFiles = [{ id: 'js', path: 'main.js', content: 'const ready = true', encoding: 'utf-8' as const }]
    render(<EditorWorkspace projectId="lotus" files={javascriptFiles} entryPath="main.js" initialFontSize={14} onPreviewChange={vi.fn()} />)

    expect(screen.getByLabelText('Code editor main.js')).toHaveValue('const ready = true')
  })

  it('moves roving tree focus to a remaining file when the focused file is deleted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    const css = screen.getByRole('treeitem', { name: 'styles.css' })
    fireEvent.click(css)
    css.focus()

    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }))

    await waitFor(() => expect(actions.trash).toHaveBeenCalledWith('lotus', 'css'))
    const remaining = screen.getByRole('treeitem', { name: 'index.html' })
    expect(remaining).toHaveAttribute('tabindex', '0')
  })

  it('closes the palette and ignores global editor shortcuts while inactive', async () => {
    function ActiveHarness() {
      const [active, setActive] = React.useState(true)
      return <>
        <button type="button" onClick={() => setActive((value) => !value)}>Toggle active</button>
        <div hidden={!active}><EditorWorkspace active={active} projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} /></div>
      </>
    }
    render(<ActiveHarness />)
    fireEvent.change(screen.getByLabelText('Code editor index.html'), { target: { value: '<main>Dirty</main>' } })
    fireEvent.click(screen.getByRole('treeitem', { name: 'styles.css' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close styles.css' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle active' }))
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, shiftKey: true })

    expect(actions.update).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'styles.css', hidden: true })).not.toBeInTheDocument()
  })

  it('opens, traps, escapes, and restores focus for the command palette shortcut', async () => {
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    const opener = screen.getByRole('button', { name: 'Open command palette' })
    opener.focus()
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true })

    const palette = screen.getByRole('dialog', { name: 'Command palette' })
    expect(palette).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save file' })).toBeInTheDocument()
    await waitFor(() => expect(within(palette).getByRole('button', { name: 'Find and replace' })).toHaveFocus())
    fireEvent.keyDown(palette, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('formats valid JSON, reports invalid JSON, toggles wrapping, and bounds font controls', () => {
    const jsonFiles = [{ id: 'json', path: 'data.json', content: '{"name":"Lotus"}', encoding: 'utf-8' as const }]
    const { rerender } = render(<EditorWorkspace projectId="lotus" files={jsonFiles} entryPath="data.json" initialFontSize={24} onPreviewChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Format document' }))
    expect(screen.getByLabelText('Code editor data.json')).toHaveValue('{\n  "name": "Lotus"\n}\n')
    const wrap = screen.getByRole('button', { name: 'Toggle word wrap' })
    const initialWrap = wrap.getAttribute('aria-pressed')
    fireEvent.click(wrap)
    expect(wrap).toHaveAttribute('aria-pressed', initialWrap === 'true' ? 'false' : 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Increase editor font size' }))
    expect(screen.getByLabelText('Editor font size')).toHaveTextContent('24px')
    fireEvent.click(screen.getByRole('button', { name: 'Decrease editor font size' }))
    expect(screen.getByLabelText('Editor font size')).toHaveTextContent('23px')

    rerender(<EditorWorkspace projectId="lotus" files={[{ ...jsonFiles[0], content: '{broken' }]} entryPath="data.json" initialFontSize={12} onPreviewChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Code editor data.json'), { target: { value: '{broken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Format document' }))
    expect(screen.getByLabelText('Code editor data.json')).toHaveValue('{broken')
    fireEvent.click(screen.getByRole('button', { name: 'Decrease editor font size' }))
    expect(screen.getByLabelText('Editor font size')).toHaveTextContent('22px')
  })

  it('resolves external conflicts in either direction', () => {
    const versioned = files.map((file) => ({ ...file, version: 1 }))
    const { rerender } = render(<EditorWorkspace projectId="lotus" files={versioned} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Code editor index.html'), { target: { value: '<main>Mine</main>' } })
    const external = versioned.map((file) => file.id === 'html' ? { ...file, content: '<main>Server</main>', version: 2 } : file)
    rerender(<EditorWorkspace projectId="lotus" files={external} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Code editor index.html')).toHaveValue('<main>Mine</main>')

    rerender(<EditorWorkspace projectId="lotus" files={external.map((file) => file.id === 'html' ? { ...file, content: '<main>New server</main>', version: 3 } : file)} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use external' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Code editor index.html')).toHaveValue('<main>New server</main>')
  })

  it('discards a dirty close, reopens it by shortcut, and navigates every tab direction', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Code editor index.html'), { target: { value: '<main>Discard</main>' } })
    fireEvent.click(screen.getByRole('treeitem', { name: 'styles.css' }))
    const cssTab = screen.getByRole('tab', { name: 'styles.css' })
    fireEvent.keyDown(cssTab, { key: 'Home' })
    expect(screen.getByRole('tab', { name: /index\.html/ })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: /index\.html/ }), { key: 'End' })
    expect(cssTab).toHaveFocus()
    fireEvent.keyDown(cssTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /index\.html/ })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Close index.html' }))
    expect(screen.queryByRole('tab', { name: /index\.html/ })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('tab', { name: /index\.html/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Code editor index.html')).toHaveValue('<main>Hello</main>')
  })

  it('covers tree movement, activation keys, all resize directions, and problems toggling', () => {
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    const html = screen.getByRole('treeitem', { name: 'index.html' })
    const css = screen.getByRole('treeitem', { name: 'styles.css' })
    html.focus()
    fireEvent.keyDown(html, { key: 'ArrowDown' })
    expect(css).toHaveFocus()
    fireEvent.keyDown(css, { key: 'ArrowUp' })
    expect(html).toHaveFocus()
    fireEvent.keyDown(html, { key: ' ' })
    fireEvent.keyDown(html, { key: 'Enter' })

    const tree = screen.getByRole('separator', { name: 'Resize file tree' })
    const preview = screen.getByRole('separator', { name: 'Resize preview' })
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    fireEvent.keyDown(preview, { key: 'ArrowLeft' })
    fireEvent.keyDown(preview, { key: 'ArrowRight' })
    expect(tree).toHaveAttribute('aria-valuenow', '194')
    expect(preview).toHaveAttribute('aria-valuenow', '380')

    const problemsToggle = screen.getByRole('button', { name: /Problems/ })
    if (problemsToggle.getAttribute('aria-expanded') === 'false') fireEvent.click(problemsToggle)
    const problems = screen.getByRole('separator', { name: 'Resize problems panel' })
    fireEvent.keyDown(problems, { key: 'ArrowUp' })
    fireEvent.keyDown(problems, { key: 'ArrowDown' })
    fireEvent.click(problemsToggle)
    expect(screen.queryByRole('separator', { name: 'Resize problems panel' })).not.toBeInTheDocument()
  })

  it('handles cancelled file prompts, command selections, and palette backdrop dismissal', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(actions.create).not.toHaveBeenCalled()
    expect(actions.rename).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Command palette' })).getByRole('button', { name: 'Toggle word wrap' }))
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()

    prompt.mockReturnValue('new.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Command palette' })).getByRole('button', { name: 'Create file' }))
    await waitFor(() => expect(actions.create).toHaveBeenCalledWith('lotus', 'new.txt', ''))

    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Command palette' }).parentElement as HTMLElement)
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
  })

  it('keeps the workspace usable when file operations fail', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('new.txt')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    actions.update.mockRejectedValueOnce(new Error('Save unavailable'))
    actions.create.mockRejectedValueOnce('Create unavailable')
    actions.rename.mockRejectedValueOnce(new Error('Rename unavailable'))
    actions.trash.mockRejectedValueOnce('Delete unavailable')
    render(<EditorWorkspace projectId="lotus" files={files} entryPath="index.html" initialFontSize={14} onPreviewChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Code editor index.html'), { target: { value: '<main>Still local</main>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
    await waitFor(() => expect(actions.update).toHaveBeenCalled())
    expect(screen.getByLabelText('Code editor index.html')).toHaveValue('<main>Still local</main>')

    fireEvent.click(screen.getByRole('button', { name: 'Create file' }))
    await waitFor(() => expect(actions.create).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(actions.rename).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }))
    await waitFor(() => expect(actions.trash).toHaveBeenCalled())

    expect(screen.getByRole('treeitem', { name: 'index.html' })).toBeInTheDocument()
  })
})
