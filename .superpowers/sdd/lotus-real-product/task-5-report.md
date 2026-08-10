# Task 5 report: safe preview and local runtime

## Outcome

Implemented the Lotus safe preview workbench and a deterministic, owner-scoped local React bundling path. Static and React/Vite-style starters are assembled into self-contained documents without external APIs, and the rendered app runs in an opaque-origin iframe with the minimum script permission.

## Delivered behavior

- Static project assembly from normalized files, including relative CSS, JavaScript, SVG/image data, CSS `url(...)` assets, and internal HTML links.
- Unsafe traversal, absolute, protocol-relative, remote, and missing references are removed and reported as build diagnostics.
- A restrictive document CSP disables network connections, remote resources, nested frames, objects, base mutation, and form submission.
- The preview iframe uses only `sandbox="allow-scripts"`, omits `allow-same-origin`, and sends no referrer. Generated content therefore cannot read Lotus cookies, storage, DOM, or parent data.
- Full-screen previews use opaque `data:` documents with `noopener,noreferrer`; the previous same-origin Blob path was removed.
- Phone, tablet, desktop, custom width/height, orientation, 25–200% zoom, refresh, auto-refresh, and open-new-window controls are wired into the real Preview tab.
- Preview content scrolls inside its own logical viewport. The prior decorative device frames and drag-only canvas were removed.
- A scoped `postMessage` bridge captures console output, uncaught errors, and unhandled rejections. The workbench displays a console, error overlay, source location, build diagnostics, and clear control.
- React/Vite-style projects are bundled with esbuild in a Node worker using in-memory virtual files, fixed input/output/file-count limits, a 1–15 second timeout, worker memory limits, unconditional termination, and no temporary source tree.
- Worker errors are normalized and local filesystem paths are removed before returning diagnostics.
- Obvious statically unbounded `while(true)` / `for(;;)` loops are removed or rejected before browser execution; worker timeout and cleanup tests cover stalled builds.
- The AI generation guidance now requires inline CSS and inline/data assets instead of remote Tailwind, font, image, or script URLs.
- Static and React starter outputs are executed in JSDOM tests, proving the assembled scripts mount and run rather than merely containing expected source text.

## Security and isolation review

- Preview documents receive a unique opaque origin because `allow-same-origin` is absent.
- `connect-src 'none'`, `default-src 'none'`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'none'`, and `form-action 'none'` prevent preview network/data exfiltration paths covered by the supported runtime.
- Message handling accepts events only from the current iframe `contentWindow` and the Lotus preview event envelope.
- React builds are requested through an authenticated server action that resolves the project, runtime, and files through the existing owner-scoped project service. Client-supplied source is not accepted by the worker action.
- Static assembly replaces traversal references instead of leaving a browser-resolvable URL in the document.
- Self-review found and fixed two bypasses: same-origin Blob new-window previews and unsafe raw HTML stored in preview undo history.
- Self-review also found and fixed structural CSP insertion corrupting React-internal HTML strings; the execution tests now guard this regression.

## TDD evidence

- `48bf09f` RED: preview runtime and bundler modules were absent.
- `5fe1b9a` GREEN: static assembly and constrained worker bundling passed 8 tests.
- `200625a` RED: the preview workbench component was absent.
- `74557db` GREEN: workbench interaction, console/error, viewport, refresh, and opaque-window tests passed.
- `ecb804b` RED: statically unbounded scripts still reached output.
- `618f6ef` GREEN: runaway loop guards passed.
- `417dfe8` RED: execution-level React proof exposed CSP insertion inside bundled React strings.
- `f2aecd8` GREEN: structural document assembly preserved an executable React starter.

## Final verification

Command: `pnpm run verify`

Result: PASS (exit 0), 115.1 seconds.

- TypeScript: PASS, `tsc --noEmit`.
- ESLint: PASS, no warnings or errors.
- Tests: PASS, 11 files and 93 tests.
- Static starter execution: PASS in JSDOM; local script updated the rendered DOM.
- React starter execution: PASS in JSDOM; bundled React mounted `React starter ready` into `#root`.
- Production build: PASS, Next.js 16.3.0 compiled, typechecked, collected page data, and generated all routes.
- Audit: PASS, `No known vulnerabilities found` at the high-severity threshold.

Coverage command: `pnpm run test:coverage`

- All 93 tests passed.
- `lib/local-bundler.ts`: 85.41% statements, 75.86% branches, 80% functions, 100% lines.
- `lib/preview-runtime.ts`: 87.82% statements, 77.45% branches, 100% functions, 91.34% lines.
- `components/lotus/preview-workbench.tsx`: 90.9% statements, 72.09% branches, 86.36% functions, 95.34% lines.
- Repository aggregate: 73.97% statements, 64.73% branches, 73.58% functions, 80.15% lines. Task 5 production modules exceed 80% statement coverage; the repository has no global threshold and includes inherited server/UI orchestration in the aggregate.

## Commits

- `48bf09f` — RED safe-preview and local-bundler tests.
- `5fe1b9a` — static assembly and constrained bundler implementation.
- `200625a` — RED workbench interaction tests.
- `74557db` — preview workbench integration.
- `e2978c6` — isolation self-review fixes.
- `ecb804b` — RED runaway-script tests.
- `618f6ef` — runaway-script guards.
- `417dfe8` — RED starter execution proof.
- `f2aecd8` — structural executable-document fix.
- `a54a456` — aligned esbuild and JSDOM typing dependencies.

