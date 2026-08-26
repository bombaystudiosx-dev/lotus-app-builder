import { beforeEach, describe, expect, it } from 'vitest'
import { aiProviderSchema, aiProviderStatus, decryptAiProviderConfig, defaultAiProviderConfig, encryptAiProviderConfig } from '@/lib/ai-provider'

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = 'test-secret-with-at-least-sixteen-characters'
})

describe('AI provider configuration', () => {
  it('encrypts provider keys at rest and restores valid settings', () => {
    const config = { provider: 'openai' as const, apiKey: 'sk-super-secret-key', model: 'gpt-4.1', baseURL: '' }
    const encrypted = encryptAiProviderConfig(config)

    expect(encrypted).not.toContain(config.apiKey)
    expect(decryptAiProviderConfig(encrypted)).toEqual(config)
    expect(aiProviderStatus(config)).toMatchObject({ configured: true, keyHint: '••••-key' })
  })

  it('rejects private or insecure custom endpoints', () => {
    for (const baseURL of ['http://api.example.com/v1', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://192.168.1.5/v1']) {
      expect(() => aiProviderSchema.parse({ provider: 'custom', apiKey: 'valid-secret-key', model: 'custom-model', baseURL })).toThrow('public HTTPS')
    }
  })

  it('falls back safely when an encrypted cookie is malformed', () => {
    expect(decryptAiProviderConfig('not-valid-ciphertext')).toEqual(defaultAiProviderConfig())
  })
})
