# Lotus Task 3 Report: Normalized Project File System

## Delivered

- Added normalized `project_file` records with project foreign-key ownership, path, text content, encoding, byte size, timestamps, original legacy path, and soft-delete timestamp.
- Added `project_runtime` records. New projects start in local static mode with `index.html`; fields retain framework, build tool, and metadata capacity for a future React/Vite runtime without any remote dependency.
- Added ownership-scoped, SQLite-transactional file operations: create, rename/move, duplicate, update, trash, restore, permanent delete, file listing, and targeted reads.
- Enforced safe forward-slash-only relative paths, traversal rejection, Windows reserved-name rejection, active-path uniqueness, UTF-8/UTF-16LE text encodings, a 1 MiB file cap, and a 5 MiB active-project cap.
- New blank projects receive only a minimal static HTML, CSS, and JavaScript starter.
- Migrated legacy `project.files` JSON into normalized records and created a static runtime record for every existing project. Unsafe legacy paths retain their exact original value in `originalPath` and are safely namespaced.
- Updated the workspace read and AI build persistence paths to use normalized records rather than the deprecated JSON blob.
- Changed startup migration locking to `BEGIN IMMEDIATE` semantics after production build concurrency exposed a SQLite snapshot-lock race.

## TDD evidence

1. RED checkpoint: `pnpm exec vitest run lib/db/migrations.test.ts lib/project-files.test.ts` failed as expected because normalized tables and file methods did not exist.
2. GREEN checkpoint: `pnpm exec vitest run lib/db/migrations.test.ts lib/project-files.test.ts lib/projects.test.ts` passed: 3 files, 19 tests.
3. Full verification: `pnpm run verify` passed:
   - TypeScript: pass
   - ESLint: pass
   - Vitest: 5 files, 29 tests passed
   - Next production build: pass
   - `pnpm audit --audit-level high`: no known vulnerabilities

## Commits

- `86c1ead test: add normalized project file reproducer`
- `c089342 feat: normalize Lotus project files`
- `8c4e7b0 fix: serialize SQLite migrations at startup`

## Self-review

- Confirmed mutations join through the owning project before reads or writes and use transactions for quota/path checks plus mutations.
- Confirmed restore cannot overwrite an active path and failed quota creation leaves no partial file.
- Confirmed legacy migration test retains nested file content and static runtime configuration.
- Confirmed `git diff --check` passes.
