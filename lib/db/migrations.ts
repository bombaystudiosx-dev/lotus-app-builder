import type Database from 'better-sqlite3'
import { createProjectSpecification } from '@/lib/project-specification'

const SCHEMA_VERSION = 6

const CREATE_BASE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS rateLimit (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL,
    lastRequest INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Untitled', mode TEXT NOT NULL DEFAULT 'html',
    files TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', archivedAt INTEGER, deletedAt INTEGER,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_settings (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'system', editorFontSize INTEGER NOT NULL DEFAULT 14,
    autosaveInterval INTEGER NOT NULL DEFAULT 30, defaultDevice TEXT NOT NULL DEFAULT 'phone',
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  );
`

const CREATE_PROJECT_FILE_TABLE_SQL = `
  CREATE TABLE project_file (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    path TEXT NOT NULL, content TEXT NOT NULL, encoding TEXT NOT NULL DEFAULT 'utf-8', size INTEGER NOT NULL,
    originalPath TEXT, deletedAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  );
`

const CREATE_PROJECT_RUNTIME_TABLE_SQL = `
  CREATE TABLE project_runtime (
    projectId TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    runtime TEXT NOT NULL DEFAULT 'static', framework TEXT NOT NULL DEFAULT 'static', buildTool TEXT,
    entryPath TEXT NOT NULL DEFAULT 'index.html', metadata TEXT NOT NULL DEFAULT '{}', createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  );
`

const CREATE_PROJECT_SPECIFICATION_TABLE_SQL = `
  CREATE TABLE project_specification (
    projectId TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    specification TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  );
`

const CREATE_MESSAGE_TABLE_SQL = `
  CREATE TABLE message (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
`

const CREATE_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(userId);
  CREATE INDEX IF NOT EXISTS session_user_id_idx ON session(userId);
  CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
  CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_key_idx ON rateLimit(key);
  CREATE INDEX IF NOT EXISTS project_user_updated_at_idx ON project(userId, updatedAt);
  CREATE INDEX IF NOT EXISTS project_user_status_updated_at_idx ON project(userId, status, updatedAt);
  CREATE INDEX IF NOT EXISTS project_file_project_updated_at_idx ON project_file(projectId, updatedAt);
  CREATE UNIQUE INDEX IF NOT EXISTS project_file_active_path_idx ON project_file(projectId, path) WHERE deletedAt IS NULL;
  CREATE INDEX IF NOT EXISTS message_project_created_at_idx ON message(projectId, createdAt);
  CREATE INDEX IF NOT EXISTS message_user_created_at_idx ON message(userId, createdAt);
`

function tableExists(sqlite: Database.Database, table: string) {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  )
}

function columnExists(sqlite: Database.Database, table: string, column: string) {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((entry) => entry.name === column)
}

function upgradeProjectLifecycleColumns(sqlite: Database.Database) {
  if (!tableExists(sqlite, 'project')) return
  if (!columnExists(sqlite, 'project', 'status')) {
    sqlite.exec("ALTER TABLE project ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
  }
  if (!columnExists(sqlite, 'project', 'archivedAt')) sqlite.exec('ALTER TABLE project ADD COLUMN archivedAt INTEGER')
  if (!columnExists(sqlite, 'project', 'deletedAt')) sqlite.exec('ALTER TABLE project ADD COLUMN deletedAt INTEGER')
}

function hasForeignKey(sqlite: Database.Database, table: string, from: string, target: string) {
  const foreignKeys = sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ from: string; table: string }>
  return foreignKeys
    .some((foreignKey) => foreignKey.from === from && foreignKey.table === target)
}

function assertNoOrphans(sqlite: Database.Database, table: string, column: string, parent: string) {
  const orphan = sqlite
    .prepare(`SELECT ${column} AS id FROM ${table} WHERE ${column} NOT IN (SELECT id FROM ${parent}) LIMIT 1`)
    .get() as { id?: string } | undefined

  if (orphan) {
    throw new Error(`Cannot safely add a foreign key: ${table}.${column} references missing ${parent}.${orphan.id}.`)
  }
}

function dropIndexes(sqlite: Database.Database, names: string[]) {
  for (const name of names) sqlite.exec(`DROP INDEX IF EXISTS ${name}`)
}

