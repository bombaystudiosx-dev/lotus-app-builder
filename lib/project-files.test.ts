import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDatabase } from '@/lib/db/migrations'
import * as schema from '@/lib/db/schema'
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

describe('normalized project files', () => {
  it('seeds a static starter and retains nested files after reading again', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a', 'Starter')

    expect(await projects.getRuntime('user-a', created.id)).toMatchObject({ runtime: 'static', entryPath: 'index.html' })
    expect(await projects.listFiles('user-a', created.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'index.html', encoding: 'utf-8' }),
      expect.objectContaining({ path: 'styles.css' }),
      expect.objectContaining({ path: 'script.js' }),
    ]))
    const nested = await projects.createFile('user-a', created.id, { path: 'src/components/greeting.js', content: 'export const greeting = "hi"' })
    await expect(projects.getFile('user-a', created.id, nested.id)).resolves.toMatchObject({ path: 'src/components/greeting.js', content: 'export const greeting = "hi"' })
  })

  it('moves, duplicates, updates, trashes, restores and permanently deletes a file', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a')
    const file = await projects.createFile('user-a', created.id, { path: 'notes/todo.txt', content: 'one' })

    await expect(projects.renameFile('user-a', created.id, file.id, 'notes/done.txt')).resolves.toMatchObject({ path: 'notes/done.txt' })
    const copy = await projects.duplicateFile('user-a', created.id, file.id, 'notes/done-copy.txt')
    await expect(projects.updateFile('user-a', created.id, copy.id, { content: 'two', encoding: 'utf-16le' })).resolves.toMatchObject({ content: 'two', encoding: 'utf-16le' })
    await expect(projects.trashFile('user-a', created.id, copy.id)).resolves.toMatchObject({ deletedAt: expect.any(Date) })
    await expect(projects.restoreFile('user-a', created.id, copy.id)).resolves.toMatchObject({ deletedAt: null })
    await expect(projects.trashFile('user-a', created.id, copy.id)).resolves.toMatchObject({ deletedAt: expect.any(Date) })
    await expect(projects.permanentlyDeleteFile('user-a', created.id, copy.id)).resolves.toBeUndefined()
    await expect(projects.getFile('user-a', created.id, copy.id, { includeTrashed: true })).resolves.toBeNull()
  })

  it('rejects traversal, Windows reserved paths, duplicates, invalid encodings, oversized input, and cross-user mutations', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a')
    const file = await projects.createFile('user-a', created.id, { path: 'safe.txt', content: 'safe' })

    await expect(projects.createFile('user-a', created.id, { path: '../secret.txt', content: 'no' })).rejects.toThrow('relative')
    await expect(projects.createFile('user-a', created.id, { path: 'CON.txt', content: 'no' })).rejects.toThrow('reserved')
    await expect(projects.createFile('user-a', created.id, { path: 'safe.txt', content: 'no' })).rejects.toThrow('already exists')
    await expect(projects.createFile('user-a', created.id, { path: 'wrong.txt', content: 'no', encoding: 'latin1' as 'utf-8' })).rejects.toThrow('Encoding')
    await expect(projects.createFile('user-a', created.id, { path: 'large.txt', content: 'x'.repeat(1_048_577) })).rejects.toThrow('too large')
    await expect(projects.updateFile('user-b', created.id, file.id, { content: 'stolen' })).rejects.toBeInstanceOf(ProjectLifecycleError)
    await expect(projects.getFile('user-b', created.id, file.id)).resolves.toBeNull()
  })

  it('prevents restoring over an active duplicate path', async () => {
    const projects = setup()
    const created = await projects.createBlank('user-a')
    const original = await projects.createFile('user-a', created.id, { path: 'same.txt', content: 'old' })
    await projects.trashFile('user-a', created.id, original.id)
    await projects.createFile('user-a', created.id, { path: 'same.txt', content: 'new' })

    await expect(projects.restoreFile('user-a', created.id, original.id)).rejects.toThrow('already exists')
  })
})
