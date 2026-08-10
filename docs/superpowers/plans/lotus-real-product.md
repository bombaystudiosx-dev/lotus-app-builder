# Lotus Real Product Implementation Plan

## Global Constraints

- Complete the local-first product before adding anything that requires an external API.
- Core create, edit, preview, save, version, import, and export workflows must work without network services or paid keys.
- Do not reintroduce the Wellness/Shop/Social/etc. template list.
- Every visible control must work or be removed/hidden.
- Keep authentication, project data, and preview content isolated by user and project.
- Never expose secrets to the browser, preview iframe, exports, logs, or AI prompts.
- Preserve a passing type-check, lint, production build, tests, and high-severity audit at every task boundary.
- Commit each task on branch `codex/lotus-real-product`.

## Task 1: Stabilize the product baseline and verification harness

- Rename the package to `lotus-app-builder`.
- Add README documentation and `.env.example` with variable names but no values.
- Add Vitest and Testing Library, a real `test` script, and a `verify` script covering type-check, lint, tests, build, and audit.
- Move schema initialization out of incidental module setup into an explicit idempotent migration module invoked by database startup.
- Add required indexes and foreign keys that are safe for the existing local SQLite data model.
- Add route-level loading, error, and not-found UI plus a reusable application error message pattern.
- Replace blocking `alert` calls with the existing toast system.
- Disable Next's generated agent-rule files and remove generated `AGENTS.md`/`CLAUDE.md` from this app repository.
- Remove or hide controls that remain nonfunctional at the end of this task.
- Add focused tests for migrations and core utility behavior.

Verification: `pnpm run verify` passes and a fresh database initializes successfully.

## Task 2: Build dashboard, navigation, and complete project lifecycle

- Make `/` an authenticated project dashboard.
- Add `/projects/[projectId]` for the builder and enforce ownership server-side.
- Implement create blank project, rename, duplicate, archive, restore, soft-delete, and permanent-delete actions.
- Show project name, status, updated time, and working actions in accessible project cards/list.
- Add empty, loading, failure, and first-run onboarding states.
- Preserve the working account menu and sign-out action.
- Add settings for theme, editor font size, autosave interval, and default device, persisted per user.
- Add tests for ownership and every lifecycle transition.

Verification: two users cannot access each other's projects; lifecycle actions survive reloads.

## Task 3: Implement a normalized project file system

- Add normalized file records with project ownership, safe relative paths, content, encoding, size, timestamps, and soft-delete state.
- Support nested folders conceptually through safe paths.
- Implement create, rename/move, duplicate, update, trash, restore, and permanent delete.
- Enforce path traversal protection, reserved-name checks, duplicate-path checks, supported text encodings, per-file size limits, and per-project size limits.
- Seed new projects with a minimal blank static HTML/CSS/JavaScript starter only.
- Add a project runtime configuration with static mode first and React/Vite metadata ready but not remotely dependent.
- Make file mutations transactional and ownership-scoped.
- Migrate legacy `projects.files` content into normalized records without data loss.
- Add comprehensive validation, permission, and transaction tests.

Verification: nested project files survive refresh and invalid/cross-user mutations are rejected.

## Task 4: Add the real code editor workspace

- Integrate CodeMirror or Monaco with HTML, CSS, JavaScript, JSON, Markdown, and TypeScript support.
- Add accessible file tree, tabs, dirty indicators, close/reopen behavior, create/rename/move/delete actions, and unsaved-change protection.
- Add find/replace, go-to-line, format document where supported, word wrap, font size, and keyboard shortcuts.
- Add resizable file tree/editor/preview layout and persist panel sizes/open files locally per project.
- Add a command palette for common local actions.
- Add a problems panel fed by syntax/build diagnostics.
- Keep editor and project-operation undo/redo semantics distinct and working.
- Add component and interaction tests for data-loss boundaries and keyboard flows.

Verification: edits update saved files and preview state without losing cursor position or unsaved work.

## Task 5: Build the safe preview and local runtime

- Render static projects from normalized files inside a restricted iframe.
- Resolve project CSS, JavaScript, images, and internal links through safe local asset assembly.
- Add phone, tablet, desktop, orientation, zoom, custom viewport, refresh, auto-refresh, and open-in-new-window controls.
- Ensure content scrolls naturally inside the device screen with no template menu.
- Add preview console, build diagnostics, and useful error overlay.
- Add an isolated local bundling worker for React/Vite projects with deterministic limits and cleanup.
- Define minimal iframe permissions and prove generated content cannot read Lotus cookies or parent data.
- Add tests for static assembly, sandbox configuration, runtime errors, cleanup, and supported React starter output.

