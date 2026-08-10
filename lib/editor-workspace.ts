import { htmlLanguage } from '@codemirror/lang-html'
import { cssLanguage } from '@codemirror/lang-css'
import { javascriptLanguage } from '@codemirror/lang-javascript'

export type EditorLanguage = 'html' | 'css' | 'javascript' | 'json' | 'markdown' | 'typescript' | 'plain'

export interface EditorFile {
  id: string
  path: string
  content: string
  encoding: 'utf-8' | 'utf-16le'
  version?: number
}

export interface EditorDocument extends EditorFile {
  savedContent: string
  dirty: boolean
  conflict?: boolean
  externalContent?: string | null
  externalPath?: string
  externalVersion?: number
}

export interface PersistedEditorState {
  openFileIds?: string[]
  activeFileId?: string | null
  treeWidth?: number
  previewWidth?: number
  problemsHeight?: number
  wordWrap?: boolean
  fontSize?: number
}

export interface EditorSession {
  projectId: string
  documents: Record<string, EditorDocument>
  openFileIds: string[]
  activeFileId: string | null
  closedFileIds: string[]
  layout: { treeWidth: number; previewWidth: number; problemsHeight: number }
  wordWrap: boolean
  fontSize: number
}

export interface EditorDiagnostic {
  path: string
  message: string
  line: number
  column: number
  severity: 'error' | 'warning'
}

const clamp = (value: number | undefined, minimum: number, maximum: number, fallback: number) =>
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value! : fallback))

export function createEditorSession(files: EditorFile[], projectId: string, persisted: PersistedEditorState = {}): EditorSession {
  const documents = Object.fromEntries(files.map((file) => [file.id, { ...file, savedContent: file.content, dirty: false }]))
  const validIds = new Set(files.map((file) => file.id))
  const persistedOpen = (persisted.openFileIds ?? []).filter((id, index, ids) => validIds.has(id) && ids.indexOf(id) === index)
  const openFileIds = persisted.openFileIds === undefined ? files.slice(0, 1).map((file) => file.id) : persistedOpen
  const activeFileId = persisted.activeFileId && openFileIds.includes(persisted.activeFileId)
    ? persisted.activeFileId
    : openFileIds.at(-1) ?? null

  return {
    projectId,
    documents,
    openFileIds,
    activeFileId,
    closedFileIds: [],
    layout: {
      treeWidth: clamp(persisted.treeWidth, 160, 360, 210),
      previewWidth: clamp(persisted.previewWidth, 260, 720, 380),
      problemsHeight: clamp(persisted.problemsHeight, 96, 320, 140),
    },
    wordWrap: persisted.wordWrap ?? true,
    fontSize: clamp(persisted.fontSize, 12, 24, 14),
  }
}

export function editDocument(state: EditorSession, fileId: string, content: string): EditorSession {
  const document = state.documents[fileId]
  if (!document) return state
  return {
    ...state,
    documents: {
      ...state.documents,
      [fileId]: { ...document, content, dirty: content !== document.savedContent },
    },
  }
}

export function saveDocument(state: EditorSession, fileId: string, savedContent: string): EditorSession {
  const document = state.documents[fileId]
  if (!document) return state
  return {
    ...state,
    documents: {
      ...state.documents,
      [fileId]: {
        ...document,
        savedContent,
        dirty: document.content !== savedContent,
      },
    },
  }
}

export function applyServerFile(state: EditorSession, file: EditorFile, preserveDirty = true): EditorSession {
  const previous = state.documents[file.id]
  const document: EditorDocument = previous?.dirty && preserveDirty
    ? { ...previous, path: file.path, encoding: file.encoding, version: file.version, savedContent: file.content, dirty: previous.content !== file.content, conflict: false, externalContent: undefined, externalPath: undefined, externalVersion: undefined }
    : { ...file, savedContent: file.content, dirty: false }
  return { ...state, documents: { ...state.documents, [file.id]: document } }
}

