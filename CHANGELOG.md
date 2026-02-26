# Changelog

## [Unreleased]

## [4.0.0] — 2026-02-26

### Removed — Dark Mode
- ChromaScale is now mode-independent. A scale is step 0 (white) → step 900 (dark), period. Consumers handle their own theming.
- Removed: `_generateDarkMode()`, `getDarkLinearL()`, `darkLightnessMax/Min`, dark contrast validation, `getSteps(mode)` (use `scale.steps` directly), mode toggle, `body.dark-mode` styles, export mode toggles, Figma dark-mode CREATE, all related tests and docs. ~555 LOC removed.

### Added — Sets
- **Multiple named workspaces** via `SetStore` (`sets.js`). Switch/rename/duplicate/delete/new all from one dropdown in the header center — no separate modal.
- localStorage key `chromascale-sets`; one-time silent migration from `chromascale-color-scales` (handles array, object, and legacy `whiteLimit` shapes).
- Auto-save on every mutation — no manual save button.
- "New set" creates from defaults and immediately focuses an inline rename input.
- Curve edits now persist across reloads (set config uses `toConfig()` shape).

### Added — URL Sharing
- `#s=base64url(gzip(json))` hash encoding via native `CompressionStream`.
- Share dialog: full-URL / params-only copy fields + paste-to-import.
- Import **creates a new set** — never overwrites. Confirmation prompt with editable name pre-filled from payload.
- Compact payload: short keys, 3-decimal floats, curve points omitted when unchanged from `_initCurves()` defaults (epsilon diff), step schedule omitted when default.

### Added — Configurable Step Schedules
- `manager.stepLabels` + `manager.majorDivisor` — per-set, persisted, travels in share URLs.
- Settings popover gained a Steps section: comma-separated textarea (validates integers 0–900, must start 0 end 900, auto-sorts/dedupes, live validation) + major-step divisor select (10/25/50/100).
- All semantic-token step references pass through `manager.snapStep()` so custom step lists don't break `var(--scale-N)` lookups.
- New `parseStepLabels()` validator + 13 new tests.

### Changed — Header & Navigation
- Three-zone header: left (title) | center (set switcher, settings) | right (share, export). Both share/export are labeled buttons.
- "New scale" is now a ghost column at the end of the scales container (dashed outline, plus icon + label) instead of a header button. Click keeps the ghost visually fixed via viewport-anchored scroll restore.
- Full-height tinted-glass scroll arrows (`backdrop-filter: blur(12px)`, 32px resting → 64px on hover, always visible). Container padding matches header gutter so first column aligns with title.
- Deleting a scale animates its width → 0 before re-render so scroll flows naturally left instead of snapping.

### Changed — Popover Styling
- New tokens: `--radius-lg` (10px), `--hairline` (0.5px), `--border-faint` (step 100).
- All popovers use hairline faint borders and `--radius-lg` with concentric inner-item radii.

## [3.1.0] — 2026-02-23

### Added
- **Dark-mode chroma boost**: Automatic chroma compensation (up to 1.3×) for gamut narrowing at dark lightness levels, keeping dark swatches more vibrant
- **`maxChroma()` in ColorEngine**: Binary-search utility for finding peak in-gamut chroma at a given lightness and hue
- **Tailwind export tab**: Generates Tailwind-ready color config with a version selector for v4 (CSS `@theme` blocks) and v3 (JS `tailwind.config.js`)
- **Light/dark mode toggles in export modal**: Independent checkboxes to include or exclude each mode from all export formats; structure flattens when only one mode is selected

### Changed
- **Renamed "Figma JSON" tab → "W3C Design Tokens"**: Same DTCG format, clearer naming
- **Removed JSON export tab**: Redundant with W3C Design Tokens and CSS exports
- **Export functions accept mode options**: `exportAllCSS()`, `exportW3CTokens()`, `exportTailwindV3()`, `exportTailwindV4()` all accept `{ light, dark }` flags

## [3.0.0] — 2026-02-22

### Changed — UI Redesign
- **Color-first swatches**: Swatch rows are now full-width color blocks; text details (step label + OKLCH) appear on hover as an inline overlay
- **Contrast-adaptive overlay text**: Overlay text color is automatically picked from the scale's lightest or darkest step to ensure AA contrast — no scrim needed
- **Gamut/adjusted dots**: Moved from right to left (inline-start) side of swatches
- **Source colors**: Removed from column body; now accessed via scale dropdown menu → "Source colors"
- **Gradient strip**: Removed from scale columns (the swatches themselves form the gradient)
- **Scale header bars**: Use the scale's own step-50 color as background for visual identity
- **Swatch hover outline**: Uses `box-shadow` with smooth 0.1s cubic-bezier transition, visible outside swatch bounds
- **Horizontal scroll-snap**: Scales container uses `scroll-snap-type: x mandatory` with arrow navigation buttons and IntersectionObserver-based visibility

### Changed — Mode Toggle
- **Redesigned segmented control**: Warm `--bg-muted` container with white/dark sliding pill
- **CSS Anchor Positioning animation**: Slider uses `position-anchor`, `anchor()`, `anchor-size()` for smooth animated transitions between light/dark buttons (following Una Kravets' "follow the anchor" pattern)
- **Icon swap**: Outline icons by default, filled icons when active, with opacity/scale transitions

### Changed — CSS Modernization
- **Logical properties migration**: Converted ~200+ physical CSS properties to logical equivalents (`inline-size`, `block-size`, `inset-*`, `margin-block/inline`, `padding-block/inline`, `border-*`) across style.css, ui.html, ui.js, and curve-editor.js
- **Exceptions kept physical**: `overflow-x`/`overflow-y` (browser support gaps for `overflow-inline`/`overflow-block`), contrast pill positioning via JS `.style.top`/`.style.height` (logical names unreliable via JS interface), pill CSS `right`/`width`, and `writing-mode: vertical-lr` padding

### Changed — ui.html Design Reference
- Added group headings (Foundations, Components, Scale UI, App Chrome, Overlays, Patterns, Reference) with h2→h3→h4 hierarchy
- Sticky glass-effect group headers with `backdrop-filter: blur(12px)` and gradient mask
- Simplified to normal page scrolling with `position: sticky` sidebar
- Demo boxes use `isolation: isolate` for proper stacking context
- Updated all component examples to match new markup and styles

### Added
- Scroll arrow navigation buttons with gradient fade backgrounds for horizontal scale overflow
- `caret-left` and `caret-right` icons in icons.js

## [2.0.0] — 2026-02-21

### Changed
- Lightness is now a shared linear schedule across all scales (was per-scale Catmull-Rom curve)
- Renamed whiteLimit/blackLimit to lightnessMax/lightnessMin for clarity
- Lightness range settings are now global (apply to all scales)
- L curve in editor is now a non-interactive reference line
- Tightened WCAG contrast gap thresholds to align with major steps: A 450→400, AA 550→500, AAA 650→600
- Contrast hover now shows ratio badges on all steps (dimmed for sub-threshold, colored for A/AA/AAA)

### Added
- Cross-scale perceptual uniformity — same step number = same lightness regardless of hue

## [1.0.0] — 2026-02-20

### Added
- Initial release with OKLCH color engine, 35-step scales, WCAG contrast enforcement
- Interactive Catmull-Rom curve editor for L/C/H
- Light and dark mode with animated transitions
- Export: CSS custom properties, W3C Design Tokens, Tailwind, Figma API push
- Unit tests (node:test) for color-engine, scale-manager
- CSS Anchor Positioning tooltip fallback for older browsers
- Self-theming UI using first scale's colors
