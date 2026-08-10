import { and, desc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type Database from 'better-sqlite3'
import type * as schema from '@/lib/db/schema'
import { project, userSettings, type Project, type ProjectFile, type ProjectRuntime, type UserSettings } from '@/lib/db/schema'

export type ProjectStatus = 'active' | 'archived' | 'trashed'
export type Theme = 'system' | 'light' | 'dark'
export type DefaultDevice = 'phone' | 'tablet' | 'desktop'

export class ProjectLifecycleError extends Error {}

type SettingsInput = Partial<Pick<UserSettings, 'theme' | 'editorFontSize' | 'autosaveInterval' | 'defaultDevice'>>
type ProjectDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

export type FileEncoding = 'utf-8' | 'utf-16le'
export type ProjectFileInput = { path: string; content: string; encoding?: FileEncoding }
export type ProjectFileUpdate = { content: string; encoding?: FileEncoding }
const MAX_FILE_BYTES = 1_048_576
const MAX_PROJECT_BYTES = 5_242_880
const SUPPORTED_ENCODINGS = new Set<FileEncoding>(['utf-8', 'utf-16le'])
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const STARTER_FILES: ProjectFileInput[] = [
  { path: 'index.html', content: '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1">\n    <title>Lotus app</title>\n    <link rel="stylesheet" href="styles.css">\n  </head>\n  <body>\n    <main><h1>Start building</h1></main>\n    <script src="script.js"></script>\n  </body>\n</html>\n' },
  { path: 'styles.css', content: ':root { font-family: system-ui, sans-serif; }\nbody { margin: 0; padding: 2rem; }\n' },
  { path: 'script.js', content: 'console.info("Lotus starter ready")\n' },
]

const DEFAULT_SETTINGS = {
  theme: 'system' as Theme,
  editorFontSize: 14,
  autosaveInterval: 30,
  defaultDevice: 'phone' as DefaultDevice,
}

function newId() {
  return crypto.randomUUID()
}

function normalizedName(name: string) {
  const value = name.trim().replace(/\s+/g, ' ')
  if (!value) throw new ProjectLifecycleError('Project name is required.')
  if (value.length > 100) throw new ProjectLifecycleError('Project name must be 100 characters or fewer.')
  return value
}

function validatePath(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.includes('\\') || value.startsWith('/') || value.includes('\0')) {
    throw new ProjectLifecycleError('File path must be a safe relative path.')
  }
  const parts = value.split('/')
  if (parts.some((part) => WINDOWS_RESERVED.test(part))) throw new ProjectLifecycleError('File path contains a reserved Windows name.')
  if (parts.some((part) => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part))) throw new ProjectLifecycleError('File path must be a safe relative path.')
  return value
}

function validateFileInput(input: ProjectFileInput) {
  const path = validatePath(input.path)
  if (typeof input.content !== 'string') throw new ProjectLifecycleError('File content must be text.')
  const encoding = input.encoding ?? 'utf-8'
  if (!SUPPORTED_ENCODINGS.has(encoding)) throw new ProjectLifecycleError('Encoding is not supported.')
  const bytes = Buffer.byteLength(input.content, encoding === 'utf-16le' ? 'utf16le' : 'utf8')
  if (bytes > MAX_FILE_BYTES) throw new ProjectLifecycleError('File is too large.')
  return { path, content: input.content, encoding, bytes }
}

type RawFile = Omit<ProjectFile, 'createdAt' | 'updatedAt' | 'deletedAt'> & { createdAt: number; updatedAt: number; deletedAt: number | null }
type RawRuntime = Omit<ProjectRuntime, 'createdAt' | 'updatedAt'> & { createdAt: number; updatedAt: number }

function fileFromRow(row: RawFile): ProjectFile {
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), deletedAt: row.deletedAt === null ? null : new Date(row.deletedAt) }
}

function runtimeFromRow(row: RawRuntime): ProjectRuntime {
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) }
}

