# Task 4 report: real code editor workspace

## Outcome

Implemented a local-first, authenticated CodeMirror 6 workspace in the existing Lotus builder. The former read-only single-file code panel is replaced by a multi-file editor connected to the normalized project-file service and its server actions.

## Delivered behavior

- CodeMirror language modes for HTML, CSS, JavaScript, JSON, Markdown, TypeScript, and a safe plain-text fallback.
- Accessible project file tree and tablist with dirty indicators, close/discard protection, and reopen-last-closed behavior.
- Create, rename, move, soft-delete, restore, save, and operation undo/redo through owner-scoped normalized server actions.
- Editor undo/redo remains CodeMirror-local; file-operation undo/redo has separate labeled controls and history.
- Find/replace, go-to-line, JSON formatting, word wrap, 12–24 px font sizing, `Ctrl+S`, `Ctrl+F`, `Ctrl+Shift+P`, and `Ctrl+Shift+T` workflows.
- Accessible keyboard and pointer resizers for the file tree, editor/preview split, and problems panel.
- Per-project local persistence for panel sizes, open files, active file, wrapping, and font size.
- Live sandboxed multi-file preview composition that inlines local CSS/JavaScript references without adding API/network dependencies.
- Problems panel driven by HTML/JSON syntax diagnostics and a missing-entry build diagnostic.
- `beforeunload` protection when any editor buffer is dirty; stale save completion cannot clear a newer dirty edit.

## TDD evidence

RED checkpoint `27deae0`:

- Command: `pnpm vitest run lib/editor-workspace.test.ts`
- Result: expected failure, suite discovered but import failed because `@/lib/editor-workspace` did not exist.

GREEN checkpoint `0d3a227`:

- Command: `pnpm vitest run lib/editor-workspace.test.ts`
- Result: 1 file passed, 15 tests passed.

RED interaction checkpoint `fd6c062`:

- Command: `pnpm vitest run components/lotus/editor-workspace.test.tsx`
- Result: expected failure, component import failed because `@/components/lotus/editor-workspace` did not exist.

GREEN interaction checkpoint `b111b51`:

- Command: `pnpm vitest run components/lotus/editor-workspace.test.tsx lib/editor-workspace.test.ts`
- Result: 2 files passed, 17 tests passed.

The interaction tests verify dirty indicators, protected close/cancel, normalized save invocation, preview refresh, and the command-palette keyboard flow. Pure state tests verify stale-save safety, discard/reopen semantics, persisted-state validation, language mapping, diagnostics, and local preview composition.

## Final verification

Command: `pnpm run verify`

Result: PASS (exit 0), 37.5 seconds.

- TypeScript: PASS, `tsc --noEmit`.
- ESLint: PASS, no warnings/errors.
- Tests: PASS, 8 files and 53 tests.
- Production build: PASS, Next.js 16.3.0 compiled, typechecked, collected page data, and generated all static pages.
- Audit: PASS, `No known vulnerabilities found` at high severity threshold.

Coverage command: `pnpm run test:coverage`

- All tests: 53 passed.
- Editor state core (`lib/editor-workspace.ts`): 92.3% statements, 82.6% branches, 90.9% functions, 97.22% lines.
- Repository aggregate: 60.65% statements, 55.61% branches, 55.84% functions, 66.57% lines. The repository has no global coverage threshold; server/UI orchestration is included in this aggregate.

## Self-review

- `git diff 27deae0^..HEAD --check`: PASS.
- Scoped secret-pattern scan over all Task 4 source files: no matches.
- Server ownership remains enforced: every mutation gets the authenticated user id server-side and calls the normalized owner-scoped project service.
- No external API, deployment, credential, or remote-state changes were added.
- Worktree was clean before this report was written.

## Commits

- `27deae0` — RED state/session specifications.
- `0d3a227` — GREEN state/session implementation.
- `fd6c062` — RED component/keyboard interaction specifications.
- `b111b51` — GREEN CodeMirror workspace integration.

## Fix Round 1

### Review findings resolved

