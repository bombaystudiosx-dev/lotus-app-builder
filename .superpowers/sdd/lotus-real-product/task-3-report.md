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

## Fix Round 1

### Resolved findings

- Reordered migration setup so project children are created or rebuilt only after the parent project table is valid. Existing `project_file` and `project_runtime` tables with a stale `project_legacy` foreign-key target are rebuilt safely before use.
- Added `PRAGMA foreign_key_check` to the migration transaction. Tests verify child foreign keys target `project`, allow post-upgrade file/runtime inserts, and cascade on project deletion.
- Stopped repeat legacy imports by atomically clearing the retired `project.files` JSON only after its normalized records are inserted. A version-3 upgrade preserves existing normalized records and retires only the old source, preventing trashed and permanently deleted files from returning after restart.
- Made colliding legacy slash/backslash paths deterministic and lossless: each source key receives its own normalized path and retains its exact `originalPath`.
- Archived projects are now unavailable to the builder. `runBuild` rejects them before any message insert or AI generation; tests assert no persistence or generation call.
- Added the missing per-file cap check to duplicate operations, including grandfathered oversized normalized records.

### Evidence

- RED: `pnpm exec vitest run lib/db/migrations.test.ts lib/project-files.test.ts` — 4 intended regressions failed before implementation.
- Focused GREEN: `pnpm exec vitest run app/actions/projects.test.ts lib/db/migrations.test.ts lib/project-files.test.ts` — 3 files, 15 tests passed.
- Full verification: `pnpm run verify` — typecheck, lint, 6 Vitest files / 35 tests, production build, and high-severity audit all passed; audit reported no known vulnerabilities.

### Fix Round 1 commits

- `8f6c385 test: reproduce Task 3 migration integrity gaps`
- `5861dd0 fix: harden Task 3 file migrations`

### Remaining concerns

- The migration lock is exercised by the production build's multi-worker startup and uses an immediate transaction. No separate timing-sensitive concurrency unit test was added because it would be flaky; foreign-key integrity and restart idempotence are covered deterministically.

## Fix Round 2

### Resolved index-rebuild regression

- Rebuild paths now explicitly drop named indexes before renaming `project`, `message`, or `project_file` tables. This prevents an index name from remaining tied to the renamed legacy table and makes the later canonical index creation deterministic.
- The existing post-rebuild index pass recreates all query indexes, including `project_file_active_path_idx` with its partial `WHERE deletedAt IS NULL` constraint.
- Added direct stale-foreign-key child-table coverage that rebuilds `message`, `project_file`, and `project_runtime`, then asserts no foreign-key violations plus both message indexes, the project-file query index, and the partial unique active-path index. Legacy-rebuild coverage also asserts these indexes.

### Exact verification outputs

- `pnpm exec vitest run lib/db/migrations.test.ts lib/project-files.test.ts app/actions/projects.test.ts`: **3 test files passed, 16 tests passed**.
- `pnpm run typecheck`: **passed**.
- `pnpm run lint`: **passed**.
- `pnpm run verify`: **passed** — typecheck and lint passed; Vitest reported **6 files / 36 tests passed**; Next production build completed; `pnpm audit --audit-level high` reported **No known vulnerabilities found**.

### Fix Round 2 commit

- `e1a25d2 fix: recreate indexes after SQLite table rebuilds`

## Fix Round 3

- Extended the direct legacy project-table rebuild test to assert both `project_user_updated_at_idx` and `project_user_status_updated_at_idx`, while retaining child/message index coverage.
- `pnpm exec vitest run lib/db/migrations.test.ts`: **1 file / 8 tests passed**.
- `pnpm run verify`: **passed** — typecheck, lint, **6 files / 36 tests**, production build, and high-severity audit; audit reported no known vulnerabilities.
