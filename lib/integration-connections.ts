import { createCipheriv, createDecipheriv, createHash, createHmac, createSign, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { postgresPool, row, rows } from '@/lib/db/postgres'

export const integrationProviderSchema = z.enum(['github', 'vercel', 'supabase', 'firebase'])
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>

export const integrationConnectionInputSchema = z.object({
  provider: integrationProviderSchema,
  credential: z.string().trim().min(8).max(12_000),
})

const firebaseServiceAccountSchema = z.object({
  type: z.literal('service_account'),
  project_id: z.string().min(1).max(200),
  private_key_id: z.string().min(1).max(300).optional(),
  private_key: z.string().min(100).max(8_000),
  client_email: z.string().email().max(320),
  token_uri: z.literal('https://oauth2.googleapis.com/token').default('https://oauth2.googleapis.com/token'),
}).passthrough()

type StoredConfig =
  | { provider: 'github' | 'vercel' | 'supabase'; token: string }
  | { provider: 'firebase'; serviceAccount: z.infer<typeof firebaseServiceAccountSchema> }

export interface IntegrationConnectionStatus {
  provider: IntegrationProvider
  connected: boolean
  accountLabel: string
  lastVerifiedAt: string | null
  status: 'connected' | 'error' | 'disconnected'
}

interface ValidationResult { accountLabel: string; metadata: Record<string, string> }

function encryptionKey() {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET ?? process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32) throw new Error('Integration encryption is not configured.')
  return createHash('sha256').update(secret).digest()
}

export function createIntegrationSessionToken(userId: string) {
  const signature = createHmac('sha256', encryptionKey()).update(userId).digest('base64url')
  return `${userId}.${signature}`
}

export function parseIntegrationSessionToken(token: string | undefined) {
  if (!token) return null
  const separator = token.lastIndexOf('.')
  if (separator < 1) return null
  const userId = token.slice(0, separator)
  const supplied = Buffer.from(token.slice(separator + 1), 'base64url')
  if (!z.string().uuid().safeParse(userId).success) return null
  const expected = createHmac('sha256', encryptionKey()).update(userId).digest()
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? userId : null
}

export function encryptIntegrationConfig(input: StoredConfig) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(input), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}

export function decryptIntegrationConfig(value: string): StoredConfig {
  const payload = Buffer.from(value, 'base64url')
  if (payload.length < 29) throw new Error('Stored integration credential is invalid.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), payload.subarray(0, 12))
  decipher.setAuthTag(payload.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8')) as StoredConfig
}

async function responseJson(response: Response) {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > 131_072) throw new Error('Provider returned an oversized response.')
  const text = await response.text()
  if (text.length > 131_072) throw new Error('Provider returned an oversized response.')
  try { return JSON.parse(text) as Record<string, unknown> } catch { throw new Error('Provider returned an invalid response.') }
}

async function providerFetch(url: string, init: RequestInit) {
  return fetch(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) })
}

