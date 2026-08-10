import { describe, expect, it } from 'vitest'
import {
  buildPreviewDocument,
  closeDocument,
  createEditorSession,
  diagnoseDocument,
  editDocument,
  languageForPath,
  reopenLastClosed,
  saveDocument,
  type EditorFile,
} from '@/lib/editor-workspace'

const files: EditorFile[] = [
  { id: 'html', path: 'index.html', content: '<main>Hello</main>', encoding: 'utf-8' },
  { id: 'css', path: 'styles.css', content: 'main { color: red; }', encoding: 'utf-8' },
  { id: 'js', path: 'script.js', content: 'console.info("ready")', encoding: 'utf-8' },
]

describe('editor workspace state', () => {
  it('marks edits dirty without changing the server snapshot', () => {
    const edited = editDocument(createEditorSession(files, 'lotus'), 'html', '<main>Changed</main>')

    expect(edited.documents.html).toMatchObject({ content: '<main>Changed</main>', savedContent: '<main>Hello</main>', dirty: true })
  })

  it('blocks a normal close when a document has unsaved changes', () => {
    const edited = editDocument(createEditorSession(files, 'lotus'), 'html', '<main>Changed</main>')
    const result = closeDocument(edited, 'html')

    expect(result.blocked).toBe(true)
    expect(result.state.openFileIds).toContain('html')
  })

  it('can explicitly discard, close, and reopen a dirty document from its saved snapshot', () => {
    const edited = editDocument(createEditorSession(files, 'lotus'), 'html', '<main>Changed</main>')
    const closed = closeDocument(edited, 'html', { discard: true })
    const reopened = reopenLastClosed(closed.state)

    expect(closed.blocked).toBe(false)
    expect(reopened.documents.html).toMatchObject({ content: '<main>Hello</main>', dirty: false })
    expect(reopened.activeFileId).toBe('html')
  })

  it('clears the dirty indicator only for the matching successful save', () => {
    const edited = editDocument(createEditorSession(files, 'lotus'), 'html', '<main>Changed</main>')
    const staleSave = saveDocument(edited, 'html', '<main>Other change</main>')
    const currentSave = saveDocument(edited, 'html', '<main>Changed</main>')

    expect(staleSave.documents.html.dirty).toBe(true)
    expect(currentSave.documents.html).toMatchObject({ savedContent: '<main>Changed</main>', dirty: false })
  })

  it('restores only valid persisted open file ids and panel sizes', () => {
    const session = createEditorSession(files, 'lotus', {
      openFileIds: ['missing', 'css'], activeFileId: 'missing', treeWidth: 90, previewWidth: 9999, problemsHeight: 4,
    })

    expect(session.openFileIds).toEqual(['css'])
    expect(session.activeFileId).toBe('css')
    expect(session.layout).toEqual({ treeWidth: 160, previewWidth: 720, problemsHeight: 96 })
  })
})

describe('editor language and diagnostics', () => {
  it.each([
    ['index.html', 'html'], ['theme.css', 'css'], ['main.js', 'javascript'], ['data.json', 'json'],
    ['README.md', 'markdown'], ['thing.ts', 'typescript'], ['unknown.txt', 'plain'],
  ])('maps %s to %s', (path, expected) => {
    expect(languageForPath(path)).toBe(expected)
  })

  it('reports malformed JSON with a useful line', () => {
    const diagnostics = diagnoseDocument('data.json', '{\n  "name":\n}')

    expect(diagnostics[0]).toMatchObject({ severity: 'error', path: 'data.json', line: 3 })
  })

  it('reports unmatched HTML tags while accepting a valid document', () => {
    expect(diagnoseDocument('index.html', '<main><section></main>')).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('section') }),
    ]))
    expect(diagnoseDocument('index.html', '<main><section></section></main>')).toEqual([])
  })
})

describe('local preview composition', () => {
  it('inlines normalized sibling CSS and JavaScript without network access', () => {
    const document = buildPreviewDocument([
      ...files.filter((file) => file.id !== 'html'),
      { ...files[0], content: '<link rel="stylesheet" href="styles.css"><main>Hello</main><script src="script.js"></script>' },
    ], 'index.html')

    expect(document).toContain('<style data-lotus-path="styles.css">main { color: red; }</style>')
    expect(document).toContain('<script data-lotus-path="script.js">console.info("ready")</script>')
    expect(document).not.toContain('src="script.js"')
  })
})
