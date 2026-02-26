# ChromaScale

OKLCH color scale generator with built-in WCAG contrast constraint enforcement.

## Features

- **Configurable step schedules** (default 35 steps, 0–900) — white to dark, mode-independent
- **Sets** — multiple named workspaces; switch/rename/duplicate/delete from one dropdown
- **URL sharing** — encode any set as a `#s=` hash; import creates a new set (non-destructive)
- **Color-first presentation** — swatches are full-width color blocks; step labels and OKLCH values appear on hover
- **Uniform lightness across scales** — shared linear L schedule means same step = same perceived brightness, regardless of hue
- **WCAG contrast guarantees** — A (3:1), AA (4.5:1), AAA (7:1) enforced automatically
- **Interactive curve editor** — adjust Chroma and Hue via Catmull-Rom splines (Lightness is a fixed linear schedule displayed as a reference line); curve edits persist across reloads
- **Multiple source colors** per scale with automatic curve fitting
- **Gamut clamping** — out-of-sRGB colors are clamped while preserving hue
- **Self-theming UI** — the app themes itself using your first scale's colors
- **Export formats** — CSS custom properties, W3C Design Tokens, Tailwind (v3 + v4), direct Figma API push
- **Horizontal scroll-snap** with full-height glass-blur arrow navigation

## Quick Start

Open `index.html` in any modern browser — no build step, no server, no dependencies.

```
open index.html
```

Or serve locally:

```
python3 -m http.server 8000
```

## Running Tests

```
node --test 'tests/*.test.js'
```

Requires Node 18+ (uses built-in `node:test` runner).

## Files

| File | Purpose |
|------|---------|
| `index.html` | Entry point |
| `style.css` | Stylesheet with CSS custom property theming |
| `icons.js` | Inline SVG icon library (24 icons, zero deps) |
| `color-engine.js` | OKLCH ↔ sRGB pipeline, contrast ratios, gamut clamping, spline interpolation |
| `curve-editor.js` | Canvas-based interactive curve editor |
| `scale-manager.js` | Scale generation with contrast constraint enforcement |
| `figma-push.js` | Figma Variables REST API integration |
| `sets.js` | Multi-workspace persistence + URL encode/decode (gzip + base64url) |
| `ui.js` | UI controller — renders all views and manages state |

## Design Specification

See [DESIGN.md](DESIGN.md) for the full design handoff document with detailed specs for every view, interaction, token, and algorithm.