- The editor workspace is now mounted for the lifetime of the builder and only hidden outside Code view. Dirty buffers and mounted CodeMirror instances therefore survive Code → Preview → Deployed → Code transitions.
- Every open tab owns a stable mounted CodeMirror instance keyed by normalized file id, preserving cursor, selection, scroll, and editor-local undo history when another tab becomes active.
- Stable-id session reconciliation replaces path-based reconstruction. Rename/move and their undo/redo preserve dirty buffers; create/delete replay uses the current record returned by the server rather than a stale operation snapshot.
- Dirty removal is routed through explicit discard protection for delete, undo-create, and redo-delete boundaries.
- Workspace file props now reconcile external builder updates. Clean buffers accept the update; dirty buffers retain local content and surface an explicit conflict banner with “Keep mine” / “Use external” resolution. Saving is disabled while conflicted.
- File versions are sent through the workspace and normalized actions. `updateFile` atomically compares the expected SQLite `updatedAt` version inside the write transaction and rejects stale saves without overwriting the newer file.
- AI build results return the real persisted entry-file version, so subsequent editor saves use a valid optimistic revision.
- An explicitly persisted empty tab list remains empty instead of silently reopening the first file.
- Entry-file rename/move updates `project_file.path` and `project_runtime.entryPath` within the same SQLite transaction. The builder and editor both adopt the returned entry path, including operation undo/redo.
- Problems now report malformed JSON/HTML plus useful unmatched delimiter, unterminated string/comment, and Markdown fence diagnostics for CSS, JavaScript, TypeScript, and Markdown. A missing configured entry remains a build diagnostic.
- Preview composition resolves `./` and nested `../` CSS/JavaScript references relative to the entry file, while traversal above the project root, absolute paths, backslashes, protocol URLs, and protocol-relative URLs are never expanded.
- File tree and tabs implement roving focus with Arrow/Home/End behavior; tabs activate during arrow navigation and tree items open with Enter/Space.
- The command palette focuses the first available command, traps Tab/Shift+Tab, closes with Escape or backdrop, and restores focus to its opener.
- All separators expose orientation plus `aria-valuemin`, `aria-valuemax`, and live `aria-valuenow`; pointer and keyboard resizing continue to persist per project.

### TDD evidence

RED checkpoint `48bcefb`:

- Command: `pnpm vitest run lib/editor-workspace.test.ts lib/project-files.test.ts components/lotus/editor-workspace.test.tsx`
- Result: expected RED, 15 failed and 21 passed across 3 files.
- Intended failures covered zero-tab persistence, external reconciliation, CSS/JS/TS/Markdown diagnostics, safe relative preview resolution, transactional entry rename, optimistic stale-save rejection, dirty rename preservation, mounted editors, roving focus, separator metadata, and palette focus behavior.

GREEN implementation checkpoint `b924d36`:

- Command: `pnpm run typecheck`; result PASS.
- Command: `pnpm run lint`; result PASS with no warnings or errors.
- Command: `pnpm run test`; result PASS, 8 files and 68 tests.

Mounted-view regression checkpoint `ea0de1a`:

- Command: `pnpm vitest run components/lotus/editor-workspace.test.tsx`
- Result: PASS, 1 file and 9 tests.
- Added a direct dirty-buffer hide/show interaction proving mounted Preview/Deployed-style transitions do not reset editor state.

### Final verification

Command: `pnpm run verify`

Result: PASS (exit 0), 33.9 seconds.

- TypeScript: PASS, `tsc --noEmit`.
- ESLint: PASS, no warnings/errors.
- Tests: PASS, 8 files and 69 tests.
- Production build: PASS; Next.js 16.3.0 compiled, typechecked, collected page data, and generated all pages.
- Audit: PASS, `No known vulnerabilities found` at the high-severity threshold.

### Self-review

- `git diff 48bcefb^..HEAD --check`: PASS.
- Worktree status before this report append: clean.
- Scoped secret-pattern scan over all Fix Round 1 production files: no matches.
- Scoped `TODO` / `FIXME` / `console.log` scan over all Fix Round 1 production files: no matches.
- Server ownership remains unchanged: version checks, runtime rename, and all mutations execute after authenticated owner scoping in the normalized project service.
- No Task 5 files or behavior were introduced.

Fix Round 1 commits:

- `48bcefb` — RED data-loss, reconciliation, diagnostics, preview, service, and accessibility regressions.
- `b924d36` — GREEN implementation for all Critical and Important findings.
- `ea0de1a` — mounted workspace view-transition regression coverage.