export function reconcileExternalFiles(state: EditorSession, files: EditorFile[]): EditorSession {
  const incoming = new Map(files.map((file) => [file.id, file]))
  const documents: Record<string, EditorDocument> = {}
  for (const file of files) {
    const previous = state.documents[file.id]
    if (!previous) {
      documents[file.id] = { ...file, savedContent: file.content, dirty: false }
      continue
    }
    const changed = previous.savedContent !== file.content || previous.path !== file.path || (file.version !== undefined && previous.version !== file.version)
    if (previous.dirty && changed) {
      documents[file.id] = { ...previous, conflict: true, externalContent: file.content, externalPath: file.path, externalVersion: file.version }
    } else if (changed) {
      documents[file.id] = { ...file, savedContent: file.content, dirty: false }
    } else {
      documents[file.id] = previous
    }
  }
  for (const previous of Object.values(state.documents)) {
    if (!incoming.has(previous.id) && previous.dirty) documents[previous.id] = { ...previous, conflict: true, externalContent: null }
  }
  const validIds = new Set(Object.keys(documents))
  const openFileIds = state.openFileIds.filter((id) => validIds.has(id))
  return {
    ...state,
    documents,
    openFileIds,
    activeFileId: state.activeFileId && validIds.has(state.activeFileId) ? state.activeFileId : openFileIds.at(-1) ?? null,
    closedFileIds: state.closedFileIds.filter((id) => validIds.has(id)),
  }
}

export function resolveExternalConflict(state: EditorSession, fileId: string, resolution: 'external' | 'mine'): EditorSession {
  const document = state.documents[fileId]
  if (!document?.conflict) return state
  const externalContent = document.externalContent
  if (externalContent === undefined) return state
  if (externalContent === null) {
    if (resolution === 'mine') return state
    const { [fileId]: removed, ...documents } = state.documents
    void removed
    const openFileIds = state.openFileIds.filter((id) => id !== fileId)
    return { ...state, documents, openFileIds, activeFileId: state.activeFileId === fileId ? openFileIds.at(-1) ?? null : state.activeFileId }
  }
  const path = document.externalPath ?? document.path
  const version = document.externalVersion ?? document.version
  if (resolution === 'external') {
    return { ...state, documents: { ...state.documents, [fileId]: { ...document, path, version, content: externalContent, savedContent: externalContent, dirty: false, conflict: false, externalContent: undefined, externalPath: undefined, externalVersion: undefined } } }
  }
  return { ...state, documents: { ...state.documents, [fileId]: { ...document, path, version, savedContent: externalContent, dirty: document.content !== externalContent, conflict: false, externalContent: undefined, externalPath: undefined, externalVersion: undefined } } }
}

export function closeDocument(state: EditorSession, fileId: string, options: { discard?: boolean } = {}) {
  const document = state.documents[fileId]
  if (!document || !state.openFileIds.includes(fileId)) return { state, blocked: false }
  if (document.dirty && !options.discard) return { state, blocked: true }

  const openFileIds = state.openFileIds.filter((id) => id !== fileId)
  const documents = options.discard
    ? { ...state.documents, [fileId]: { ...document, content: document.savedContent, dirty: false } }
    : state.documents
  return {
    blocked: false,
    state: {
      ...state,
      documents,
      openFileIds,
      activeFileId: state.activeFileId === fileId ? openFileIds.at(-1) ?? null : state.activeFileId,
      closedFileIds: [...state.closedFileIds.filter((id) => id !== fileId), fileId],
    },
  }
}

export function reopenLastClosed(state: EditorSession): EditorSession {
  const fileId = state.closedFileIds.at(-1)
  if (!fileId || !state.documents[fileId]) return state
  return {
    ...state,
    openFileIds: [...state.openFileIds.filter((id) => id !== fileId), fileId],
    activeFileId: fileId,
    closedFileIds: state.closedFileIds.slice(0, -1),
  }
}

export function removeDocument(state: EditorSession, fileId: string, options: { discard?: boolean } = {}) {
  const document = state.documents[fileId]
  if (!document) return { state, blocked: false }
  if (document.dirty && !options.discard) return { state, blocked: true }
  const { [fileId]: removed, ...documents } = state.documents
  void removed
  const openFileIds = state.openFileIds.filter((id) => id !== fileId)
  return {
    blocked: false,
    state: {
      ...state,
      documents,
      openFileIds,
      activeFileId: state.activeFileId === fileId ? openFileIds.at(-1) ?? null : state.activeFileId,
      closedFileIds: state.closedFileIds.filter((id) => id !== fileId),
    },
  }
}

