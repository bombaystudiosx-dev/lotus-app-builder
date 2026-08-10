# Lotus Task 2 report: project dashboard and lifecycle

## Outcome

Task 2 is implemented on `codex/lotus-real-product`. The authenticated root route is now a project dashboard, and the builder is scoped to `/projects/[projectId]` with a server-side ownership check.

## User journeys and implementation

- As an authenticated user, I can create a blank local project from the dashboard and enter its builder route.
- As a project owner, I can rename, duplicate, archive, restore, move to trash, restore from trash, and permanently delete a project. State is persisted in SQLite and the dashboard is revalidated after every operation.
- As a different user, I cannot read or mutate a project I do not own. Lookups are scoped by both `project.id` and `project.userId`; cross-user operations return the same not-found lifecycle error.
- As a user with no projects, I see first-run onboarding and a working first-project button. Empty active/archive/trash sections, route loading, and the existing application failure UI cover the remaining dashboard states.
- As a user, I can keep the account menu/sign-out behavior and save theme, editor font size, autosave interval, and default device preferences to my own `user_settings` row.

## Files changed

- `app/page.tsx` — authenticated project dashboard route.
- `app/projects/[projectId]/page.tsx` — authenticated, owned builder route and persisted builder preferences.
- `app/actions/projects.ts` — authenticated lifecycle/settings server actions and owned workspace lookup.
- `components/lotus/project-dashboard.tsx` — accessible dashboard cards, lifecycle controls, settings, account menu, onboarding, error state.
- `components/lotus/builder.tsx` — applies saved default device and editor font size.
- `app/globals.css` — dark theme token set.
- `lib/projects.ts` — ownership-scoped lifecycle and settings service.
- `lib/projects.test.ts` — lifecycle, ownership, validation, and preference tests.
- `lib/db/schema.ts` and `lib/db/migrations.ts` — project state fields and per-user settings schema, including upgrade-safe SQLite migration.
- `lib/db/migrations.test.ts` — verifies legacy projects upgrade with active lifecycle state and the settings table exists.

## Tests and verification

### RED checkpoint

`pnpm test -- lib/projects.test.ts` failed as intended before the service existed:

```
Error: Cannot find package '@/lib/projects'
```

### GREEN and full verification

`pnpm run verify` passed:

```
typecheck: passed
lint: passed
vitest: 3 files, 17 tests passed
next build: passed; / and /projects/[projectId] are dynamic routes
pnpm audit --audit-level high: No known vulnerabilities found
```

`pnpm run test:coverage` passed with 17 tests. Global coverage: 90.07% statements, 85.13% branches, 82.92% functions, and 95.00% lines.

The lifecycle service tests specifically prove creation/list persistence, cross-user read/mutation denial, rename/duplicate, archive/restore, trash/restore/permanent deletion, invalid-state rejection, and isolated settings persistence.

## Self-review

- All lifecycle mutations resolve the authenticated server session, then perform an ownership-scoped SQL condition; no client-provided user ID is trusted.
- Soft deletion is an explicit `trashed` state. Permanent deletion is only permitted from trash and relies on the existing foreign-key cascade for project messages.
- Existing databases are upgraded non-destructively using additive project columns; legacy tables without foreign keys are rebuilt while retaining data and assigning `active` status.
- Project card actions have text labels, semantic buttons/links, disabled pending states, an alert region for failures, labelled settings selects, and account-menu ARIA attributes.
- No external API or template catalog was added.

## Concerns / follow-up

- Browser-level E2E coverage is scheduled for Task 8. This task's cross-user proof is integration coverage against the real SQLite schema and service boundary.
- The autosave interval is stored and surfaced to the builder as a user preference; Task 6 will implement the actual debounced autosave engine that consumes it.
- The current builder still permits an archived project to be opened. This preserves read/access continuity; a future archival read-only policy should be decided alongside Task 4/6 editing semantics.

## Commits

- `4c24919 test: add project lifecycle reproducer` — RED checkpoint.
- `8923570 feat: add Lotus project dashboard and lifecycle` — GREEN implementation and verification.

## Fix Round 1

### Findings addressed

- Settings payloads are now parsed as runtime objects, reject unknown keys, and are reconstructed from only the four allowed preference fields before the database update. A malicious `{ theme: 'dark', userId: 'user-b' }` payload is rejected and both users' rows remain unchanged.
- Trashed project names render as plain text, not a broken builder link.
- Duplication truncates the source name to 95 characters before appending ` copy`, so 96–100 character project names remain valid.
- `system` theme now resolves against `prefers-color-scheme` and listens for changes in both dashboard and builder. The pure resolver has deterministic unit coverage.
- Every async dashboard transition callback now returns/awaits the action promise through `startTransition`, keeping pending state active for the complete request.
- Dashboard data uses a 100-record, summary-only projection (`id`, `name`, `status`, `updatedAt`); project files are not selected or serialized to its client component.

### Added test coverage

- `lib/projects.test.ts`: duplicate 100-character name boundary; summary projection excluding `files`; malicious settings key rejection with user isolation.
- `lib/theme.test.ts`: explicit dark/light preferences and both system preference outcomes.

### Commands and outputs

```
pnpm test -- lib/projects.test.ts lib/theme.test.ts
Test Files  2 passed (2)
Tests  14 passed (14)

pnpm run typecheck
tsc --noEmit (passed)

pnpm run lint
eslint . (passed)

pnpm run verify
typecheck: passed
lint: passed
vitest: Test Files 4 passed (4), Tests 24 passed (24)
next build: passed; routes include / and /projects/[projectId]
pnpm audit --audit-level high: No known vulnerabilities found

pnpm run test:coverage
Tests 24 passed (24)
Statements 88.88%, Branches 84.15%, Functions 84.44%, Lines 95.77%
```

### Fix Round 1 self-review

- The service accepts `unknown` at the settings boundary. It rejects non-object/array payloads and every unknown key before creating a fresh, whitelisted update object, so a runtime payload cannot alter `userId`, timestamps, or other database columns.
- The summary selector is separate from the full-project selector needed by builder/server operations, preventing `files` from entering dashboard props.
- The system-theme listener is registered only on the client and removed on unmount.
- No Task 3 schema or normalized-file work was started.

### Fix Round 1 concerns

- Browser E2E coverage remains a Task 8 deliverable; the new behavior is covered at the service and deterministic theme-resolution levels.
