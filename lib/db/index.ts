import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import * as schema from './schema'

const databasePath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'lotus.db')
fs.mkdirSync(path.dirname(databasePath), { recursive: true })

const sqlite = new Database(databasePath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER);
  CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'Untitled', mode TEXT NOT NULL DEFAULT 'html', files TEXT NOT NULL DEFAULT '{}', createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, userId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL);
`)

export { sqlite }
export const db = drizzle(sqlite, { schema })
