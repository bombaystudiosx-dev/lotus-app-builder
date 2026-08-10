import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import * as schema from './schema'
import { migrateDatabase } from './migrations'

const databasePath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'lotus.db')
fs.mkdirSync(path.dirname(databasePath), { recursive: true })

const sqlite = new Database(databasePath)
sqlite.pragma('journal_mode = WAL')
migrateDatabase(sqlite)

export { sqlite }
export const db = drizzle(sqlite, { schema })
