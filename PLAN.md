# ChromaScale Improvements Plan

## Context
ChromaScale is a fully functional vanilla JS color scale tool. This plan addresses improvements identified during codebase review: adding unit tests, splitting the README, and adding browser fallbacks for cutting-edge CSS APIs. Build system and ES module conversion were evaluated and deliberately skipped — the zero-config `file://` simplicity is kept.

---

## 1. Unit Tests (Node built-in test runner)

**Problem:** The color math, constraint solver, and gamut clamping are complex algorithms with no tests. Regressions could silently break WCAG compliance guarantees.

**Approach:** Use `node:test` + `node:assert` (zero dependencies). Add conditional `module.exports` to each file so they work in both browser (globals) and Node (`require()`).

### Files to modify
- `color-engine.js` — add `if (typeof module !== 'undefined') module.exports = ColorEngine;` at end
- `scale-manager.js` — same pattern for `Scale`, `ScaleManager`, `STEP_LABELS`, `MAJOR_STEPS`, `getRequiredRatio`
- `curve-editor.js` — skip (canvas-dependent, not unit-testable without DOM mocking)
- `figma-push.js` — skip for now (API integration, needs mocking)
- `ui.js` — skip (DOM-heavy)

### New files
- `tests/color-engine.test.js` — test suite for ColorEngine
  - Hex ↔ RGB round-trip
  - Hex → OKLCH → Hex round-trip (within rounding tolerance)
  - Known OKLCH values for pure white, black, primary colors
  - `isInGamut` returns true for valid sRGB colors, false for out-of-gamut
  - `clampToGamut` preserves in-gamut colors, reduces chroma for out-of-gamut
  - `contrastRatio` returns 21:1 for black/white, 1:1 for same color
  - `cubicHermiteInterpolate` — endpoint clamping, midpoint interpolation
  - `interpolateHue` — wrapping across 0°/360° boundary

- `tests/scale-manager.test.js` — test suite for Scale + ScaleManager
  - Scale generation produces exactly 35 steps
  - Step 0 is always #FFFFFF in light mode
  - Steps are monotonically decreasing in lightness (light mode)
  - Dark steps are monotonically increasing in lightness
  - All WCAG contrast constraints are met (gap ≥400 → 3:1, ≥500 → 4.5:1, ≥600 → 7:1)
  - `getRequiredRatio` returns correct values for each gap threshold
  - `exportJSON` / `exportAllCSS` produce valid output
  - Adding/removing key colors regenerates correctly
  - `sampleStep` returns valid light + dark colors for arbitrary step labels

### Run command
```
node --test tests/
```

---

## 2. README Split

**Problem:** The current README.md is a 528-line design handoff document. It's excellent as a spec but too long for a project README.

### Approach
- Rename `README.md` → `DESIGN.md` (preserve the full spec)
- Create a new concise `README.md` (~50 lines): project description, screenshot placeholder, features list, how to run, how to test, link to DESIGN.md

### Files
- `README.md` → rename to `DESIGN.md`
- New `README.md`

---

## 3. Browser Fallbacks

### Research Summary

The tooltip system (`ui.js:39-127`, `style.css:228-251`) uses two modern APIs:

**Popover API** (`popover="manual"`, `showPopover()`, `hidePopover()`)
- Chrome 114+ (May 2023), Firefox 125+ (Apr 2024), Safari 17+ (Sept 2023)
- **All three browsers have shipped this for 1.5+ years. No fallback needed.**
- Used here to put the tooltip in the top layer (escapes stacking contexts/z-index wars)

**CSS Anchor Positioning** (`anchor-name`, `position-anchor`, `anchor()`, `position-try-fallbacks`)
- Chrome 125+ (May 2024), Firefox 131+ (Oct 2024), Safari 18+ (Sept 2024)
- **All three browsers have shipped this for 1+ year as of Feb 2026.**
- Used here to position the tooltip relative to the trigger element without JS coordinates

**Verdict:** Both APIs are now well-supported. However, adding a graceful fallback is still good practice for users on older browser versions. The `@supports` approach keeps the happy path pure CSS while degrading gracefully.

### Why pure CSS-only tooltips won't work here

The classic `::after` pseudo-element tooltip pattern (`content: attr(data-tooltip)`) doesn't work because:
- Triggers are inside `.scale-column` which has `overflow: clip` (`style.css:385`)
- Pseudo-elements inherit their parent's clipping context — the tooltip gets clipped
- The `overflow-clip-margin: 40px` isn't reliable for all tooltip positions

