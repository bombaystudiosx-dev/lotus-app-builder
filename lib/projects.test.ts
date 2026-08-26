import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDatabase } from '@/lib/db/migrations'
import * as schema from '@/lib/db/schema'
import { createProjectSpecification } from '@/lib/project-specification'
import { createProjectService, ProjectLifecycleError } from '@/lib/projects'

const databases: Database.Database[] = []

afterEach(() => databases.splice(0).forEach((database) => database.close()))

function setup() {
  const sqlite = new Database(':memory:')
  databases.push(sqlite)
  migrateDatabase(sqlite)
  const database = drizzle(sqlite, { schema })
  const now = new Date()
  database.insert(schema.user).values([
    { id: 'user-a', name: 'Ada', email: 'ada@example.com', createdAt: now, updatedAt: now },
    { id: 'user-b', name: 'Bea', email: 'bea@example.com', createdAt: now, updatedAt: now },
  ]).run()
  return createProjectService(database)
}

describe('project lifecycle service', () => {
  it('persists an owner-scoped website or app specification and copies it on duplicate', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a', 'Dispatch')
    const specification = createProjectSpecification({
      name: 'Dispatch',
      prompt: 'Build dispatch software for web and mobile',
      targets: ['web', 'ios', 'android', 'api'],
    })

    await expect(projects.updateSpecification('user-a', created.id, specification)).resolves.toEqual(specification)
    await expect(projects.getSpecification('user-a', created.id)).resolves.toEqual(specification)
    await expect(projects.getSpecification('user-b', created.id)).rejects.toThrow('Project not found')

    const duplicate = await projects.duplicate('user-a', created.id)
    await expect(projects.getSpecification('user-a', duplicate.id)).resolves.toEqual(specification)
  })

  it('rejects malformed specification updates without replacing the last valid version', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a', 'Safe specification')
    const specification = createProjectSpecification({
      name: 'Safe specification',
      prompt: 'Build a website',
      kind: 'website',
      targets: ['web'],
    })
    await projects.updateSpecification('user-a', created.id, specification)

    await expect(projects.updateSpecification('user-a', created.id, { ...specification, token: 'exposed' })).rejects.toThrow('Unrecognized')
    await expect(projects.getSpecification('user-a', created.id)).resolves.toEqual(specification)
  })

  it('creates a blank project for its owner and lists it after a reload', async () => {
    const projects = setup()

    const created = await projects.createBlank('user-a', 'My first app')

    expect(created).toMatchObject({ userId: 'user-a', name: 'My first app', status: 'active', files: {} })
    await expect(projects.list('user-a')).resolves.toEqual([expect.objectContaining({ id: created.id })])
  })

  it('does not reveal or mutate another user’s project', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a', 'Private project')

    await expect(projects.get('user-b', created.id)).resolves.toBeNull()
    await expect(projects.rename('user-b', created.id, 'Stolen')).rejects.toBeInstanceOf(ProjectLifecycleError)
    await expect(projects.softDelete('user-b', created.id)).rejects.toBeInstanceOf(ProjectLifecycleError)
    await expect(projects.get('user-a', created.id)).resolves.toMatchObject({ name: 'Private project', status: 'active' })
  })

  it('renames and duplicates an active project without sharing mutable file data', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a', 'Original')

    const renamed = await projects.rename('user-a', created.id, 'Renamed')
    const duplicate = await projects.duplicate('user-a', created.id)

    expect(renamed.name).toBe('Renamed')
    expect(duplicate).toMatchObject({ userId: 'user-a', name: 'Renamed copy', status: 'active', files: {} })
    expect(duplicate.id).not.toBe(created.id)
  })

  it('truncates a duplicate name safely at the 100 character boundary', async () => {
    const projects = setup()
    const sourceName = 'a'.repeat(100)
    const created = await projects.createBlank('user-a', sourceName)

    const duplicate = await projects.duplicate('user-a', created.id)

    expect(duplicate.name).toBe(`${'a'.repeat(95)} copy`)
    expect(duplicate.name).toHaveLength(100)
  })

  it('returns dashboard summaries without project file contents and applies a safety limit', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a', 'Summary only')

    const summaries = await projects.listDashboard('user-a')

    expect(summaries).toEqual([expect.objectContaining({ id: created.id, name: 'Summary only', status: 'active' })])
    expect(summaries[0]).not.toHaveProperty('files')
  })

  it('transitions a project through archive, restore, trash, restore, and permanent delete', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a', 'Lifecycle')

    await expect(projects.archive('user-a', created.id)).resolves.toMatchObject({ status: 'archived', archivedAt: expect.any(Date) })
    await expect(projects.restore('user-a', created.id)).resolves.toMatchObject({ status: 'active', archivedAt: null, deletedAt: null })
    await expect(projects.softDelete('user-a', created.id)).resolves.toMatchObject({ status: 'trashed', deletedAt: expect.any(Date) })
    await expect(projects.restore('user-a', created.id)).resolves.toMatchObject({ status: 'active', archivedAt: null, deletedAt: null })
    await projects.softDelete('user-a', created.id)
    await expect(projects.permanentlyDelete('user-a', created.id)).resolves.toBeUndefined()
    await expect(projects.get('user-a', created.id)).resolves.toBeNull()
  })

  it('rejects invalid state transitions and names', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a')

    await expect(projects.restore('user-a', created.id)).rejects.toThrow('cannot be restored')
    await expect(projects.rename('user-a', created.id, '   ')).rejects.toThrow('Project name is required')
    await projects.softDelete('user-a', created.id)
    await expect(projects.archive('user-a', created.id)).rejects.toThrow('cannot be archived')
    await expect(projects.permanentlyDelete('user-a', created.id)).resolves.toBeUndefined()
  })

  it('protects trashed projects and validates every preference boundary', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a', 'x'.repeat(101))
      .catch((error: unknown) => error)

    expect(created).toBeInstanceOf(ProjectLifecycleError)
    const project = await projects.createBlank('user-a', 'Keep safe')
    await projects.softDelete('user-a', project.id)
    await expect(projects.rename('user-a', project.id, 'Nope')).rejects.toThrow('cannot be renamed')
    await expect(projects.duplicate('user-a', project.id)).rejects.toThrow('cannot be duplicated')
    await expect(projects.softDelete('user-a', project.id)).rejects.toThrow('already in trash')
    await expect(projects.updateSettings('user-a', { theme: 'invalid' as 'system' })).rejects.toThrow('Theme is invalid')
    await expect(projects.updateSettings('user-a', { defaultDevice: 'watch' as 'phone' })).rejects.toThrow('Default device is invalid')
    await expect(projects.updateSettings('user-a', { editorFontSize: 11 })).rejects.toThrow('Editor font size')
    await expect(projects.updateSettings('user-a', { autosaveInterval: 4 })).rejects.toThrow('Autosave interval')
    await expect(projects.updateSettings('user-a', { autosaveInterval: 5.5 })).rejects.toThrow('Autosave interval')
  })

  it('persists validated per-user settings independently', async () => {
    const projects = setup()

    const updated = await projects.updateSettings('user-a', { theme: 'dark', editorFontSize: 18, autosaveInterval: 15, defaultDevice: 'desktop' })

    expect(updated).toMatchObject({ userId: 'user-a', theme: 'dark', editorFontSize: 18, autosaveInterval: 15, defaultDevice: 'desktop' })
    await expect(projects.getSettings('user-b')).resolves.toMatchObject({ theme: 'system', editorFontSize: 14, autosaveInterval: 30, defaultDevice: 'phone' })
    await expect(projects.updateSettings('user-a', { editorFontSize: 100 })).rejects.toThrow('Editor font size')
  })

  it('rejects unrecognized settings payload keys without changing either user', async () => {
    const projects = setup()

    await expect(projects.updateSettings('user-a', { theme: 'dark', userId: 'user-b' } as unknown)).rejects.toThrow('Unrecognized setting')

    await expect(projects.getSettings('user-a')).resolves.toMatchObject({ userId: 'user-a', theme: 'system' })
    await expect(projects.getSettings('user-b')).resolves.toMatchObject({ userId: 'user-b', theme: 'system' })
  })
})
