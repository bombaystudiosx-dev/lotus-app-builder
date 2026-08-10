export type EditorLanguage = 'html' | 'css' | 'javascript' | 'json' | 'markdown' | 'typescript' | 'plain'

export interface EditorFile {
  id: string
  path: string
  content: string
  encoding: 'utf-8' | 'utf-16le'
}

export interface EditorDocument extends EditorFile {
  savedContent: string
  dirty: boolean
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
  const openFileIds = persistedOpen.length ? persistedOpen : files.slice(0, 1).map((file) => file.id)
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

  if (language === 'html') {
    const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
    const stack: Array<{ name: string; offset: number }> = []
    for (const match of content.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)) {
      const token = match[0]
      const name = match[1].toLowerCase()
      if (token.startsWith('</')) {
        const open = stack.at(-1)
        if (!open || open.name !== name) {
          return [{ path, message: `Unexpected closing tag </${name}>; ${open ? `<${open.name}> is still open.` : 'no matching opening tag was found.'}`, ...locationFromOffset(content, match.index), severity: 'error' }]
        }
        stack.pop()
      } else if (!token.endsWith('/>') && !voidElements.has(name) && !token.startsWith('<!')) {
        stack.push({ name, offset: match.index })
      }
    }
    const open = stack.at(-1)
    return open
      ? [{ path, message: `Unclosed tag <${open.name}>.`, ...locationFromOffset(content, open.offset), severity: 'error' }]
      : []
  }

  return []
}

export function buildPreviewDocument(files: EditorFile[], entryPath: string) {
  const entry = files.find((file) => file.path === entryPath)
  if (!entry) return '<!doctype html><html><body><p>Preview entry file is missing.</p></body></html>'

  const byPath = new Map(files.map((file) => [file.path, file.content]))
  let html = entry.content
  html = html.replace(/<link\b[^>]*?href=["']([^"']+)["'][^>]*>/gi, (tag, path) => {
    const content = byPath.get(path)
    return content === undefined ? tag : `<style data-lotus-path="${path}">${content}</style>`
  })
  html = html.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, before, path) => {
    const content = byPath.get(path)
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
