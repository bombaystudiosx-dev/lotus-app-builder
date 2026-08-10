import { and, desc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '@/lib/db/schema'
import { project, userSettings, type Project, type UserSettings } from '@/lib/db/schema'

export type ProjectStatus = 'active' | 'archived' | 'trashed'
export type Theme = 'system' | 'light' | 'dark'
export type DefaultDevice = 'phone' | 'tablet' | 'desktop'

export class ProjectLifecycleError extends Error {}

type SettingsInput = Partial<Pick<UserSettings, 'theme' | 'editorFontSize' | 'autosaveInterval' | 'defaultDevice'>>
type ProjectDatabase = BetterSQLite3Database<typeof schema>

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

function cloneFiles(files: Project['files']): Record<string, string> {
  return JSON.parse(JSON.stringify(files ?? {})) as Record<string, string>
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
      await database.insert(project).values(created)
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
        id: newId(), userId, name: normalizedName(`${source.name.slice(0, 95).trimEnd()} copy`), mode: source.mode, files: cloneFiles(source.files),
        status: 'active', createdAt: now, updatedAt: now,
      }
      await database.insert(project).values(created)
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