## Scope and external actions

- All changes were made only in the assigned `lotus-real-product` worktree.
- No external APIs were called by the product implementation.
- No deployment, push, credential, or third-party state change was performed.

---

## Fix Round 1 (2026-08-10)

### Outcome

Resolved every Critical and Important review finding plus the practical Minor findings. This section supersedes the earlier statement about opening generated apps in `data:` windows: all preview export surfaces now download inert HTML or copy the HTML source and never execute generated code in an unsandboxed window.

### Security and runtime corrections

- Replaced regex document mutation with parse5 document parsing and structural serialization. Lotus now removes attacker-supplied CSP/base nodes and installs the restrictive CSP plus the console/error bridge as the first two trusted head children, before all user scripts. A regression reproduces a fake `<head>` embedded in script text.
- Restricted document behavior by removing nested browsing/plugin elements, refresh metas, event handlers, form actions/targets/methods, per-control `formaction`, anchor popup targets/pings, and remote or unsafe links. CSP continues to deny connections, frames, workers, objects, media/network assets, base changes, and forms.
- Replaced both Builder and workbench new-window actions with Blob-backed HTML downloads. Clipboard actions copy inert HTML source rather than an executable data URL.
- Added Acorn AST instrumentation for loops, block-bodied functions, single-statement loops, and expression-bodied arrow functions. Per-document randomized guard identifiers capture timing and microtask primitives, prevent marker/name spoofing, and throw after the 100 ms execution budget. Literal infinite loops remain rejected before output.
- Rejects source access to preview navigation and network primitives, including `fetch`, XHR, sockets, workers, beacons, `window.open`, and location mutation.
- Hardened the event bridge and receiver with source and event-type checks, an 8 KiB envelope limit, payload schemas, field/string/array limits, a 40-events-per-second rate cap on both sides, and a 200-line console bound.
- Moved React dependencies into an explicit read-only vendor namespace limited to React, React DOM, and Scheduler package roots. All user imports are resolved only from normalized in-memory project paths; drive paths, UNC paths, file URLs, root-absolute imports, traversal, and non-allowlisted bare packages are rejected before generic esbuild resolution. No `resolveDir` is set.
- Structurally extracts quoted or unquoted React module entries. SVG, raster image, and font assets remain self-contained data URLs with correct MIME types; CSS and React bundle assets are assembled into the hardened document.
- Added global (4), per-user (2), and queued (16) build bounds, pre-build file/count/byte checks, post-build byte checks, abort handling, time/memory bounds, unconditional worker cleanup, and authenticated per-user ownership keys.
- Added client revision ordering and cancellation flags so stale React builds cannot replace newer output. Editor and chat paths never send TSX through static HTML assembly; React editing rebuilds through the isolated server action after persistence.
- Removed the duplicate Builder device selector and stale dimension label. `PreviewWorkbench` is the single viewport-state owner. Build diagnostics now render even when the build returns empty HTML.
- Added recursive linked-HTML assembly with cycle/depth bounds, unquoted attribute handling, and preservation of safe query/fragment metadata.

### Exploit regression evidence

Focused command:

`pnpm exec vitest run lib/preview-runtime.test.ts lib/local-bundler.test.ts components/lotus/preview-workbench.test.tsx components/lotus/editor-workspace.test.tsx`

Result: PASS, 4 files and 38 tests.

The focused suite proves:

- absolute `package.json`, Windows drive, UNC, file URL, POSIX absolute, and bare-package disclosure attempts fail without returning file contents or workspace paths;
- fake-head CSP insertion cannot move policy behind user code and the bridge precedes initial user logging;
- computed `while (Date.now())` and single-statement loops receive watchdog calls, while a forged Lotus guard marker cannot bypass instrumentation;
- forms, popup targets, refresh navigation, script navigation/network calls, and network hints are removed or rejected;
- malformed, oversized, wrong-source, and flooding iframe events are discarded;
- generated HTML is downloaded without `window.open`;
- unquoted module/asset attributes, recursive HTML links, query/fragment metadata, SVG, and font data URLs work;
- React editor updates do not pass raw TSX to the static assembler;
- timeout and pre-abort cases release all build slots.

### Final verification

Command: `pnpm run verify`

Result: PASS (exit 0), 37.9 seconds.

- TypeScript: PASS, `tsc --noEmit`.
- ESLint: PASS, no warnings or errors.
- Tests: PASS, 11 files and 105 tests.
- Production build: PASS, Next.js 16.3.0 compiled, typechecked, generated all routes, and finalized optimization.
- Audit: PASS, `No known vulnerabilities found` at the high-severity threshold.
- Diff hygiene: PASS, `git diff --check` returned no findings before commit.

### Fix-round commits

- `8a151d2` — RED exploit regressions for import disclosure, CSP structure, runaway code, unsafe export, event abuse, assets, recursion, and diagnostics.
- `b03e26d` — GREEN preview isolation, structural assembly, guarded runtime, bounded vendor bundling, runtime-aware integration, and self-review corrections.

### Scope

- No Task 6 work was performed.
- All changes stayed inside the assigned `lotus-real-product` worktree.
- No product external API, deployment, push, credential, or third-party mutation was performed.
