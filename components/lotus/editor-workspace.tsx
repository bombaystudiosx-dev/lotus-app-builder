'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { openSearchPanel, searchKeymap } from '@codemirror/search'
import { Prec } from '@codemirror/state'
import {
  AlertTriangle, Braces, ChevronDown, FilePlus2, FileText, FolderTree,
  ListRestart, Minus, PanelBottom, Plus, Redo2, Save, Search, Settings2, Trash2, Undo2, WrapText, X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createProjectFileAction,
  renameProjectFileAction,
  restoreProjectFileAction,
  trashProjectFileAction,
  updateProjectFileAction,
} from '@/app/actions/projects'
import { LivePreview } from '@/components/lotus/live-preview'
import {
  buildPreviewDocument, closeDocument, createEditorSession, diagnoseDocument, editDocument,
  languageForPath, persistedEditorState, reopenLastClosed, saveDocument,
  type EditorFile, type EditorSession, type PersistedEditorState,
} from '@/lib/editor-workspace'

interface EditorWorkspaceProps {
  projectId: string
  files: EditorFile[]
  entryPath: string
  initialFontSize: number
  onPreviewChange: (html: string) => void
  onFilesChange?: (files: EditorFile[]) => void
}

type ProjectOperation =
  | { kind: 'rename'; fileId: string; before: string; after: string }
  | { kind: 'create'; file: EditorFile }
  | { kind: 'trash'; file: EditorFile }

function extensionsFor(path: string, wordWrap: boolean) {
  const language = languageForPath(path)
  const languageExtension = language === 'html' ? html()
    : language === 'css' ? css()
      : language === 'javascript' ? javascript({ jsx: path.endsWith('x') })
        : language === 'typescript' ? javascript({ jsx: path.endsWith('x'), typescript: true })
          : language === 'json' ? json()
            : language === 'markdown' ? markdown()
              : []
  return [
    languageExtension,
    Prec.high(keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap])),
    ...(wordWrap ? [EditorView.lineWrapping] : []),
    EditorView.theme({
      '&': { height: '100%', backgroundColor: 'var(--background)', color: 'var(--foreground)' },
      '.cm-scroller': { fontFamily: 'DM Mono, ui-monospace, monospace' },
      '.cm-gutters': { backgroundColor: 'var(--card)', color: 'var(--muted-foreground)', borderRight: '1px solid var(--border)' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 9%, transparent)' },
    }),
  ]
}

function persisted(projectId: string): PersistedEditorState {
  try {
    return JSON.parse(localStorage.getItem(`lotus:editor:${projectId}`) ?? '{}') as PersistedEditorState
  } catch {
    return {}
  }
}

function updateFiles(state: EditorSession, files: EditorFile[]): EditorSession {
  const next = createEditorSession(files, state.projectId, { ...persistedEditorState(state), openFileIds: state.openFileIds, activeFileId: state.activeFileId })
  for (const file of files) {
    const previous = state.documents[file.id]
    if (previous?.dirty && previous.path === file.path) next.documents[file.id] = previous
  }
  next.closedFileIds = state.closedFileIds.filter((id) => next.documents[id])
  return next
}

