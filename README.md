# ChromaScale

OKLCH color scale generator with built-in WCAG contrast constraint enforcement.

## Features

- **35-step color scales** (0–900) — white to dark, mode-independent
- **Color-first presentation** — swatches are full-width color blocks; step labels and OKLCH values appear on hover
- **Uniform lightness across scales** — shared linear L schedule means same step = same perceived brightness, regardless of hue
- **WCAG contrast guarantees** — A (3:1), AA (4.5:1), AAA (7:1) enforced automatically
- **Interactive curve editor** — adjust Chroma and Hue via Catmull-Rom splines (Lightness is a fixed linear schedule displayed as a reference line)
- **Multiple source colors** per scale with automatic curve fitting
- **Gamut clamping** — out-of-sRGB colors are clamped while preserving hue
- **Self-theming UI** — the app themes itself using your first scale's colors
- **Export formats** — CSS custom properties, W3C Design Tokens, Tailwind (v3 + v4), direct Figma API push
- **Horizontal scroll-snap** with arrow navigation for scale columns
- **CSS logical properties** throughout for modern, writing-mode-aware layout

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
| `ui.js` | UI controller — renders all views and manages state |

## Design Specification

See [DESIGN.md](DESIGN.md) for the full design handoff document with detailed specs for every view, interaction, token, and algorithm.
