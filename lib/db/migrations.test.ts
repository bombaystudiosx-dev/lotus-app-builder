import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDatabase } from '@/lib/db/migrations'

const databases: Database.Database[] = []

afterEach(() => {
  databases.splice(0).forEach((database) => database.close())
})

function createDatabase() {
  const database = new Database(':memory:')
  databases.push(database)
  return database
}

describe('migrateDatabase', () => {
  it('initializes a fresh database with relational integrity and query indexes', () => {
    const database = createDatabase()

    migrateDatabase(database)

    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project'").get()).toBeTruthy()
    expect(database.prepare("PRAGMA foreign_key_list('project')").all()).toContainEqual(
      expect.objectContaining({ from: 'userId', table: 'user', to: 'id' }),
    )
    expect(database.prepare("PRAGMA foreign_key_list('message')").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'projectId', table: 'project', to: 'id' }),
        expect.objectContaining({ from: 'userId', table: 'user', to: 'id' }),
      ]),
    )
    expect(database.prepare("PRAGMA index_list('message')").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'message_project_created_at_idx' })]),
    )
  })

  it('can run repeatedly without changing the schema version', () => {
    const database = createDatabase()

    migrateDatabase(database)
    const firstVersion = database.pragma('user_version', { simple: true })
    migrateDatabase(database)

    expect(database.pragma('user_version', { simple: true })).toBe(firstVersion)
  })
})