function settingsValues(input: unknown): SettingsInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProjectLifecycleError('Settings payload is invalid.')
  const values = input as Record<string, unknown>
  const allowed = new Set(['theme', 'editorFontSize', 'autosaveInterval', 'defaultDevice'])
  if (Object.keys(values).some((key) => !allowed.has(key))) throw new ProjectLifecycleError('Unrecognized setting.')

  const safe: SettingsInput = {}
  if (values.theme !== undefined) {
    if (typeof values.theme !== 'string') throw new ProjectLifecycleError('Theme is invalid.')
    safe.theme = values.theme as Theme
  }
  if (values.defaultDevice !== undefined) {
    if (typeof values.defaultDevice !== 'string') throw new ProjectLifecycleError('Default device is invalid.')
    safe.defaultDevice = values.defaultDevice as DefaultDevice
  }
  if (values.editorFontSize !== undefined) {
    if (typeof values.editorFontSize !== 'number') throw new ProjectLifecycleError('Editor font size must be between 12 and 24.')
    safe.editorFontSize = values.editorFontSize
  }
  if (values.autosaveInterval !== undefined) {
    if (typeof values.autosaveInterval !== 'number') throw new ProjectLifecycleError('Autosave interval must be between 5 and 300 seconds.')
    safe.autosaveInterval = values.autosaveInterval
  }

  validateSettings(safe)
  return safe
}

function validateSettings(input: SettingsInput) {
  if (input.theme && !['system', 'light', 'dark'].includes(input.theme)) throw new ProjectLifecycleError('Theme is invalid.')
  if (input.defaultDevice && !['phone', 'tablet', 'desktop'].includes(input.defaultDevice)) throw new ProjectLifecycleError('Default device is invalid.')
  if (input.editorFontSize !== undefined && (!Number.isInteger(input.editorFontSize) || input.editorFontSize < 12 || input.editorFontSize > 24)) {
    throw new ProjectLifecycleError('Editor font size must be between 12 and 24.')
  }
  if (input.autosaveInterval !== undefined && (!Number.isInteger(input.autosaveInterval) || input.autosaveInterval < 5 || input.autosaveInterval > 300)) {
    throw new ProjectLifecycleError('Autosave interval must be between 5 and 300 seconds.')
  }
}

