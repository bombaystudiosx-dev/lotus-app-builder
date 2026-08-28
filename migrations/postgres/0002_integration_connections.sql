CREATE TABLE IF NOT EXISTS integration_connection (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('github', 'vercel', 'supabase', 'firebase')),
  "encryptedConfig" text NOT NULL,
  "accountLabel" text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error')),
  "lastVerifiedAt" timestamptz NOT NULL DEFAULT now(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", provider)
);

CREATE INDEX IF NOT EXISTS integration_connection_user_idx
  ON integration_connection("userId", provider);
