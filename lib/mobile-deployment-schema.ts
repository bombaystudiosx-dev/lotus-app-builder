import { z } from 'zod'

export const mobileDeploymentInputSchema = z.object({
  projectId: z.string().uuid(),
  appleBundleId: z.string().trim().max(255).refine(value => value === '' || /^(?:[A-Za-z][A-Za-z0-9-]*\.)+[A-Za-z][A-Za-z0-9-]*$/.test(value), 'Enter a valid Apple bundle ID.'),
  appleAppId: z.string().trim().max(32).refine(value => value === '' || /^\d{6,32}$/.test(value), 'Enter the numeric App Store app ID.'),
  googlePackageName: z.string().trim().max(255).refine(value => value === '' || /^(?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/.test(value), 'Enter a valid Google Play package name.'),
  googleTrack: z.enum(['internal', 'alpha', 'beta', 'production']),
})

export type MobileDeploymentConfig = z.infer<typeof mobileDeploymentInputSchema>

export function emptyMobileDeploymentConfig(projectId: string): MobileDeploymentConfig {
  return { projectId, appleBundleId: '', appleAppId: '', googlePackageName: '', googleTrack: 'internal' }
}
