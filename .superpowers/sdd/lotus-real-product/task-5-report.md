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