function rebuildProjectTable(sqlite: Database.Database) {
  if (!tableExists(sqlite, 'project') || hasForeignKey(sqlite, 'project', 'userId', 'user')) return
  assertNoOrphans(sqlite, 'project', 'userId', 'user')
  const legacyStatus = columnExists(sqlite, 'project', 'status') ? "COALESCE(status, 'active')" : "'active'"
  const legacyArchivedAt = columnExists(sqlite, 'project', 'archivedAt') ? 'archivedAt' : 'NULL'
  const legacyDeletedAt = columnExists(sqlite, 'project', 'deletedAt') ? 'deletedAt' : 'NULL'
  dropIndexes(sqlite, ['project_user_updated_at_idx', 'project_user_status_updated_at_idx'])
  sqlite.exec(`
    ALTER TABLE project RENAME TO project_legacy;
    CREATE TABLE project (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Untitled', mode TEXT NOT NULL DEFAULT 'html',
      files TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', archivedAt INTEGER, deletedAt INTEGER,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    );
    INSERT INTO project (id, userId, name, mode, files, status, archivedAt, deletedAt, createdAt, updatedAt)
      SELECT id, userId, name, mode, files,
        ${legacyStatus}, ${legacyArchivedAt}, ${legacyDeletedAt},
        createdAt, updatedAt FROM project_legacy;
    DROP TABLE project_legacy;
  `)
}

function rebuildMessageTable(sqlite: Database.Database) {
  if (!tableExists(sqlite, 'message')) {
    sqlite.exec(CREATE_MESSAGE_TABLE_SQL)
    return
  }
  if (hasForeignKey(sqlite, 'message', 'projectId', 'project') && hasForeignKey(sqlite, 'message', 'userId', 'user')) return
  assertNoOrphans(sqlite, 'message', 'projectId', 'project')
  assertNoOrphans(sqlite, 'message', 'userId', 'user')
  dropIndexes(sqlite, ['message_project_created_at_idx', 'message_user_created_at_idx'])
  sqlite.exec(`
    ALTER TABLE message RENAME TO message_legacy;
    ${CREATE_MESSAGE_TABLE_SQL}
    INSERT INTO message (id, projectId, userId, role, content, createdAt)
      SELECT id, projectId, userId, role, content, createdAt FROM message_legacy;
    DROP TABLE message_legacy;
  `)
}

function rebuildProjectFileTable(sqlite: Database.Database) {
  if (!tableExists(sqlite, 'project_file')) {
    sqlite.exec(CREATE_PROJECT_FILE_TABLE_SQL)
    return
  }
  if (hasForeignKey(sqlite, 'project_file', 'projectId', 'project')) return
  assertNoOrphans(sqlite, 'project_file', 'projectId', 'project')
  const originalPath = columnExists(sqlite, 'project_file', 'originalPath') ? 'originalPath' : 'NULL'
  const deletedAt = columnExists(sqlite, 'project_file', 'deletedAt') ? 'deletedAt' : 'NULL'
  dropIndexes(sqlite, ['project_file_project_updated_at_idx', 'project_file_active_path_idx'])
  sqlite.exec(`
    ALTER TABLE project_file RENAME TO project_file_legacy;
    ${CREATE_PROJECT_FILE_TABLE_SQL}
    INSERT INTO project_file (id, projectId, path, content, encoding, size, originalPath, deletedAt, createdAt, updatedAt)
      SELECT id, projectId, path, content, encoding, size, ${originalPath}, ${deletedAt}, createdAt, updatedAt FROM project_file_legacy;
    DROP TABLE project_file_legacy;
  `)
}

function rebuildProjectRuntimeTable(sqlite: Database.Database) {
  if (!tableExists(sqlite, 'project_runtime')) {
    sqlite.exec(CREATE_PROJECT_RUNTIME_TABLE_SQL)
    return
  }
  if (hasForeignKey(sqlite, 'project_runtime', 'projectId', 'project')) return
  assertNoOrphans(sqlite, 'project_runtime', 'projectId', 'project')
  sqlite.exec(`
    ALTER TABLE project_runtime RENAME TO project_runtime_legacy;
    ${CREATE_PROJECT_RUNTIME_TABLE_SQL}
    INSERT INTO project_runtime (projectId, runtime, framework, buildTool, entryPath, metadata, createdAt, updatedAt)
      SELECT projectId, runtime, framework, buildTool, entryPath, metadata, createdAt, updatedAt FROM project_runtime_legacy;
    DROP TABLE project_runtime_legacy;
  `)
}

function rebuildProjectSpecificationTable(sqlite: Database.Database) {
  if (!tableExists(sqlite, 'project_specification')) {
    sqlite.exec(CREATE_PROJECT_SPECIFICATION_TABLE_SQL)
    return
  }
  if (hasForeignKey(sqlite, 'project_specification', 'projectId', 'project')) return
  assertNoOrphans(sqlite, 'project_specification', 'projectId', 'project')
  sqlite.exec(`
    ALTER TABLE project_specification RENAME TO project_specification_legacy;
    ${CREATE_PROJECT_SPECIFICATION_TABLE_SQL}
    INSERT INTO project_specification (projectId, specification, createdAt, updatedAt)
      SELECT projectId, specification, createdAt, updatedAt FROM project_specification_legacy;
    DROP TABLE project_specification_legacy;
  `)
}