export function createProjectService(database: ProjectDatabase) {
  const sqlite = database.$client

  function withTransaction<T>(work: () => T) {
    return sqlite.transaction(work)()
  }

  function assertWritableProject(userId: string, projectId: string) {
    const row = sqlite.prepare('SELECT status FROM project WHERE id = ? AND userId = ?').get(projectId, userId) as { status: ProjectStatus } | undefined
    if (!row) throw new ProjectLifecycleError('Project not found.')
    if (row.status !== 'active') throw new ProjectLifecycleError('Files can only be changed in an active project.')
  }

  function findFile(userId: string, projectId: string, fileId: string, includeTrashed = false) {
    const query = `SELECT f.* FROM project_file f JOIN project p ON p.id = f.projectId
      WHERE f.id = ? AND f.projectId = ? AND p.userId = ?${includeTrashed ? '' : ' AND f.deletedAt IS NULL'} LIMIT 1`
    return sqlite.prepare(query).get(fileId, projectId, userId) as RawFile | undefined
  }

  function assertAvailablePath(projectId: string, path: string, ignoredFileId?: string) {
    const row = sqlite.prepare(`SELECT id FROM project_file WHERE projectId = ? AND path = ? AND deletedAt IS NULL${ignoredFileId ? ' AND id != ?' : ''} LIMIT 1`)
      .get(...(ignoredFileId ? [projectId, path, ignoredFileId] : [projectId, path]))
    if (row) throw new ProjectLifecycleError('A file already exists at that path.')
  }

  function assertProjectCapacity(projectId: string, nextBytes: number, existingBytes = 0) {
    const row = sqlite.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM project_file WHERE projectId = ? AND deletedAt IS NULL').get(projectId) as { total: number }
    if (row.total - existingBytes + nextBytes > MAX_PROJECT_BYTES) throw new ProjectLifecycleError('Project size limit exceeded.')
  }

  function touchProject(projectId: string, timestamp: number) {
    sqlite.prepare('UPDATE project SET updatedAt = ? WHERE id = ?').run(timestamp, projectId)
  }

  async function owned(userId: string, projectId: string) {
    const [row] = await database.select().from(project)
      .where(and(eq(project.id, projectId), eq(project.userId, userId))).limit(1)
    if (!row) throw new ProjectLifecycleError('Project not found.')
    return row
  }

  async function updateOwned(userId: string, projectId: string, values: Partial<Project>) {
    const existing = await owned(userId, projectId)
    await database.update(project).set({ ...values, updatedAt: new Date() }).where(and(eq(project.id, projectId), eq(project.userId, userId)))
    return { ...existing, ...values, updatedAt: new Date() } as Project
  }

  async function getSettings(userId: string) {
    const [existing] = await database.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
    if (existing) return existing
    const now = new Date()
    await database.insert(userSettings).values({ userId, ...DEFAULT_SETTINGS, createdAt: now, updatedAt: now }).onConflictDoNothing()
    const [created] = await database.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
    if (!created) throw new ProjectLifecycleError('Unable to initialize settings.')
    return created
  }

  return {
    async list(userId: string) {
      return database.select().from(project).where(eq(project.userId, userId)).orderBy(desc(project.updatedAt))
    },
    async listDashboard(userId: string) {
      return database.select({ id: project.id, name: project.name, status: project.status, updatedAt: project.updatedAt })
        .from(project).where(eq(project.userId, userId)).orderBy(desc(project.updatedAt)).limit(100)
    },
    async get(userId: string, projectId: string) {
      const [row] = await database.select().from(project)
        .where(and(eq(project.id, projectId), eq(project.userId, userId))).limit(1)
      return row ?? null
    },
    async createBlank(userId: string, name = 'Untitled project') {
      const now = new Date()
      const created: typeof project.$inferInsert = {
        id: newId(), userId, name: normalizedName(name), mode: 'html', files: {}, status: 'active', createdAt: now, updatedAt: now,
      }
      withTransaction(() => {
        database.insert(project).values(created).run()
        sqlite.prepare(`INSERT INTO project_runtime (projectId, runtime, framework, buildTool, entryPath, metadata, createdAt, updatedAt)
          VALUES (?, 'static', 'static', NULL, 'index.html', '{}', ?, ?)`)
          .run(created.id, now.getTime(), now.getTime())
        const insert = sqlite.prepare(`INSERT INTO project_file (id, projectId, path, content, encoding, size, originalPath, deletedAt, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`)
        for (const starter of STARTER_FILES) {
          const file = validateFileInput(starter)
          insert.run(newId(), created.id, file.path, file.content, file.encoding, file.bytes, now.getTime(), now.getTime())
        }
      })
      return (await owned(userId, created.id))
    },
    async rename(userId: string, projectId: string, name: string) {
      const existing = await owned(userId, projectId)
      if (existing.status === 'trashed') throw new ProjectLifecycleError('A trashed project cannot be renamed.')
      return updateOwned(userId, projectId, { name: normalizedName(name) })
    },
    async duplicate(userId: string, projectId: string) {
      const source = await owned(userId, projectId)
      if (source.status === 'trashed') throw new ProjectLifecycleError('A trashed project cannot be duplicated.')
      const now = new Date()
      const created: typeof project.$inferInsert = {
        id: newId(), userId, name: normalizedName(`${source.name.slice(0, 95).trimEnd()} copy`), mode: source.mode, files: {},
        status: 'active', createdAt: now, updatedAt: now,
      }
      withTransaction(() => {
        database.insert(project).values(created).run()
        const runtime = sqlite.prepare('SELECT runtime, framework, buildTool, entryPath, metadata FROM project_runtime WHERE projectId = ?').get(source.id) as Omit<RawRuntime, 'projectId' | 'createdAt' | 'updatedAt'> | undefined
        sqlite.prepare(`INSERT INTO project_runtime (projectId, runtime, framework, buildTool, entryPath, metadata, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(created.id, runtime?.runtime ?? 'static', runtime?.framework ?? 'static', runtime?.buildTool ?? null, runtime?.entryPath ?? 'index.html', runtime?.metadata ?? '{}', now.getTime(), now.getTime())
        const files = sqlite.prepare('SELECT path, content, encoding, size, originalPath FROM project_file WHERE projectId = ? AND deletedAt IS NULL').all(source.id) as Array<Pick<RawFile, 'path' | 'content' | 'encoding' | 'size' | 'originalPath'>>
        const insert = sqlite.prepare(`INSERT INTO project_file (id, projectId, path, content, encoding, size, originalPath, deletedAt, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
        for (const file of files) insert.run(newId(), created.id, file.path, file.content, file.encoding, file.size, file.originalPath, now.getTime(), now.getTime())
      })
      return owned(userId, created.id)
    },
    async archive(userId: string, projectId: string) {
      const existing = await owned(userId, projectId)
      if (existing.status !== 'active') throw new ProjectLifecycleError('This project cannot be archived.')
      return updateOwned(userId, projectId, { status: 'archived', archivedAt: new Date(), deletedAt: null })
    },
    async restore(userId: string, projectId: string) {
      const existing = await owned(userId, projectId)
      if (existing.status === 'active') throw new ProjectLifecycleError('This project cannot be restored.')
      return updateOwned(userId, projectId, { status: 'active', archivedAt: null, deletedAt: null })
    },
    async softDelete(userId: string, projectId: string) {
      const existing = await owned(userId, projectId)
      if (existing.status === 'trashed') throw new ProjectLifecycleError('This project is already in trash.')
      return updateOwned(userId, projectId, { status: 'trashed', deletedAt: new Date() })
    },
    async permanentlyDelete(userId: string, projectId: string) {
      const existing = await owned(userId, projectId)
      if (existing.status !== 'trashed') throw new ProjectLifecycleError('Only trashed projects can be permanently deleted.')
      await database.delete(project).where(and(eq(project.id, projectId), eq(project.userId, userId), eq(project.status, 'trashed')))
    },
    async getRuntime(userId: string, projectId: string) {
      const row = sqlite.prepare(`SELECT r.* FROM project_runtime r JOIN project p ON p.id = r.projectId
        WHERE r.projectId = ? AND p.userId = ? LIMIT 1`).get(projectId, userId) as RawRuntime | undefined
      return row ? runtimeFromRow(row) : null
    },
    async listFiles(userId: string, projectId: string, options: { includeTrashed?: boolean } = {}) {
      const rows = sqlite.prepare(`SELECT f.* FROM project_file f JOIN project p ON p.id = f.projectId
        WHERE f.projectId = ? AND p.userId = ?${options.includeTrashed ? '' : ' AND f.deletedAt IS NULL'} ORDER BY f.path`).all(projectId, userId) as RawFile[]
      return rows.map(fileFromRow)
    },
    async getFile(userId: string, projectId: string, fileId: string, options: { includeTrashed?: boolean } = {}) {
      const row = findFile(userId, projectId, fileId, options.includeTrashed)
      return row ? fileFromRow(row) : null
    },
    async getFileByPath(userId: string, projectId: string, path: string, options: { includeTrashed?: boolean } = {}) {
      const safePath = validatePath(path)
      const row = sqlite.prepare(`SELECT f.* FROM project_file f JOIN project p ON p.id = f.projectId
        WHERE f.projectId = ? AND f.path = ? AND p.userId = ?${options.includeTrashed ? '' : ' AND f.deletedAt IS NULL'} LIMIT 1`).get(projectId, safePath, userId) as RawFile | undefined
      return row ? fileFromRow(row) : null
    },
    async createFile(userId: string, projectId: string, input: ProjectFileInput) {
      const file = validateFileInput(input)
      return withTransaction(() => {
        assertWritableProject(userId, projectId)
        assertAvailablePath(projectId, file.path)
        assertProjectCapacity(projectId, file.bytes)
        const now = Date.now()
        const id = newId()
        sqlite.prepare(`INSERT INTO project_file (id, projectId, path, content, encoding, size, originalPath, deletedAt, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`)
          .run(id, projectId, file.path, file.content, file.encoding, file.bytes, now, now)
        touchProject(projectId, now)
        return fileFromRow({ id, projectId, path: file.path, content: file.content, encoding: file.encoding, size: file.bytes, originalPath: null, deletedAt: null, createdAt: now, updatedAt: now })
      })
    },
    async renameFile(userId: string, projectId: string, fileId: string, path: string) {
      const safePath = validatePath(path)
      return withTransaction(() => {
        assertWritableProject(userId, projectId)
        const existing = findFile(userId, projectId, fileId)
        if (!existing) throw new ProjectLifecycleError('File not found.')
        assertAvailablePath(projectId, safePath, fileId)
        const now = Date.now()
        sqlite.prepare('UPDATE project_file SET path = ?, updatedAt = ? WHERE id = ? AND projectId = ?').run(safePath, now, fileId, projectId)
        touchProject(projectId, now)
        return fileFromRow({ ...existing, path: safePath, updatedAt: now })
      })
    },
    async duplicateFile(userId: string, projectId: string, fileId: string, path: string) {
      const safePath = validatePath(path)
      return withTransaction(() => {
        assertWritableProject(userId, projectId)
        const existing = findFile(userId, projectId, fileId)
        if (!existing) throw new ProjectLifecycleError('File not found.')
        if (existing.size > MAX_FILE_BYTES) throw new ProjectLifecycleError('File is too large.')
        assertAvailablePath(projectId, safePath)
        assertProjectCapacity(projectId, existing.size)
        const now = Date.now()
        const id = newId()
        sqlite.prepare(`INSERT INTO project_file (id, projectId, path, content, encoding, size, originalPath, deletedAt, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`)
          .run(id, projectId, safePath, existing.content, existing.encoding, existing.size, now, now)
        touchProject(projectId, now)
        return fileFromRow({ ...existing, id, path: safePath, originalPath: null, createdAt: now, updatedAt: now })
      })
    },
    async updateFile(userId: string, projectId: string, fileId: string, input: ProjectFileUpdate) {
      return withTransaction(() => {
        assertWritableProject(userId, projectId)
        const existing = findFile(userId, projectId, fileId)
        if (!existing) throw new ProjectLifecycleError('File not found.')
        const content = validateFileInput({ path: existing.path, content: input.content, encoding: input.encoding ?? existing.encoding as FileEncoding })
        assertProjectCapacity(projectId, content.bytes, existing.size)
        const now = Date.now()
        sqlite.prepare('UPDATE project_file SET content = ?, encoding = ?, size = ?, updatedAt = ? WHERE id = ? AND projectId = ?')
          .run(content.content, content.encoding, content.bytes, now, fileId, projectId)
        touchProject(projectId, now)
        return fileFromRow({ ...existing, content: content.content, encoding: content.encoding, size: content.bytes, updatedAt: now })
      })
    },
    async trashFile(userId: string, projectId: string, fileId: string) {
      return withTransaction(() => {
        assertWritableProject(userId, projectId)
        const existing = findFile(userId, projectId, fileId)
        if (!existing) throw new ProjectLifecycleError('File not found.')
        const now = Date.now()
        sqlite.prepare('UPDATE project_file SET deletedAt = ?, updatedAt = ? WHERE id = ? AND projectId = ?').run(now, now, fileId, projectId)
        touchProject(projectId, now)
        return fileFromRow({ ...existing, deletedAt: now, updatedAt: now })
      })
    },
    async restoreFile(userId: string, projectId: string, fileId: string) {
      return withTransaction(() => {
        assertWritableProject(userId, projectId)
        const existing = findFile(userId, projectId, fileId, true)
        if (!existing || existing.deletedAt === null) throw new ProjectLifecycleError('Trashed file not found.')
        assertAvailablePath(projectId, existing.path)
        assertProjectCapacity(projectId, existing.size)
        const now = Date.now()
        sqlite.prepare('UPDATE project_file SET deletedAt = NULL, updatedAt = ? WHERE id = ? AND projectId = ?').run(now, fileId, projectId)
        touchProject(projectId, now)
        return fileFromRow({ ...existing, deletedAt: null, updatedAt: now })
      })
    },
    async permanentlyDeleteFile(userId: string, projectId: string, fileId: string) {
      withTransaction(() => {
        assertWritableProject(userId, projectId)
        const existing = findFile(userId, projectId, fileId, true)
        if (!existing || existing.deletedAt === null) throw new ProjectLifecycleError('Only trashed files can be permanently deleted.')
        sqlite.prepare('DELETE FROM project_file WHERE id = ? AND projectId = ? AND deletedAt IS NOT NULL').run(fileId, projectId)
        touchProject(projectId, Date.now())
      })
    },
    getSettings,
    async updateSettings(userId: string, input: unknown) {
      const inputValues = settingsValues(input)
      const current = await getSettings(userId)
      const values = { ...inputValues, updatedAt: new Date() }
      await database.update(userSettings).set(values).where(eq(userSettings.userId, userId))
      return { ...current, ...values } as UserSettings
    },
  }
}

export type ProjectService = ReturnType<typeof createProjectService>
