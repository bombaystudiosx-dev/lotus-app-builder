CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Untitled',
  mode text NOT NULL DEFAULT 'html',
  files jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'trashed')),
  "archivedAt" timestamptz,
  "deletedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_file (
  id text PRIMARY KEY,
  "projectId" text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  path text NOT NULL,
  content text NOT NULL,
  encoding text NOT NULL DEFAULT 'utf-8' CHECK (encoding IN ('utf-8', 'utf-16le')),
  size integer NOT NULL CHECK (size >= 0),
  "originalPath" text,
  "deletedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_runtime (
  "projectId" text PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  runtime text NOT NULL DEFAULT 'static' CHECK (runtime IN ('static', 'react')),
  framework text NOT NULL DEFAULT 'static',
  "buildTool" text,
  "entryPath" text NOT NULL DEFAULT 'index.html',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_specification (
  "projectId" text PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  specification jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
  "userId" text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  "editorFontSize" integer NOT NULL DEFAULT 14,
  "autosaveInterval" integer NOT NULL DEFAULT 30,
  "defaultDevice" text NOT NULL DEFAULT 'phone' CHECK ("defaultDevice" IN ('phone', 'tablet', 'desktop')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message (
  id text PRIMARY KEY,
  "projectId" text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_user_id_idx ON account("userId");
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session("userId");
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
CREATE INDEX IF NOT EXISTS project_user_updated_at_idx ON project("userId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS project_user_status_updated_at_idx ON project("userId", status, "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS project_file_project_updated_at_idx ON project_file("projectId", "updatedAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS project_file_active_path_idx ON project_file("projectId", path) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS message_project_created_at_idx ON message("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS message_user_created_at_idx ON message("userId", "createdAt");
