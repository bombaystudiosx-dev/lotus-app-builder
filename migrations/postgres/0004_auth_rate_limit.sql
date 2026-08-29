CREATE TABLE IF NOT EXISTS "rateLimit" (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_key_idx ON "rateLimit" (key);
