ALTER TABLE integration_connection DROP CONSTRAINT IF EXISTS integration_connection_provider_check;
ALTER TABLE integration_connection ADD CONSTRAINT integration_connection_provider_check
  CHECK (provider IN ('github', 'vercel', 'supabase', 'firebase', 'appstore', 'googleplay'));

CREATE TABLE IF NOT EXISTS mobile_deployment_config (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "projectId" text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  "appleBundleId" text NOT NULL DEFAULT '',
  "appleAppId" text NOT NULL DEFAULT '',
  "googlePackageName" text NOT NULL DEFAULT '',
  "googleTrack" text NOT NULL DEFAULT 'internal' CHECK ("googleTrack" IN ('internal', 'alpha', 'beta', 'production')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("userId", "projectId")
);

CREATE INDEX IF NOT EXISTS mobile_deployment_config_owner_project_idx
  ON mobile_deployment_config("userId", "projectId");
