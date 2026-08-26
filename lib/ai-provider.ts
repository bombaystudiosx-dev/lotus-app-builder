import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'

export const AI_PROVIDER_COOKIE = 'lotus-ai-provider'

export const aiProviderSchema = z.object({
  provider: z.enum(['vercel', 'openai', 'anthropic', 'google', 'openrouter', 'custom']),
  apiKey: z.string().trim().max(512).default(''),
  model: z.string().trim().min(1).max(160),
  baseURL: z.string().trim().max(500).default(''),
}).superRefine((value, context) => {
  if (value.provider !== 'vercel' && value.apiKey.length < 8) context.addIssue({ code: 'custom', path: ['apiKey'], message: 'Enter a valid API key.' })
  if (value.provider === 'custom') {
    try {
      const url = new URL(value.baseURL)
      const host = url.hostname.toLowerCase()
      if (url.protocol !== 'https:' || host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('unsafe')
    } catch {
      context.addIssue({ code: 'custom', path: ['baseURL'], message: 'Enter a public HTTPS API base URL.' })
    }
  }
})

export type AiProviderConfig = z.infer<typeof aiProviderSchema>
export type AiProviderStatus = Omit<AiProviderConfig, 'apiKey'> & { configured: boolean; keyHint: string }

const DEFAULT_MODELS: Record<AiProviderConfig['provider'], string> = {
  vercel: 'anthropic/claude-sonnet-4.5',
  openai: 'gpt-4.1',
  anthropic: 'claude-sonnet-4-5',
  google: 'gemini-2.5-pro',
  openrouter: 'anthropic/claude-sonnet-4.5',
  custom: 'model-name',
}

export function defaultAiProviderConfig(provider: AiProviderConfig['provider'] = 'vercel'): AiProviderConfig {
  return { provider, apiKey: '', model: DEFAULT_MODELS[provider], baseURL: provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : '' }
}

function encryptionKey() {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET ?? process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 16) throw new Error('Server key encryption is not configured.')
  return createHash('sha256').update(secret).digest()
}

export function encryptAiProviderConfig(input: AiProviderConfig) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(input), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}

export function decryptAiProviderConfig(value?: string): AiProviderConfig {
  if (!value) return defaultAiProviderConfig()
  try {
    const payload = Buffer.from(value, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), payload.subarray(0, 12))
    decipher.setAuthTag(payload.subarray(12, 28))
    return aiProviderSchema.parse(JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8')))
  } catch {
    return defaultAiProviderConfig()
  }
}

export function aiProviderStatus(config: AiProviderConfig): AiProviderStatus {
  return {
    provider: config.provider,
    model: config.model,
    baseURL: config.baseURL,
    configured: config.provider === 'vercel' || config.apiKey.length >= 8,
    keyHint: config.apiKey ? `••••${config.apiKey.slice(-4)}` : '',
  }
}

export function generationModel(config: AiProviderConfig, gatewayModel: string) {
  if (config.provider === 'vercel') return gatewayModel
  if (config.provider === 'openai') return createOpenAI({ apiKey: config.apiKey })(config.model)
  if (config.provider === 'anthropic') return createAnthropic({ apiKey: config.apiKey })(config.model)
  if (config.provider === 'google') return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model)
  const compatible = createOpenAICompatible({
    name: config.provider === 'openrouter' ? 'openrouter' : 'custom',
    apiKey: config.apiKey,
    baseURL: config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : config.baseURL,
  })
  return compatible.chatModel(config.model)
}
