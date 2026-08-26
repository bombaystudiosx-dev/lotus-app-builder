import type Database from 'better-sqlite3'

export const GUEST_USER_ID = 'lotus-public-guest'

export function ensureGuestWorkspace(database: Database.Database) {
  const now = Date.now()
  database.prepare(`INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES (?, ?, ?, 1, ?, ?)`)
    .run(GUEST_USER_ID, 'Lotus Guest', 'guest@lotus.local', now, now)
  return GUEST_USER_ID
}