async function validateTokenProvider(provider: 'github' | 'vercel' | 'supabase', token: string): Promise<ValidationResult> {
  const endpoints = {
    github: 'https://api.github.com/user',
    vercel: 'https://api.vercel.com/v2/user',
    supabase: 'https://api.supabase.com/v1/projects',
  }
  const response = await providerFetch(endpoints[provider], {
    headers: provider === 'github'
      ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
      : { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`${provider} rejected that credential.`)
  const data = await responseJson(response)
  if (provider === 'github') {
    const login = z.string().min(1).max(100).parse(data.login)
    return { accountLabel: login, metadata: { login } }
  }
  if (provider === 'vercel') {
    const user = z.object({ username: z.string().optional(), email: z.string().optional(), id: z.string() }).parse(data.user)
    const label = user.username || user.email || user.id
    return { accountLabel: label, metadata: { userId: user.id } }
  }
  const projects = z.array(z.object({ id: z.string(), name: z.string() })).parse(data)
  return { accountLabel: `${projects.length} Supabase project${projects.length === 1 ? '' : 's'}`, metadata: { projectCount: String(projects.length) } }
}

function base64url(input: string | Buffer) { return Buffer.from(input).toString('base64url') }

async function validateFirebase(credential: string): Promise<{ result: ValidationResult; config: StoredConfig }> {
  let decoded: unknown
  try { decoded = JSON.parse(credential) } catch { throw new Error('Firebase requires a valid service-account JSON file.') }
  const serviceAccount = firebaseServiceAccountSchema.parse(decoded)
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: serviceAccount.private_key_id }))
  const claims = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: serviceAccount.token_uri,
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claims}`
  let signature: string
  try { signature = createSign('RSA-SHA256').update(unsigned).end().sign(serviceAccount.private_key).toString('base64url') } catch { throw new Error('Firebase private key is invalid.') }
  const response = await providerFetch(serviceAccount.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  if (!response.ok) throw new Error('Firebase rejected that service account.')
  const token = z.object({ access_token: z.string().min(20) }).parse(await responseJson(response)).access_token
  const projectResponse = await providerFetch(`https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(serviceAccount.project_id)}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!projectResponse.ok && projectResponse.status !== 403 && projectResponse.status !== 404) throw new Error('Firebase project validation failed.')
  return {
    result: { accountLabel: serviceAccount.project_id, metadata: { projectId: serviceAccount.project_id, clientEmail: serviceAccount.client_email } },
    config: { provider: 'firebase', serviceAccount },
  }
}

export async function validateIntegrationInput(input: unknown) {
  const parsed = integrationConnectionInputSchema.parse(input)
  if (parsed.provider === 'firebase') return validateFirebase(parsed.credential)
  const result = await validateTokenProvider(parsed.provider, parsed.credential)
  return { result, config: { provider: parsed.provider, token: parsed.credential } as StoredConfig }
}

export async function listIntegrationStatuses(userId: string): Promise<IntegrationConnectionStatus[]> {
  const connected = await rows<{ provider: IntegrationProvider; accountLabel: string; status: 'connected' | 'error'; lastVerifiedAt: Date }>(postgresPool,
    'SELECT provider, "accountLabel", status, "lastVerifiedAt" FROM integration_connection WHERE "userId" = $1', [userId])
  const map = new Map(connected.map(item => [item.provider, item]))
  return integrationProviderSchema.options.map(provider => {
    const item = map.get(provider)
    return item ? { provider, connected: item.status === 'connected', accountLabel: item.accountLabel, status: item.status, lastVerifiedAt: item.lastVerifiedAt.toISOString() }
      : { provider, connected: false, accountLabel: '', status: 'disconnected', lastVerifiedAt: null }
  })
}

export async function saveIntegrationConnection(userId: string, input: unknown) {
  const { result, config } = await validateIntegrationInput(input)
  const encrypted = encryptIntegrationConfig(config)
  await postgresPool.query(`INSERT INTO integration_connection (id, "userId", provider, "encryptedConfig", "accountLabel", metadata)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT ("userId", provider) DO UPDATE SET "encryptedConfig" = EXCLUDED."encryptedConfig", "accountLabel" = EXCLUDED."accountLabel",
      metadata = EXCLUDED.metadata, status = 'connected', "lastVerifiedAt" = now(), "updatedAt" = now()`,
  [crypto.randomUUID(), userId, config.provider, encrypted, result.accountLabel, result.metadata])
  return (await listIntegrationStatuses(userId)).find(item => item.provider === config.provider)!
}

export async function disconnectIntegration(userId: string, provider: unknown) {
  const safeProvider = integrationProviderSchema.parse(provider)
  await postgresPool.query('DELETE FROM integration_connection WHERE "userId" = $1 AND provider = $2', [userId, safeProvider])
  return { provider: safeProvider, connected: false, accountLabel: '', status: 'disconnected', lastVerifiedAt: null } satisfies IntegrationConnectionStatus
}

export async function getStoredIntegration(userId: string, provider: IntegrationProvider) {
  const stored = await row<{ encryptedConfig: string }>(postgresPool, 'SELECT "encryptedConfig" FROM integration_connection WHERE "userId" = $1 AND provider = $2', [userId, provider])
  return stored ? decryptIntegrationConfig(stored.encryptedConfig) : null
}
