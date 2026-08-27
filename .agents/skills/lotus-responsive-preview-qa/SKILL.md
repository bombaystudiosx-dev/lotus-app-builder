---
name: lotus-responsive-preview-qa
description: Verify and repair Lotus device-preview sizing, fit behavior, breakpoint controls, and responsive builder layout; use when phone, tablet, desktop, custom viewport, zoom, or canvas sizing changes.
---

# Lotus Responsive Preview QA

Keep generated content at its real CSS viewport size and scale only its visual presentation. A fitted desktop preview must still report and render at 1440x900 inside the iframe.

## Required viewport behavior

- Phone: 390x844 portrait with a recognizable device frame and direct move/resize controls.
- Tablet: 768x1024 portrait with rotation support.
- Desktop: 1440x900 landscape with browser chrome and Fit enabled by default.
- Responsive/custom: exact editable width and height bounded from 240 to 2560.
- Breakpoint presets: 640, 768, 1024, 1280, and 1440.

## Interaction requirements

- Fit computes display scale from available stage width and height without changing iframe width, media-query behavior, or content typography.
- Manual zoom exits Fit mode and supports 25% through 200%.
- Switching device resets drifted position and chooses the natural orientation.
- Preview refresh, auto-refresh, inert HTML download, runtime errors, and scoped console capture remain functional.
- Generated code must stay sandboxed. Do not open generated HTML as an unsandboxed top-level blob page.
- The console is collapsible and should not consume canvas height by default.

## Verification

Add or update component tests for intrinsic dimensions, Fit state, presets, movement, resizing, console state, and preview sandboxing. In the browser, inspect the iframe element's intrinsic width and height separately from its transformed rectangle. Check the builder at desktop and 390px mobile widths, verify no framework overlay, and require a clean relevant console.