export function EditorWorkspace({ projectId, files: initialFiles, entryPath, initialFontSize, onPreviewChange, onFilesChange }: EditorWorkspaceProps) {
  const [files, setFiles] = useState(initialFiles)
  const [session, setSession] = useState(() => createEditorSession(initialFiles, projectId, { ...persisted(projectId), fontSize: persisted(projectId).fontSize ?? initialFontSize }))
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [problemsOpen, setProblemsOpen] = useState(true)
  const [operationHistory, setOperationHistory] = useState<ProjectOperation[]>([])
  const [operationIndex, setOperationIndex] = useState(-1)
  const editorRef = useRef<ReactCodeMirrorRef>(null)

  const active = session.activeFileId ? session.documents[session.activeFileId] : null
  const diagnostics = useMemo(() => {
    const syntax = Object.values(session.documents).flatMap((document) => diagnoseDocument(document.path, document.content))
    if (!Object.values(session.documents).some((document) => document.path === entryPath)) {
      syntax.unshift({ path: entryPath, message: 'The configured preview entry file is missing.', line: 1, column: 1, severity: 'error' })
    }
    return syntax
  }, [entryPath, session.documents])
  const preview = useMemo(() => buildPreviewDocument(Object.values(session.documents), entryPath), [entryPath, session.documents])

  useEffect(() => {
    localStorage.setItem(`lotus:editor:${projectId}`, JSON.stringify(persistedEditorState(session)))
  }, [projectId, session])

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (Object.values(session.documents).some((document) => document.dirty)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [session.documents])

  const saveActive = useCallback(async () => {
    if (!active || !active.dirty) return
    try {
      await updateProjectFileAction(projectId, active.id, active.content)
      setSession((current) => saveDocument(current, active.id, active.content))
      const nextFiles = files.map((file) => file.id === active.id ? { ...file, content: active.content } : file)
      setFiles(nextFiles)
      onFilesChange?.(nextFiles)
      onPreviewChange(buildPreviewDocument(nextFiles, entryPath))
      toast.success(`${active.path} saved`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the file.')
    }
  }, [active, entryPath, files, onFilesChange, onPreviewChange, projectId])

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPaletteOpen(true)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveActive()
      } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        setSession(reopenLastClosed)
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [saveActive])

  function openFile(fileId: string) {
    setSession((current) => ({
      ...current,
      openFileIds: current.openFileIds.includes(fileId) ? current.openFileIds : [...current.openFileIds, fileId],
      activeFileId: fileId,
      closedFileIds: current.closedFileIds.filter((id) => id !== fileId),
    }))
  }

  function closeFile(fileId: string) {
    setSession((current) => {
      const first = closeDocument(current, fileId)
      if (!first.blocked) return first.state
      return window.confirm('This file has unsaved changes. Discard them and close it?')
        ? closeDocument(current, fileId, { discard: true }).state
        : current
    })
  }

  function recordOperation(operation: ProjectOperation) {
    setOperationHistory((current) => [...current.slice(0, operationIndex + 1), operation])
    setOperationIndex((current) => current + 1)
  }

  async function createFile() {
    const path = window.prompt('New file path (for example src/component.ts)')?.trim()
    if (!path) return
    try {
      const created = await createProjectFileAction(projectId, path, '')
      const file: EditorFile = { id: created.id, path: created.path, content: created.content, encoding: created.encoding as EditorFile['encoding'] }
      const nextFiles = [...files, file].sort((a, b) => a.path.localeCompare(b.path))
      setFiles(nextFiles)
      setSession((current) => ({ ...updateFiles(current, nextFiles), openFileIds: [...current.openFileIds, file.id], activeFileId: file.id }))
      onFilesChange?.(nextFiles)
      recordOperation({ kind: 'create', file })
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create the file.') }
  }

  async function renameActive(kind: 'rename' | 'move') {
    if (!active) return
    const path = window.prompt(kind === 'move' ? 'Move file to path' : 'Rename file path', active.path)?.trim()
    if (!path || path === active.path) return
    try {
      const before = active.path
      await renameProjectFileAction(projectId, active.id, path)
      const nextFiles = files.map((file) => file.id === active.id ? { ...file, path } : file).sort((a, b) => a.path.localeCompare(b.path))
      setFiles(nextFiles)
      setSession((current) => updateFiles(current, nextFiles))
      onFilesChange?.(nextFiles)
      recordOperation({ kind: 'rename', fileId: active.id, before, after: path })
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not move the file.') }
  }

  async function trashActive() {
    if (!active) return
    if (active.dirty && !window.confirm('Delete this file and discard its unsaved changes?')) return
    if (!active.dirty && !window.confirm(`Move ${active.path} to trash?`)) return
    try {
      await trashProjectFileAction(projectId, active.id)
      const file = files.find((candidate) => candidate.id === active.id)!
      const nextFiles = files.filter((candidate) => candidate.id !== active.id)
      setFiles(nextFiles)
      setSession((current) => updateFiles(current, nextFiles))
      onFilesChange?.(nextFiles)
      onPreviewChange(buildPreviewDocument(nextFiles, entryPath))
      recordOperation({ kind: 'trash', file })
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not delete the file.') }
  }

  async function applyOperation(direction: 'undo' | 'redo') {
    const index = direction === 'undo' ? operationIndex : operationIndex + 1
    const operation = operationHistory[index]
    if (!operation) return
    try {
      let nextFiles = files
      if (operation.kind === 'rename') {
        const path = direction === 'undo' ? operation.before : operation.after
        await renameProjectFileAction(projectId, operation.fileId, path)
        nextFiles = files.map((file) => file.id === operation.fileId ? { ...file, path } : file)
      } else if (operation.kind === 'create') {
        if (direction === 'undo') {
          await trashProjectFileAction(projectId, operation.file.id)
          nextFiles = files.filter((file) => file.id !== operation.file.id)
        } else {
          await restoreProjectFileAction(projectId, operation.file.id)
          nextFiles = [...files, operation.file]
        }
      } else if (direction === 'undo') {
        await restoreProjectFileAction(projectId, operation.file.id)
        nextFiles = [...files, operation.file]
      } else {
        await trashProjectFileAction(projectId, operation.file.id)
        nextFiles = files.filter((file) => file.id !== operation.file.id)
      }
      nextFiles = [...nextFiles].sort((a, b) => a.path.localeCompare(b.path))
      setFiles(nextFiles)
      setSession((current) => updateFiles(current, nextFiles))
      setOperationIndex(direction === 'undo' ? index - 1 : index)
      onFilesChange?.(nextFiles)
      onPreviewChange(buildPreviewDocument(nextFiles, entryPath))
    } catch (error) { toast.error(error instanceof Error ? error.message : `Could not ${direction} the file operation.`) }
  }

  function formatActive() {
    if (!active || languageForPath(active.path) !== 'json') return
    try {
      setSession((current) => editDocument(current, active.id, `${JSON.stringify(JSON.parse(active.content), null, 2)}\n`))
    } catch { toast.error('Fix JSON syntax errors before formatting.') }
  }

  function goToLine() {
    const requested = Number(window.prompt('Go to line'))
    const view = editorRef.current?.view
    if (!view || !Number.isInteger(requested) || requested < 1) return
    const line = view.state.doc.line(Math.min(requested, view.state.doc.lines))
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
    view.focus()
  }

  function resize(key: 'treeWidth' | 'previewWidth' | 'problemsHeight', delta: number) {
    const bounds = key === 'treeWidth' ? [160, 360] : key === 'previewWidth' ? [260, 720] : [96, 320]
    setSession((current) => ({
      ...current,
      layout: { ...current.layout, [key]: Math.min(bounds[1], Math.max(bounds[0], current.layout[key] + delta)) },
    }))
  }

  function beginResize(key: 'treeWidth' | 'previewWidth' | 'problemsHeight', event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    let previous = key === 'problemsHeight' ? event.clientY : event.clientX
    const direction = key === 'treeWidth' ? 1 : -1
    const move = (next: PointerEvent) => {
      const position = key === 'problemsHeight' ? next.clientY : next.clientX
      const delta = key === 'problemsHeight' ? previous - position : (position - previous) * direction
      previous = position
      resize(key, delta)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }

  const commands = [
    { id: 'save', label: 'Save current file', disabled: !active?.dirty },
    { id: 'find', label: 'Find and replace' },
    { id: 'line', label: 'Go to line' },
    { id: 'format', label: 'Format JSON document', disabled: !active || languageForPath(active.path) !== 'json' },
    { id: 'wrap', label: 'Toggle word wrap' },
    { id: 'reopen', label: 'Reopen closed file', disabled: session.closedFileIds.length === 0 },
    { id: 'create', label: 'Create file' },
  ]

  function runCommand(id: string) {
    if (id === 'save') void saveActive()
    if (id === 'find' && editorRef.current?.view) openSearchPanel(editorRef.current.view)
    if (id === 'line') goToLine()
    if (id === 'format') formatActive()
    if (id === 'wrap') setSession((current) => ({ ...current, wordWrap: !current.wordWrap }))
    if (id === 'reopen') setSession(reopenLastClosed)
    if (id === 'create') void createFile()
    setPaletteOpen(false)
  }

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden" onKeyDown={(event) => event.stopPropagation()}>
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside aria-label="Project files" className="flex shrink-0 flex-col overflow-hidden bg-[var(--card)]" style={{ width: session.layout.treeWidth }}>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[.08em]"><FolderTree size={12}/> FILES</span>
          <button type="button" aria-label="Create file" title="Create file" onClick={() => void createFile()}><FilePlus2 size={14}/></button>
        </div>
        <div role="tree" className="min-h-0 flex-1 overflow-y-auto py-1">
          {files.map((file) => <button key={file.id} type="button" role="treeitem" aria-selected={active?.id === file.id} onClick={() => openFile(file.id)}
            className="flex w-full items-center gap-2 truncate px-3 py-1.5 text-left text-[11px] hover:bg-[var(--muted)]"
            style={{ background: active?.id === file.id ? 'var(--muted)' : undefined }}><FileText size={12}/><span className="truncate">{file.path}</span></button>)}
        </div>
        <div className="grid grid-cols-2 gap-1 border-t p-2">
          <button type="button" onClick={() => void renameActive('rename')} disabled={!active} className="rounded bg-[var(--muted)] px-2 py-1 text-[10px] disabled:opacity-40">Rename</button>
          <button type="button" onClick={() => void renameActive('move')} disabled={!active} className="rounded bg-[var(--muted)] px-2 py-1 text-[10px] disabled:opacity-40">Move</button>
          <button type="button" aria-label="Undo file operation" title="File-operation undo (separate from editor undo)" onClick={() => void applyOperation('undo')} disabled={operationIndex < 0} className="flex items-center justify-center gap-1 rounded bg-[var(--muted)] px-2 py-1 text-[10px] disabled:opacity-40"><Undo2 size={10}/> Undo</button>
          <button type="button" aria-label="Redo file operation" title="File-operation redo (separate from editor redo)" onClick={() => void applyOperation('redo')} disabled={operationIndex >= operationHistory.length - 1} className="flex items-center justify-center gap-1 rounded bg-[var(--muted)] px-2 py-1 text-[10px] disabled:opacity-40"><Redo2 size={10}/> Redo</button>
        </div>
      </aside>

      <button type="button" role="separator" aria-label="Resize file tree" aria-orientation="vertical" tabIndex={0} onPointerDown={(event) => beginResize('treeWidth', event)} onKeyDown={(event) => { if (event.key === 'ArrowLeft') resize('treeWidth', -16); if (event.key === 'ArrowRight') resize('treeWidth', 16) }} className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]"/>

      <section aria-label="Code editor workspace" className="flex min-w-0 flex-1 flex-col">
        <div role="tablist" aria-label="Open files" className="flex min-h-9 overflow-x-auto border-b bg-[var(--card)]">
          {session.openFileIds.map((fileId) => {
            const document = session.documents[fileId]
            if (!document) return null
            return <div key={fileId} className="flex shrink-0 items-center border-r">
              <button type="button" role="tab" aria-selected={active?.id === fileId} aria-label={`${document.path}${document.dirty ? ' — unsaved changes' : ''}`} onClick={() => openFile(fileId)} className="flex h-full items-center gap-1.5 px-3 text-[11px]" style={{ background: active?.id === fileId ? 'var(--background)' : undefined }}>
                {document.dirty && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]"/>}{document.path}
              </button>
              <button type="button" aria-label={`Close ${document.path}`} onClick={() => closeFile(fileId)} className="mr-1 rounded p-1 hover:bg-[var(--muted)]"><X size={11}/></button>
            </div>
          })}
        </div>
        <div className="flex min-h-9 items-center gap-1 border-b bg-[var(--card)] px-2">
          <button type="button" aria-label="Save file" title="Save file (Ctrl+S)" onClick={() => void saveActive()} disabled={!active?.dirty} className="rounded p-1.5 hover:bg-[var(--muted)] disabled:opacity-35"><Save size={13}/></button>
          <button type="button" aria-label="Find and replace" title="Find and replace (Ctrl+F)" onClick={() => editorRef.current?.view && openSearchPanel(editorRef.current.view)} className="rounded p-1.5 hover:bg-[var(--muted)]"><Search size={13}/></button>
          <button type="button" aria-label="Go to line" onClick={goToLine} className="rounded p-1.5 hover:bg-[var(--muted)]"><ListRestart size={13}/></button>
          <button type="button" aria-label="Format document" title={active && languageForPath(active.path) === 'json' ? 'Format JSON document' : 'Formatting is available for JSON'} onClick={formatActive} disabled={!active || languageForPath(active.path) !== 'json'} className="rounded p-1.5 hover:bg-[var(--muted)] disabled:opacity-35"><Braces size={13}/></button>
          <button type="button" aria-label="Toggle word wrap" aria-pressed={session.wordWrap} onClick={() => setSession((current) => ({ ...current, wordWrap: !current.wordWrap }))} className="rounded p-1.5 hover:bg-[var(--muted)]"><WrapText size={13}/></button>
          <div className="ml-auto flex items-center gap-1 text-[10px]">
            <button type="button" aria-label="Decrease editor font size" onClick={() => setSession((current) => ({ ...current, fontSize: Math.max(12, current.fontSize - 1) }))}><Minus size={11}/></button>
            <span aria-label="Editor font size">{session.fontSize}px</span>
            <button type="button" aria-label="Increase editor font size" onClick={() => setSession((current) => ({ ...current, fontSize: Math.min(24, current.fontSize + 1) }))}><Plus size={11}/></button>
            <button type="button" aria-label="Open command palette" title="Command palette (Ctrl+Shift+P)" onClick={() => setPaletteOpen(true)} className="ml-2 flex items-center gap-1 rounded bg-[var(--muted)] px-2 py-1"><Settings2 size={11}/> Commands</button>
            <button type="button" aria-label="Delete file" onClick={() => void trashActive()} disabled={!active} className="rounded p-1.5 text-[var(--destructive)] disabled:opacity-35"><Trash2 size={13}/></button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {active ? <CodeMirror ref={editorRef} key={active.id} value={active.content} onChange={(value) => setSession((current) => editDocument(current, active.id, value))} extensions={extensionsFor(active.path, session.wordWrap)} basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: true }} style={{ height: '100%', fontSize: session.fontSize }} height="100%"/> : <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">Open a file to start editing.</div>}
        </div>
      </section>

      <button type="button" role="separator" aria-label="Resize preview" aria-orientation="vertical" tabIndex={0} onPointerDown={(event) => beginResize('previewWidth', event)} onKeyDown={(event) => { if (event.key === 'ArrowLeft') resize('previewWidth', 16); if (event.key === 'ArrowRight') resize('previewWidth', -16) }} className="w-1 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]"/>
      <aside aria-label="Live code preview" className="shrink-0 bg-white" style={{ width: session.layout.previewWidth }}><LivePreview html={preview}/></aside>
    </div>

    {problemsOpen && <button type="button" role="separator" aria-label="Resize problems panel" aria-orientation="horizontal" onPointerDown={(event) => beginResize('problemsHeight', event)} onKeyDown={(event) => { if (event.key === 'ArrowUp') resize('problemsHeight', 16); if (event.key === 'ArrowDown') resize('problemsHeight', -16) }} className="h-1 w-full cursor-row-resize bg-[var(--border)] hover:bg-[var(--accent)]"/>}
    <section aria-label="Problems" className="shrink-0 overflow-hidden border-t bg-[var(--card)]" style={{ height: problemsOpen ? session.layout.problemsHeight : 34 }}>
      <button type="button" aria-expanded={problemsOpen} onClick={() => setProblemsOpen((open) => !open)} className="flex h-8 w-full items-center gap-2 px-3 text-left text-[11px] font-semibold"><PanelBottom size={12}/> Problems <span className="rounded-full bg-[var(--muted)] px-2 py-0.5">{diagnostics.length}</span><ChevronDown size={12} className={`ml-auto transition-transform ${problemsOpen ? 'rotate-180' : ''}`}/></button>
      {problemsOpen && <div className="h-[calc(100%-2rem)] overflow-y-auto border-t py-1">
        {diagnostics.length ? diagnostics.map((problem, index) => <button type="button" key={`${problem.path}:${problem.line}:${index}`} onClick={() => { const file = files.find((candidate) => candidate.path === problem.path); if (file) openFile(file.id) }} className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-[var(--muted)]"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-[var(--destructive)]"/><span>{problem.path}:{problem.line}:{problem.column} — {problem.message}</span></button>) : <p className="px-3 py-2 text-[11px] text-[var(--muted-foreground)]">No syntax problems detected.</p>}
      </div>}
    </section>

    {paletteOpen && <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/35 p-8" onMouseDown={(event) => { if (event.currentTarget === event.target) setPaletteOpen(false) }}>
      <div role="dialog" aria-label="Command palette" aria-modal="true" className="mt-[10vh] w-full max-w-md overflow-hidden rounded-xl border bg-[var(--popover)] shadow-2xl">
        <div className="flex items-center gap-2 border-b px-3 py-2"><Search size={14}/><span className="text-xs text-[var(--muted-foreground)]">Common local actions</span><button type="button" aria-label="Close command palette" onClick={() => setPaletteOpen(false)} className="ml-auto"><X size={14}/></button></div>
        <div className="max-h-80 overflow-y-auto p-1">{commands.map((command) => <button type="button" key={command.label} disabled={command.disabled} onClick={() => runCommand(command.id)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--muted)] disabled:opacity-35">{command.label}</button>)}</div>
        <p className="border-t px-3 py-2 text-[10px] text-[var(--muted-foreground)]">Ctrl+Shift+P palette · Ctrl+S save · Ctrl+F find · Ctrl+Shift+T reopen</p>
      </div>
    </div>}
  </div>
}
