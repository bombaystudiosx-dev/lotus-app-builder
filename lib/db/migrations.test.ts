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

function createLegacyDatabase() {
  const database = createDatabase()
  database.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE TABLE project (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'Untitled', mode TEXT NOT NULL DEFAULT 'html', files TEXT NOT NULL DEFAULT '{}', createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE TABLE message (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, userId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL);
  `)
  return database
}

describe('migrateDatabase', () => {
  it('initializes a fresh database with relational integrity and query indexes', () => {
    const database = createDatabase()

    migrateDatabase(database)

    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project'").get()).toBeTruthy()
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_file'").get()).toBeTruthy()
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_runtime'").get()).toBeTruthy()
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
    expect(database.prepare("PRAGMA table_info('project')").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'status' }),
        expect.objectContaining({ name: 'archivedAt' }),
        expect.objectContaining({ name: 'deletedAt' }),
      ]),
    )
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_settings'").get()).toBeTruthy()
  })

  it('can run repeatedly without changing the schema version', () => {
    const database = createDatabase()

    migrateDatabase(database)
    const firstVersion = database.pragma('user_version', { simple: true })
    migrateDatabase(database)

    expect(database.pragma('user_version', { simple: true })).toBe(firstVersion)
  })

  it('preserves populated legacy rows and cascades after upgrade', () => {
    const database = createLegacyDatabase()
    database.exec(`
      INSERT INTO user VALUES ('user-1', 'Lotus', 'lotus@example.com', 0, NULL, 1, 1);
      INSERT INTO project VALUES ('project-1', 'user-1', 'Existing project', 'html', '{"index.html":"<h1>Keep this</h1>","src/app.js":"console.log(1)"}', 1, 1);
      INSERT INTO message VALUES ('message-1', 'project-1', 'user-1', 'user', 'Keep this', 1);
    `)

    migrateDatabase(database)

    expect(database.prepare("SELECT name FROM project WHERE id = 'project-1'").get()).toEqual({ name: 'Existing project' })
    expect(database.prepare("SELECT status, archivedAt, deletedAt FROM project WHERE id = 'project-1'").get()).toEqual({ status: 'active', archivedAt: null, deletedAt: null })
    expect(database.prepare("SELECT content FROM message WHERE id = 'message-1'").get()).toEqual({ content: 'Keep this' })
    expect(database.prepare("SELECT path, content, encoding FROM project_file WHERE projectId = 'project-1' ORDER BY path").all()).toEqual([
      { path: 'index.html', content: '<h1>Keep this</h1>', encoding: 'utf-8' },
      { path: 'src/app.js', content: 'console.log(1)', encoding: 'utf-8' },
    ])
    expect(database.prepare("SELECT runtime, entryPath FROM project_runtime WHERE projectId = 'project-1'").get()).toEqual({ runtime: 'static', entryPath: 'index.html' })
    database.prepare("DELETE FROM user WHERE id = 'user-1'").run()
    expect(database.prepare('SELECT count(*) AS count FROM project').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT count(*) AS count FROM message').get()).toEqual({ count: 0 })
  })

  it('rejects orphaned legacy rows without partially changing the schema', () => {
    const database = createLegacyDatabase()
    database.exec("INSERT INTO project VALUES ('orphan-project', 'missing-user', 'Orphan', 'html', '{}', 1, 1)")

    expect(() => migrateDatabase(database)).toThrow('Cannot safely add a foreign key')
    expect(database.prepare("SELECT userId FROM project WHERE id = 'orphan-project'").get()).toEqual({ userId: 'missing-user' })
    expect(database.prepare("PRAGMA foreign_key_list('project')").all()).toEqual([])
    expect(database.pragma('user_version', { simple: true })).toBe(0)
  })
})