The shared tooltip element lives on `document.body` (`ui.js:45`) specifically to escape this clipping. This is the right architecture — no change needed there.

### Approach: CSS `@supports` Progressive Enhancement

**Principle:** CSS handles styling and positioning in two tiers. JS stays minimal — only coordinates for the fallback path.

#### CSS changes (`style.css`)

Replace the current `#shared-tooltip` block with a two-tier approach:

```css
/* === Base tooltip (works everywhere) === */
/* Position via JS-set custom properties as fallback */
#shared-tooltip {
  position: fixed;
  top: var(--tip-top, -9999px);
  left: var(--tip-left, -9999px);
  translate: -50% 0;
  margin: 0;
  margin-top: -6px;
  /* ... all existing visual styles (bg, color, padding, font, shadow, etc.) ... */
  pointer-events: none;
  position-try-fallbacks: flip-block;
}

/* === Enhanced: CSS Anchor Positioning (Chrome 125+, Firefox 131+, Safari 18+) === */
@supports (anchor-name: --x) {
  #shared-tooltip {
    /* Override the JS-positioned fallback with anchor-based positioning */
    top: auto;
    left: auto;
    position-anchor: --tip-anchor;
    inset: auto;
    bottom: anchor(top);
    left: anchor(center);
    margin-top: 0;
    margin-bottom: 6px;
  }
}
```

This means:
- **Browsers with anchor positioning:** CSS positions the tooltip automatically via `anchor()` functions. The JS-set `--tip-top`/`--tip-left` are ignored because `top`/`left` are overridden to `auto`.
- **Browsers without anchor positioning:** The `@supports` block is skipped. Tooltip uses `position: fixed` with coordinates from JS custom properties.

#### JS changes (`ui.js` — `_initTooltipSystem`)

Feature-detect once at init:

```js
this._hasAnchorPositioning = CSS.supports('anchor-name', '--x');
```

In `showTip(trigger)`:
- **If anchor positioning is supported:** Set `trigger.style.anchorName = '--tip-anchor'` (current behavior). CSS handles the rest.
- **If not supported:** Calculate position via `trigger.getBoundingClientRect()` and set `--tip-top`/`--tip-left` on the tooltip element. This is ~4 lines of JS.

```js
// Fallback path (non-anchor browsers)
const rect = trigger.getBoundingClientRect();
tip.style.setProperty('--tip-top', `${rect.top}px`);
tip.style.setProperty('--tip-left', `${rect.left + rect.width / 2}px`);
```

The horizontal viewport-edge nudge logic (existing lines 67-75) stays as-is for both paths — it already works with `getBoundingClientRect()`.

#### Popover API — no fallback needed

All three modern browsers (Chrome 114+, Firefox 125+, Safari 17+) have supported `popover="manual"` since at least April 2024. The existing `try { tip.showPopover() } catch(e) {}` pattern already handles any edge case gracefully.

### Files to modify
- `style.css` — restructure `#shared-tooltip` into base + `@supports (anchor-name: --x)` enhancement
- `ui.js` — `_initTooltipSystem()`: add one-time feature detection boolean, add ~6 lines of fallback coordinate logic in `showTip()`

### What's CSS vs JS

| Concern | CSS | JS |
|---------|-----|-----|
| Tooltip visual styling | 100% CSS | — |
| Positioning (anchor browsers) | 100% CSS via `anchor()` | Only sets `anchorName` property |
| Positioning (fallback) | CSS `position: fixed` + custom properties | Sets `--tip-top`/`--tip-left` from `getBoundingClientRect()` |
| Visibility (show/hide) | — | `showPopover()` / `hidePopover()` (existing) |
| Viewport edge clamping | CSS `translate` adjustment | Existing nudge logic (5 lines, unchanged) |
| Vertical flip | CSS `position-try-fallbacks: flip-block` | No change needed |

---

## Execution Order

1. **Tests infrastructure + color-engine tests** — add conditional exports, write `tests/color-engine.test.js`, verify with `node --test`
2. **Scale manager tests** — write `tests/scale-manager.test.js`
3. **README split** — rename to DESIGN.md, write new README.md
4. **Browser fallbacks** — feature detection in tooltip system

Steps 1-3 are independent and can be parallelized. Step 4 is independent.

---

## Verification

- `node --test tests/` — all tests pass
- Open `index.html` in Chrome — app works as before
- Open `index.html` in Firefox/Safari — tooltips work via fallback positioning
