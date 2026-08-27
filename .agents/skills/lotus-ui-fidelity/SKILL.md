---
name: lotus-ui-fidelity
description: Build or revise the Lotus App Builder interface to match its locked cream, peach, and gold product reference; use for Lotus shell, navigation, preview canvas, prompt composer, or visual-polish work.
---

# Lotus UI Fidelity

Treat [assets/lotus-ui-target.png](assets/lotus-ui-target.png) as the locked visual specification. Inspect it at original resolution before changing Lotus UI code and compare it with a same-size browser screenshot before completion.

## Product anatomy

- Use a fixed 248px desktop sidebar with the complete Lotus mark, navigation for App Builder, Projects, Templates, Preview, Deploy, and Settings, plus the founder card at the bottom.
- Use an open white main surface with a compact page heading, subtitle, theme control, and Docs action.
- Make the live-preview card the visual center. Keep its border subtle, corners approximately 20px, and title/status at top left.
- Keep Phone, Tablet, Desktop, and refresh controls grouped at the preview card's top right.
- Put the prompt composer below the preview as a full-width anchored command bar with a peach-to-coral Generate App action.

## Visual system

- Background: warm white, never gray or dark brown for this surface.
- Accent: pale peach selection surfaces and a restrained coral-peach primary action.
- Brand: metallic gold Lotus artwork is the only ornate element; the application chrome stays quiet.
- Typography: strong black sans-serif page headings, warm dark-brown body text, compact readable control labels.
- Borders and shadows: low contrast, thin, and soft. Avoid nested cards, heavy glass effects, or generic dashboard grids.

## Fidelity boundaries

- Preserve the shown information hierarchy and visible labels. Do not replace the sidebar with a chat rail or move the prompt into the sidebar.
- Device previews remain real interactive iframes; never ship the reference screenshot as application UI.
- Reuse the existing Lotus logo asset when it matches. Use the locked image only as a design reference, not as a runtime background.
- Extend the reference responsively: collapse the sidebar below tablet width while retaining access to navigation; never squeeze it beside the preview.

## Completion gate

Verify the implementation at 1536x1024 and one mobile viewport. Inspect both the locked reference and final browser screenshot with `view_image`. Record mismatches in shell geometry, palette, typography, preview framing, controls, and composer placement, and fix all material drift.
