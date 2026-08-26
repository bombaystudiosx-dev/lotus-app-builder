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

function createStaleChildDatabase() {
  const database = createDatabase()
  database.pragma('foreign_keys = OFF')
  database.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE TABLE project (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, name TEXT NOT NULL DEFAULT 'Untitled', mode TEXT NOT NULL DEFAULT 'html', files TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', archivedAt INTEGER, deletedAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE TABLE message (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES project_legacy(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL);
    CREATE INDEX message_project_created_at_idx ON message(projectId, createdAt);
    CREATE INDEX message_user_created_at_idx ON message(userId, createdAt);
    CREATE TABLE project_file (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES project_legacy(id) ON DELETE CASCADE, path TEXT NOT NULL, content TEXT NOT NULL, encoding TEXT NOT NULL DEFAULT 'utf-8', size INTEGER NOT NULL, originalPath TEXT, deletedAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE INDEX project_file_project_updated_at_idx ON project_file(projectId, updatedAt);
    CREATE UNIQUE INDEX project_file_active_path_idx ON project_file(projectId, path) WHERE deletedAt IS NULL;
    CREATE TABLE project_runtime (projectId TEXT PRIMARY KEY REFERENCES project_legacy(id) ON DELETE CASCADE, runtime TEXT NOT NULL DEFAULT 'static', framework TEXT NOT NULL DEFAULT 'static', buildTool TEXT, entryPath TEXT NOT NULL DEFAULT 'index.html', metadata TEXT NOT NULL DEFAULT '{}', createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    INSERT INTO user VALUES ('user-1', 'Lotus', 'lotus@example.com', 0, NULL, 1, 1);
    INSERT INTO project VALUES ('project-1', 'user-1', 'Existing project', 'html', '{}', 'active', NULL, NULL, 1, 1);
    INSERT INTO message VALUES ('message-1', 'project-1', 'user-1', 'user', 'Keep this', 1);
    INSERT INTO project_file VALUES ('file-1', 'project-1', 'index.html', '<h1>Keep this</h1>', 'utf-8', 18, NULL, NULL, 1, 1);
    INSERT INTO project_runtime VALUES ('project-1', 'static', 'static', NULL, 'index.html', '{}', 1, 1);
  `)
  database.pragma('user_version = 4')
  return database
}

function expectRequiredChildIndexes(database: Database.Database) {
  expect(database.prepare("PRAGMA index_list('message')").all()).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'message_project_created_at_idx' }),
    expect.objectContaining({ name: 'message_user_created_at_idx' }),
  ]))
  expect(database.prepare("PRAGMA index_list('project_file')").all()).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'project_file_project_updated_at_idx' }),
    expect.objectContaining({ name: 'project_file_active_path_idx', unique: 1, partial: 1 }),
  ]))
}

function expectRequiredProjectIndexes(database: Database.Database) {
  expect(database.prepare("PRAGMA index_list('project')").all()).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'project_user_updated_at_idx' }),
    expect.objectContaining({ name: 'project_user_status_updated_at_idx' }),
  ]))
}

describe('migrateDatabase', () => {
  it('initializes a fresh database with relational integrity and query indexes', () => {
    const database = createDatabase()

    migrateDatabase(database)

    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project'").get()).toBeTruthy()
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_file'").get()).toBeTruthy()
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_runtime'").get()).toBeTruthy()
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_specification'").get()).toBeTruthy()
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
    const storedSpecification = database.prepare("SELECT specification FROM project_specification WHERE projectId = 'project-1'").get() as { specification: string }
    expect(JSON.parse(storedSpecification.specification)).toMatchObject({
      version: 1,
      product: { name: 'Existing project', kind: 'application' },
      targets: [{ platform: 'web', framework: 'nextjs', enabled: true }],
    })
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

  it('rebuilds child tables after a legacy project rebuild with valid foreign keys and cascades', () => {
    const database = createLegacyDatabase()
    database.exec(`
      INSERT INTO user VALUES ('user-1', 'Lotus', 'lotus@example.com', 0, NULL, 1, 1);
      INSERT INTO project VALUES ('project-1', 'user-1', 'Existing project', 'html', '{"index.html":"<h1>Keep this</h1>"}', 1, 1);
    `)

    migrateDatabase(database)

    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([])
    expectRequiredProjectIndexes(database)
    expect(database.prepare("PRAGMA foreign_key_list('project_file')").all()).toContainEqual(expect.objectContaining({ from: 'projectId', table: 'project', to: 'id' }))
    expect(database.prepare("PRAGMA foreign_key_list('project_runtime')").all()).toContainEqual(expect.objectContaining({ from: 'projectId', table: 'project', to: 'id' }))
    database.prepare("INSERT INTO project_file VALUES ('extra-file', 'project-1', 'extra.js', 'export {}', 'utf-8', 9, NULL, NULL, 2, 2)").run()
    database.prepare("INSERT INTO project VALUES ('project-2', 'user-1', 'Second project', 'html', '{}', 'active', NULL, NULL, 2, 2)").run()
    database.prepare("INSERT INTO project_runtime VALUES ('project-2', 'static', 'static', NULL, 'index.html', '{}', 2, 2)").run()
    database.prepare("DELETE FROM project WHERE id = 'project-1'").run()
    database.prepare("DELETE FROM project WHERE id = 'project-2'").run()
    expect(database.prepare('SELECT count(*) AS count FROM project_file').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT count(*) AS count FROM project_runtime').get()).toEqual({ count: 0 })
    expectRequiredChildIndexes(database)
  })

  it('recreates named indexes after stale foreign-key child table rebuilds', () => {
    const database = createStaleChildDatabase()

    migrateDatabase(database)

    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expectRequiredChildIndexes(database)
    expect(database.prepare("SELECT projectId FROM project_specification WHERE projectId = 'project-1'").get()).toEqual({ projectId: 'project-1' })
  })

  it('retires legacy file JSON atomically so restarts cannot resurrect trashed or deleted files', () => {
    const database = createLegacyDatabase()
    database.exec(`
      INSERT INTO user VALUES ('user-1', 'Lotus', 'lotus@example.com', 0, NULL, 1, 1);
      INSERT INTO project VALUES ('project-1', 'user-1', 'Existing project', 'html', '{"keep.txt":"one","remove.txt":"two"}', 1, 1);
    `)

    migrateDatabase(database)
    database.prepare("UPDATE project_file SET deletedAt = 2 WHERE path = 'keep.txt'").run()
    database.prepare("DELETE FROM project_file WHERE path = 'remove.txt'").run()
    migrateDatabase(database)

    expect(database.prepare("SELECT files FROM project WHERE id = 'project-1'").get()).toEqual({ files: '{}' })
    expect(database.prepare("SELECT path, content, deletedAt FROM project_file WHERE projectId = 'project-1'").all()).toEqual([{ path: 'keep.txt', content: 'one', deletedAt: 2 }])
  })

  it('keeps colliding slash and backslash legacy keys as separate normalized records', () => {
    const database = createLegacyDatabase()
    database.exec(`
      INSERT INTO user VALUES ('user-1', 'Lotus', 'lotus@example.com', 0, NULL, 1, 1);
      INSERT INTO project VALUES ('project-1', 'user-1', 'Existing project', 'html', '{"src\\\\app.js":"backslash","src/app.js":"slash"}', 1, 1);
    `)

    migrateDatabase(database)

    const files = database.prepare("SELECT path, content, originalPath FROM project_file WHERE projectId = 'project-1' ORDER BY content").all()
    expect(files).toHaveLength(2)
    expect(files).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'backslash', originalPath: 'src\\app.js' }),
      expect.objectContaining({ content: 'slash', originalPath: 'src/app.js' }),
    ]))
    expect(new Set((files as Array<{ path: string }>).map((file) => file.path)).size).toBe(2)
  })
})
