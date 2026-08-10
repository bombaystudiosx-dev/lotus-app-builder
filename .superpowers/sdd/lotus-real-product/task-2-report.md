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
