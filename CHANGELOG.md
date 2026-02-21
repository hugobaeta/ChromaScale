# Changelog

## [Unreleased]

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