function backfillProjectSpecifications(sqlite: Database.Database) {
  const projects = sqlite.prepare(`SELECT p.id, p.name, p.createdAt, p.updatedAt
    FROM project p LEFT JOIN project_specification s ON s.projectId = p.id
    WHERE s.projectId IS NULL`).all() as Array<{ id: string; name: string; createdAt: number; updatedAt: number }>
  const insert = sqlite.prepare(`INSERT INTO project_specification (projectId, specification, createdAt, updatedAt)
    VALUES (?, ?, ?, ?)`)
  for (const project of projects) {
    const name = project.name.trim().replace(/\s+/g, ' ').slice(0, 100) || 'Untitled project'
    const specification = createProjectSpecification({
      name,
      prompt: `Build ${name}`,
      targets: ['web'],
    })
    insert.run(project.id, JSON.stringify(specification), project.createdAt, project.updatedAt)
  }
}

function safeLegacyPath(value: string, ordinal: number) {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/')
  const unsafe = !normalized || normalized.length > 240 || segments.some((part) => !part || part === '.' || part === '..' || /[\0<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))
  if (!unsafe) return normalized
  return `legacy/file-${ordinal}-${Buffer.from(value).toString('base64url').slice(0, 80) || 'unnamed'}.txt`
}

function uniqueLegacyPath(path: string, originalPath: string, ordinal: number, occupied: Set<string>) {
  if (!occupied.has(path)) {
    occupied.add(path)
    return path
  }
  const token = Buffer.from(originalPath).toString('base64url').slice(0, 80) || 'unnamed'
  let attempt = 0
  let candidate = `legacy/collision-${ordinal}-${token}.txt`
  while (occupied.has(candidate)) {
    attempt += 1
    candidate = `legacy/collision-${ordinal}-${token}-${attempt}.txt`
  }
  occupied.add(candidate)
  return candidate
}

function migrateLegacyProjectFiles(sqlite: Database.Database, priorVersion: number) {
  if (!tableExists(sqlite, 'project_file') || !columnExists(sqlite, 'project', 'files')) return
  const projects = sqlite.prepare('SELECT id, files, createdAt, updatedAt FROM project').all() as Array<{ id: string; files: string; createdAt: number; updatedAt: number }>
  if (priorVersion >= 3) {
    sqlite.prepare("UPDATE project SET files = '{}' WHERE files != '{}'").run()
    return
  }
  const insert = sqlite.prepare(`INSERT INTO project_file (id, projectId, path, content, encoding, size, originalPath, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 'utf-8', ?, ?, ?, ?)`)
  const runtime = sqlite.prepare(`INSERT OR IGNORE INTO project_runtime (projectId, runtime, framework, buildTool, entryPath, metadata, createdAt, updatedAt)
    VALUES (?, 'static', 'static', NULL, 'index.html', '{}', ?, ?)`)
  for (const row of projects) {
    runtime.run(row.id, row.createdAt, row.updatedAt)
    let legacy: unknown = {}
    try { legacy = JSON.parse(row.files || '{}') } catch { legacy = { 'legacy/files.json': row.files } }
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) legacy = { 'legacy/files.json': JSON.stringify(legacy) }
    let ordinal = 0
    const occupied = new Set<string>()
    for (const [originalPath, rawContent] of Object.entries(legacy as Record<string, unknown>)) {
      ordinal += 1
      const path = uniqueLegacyPath(safeLegacyPath(originalPath, ordinal), originalPath, ordinal, occupied)
      const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent)
      insert.run(crypto.randomUUID(), row.id, path, content, Buffer.byteLength(content, 'utf8'), originalPath, row.createdAt, row.updatedAt)
    }
    sqlite.prepare("UPDATE project SET files = '{}' WHERE id = ?").run(row.id)
  }
}

function assertForeignKeyIntegrity(sqlite: Database.Database) {
  const violations = sqlite.prepare('PRAGMA foreign_key_check').all()
  if (violations.length) throw new Error('Database migration left foreign key violations.')
}

/** Initializes or safely upgrades the local SQLite schema. Safe to call on every startup. */
export function migrateDatabase(sqlite: Database.Database) {
  const priorVersion = Number(sqlite.pragma('user_version', { simple: true }))
  sqlite.pragma('foreign_keys = OFF')
  try {
    const migrate = sqlite.transaction(() => {
      sqlite.exec(CREATE_BASE_TABLES_SQL)
      rebuildProjectTable(sqlite)
      upgradeProjectLifecycleColumns(sqlite)
      rebuildMessageTable(sqlite)
      rebuildProjectFileTable(sqlite)
      rebuildProjectRuntimeTable(sqlite)
      rebuildProjectSpecificationTable(sqlite)
      backfillProjectSpecifications(sqlite)
      migrateLegacyProjectFiles(sqlite, priorVersion)
      sqlite.exec(CREATE_INDEXES_SQL)
      assertForeignKeyIntegrity(sqlite)
      sqlite.pragma(`user_version = ${SCHEMA_VERSION}`)
    })
    migrate.immediate()
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
}

export { SCHEMA_VERSION }
