# Changelog

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
- Export: CSS custom properties, JSON, W3C Design Tokens, Figma API push
- Unit tests (node:test) for color-engine, scale-manager
- CSS Anchor Positioning tooltip fallback for older browsers
- Self-theming UI using first scale's colors
