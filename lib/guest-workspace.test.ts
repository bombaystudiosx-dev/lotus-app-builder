import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDatabase } from '@/lib/db/migrations'
import { GUEST_USER_ID, ensureGuestWorkspace } from '@/lib/guest-workspace'

const databases: Database.Database[] = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))

describe('public guest workspace identity', () => {
  it('creates one stable owner and remains idempotent', () => {
    const database = new Database(':memory:')
    databases.push(database)
    migrateDatabase(database)

    expect(ensureGuestWorkspace(database)).toBe(GUEST_USER_ID)
    expect(ensureGuestWorkspace(database)).toBe(GUEST_USER_ID)
    expect(database.prepare('SELECT id, name, email FROM user').all()).toEqual([
      { id: GUEST_USER_ID, name: 'Lotus Guest', email: 'guest@lotus.local' },
    ])
  })
})
