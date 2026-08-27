import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL?.replace(/([?&])sslmode=require(?=&|$)/, '$1sslmode=verify-full')
if (!connectionString) throw new Error('DATABASE_URL is required.')

const pool = new pg.Pool({ connectionString, max: 1 })
const directory = path.join(process.cwd(), 'migrations', 'postgres')

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS lotus_migration (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const files = (await fs.readdir(directory)).filter(name => name.endsWith('.sql')).sort()
  for (const name of files) {
    const applied = await pool.query('SELECT 1 FROM lotus_migration WHERE name = $1', [name])
    if (applied.rowCount) continue
    const sql = await fs.readFile(path.join(directory, name), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO lotus_migration (name) VALUES ($1)', [name])
      await client.query('COMMIT')
      process.stdout.write(`Applied ${name}\n`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
} finally {
  await pool.end()
}