Verification: static and React starter projects render; broken or runaway code cannot freeze or compromise Lotus.

## Task 6: Add autosave, versions, history, and recovery

- Implement debounced autosave with Saving, Saved, Offline, Failed, and retry states.
- Add optimistic concurrency versions and clear conflict handling.
- Add automatic and named snapshots with changed-file summaries.
- Add version browsing, preview, and restore-as-new-version.
- Add project operation history for reversible file actions.
- Persist unsaved editor buffers in IndexedDB and restore them after reload/crash.
- Create automatic restore points before imports, bulk changes, and later AI edits.
- Add backup/restore documentation and retention cleanup.
- Add deterministic tests for conflicts, failure/retry, recovery, and restore semantics.

Verification: refreshes, failed saves, and version restores do not silently lose work or erase history.

## Task 7: Add secure import, export, and local ownership workflows

- Import ZIP files and browser-selected files/folders with strict validation.
- Reject ZIP slip, decompression bombs, unsafe paths, executable content, unsupported encodings, and configured size violations.
- Detect supported static and React/Vite structures and explain unsupported imports.
- Import transactionally with no partial overwrite and create a restore point first.
- Export complete source ZIPs with a generated README and no secrets/local-only files.
- Export static production output for supported projects.
- Add duplicate project and local backup export flows.
- Add tests proving exported projects run with documented commands and malicious imports fail safely.

Verification: round-trip import/export preserves supported projects and security fixtures are rejected.

## Task 8: Complete quality, accessibility, security, and release UX

- Add Playwright coverage for sign-up, dashboard, project lifecycle, editing, preview, history, import/export, settings, and sign out.
- Reach meaningful unit/integration coverage for validation, permissions, transactions, and recovery.
- Complete WCAG 2.2 AA interaction work: labels, contrast, visible focus, menus/dialogs, reduced motion, keyboard flows, and screen-reader announcements.
- Add secure headers, CSP, origin/CSRF checks, rate limits for sensitive operations, and hardened cookies.
- Add session listing/revocation, password change, data export, and account deletion.
- Add structured redacted local logs and performance budgets.
- Finalize responsive brand UI, dark mode, onboarding, help, shortcuts, feature flags, and legal placeholders.
- Add Docker/Node production runbooks, migration/rollback/backup procedures, and release checklist.
- Hide every incomplete external/API feature behind disabled feature flags.

Verification: clean release-candidate suite, no critical accessibility issues, no high vulnerabilities, and no dead visible controls.

## Task 9: Add all API and external-service capabilities last

- First implement and test provider-neutral interfaces using deterministic local fakes.
- AI: streaming/cancellation/timeouts, structured file operations, path validation, context selection, diff review, accept/reject/revert, restore points, usage limits, and server-only bring-your-own-key handling.
- GitHub: OAuth/repository selection, import, branch selection, diff, commit, push, and pull request flows with explicit confirmation before every external write.
- Deployment: provider-neutral interface plus separately gated Vercel, Netlify, and Cloudflare adapters; distinguish preview/production; show logs/status/rollback and confirm external writes.
- Backend/data: gated Supabase-style connector, environment manager, schema inspection, and migration preview with no silent destructive execution.
- Billing: Stripe subscription/credit abstractions, verified idempotent webhooks, server-enforced limits, usage dashboard, cancellation, and spending controls.
- Collaboration: invitations, roles, sharing, comments, optimistic locking, presence/realtime only after conflict tests, and audit log.
- Analytics/monitoring/email: consent, redaction, retention, opt-out, error monitoring, transactional email, and notifications before any event is transmitted.
- Keep all real adapters disabled without their explicit environment variables and feature flags; the complete core builder must continue working offline.

Verification: fake-provider suites pass; outages and missing credentials degrade cleanly; no secret or external write boundary is violated.

## Task 10: Final whole-product verification and branch completion

- Run the complete unit, integration, E2E, accessibility, build, audit, import-security, sandbox, and performance suites.
- Run a broad code/security review over the complete branch and fix all load-bearing findings.
- Verify a clean environment setup and documented local workflow.
- Verify the current application visually and functionally, not only through build output.
- Produce a release report distinguishing verified local features from API adapters that require credentials.
- Finish the development branch using the Superpowers finishing workflow; do not merge or push without explicit user approval.
