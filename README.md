# Lotus App Builder

Lotus is a local-first app-builder workspace. Authentication and project history are stored in SQLite; model access remains server-side and is never made available to the browser or generated previews.

## Local setup

```sh
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

Set `DATABASE_PATH` only when you need a database outside the default `data/lotus.db`. Keep all credential values in `.env.local`; do not put secrets in generated app content or prompts.

## Quality checks

```sh
pnpm run verify
```

This runs type-checking, linting, unit tests, the production build, and a high-severity dependency audit. The database migration is idempotent and runs explicitly when the database starts; use `pnpm run test` to exercise it against a fresh SQLite database.
