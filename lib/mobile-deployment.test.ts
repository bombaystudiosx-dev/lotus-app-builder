import { describe, expect, it } from 'vitest'
import { mobileDeploymentInputSchema } from '@/lib/mobile-deployment-schema'

describe('mobile deployment configuration', () => {
  const projectId = 'a30007cf-d346-4760-882b-4d6e17766823'

  it('accepts store-native identifiers and a safe release track', () => {
    expect(mobileDeploymentInputSchema.parse({ projectId, appleBundleId: 'com.lotus.builder', appleAppId: '1234567890', googlePackageName: 'com.lotus.builder', googleTrack: 'internal' })).toMatchObject({ googleTrack: 'internal' })
  })

  it('rejects malformed identifiers and unsupported tracks', () => {
    expect(() => mobileDeploymentInputSchema.parse({ projectId, appleBundleId: 'bad bundle', appleAppId: 'abc', googlePackageName: 'Bad Package', googleTrack: 'instant' })).toThrow()
  })
})
