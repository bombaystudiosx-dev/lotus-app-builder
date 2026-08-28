import { postgresPool, row } from '@/lib/db/postgres'
import { emptyMobileDeploymentConfig, mobileDeploymentInputSchema, type MobileDeploymentConfig } from '@/lib/mobile-deployment-schema'
import { z } from 'zod'
export type { MobileDeploymentConfig } from '@/lib/mobile-deployment-schema'

export async function getMobileDeploymentConfig(userId: string, projectId: string) {
  const safeProjectId = z.string().uuid().parse(projectId)
  return (await row<MobileDeploymentConfig>(postgresPool, `SELECT "projectId", "appleBundleId", "appleAppId", "googlePackageName", "googleTrack"
    FROM mobile_deployment_config WHERE "userId" = $1 AND "projectId" = $2`, [userId, safeProjectId])) ?? emptyMobileDeploymentConfig(safeProjectId)
}

export async function saveMobileDeploymentConfig(userId: string, input: unknown) {
  const config = mobileDeploymentInputSchema.parse(input)
  await postgresPool.query(`INSERT INTO mobile_deployment_config
    (id, "userId", "projectId", "appleBundleId", "appleAppId", "googlePackageName", "googleTrack")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT ("userId", "projectId") DO UPDATE SET "appleBundleId" = EXCLUDED."appleBundleId",
      "appleAppId" = EXCLUDED."appleAppId", "googlePackageName" = EXCLUDED."googlePackageName",
      "googleTrack" = EXCLUDED."googleTrack", "updatedAt" = now()`,
  [crypto.randomUUID(), userId, config.projectId, config.appleBundleId, config.appleAppId, config.googlePackageName, config.googleTrack])
  return config
}