export function languageForPath(path: string): EditorLanguage {
  const extension = path.toLowerCase().split('.').pop()
  if (extension === 'html' || extension === 'htm') return 'html'
  if (extension === 'css') return 'css'
  if (extension === 'js' || extension === 'jsx' || extension === 'mjs') return 'javascript'
  if (extension === 'json') return 'json'
  if (extension === 'md' || extension === 'mdx') return 'markdown'
  if (extension === 'ts' || extension === 'tsx') return 'typescript'
  return 'plain'
}

function locationFromOffset(content: string, offset: number) {
  const before = content.slice(0, Math.max(0, offset))
  const lines = before.split('\n')
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

export function diagnoseDocument(path: string, content: string): EditorDiagnostic[] {
  const language = languageForPath(path)
  if (language === 'json') {
    try {
      JSON.parse(content)
      return []
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON'
      const offset = Number(message.match(/position\s+(\d+)/i)?.[1] ?? content.length)
      return [{ path, message, ...locationFromOffset(content, offset), severity: 'error' }]
    }
  }

  if (language === 'markdown') {
    const fences = [...content.matchAll(/^\s*```/gm)]
    if (fences.length % 2 === 1) {
      const offset = fences.at(-1)?.index ?? 0
      return [{ path, message: 'Unclosed fenced code block.', ...locationFromOffset(content, offset), severity: 'error' }]
    }
    return []
  }

  const parser = language === 'html' ? htmlLanguage.parser
    : language === 'css' ? cssLanguage.parser
      : language === 'javascript' ? javascriptLanguage.parser.configure({ dialect: path.toLowerCase().endsWith('x') ? 'jsx' : '' })
        : language === 'typescript' ? javascriptLanguage.parser.configure({ dialect: path.toLowerCase().endsWith('x') ? 'ts jsx' : 'ts' })
          : null
  if (parser) {
    const diagnostics: EditorDiagnostic[] = []
    const cursor = parser.parse(content).cursor()
    do {
      if (!cursor.type.isError) continue
      const offset = cursor.from
      const snippet = content.slice(Math.max(0, offset - 32), Math.min(content.length, Math.max(cursor.to, offset + 1) + 32)).replace(/\s+/g, ' ').trim()
      diagnostics.push({ path, message: `${language.toUpperCase()} syntax error${snippet ? ` near “${snippet}”` : ''}.`, ...locationFromOffset(content, offset), severity: 'error' })
    } while (cursor.next())
    return diagnostics
  }

  return []
}

export function resolveProjectReference(entryPath: string, reference: string) {
  const cleanReference = reference.split(/[?#]/, 1)[0]
  if (!cleanReference || cleanReference.startsWith('/') || cleanReference.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(cleanReference) || cleanReference.startsWith('//')) return null
  const parts = [...entryPath.split('/').slice(0, -1), ...cleanReference.split('/')]
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!normalized.length) return null
      normalized.pop()
    } else {
      normalized.push(part)
    }
  }
  return normalized.join('/') || null
}

export function buildPreviewDocument(files: EditorFile[], entryPath: string) {
  const entry = files.find((file) => file.path === entryPath)
  if (!entry) return '<!doctype html><html><body><p>Preview entry file is missing.</p></body></html>'

  const byPath = new Map(files.map((file) => [file.path, file.content]))
  let html = entry.content
  html = html.replace(/<link\b[^>]*?href=["']([^"']+)["'][^>]*>/gi, (tag, reference) => {
    const path = resolveProjectReference(entryPath, reference)
    const content = path ? byPath.get(path) : undefined
    return content === undefined ? tag : `<style data-lotus-path="${path}">${content}</style>`
  })
  html = html.replace(/<script\b[^>]*?src=["']([^"']+)["'][^>]*><\/script>/gi, (tag, reference) => {
    const path = resolveProjectReference(entryPath, reference)
    const content = path ? byPath.get(path) : undefined
    return content === undefined ? tag : `<script data-lotus-path="${path}">${content.replace(/<\/script/gi, '<\\/script')}</script>`
  })
  return html
}

export function persistedEditorState(state: EditorSession): PersistedEditorState {
  return {
    openFileIds: state.openFileIds,
    activeFileId: state.activeFileId,
    ...state.layout,
    wordWrap: state.wordWrap,
    fontSize: state.fontSize,
  }
}
