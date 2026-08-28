import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decryptIntegrationConfig,
  encryptIntegrationConfig,
  createIntegrationSessionToken,
  parseIntegrationSessionToken,
  validateIntegrationInput,
} from '@/lib/integration-connections'

describe('integration connections', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'a-secure-test-secret-that-is-longer-than-32-characters'
  })

  afterEach(() => vi.unstubAllGlobals())

  it('encrypts provider credentials with authenticated encryption', () => {
    const config = { provider: 'github' as const, token: 'github_pat_secret-value' }
    const encrypted = encryptIntegrationConfig(config)
    expect(encrypted).not.toContain(config.token)
    expect(decryptIntegrationConfig(encrypted)).toEqual(config)
  })

  it('signs browser-scoped integration sessions and rejects tampering', () => {
    const userId = crypto.randomUUID()
    const token = createIntegrationSessionToken(userId)
    expect(parseIntegrationSessionToken(token)).toBe(userId)
    expect(parseIntegrationSessionToken(`${token}tampered`)).toBeNull()
  })

  it('verifies a GitHub token against the account API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ login: 'lotus-owner' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const validated = await validateIntegrationInput({ provider: 'github', credential: 'github_pat_valid-token' })
    expect(validated.result.accountLabel).toBe('lotus-owner')
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/user', expect.objectContaining({ redirect: 'error' }))
  })

  it('verifies Vercel and Supabase credentials against their management APIs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'usr_1', username: 'lotus' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'one', name: 'Lotus' }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(validateIntegrationInput({ provider: 'vercel', credential: 'vercel-valid-token' })).resolves.toMatchObject({ result: { accountLabel: 'lotus' } })
    await expect(validateIntegrationInput({ provider: 'supabase', credential: 'supabase-valid-token' })).resolves.toMatchObject({ result: { accountLabel: '1 Supabase project' } })
  })

  it('verifies a Firebase service account without persisting its OAuth access token', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const serviceAccount = {
      type: 'service_account',
      project_id: 'lotus-firebase',
      private_key_id: 'key-1',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      client_email: 'firebase-admin@lotus-firebase.iam.gserviceaccount.com',
      token_uri: 'https://oauth2.googleapis.com/token',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'temporary-google-access-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ projectId: 'lotus-firebase' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const validated = await validateIntegrationInput({ provider: 'firebase', credential: JSON.stringify(serviceAccount) })
    expect(validated.result.accountLabel).toBe('lotus-firebase')
    expect(JSON.stringify(validated.config)).not.toContain('temporary-google-access-token')
  })

  it('does not expose a rejected credential in the error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })))
    const credential = 'github_pat_do-not-repeat-this'
    await expect(validateIntegrationInput({ provider: 'github', credential })).rejects.not.toThrow(credential)
  })
})
