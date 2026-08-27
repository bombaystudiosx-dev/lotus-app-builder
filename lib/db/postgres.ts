import { Pool, type PoolClient, type QueryResultRow } from 'pg'

declare global {
  var lotusPostgresPool: Pool | undefined
}

export const postgresPool = globalThis.lotusPostgresPool ?? new Pool({
  connectionString: process.env.DATABASE_URL?.replace(/([?&])sslmode=require(?=&|$)/, '$1sslmode=verify-full'),
  max: 5,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 10_000,
})

if (process.env.NODE_ENV !== 'production') globalThis.lotusPostgresPool = postgresPool

export type PostgresExecutor = Pick<Pool | PoolClient, 'query'>

export async function rows<T extends QueryResultRow>(executor: PostgresExecutor, text: string, values: unknown[] = []) {
  return (await executor.query<T>(text, values)).rows
}

export async function row<T extends QueryResultRow>(executor: PostgresExecutor, text: string, values: unknown[] = []) {
  return (await rows<T>(executor, text, values))[0]
}

export async function postgresTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await postgresPool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
