import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const timestamp = (name: string) => integer(name, { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())

export const user = sqliteTable('user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false), image: text('image'),
  createdAt: timestamp('createdAt'), updatedAt: timestamp('updatedAt'),
})
export const session = sqliteTable('session', {
  id: text('id').primaryKey(), expiresAt: timestamp('expiresAt'), token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt'), updatedAt: timestamp('updatedAt'), ipAddress: text('ipAddress'),
  userAgent: text('userAgent'), userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
})
export const account = sqliteTable('account', {
  id: text('id').primaryKey(), accountId: text('accountId').notNull(), providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'), refreshToken: text('refreshToken'), idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }), scope: text('scope'),
  password: text('password'), createdAt: timestamp('createdAt'), updatedAt: timestamp('updatedAt'),
})
export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expiresAt'), createdAt: integer('createdAt', { mode: 'timestamp' }), updatedAt: integer('updatedAt', { mode: 'timestamp' }),
})
export const project = sqliteTable('project', {
  id: text('id').primaryKey(), userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }), name: text('name').notNull().default('Untitled'),
  mode: text('mode').notNull().default('html'), files: text('files', { mode: 'json' }).$type<Record<string, string>>().notNull().default({}),
  status: text('status', { enum: ['active', 'archived', 'trashed'] }).notNull().default('active'),
  archivedAt: integer('archivedAt', { mode: 'timestamp' }), deletedAt: integer('deletedAt', { mode: 'timestamp' }),
  createdAt: timestamp('createdAt'), updatedAt: timestamp('updatedAt'),
}, (table) => [index('project_user_updated_at_idx').on(table.userId, table.updatedAt)])
export const userSettings = sqliteTable('user_settings', {
  userId: text('userId').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  theme: text('theme', { enum: ['system', 'light', 'dark'] }).notNull().default('system'),
  editorFontSize: integer('editorFontSize').notNull().default(14),
  autosaveInterval: integer('autosaveInterval').notNull().default(30),
  defaultDevice: text('defaultDevice', { enum: ['phone', 'tablet', 'desktop'] }).notNull().default('phone'),
  createdAt: timestamp('createdAt'), updatedAt: timestamp('updatedAt'),
})
export const message = sqliteTable('message', {
  id: text('id').primaryKey(), projectId: text('projectId').notNull().references(() => project.id, { onDelete: 'cascade' }), userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), content: text('content').notNull(), createdAt: timestamp('createdAt'),
}, (table) => [
  index('message_project_created_at_idx').on(table.projectId, table.createdAt),
  index('message_user_created_at_idx').on(table.userId, table.createdAt),
])

export type Project = typeof project.$inferSelect
export type Message = typeof message.$inferSelect
export type UserSettings = typeof userSettings.$inferSelect
export type ProjectFiles = Record<string, string>
