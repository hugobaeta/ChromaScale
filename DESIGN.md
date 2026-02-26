# Handoff: ChromaScale — OKLCH Color Scale Tool

## Overview
ChromaScale is a professional-grade color scale generation tool built on the OKLCH color space. It enables designers to create perceptually uniform color palettes with built-in WCAG contrast constraint enforcement. The tool generates stepped scales from 0 to 900 (white to dark, mode-independent), with interactive curve editing, source color management, gamut clamping, and multiple export formats including CSS custom properties, W3C Design Tokens, Tailwind (v3/v4), and direct Figma API push.

## Fidelity
**High-fidelity (hifi)** — This is a fully functional, production-quality tool. The mockup represents the final design with exact colors, typography, spacing, interactions, and behavior. The developer should recreate the UI pixel-perfectly using the codebase's existing libraries and patterns.

---

## Architecture

### File Structure
| File | Purpose |
|------|---------|
| `index.html` | Entry point — loads all scripts and mounts `#app` |
| `style.css` | Complete stylesheet (~1,700 lines) with CSS custom properties, logical properties for theming |
| `icons.js` | Inline SVG icon library (24 icons, zero dependencies) |
| `color-engine.js` | OKLCH ↔ sRGB color pipeline, contrast ratios, gamut clamping, spline interpolation |
| `curve-editor.js` | Canvas-based L/C/H curve editor with interactive point manipulation |
| `scale-manager.js` | Scale generation engine — 35-step scales with contrast constraint enforcement |
| `figma-push.js` | Figma Variables REST API integration for pushing color variables |
| `ui.js` | UI controller — renders all views, manages state and interactions |

### Technology Stack
- **Vanilla JS** — No framework. All DOM is imperatively constructed via `document.createElement()`.
- **CSS Custom Properties** — Theming via `--bg`, `--text`, `--border`, `--accent`, etc. Uses `@property` declarations for animatable theme transitions.
- **Canvas 2D** — Curve editor uses `<canvas>` for rendering L/C/H curves, control points, gradient strips, and constraint boundaries.
- **LocalStorage** — Persistence for scale data and Figma credentials.
- **Popover API** — Tooltips use the native `popover` attribute with CSS Anchor Positioning for placement.

---

## Screens / Views

### 1. Main Scale View (Default)
**Purpose**: Displays all color scales side-by-side as scrollable columns.

#### Layout
- **Full viewport height**, `display: flex; flex-direction: column`
- **Header bar**: 40px tall, fixed at top, `justify-content: space-between`
- **Scales container**: `display: flex; overflow-x: auto; flex: 1` with `scroll-snap-type: x mandatory`, `scroll-padding-inline: 32px`, hidden scrollbar — horizontally scrollable columns with snap
- **Scales wrapper**: Wraps the container + left/right scroll arrow buttons (positioned absolutely with gradient fade backgrounds, shown/hidden via IntersectionObserver)
- **Curve panel** (when open): Docked to bottom, `max-height: 44vh`, slides up with animation

#### Header
- **Left**: App title "ChromaScale" (14px, weight 700, letter-spacing -0.02em) + subtitle "OKLCH color scale tool" (11px, `--text-muted`)
- **Right**: Action buttons — "Add scale" (secondary), Settings gear (icon-only), Save (floppy disk icon), Reset (counter-clockwise arrow icon), "Export" (primary, accent-colored)

#### Scale Columns
- **Min-width**: 270px, `flex: 1 0 270px`, `scroll-snap-align: start`
- **Border-radius**: 8px, no border-right (gap handles separation)
- **Selected state**: `border-radius: 12px`, `box-shadow: 0 0 0 8px var(--scale-step0), inset 0 0 0 2px var(--outline-active)`, padding: 2px, z-index: 2
- **Dimmed state** (when another column is selected): `opacity: 0.35`, hover → 0.55

Each column contains:

1. **Scale Header Bar** (colored)
   - `.scale-header-bar` div with `background-color` set to the scale's step-50 hex
   - `border-radius: 8px`, `padding: 4px`, subtle inset border via `box-shadow`
   - Drag handle: 6-dot vertical grip icon (14px), `cursor: grab`
   - Editable name input: transparent background, no border, blends into colored bar, 12px weight 500
   - Three-dot menu button: 16×16 icon in 24×24 hit area

2. **Source colors**: No longer shown in column body. Access via "..." dropdown menu → "Source colors" item, which opens the source panel overlay.

3. **Swatch List** (fills remaining column height, `padding: 2px` for hover outline breathing room)
   - **Color-block default**: Each swatch row IS the color — `background-color` set directly on `.swatch-row`, no separate `.swatch-color` child
   - **Major steps**: `flex: 1` (tall), **Minor steps**: `flex: 0.55` (shorter)
   - `border-radius: 2px`, `1px` gap between rows, no padding/text by default
   - **Gamut-clamped indicator**: Orange dot (6px) at inline-start (left side)
   - **Adjusted indicator**: Blue dot (6px) at inline-start, below gamut dot

   **On hover — inline overlay** (`.swatch-overlay`):
   - Absolutely positioned over the row, `opacity: 0 → 1` with 0.12s transition
   - Shows: step label + OKLCH values (format: `L0.95 C0.007 H98`), copy button, curve editor button
   - **No scrim** — text color picked from scale's own endpoints (step-0 or step-900) based on which has better contrast against the swatch color, ensuring AA compliance
   - `pointer-events: none` by default, `auto` on hover

   **Hover-source outline** (contrast visualization):
   - `box-shadow: 0 0 0 2px var(--hover-outline)` with `transition: box-shadow 0.1s cubic-bezier(0.2, 0, 0, 1)`
   - Visible outside swatch bounds (no clipping)

### 2. Source Colors Panel (Overlay)
**Purpose**: Edit the key/source colors that define a scale's curve.

#### Layout
- **Full-column overlay**: Absolutely positioned over the swatch area (`position: absolute; inset: 0`)
- **Animation**: Slides down from top with spring easing (`cubic-bezier(0.16, 1, 0.3, 1)`, 0.28s)
- **Close animation**: Slides up (0.2s)
- When open: All other columns dim to `opacity: 0.35`; active column gets selected-style outline

#### Content
- **Header**: "Source colors · N" title (11px, weight 600) + close button
- **Add Color button**: Full-width secondary button with plus icon
- **Middle row** (`display: flex`):
  - **Gradient strip** (left): 48px wide `<canvas>`, renders smooth color gradient from curves
  - **Color input list** (right, scrollable):
    - Each row: Color swatch (20×20px) with native `<input type="color">` overlay + hex text input (mono, 10px)
    - Minus button to remove (only if >1 color)
    - Out-of-range colors: hatched overlay pattern, reduced opacity, warning note ("N inputs beyond 900 range")

### 3. Curve Editor Panel (Bottom Dock)
**Purpose**: Interactive Bézier curve editor for adjusting Lightness, Chroma, and Hue curves.

#### Layout
- **Docked to bottom of viewport**: `border-top: 1px solid var(--border)`, `padding: 10px 20px 14px`
- **Background**: `var(--bg-subtle)`
- **Animation**: Slides up from bottom (`curveSlideUp` keyframes, 0.22s)
- **Content layout**: `display: flex; gap: 16px`
  - **Canvas area** (left, flex: 1): `<canvas>` element, 220px tall
  - **Validation sidebar** (right, 200px fixed width)

#### Canvas Details
- **Grid**: 10 vertical divisions (steps 0–900), 4 horizontal divisions (0.00–1.00)
- **Three curves**:
  - **L (Lightness)**: Color `#555`, Y-axis 0–1
  - **C (Chroma)**: Color `#D97757` (terra cotta), Y-axis 0–0.4
  - **H (Hue)**: Color `#6A9BCC` (steel blue), Y-axis 0–360
- **Control points**: Circle markers (4.5px default, 6px hover, 7px dragging), white fill with colored stroke
- **Constraint zones**: Red-tinted bands with dashed borders showing WCAG contrast limits
- **Gradient strip**: 6px tall bar at bottom showing resulting color ramp
- **X-axis labels**: Step numbers (0, 100, 200…900) in mono 10px
- **Y-axis labels**: Normalized values (0.00–1.00) in mono 10px

#### Interactions
- **Click on curve**: Add new control point
- **Drag point**: Adjust position (X clamped between neighbors, Y clamped to channel range)
- **Right-click / double-click point**: Remove it (except endpoints for L curve)
- **Hover on point**: Shows value label above point
- **Highlight from swatch**: Clicking chart icon on a swatch row highlights that step's position on all curves

#### Validation Sidebar
- **Status badges**: "✓ All constraints met" (green) or "N constraints failed" (red), "N steps adjusted" (blue)
- **Collapsible constraint groups**:
  - AAA 7:1 pairs (gap ≥600)
  - AA 4.5:1 pairs (gap ≥500)
  - A 3:1 pairs (gap 400–499)
- Each row shows: step pair (e.g., "0→650"), ratio (e.g., "8.42:1"), pass/fail icon

### 4. Contrast Hover Visualization (In-Place)
**Purpose**: Shows which steps meet WCAG contrast requirements relative to a hovered step.

#### Behavior
- **Trigger**: Hovering any swatch row
- **Effect**: All other steps show contrast ratio badges; sub-threshold rows dim to `opacity: 0.5`; WCAG-tier rows are highlighted:
  - **A (≥3:1)**: Amber left border (`inset 3px 0 0 #f59e0b`), amber tint background
  - **AA (≥4.5:1)**: Indigo left border (`inset 3px 0 0 #6366f1`), indigo tint background
  - **AAA (≥7:1)**: Emerald left border (`inset 3px 0 0 #10b981`), emerald tint background
- **Ratio badges**: Positioned absolute right, mono font, 9px, color-coded pill backgrounds
- **Zone labels**: Tiny uppercase labels ("A ≥3:1", "AA ≥4.5:1", "AAA ≥7:1") at zone boundaries

### 5. Export Modal
**Purpose**: Export scales in multiple formats.

#### Layout
- **Overlay**: `position: fixed; inset: 0`, backdrop: `rgba(0,0,0,0.35)` + `blur(3px)`
- **Modal**: 580px wide, centered, `border-radius: 16px`, max-height 80vh
- **Header**: Title + close button
- **Tabs**: CSS | W3C Design Tokens | Tailwind | Figma API

#### Tabs
1. **CSS**: Shows `:root { --prefix-step: hex }`. Copy + Download buttons.
2. **W3C Design Tokens**: DTCG format (`$value`, `$type`, `$description`) for Tokens Studio and variables import plugins. Flat `{ scaleName: {...} }` structure. Copy + Download.
3. **Tailwind**: Version selector dropdown (v4 CSS-based / v3 JS config). v4 outputs `@theme { --color-prefix-step }`. v3 outputs `module.exports = { theme: { extend: { colors } } }` with raw hex values. Copy + Download.
4. **Figma API**: Full Figma Variables push panel:
   - Personal Access Token input (password field with toggle visibility)
   - File URL/key input with live key extraction preview
   - Collection name input
   - Step preset selector (Major 19 / All 35 / Custom with chip picker)
   - Summary: "N scales × N steps = N variables"
   - Push button + Copy curl fallback
   - Status messages (info/success/error)

### 6. Settings Popover
**Purpose**: Global scale endpoint configuration.

#### Layout
- Anchored below settings gear icon, `min-width: 240px`
- **Lightness section**: Lightest point (step 0), Darkest point (step 900) — number inputs

### 7. Scale Dropdown Menu
**Purpose**: Per-scale actions.

#### Layout
- Anchored below three-dot button, `min-width: 180px`, `border-radius: 6px`
- **Items**: Source colors, Curve editor (toggles open/close), Duplicate scale, Delete scale (red, disabled if only 1 scale)
- **Animation**: `dropdownIn` — opacity + translateY + scale (0.12s ease-out)

---

## Interactions & Behavior

### Self-Theming
- **Theme application**: First scale's step values are mapped to semantic CSS variables:
  - Step 0 → `--bg`
  - Step 50 → `--bg-subtle`, `--hover`
  - Step 100 → `--bg-muted`
  - Step 200 → `--border`
  - Step 300 → `--border-strong`
  - Step 400 → `--border-hover`
  - Step 450 → `--text-muted`
  - Step 600 → `--text-secondary`
  - Step 850 → `--text`, `--accent`

### Column Drag to Reorder
- Uses Pointer Events API (`setPointerCapture`)
- Visual feedback: Dragging column goes `opacity: 0.4`; drop target shows `inset 3px 0 0 var(--accent)` on appropriate side
- On drop: `ScaleManager.moveScale()` reindexes and re-renders

### Tooltip System
- Single shared `<div popover="manual">` in top layer
- CSS Anchor Positioning (`position-anchor: --tip-anchor`, `bottom: anchor(top)`, `left: anchor(center)`)
- 120ms delay on first show; instant switch when moving between tooltip triggers
- Auto-clamped horizontally to viewport edges via JS nudge

### Clipboard
- Uses `navigator.clipboard.writeText()` for hex values
- Copy button shows checkmark icon for 1.2 seconds after copy

### LocalStorage Persistence
- Key: `chromascale-sets`
- Shape: `{ v: 1, activeId, sets: [{ id, name, modified, config }] }`
- Each set's `config` is a full `ScaleManager.toConfig()` (includes curve points — curves now persist across reloads)
- Auto-saved on every mutation (no manual save required)
- One-time silent migration from old key `chromascale-color-scales` on first v4 load

---

## State Management

### Primary State
- `ScaleManager.scales[]` — Array of `Scale` objects
- `ScaleManager.selectedId` — Currently selected scale (for curve editor)
- `ScaleManager.lightnessMax` / `lightnessMin` — Shared lightness endpoints for all scales
- `App._openSourcePanelId` — ID of scale with open source panel (or null)

### Scale Object State
Each `Scale` instance holds:
- `id` — Unique identifier (`scale_timestamp_random`)
- `name` — Display name
- `keyColors[]` — Array of hex strings (source colors, sorted by luminance descending)
- `curvePoints.C/H` — Arrays of `{x, y}` control points for Chroma and Hue channels
- `steps[]` — Generated 35-step array

### Step Object Structure
```js
{
  label: 500,          // Step number (0–900)
  t: 0.556,            // Normalized position (label/900)
  hex: '#CF5625',      // sRGB hex
  oklch: { L: 0.56, C: 0.165, H: 25 },
  desiredL: 0.57,      // L from curve before constraint enforcement
  effectiveL: 0.56,    // L after constraint enforcement
  rgb: [207, 86, 37],
  clamped: false,       // Was chroma gamut-clamped?
  adjusted: true,       // Was L adjusted for contrast constraints?
  contrastWhite: 4.6,   // Contrast ratio vs white
  contrastBlack: 4.57,  // Contrast ratio vs black
  isMajor: true         // Is this a 50-interval step?
}
```

### Regeneration Flow
1. User modifies source colors or curve points
2. `Scale.generate()` is called:
   - Sample L/C/H from curves at 35 step positions
   - Enforce WCAG contrast constraints on L values (iterative, 4 passes)
   - Gamut-clamp each color to sRGB
   - Verify actual RGB contrast ratios (post-clamp fix, 3 passes)
3. UI re-renders affected column(s)

---

## Design Tokens

### Colors (CSS Custom Properties)
```css
--bg: #ffffff;                    /* Main background */
--bg-subtle: #fafafa;             /* Subtle background */
--bg-muted: #f5f5f5;              /* Muted background, hover states */
--bg-alt: #fafafa;                /* Alternative background */
--hover: #fafafa;                 /* Hover state background */
--border: #e8e8e8;                /* Default border */
--border-strong: #d0d0d0;         /* Emphasized border */
--border-hover: #aaaaaa;          /* Border on hover */
--text: #111111;                  /* Primary text */
--text-secondary: #555555;        /* Secondary text */
--text-muted: #999999;            /* Muted text */
--text-muted-strong: #777777;     /* Stronger muted text */
--accent: #111111;                /* Accent / primary action */
--accent-fg: #ffffff;             /* Text on accent background */
--outline-active: #888888;        /* Active selection outline */
```

Note: These are initial values. At runtime, they're dynamically overridden by the first scale's step values for a self-theming effect.

### Curve Colors
```
Lightness: #555555
Chroma: #D97757
Hue: #6A9BCC
```

### Contrast Tier Colors
```
A (3:1):   #f59e0b (amber)    — bg: rgba(245,158,11,0.08)
AA (4.5:1): #6366f1 (indigo)  — bg: rgba(99,102,241,0.08)
AAA (7:1): #10b981 (emerald)  — bg: rgba(16,185,129,0.08)
```

### Status Colors
```
Pass:     bg: #dcfce7, text: #166534
Fail:     bg: #fee2e2, text: #991b1b
Adjusted: bg: #dbeafe, text: #1e40af
Danger:   text: #dc2626
Warning:  text: #b45309, bg: #fffbeb, border: #fde68a
```

### Typography
```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
--font-mono: "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;

/* Scale */
Base: 13px, line-height 1.5
App title: 14px, weight 700, letter-spacing -0.02em
App subtitle: 11px, weight 400
Scale name: 13px, weight 600
Step label: 10px, weight 600, tabular-nums
Hex value: 10px, monospace
OKLCH value: 8px, monospace
Buttons: 12px, weight 500
Modal title: 14px, weight 600
Tab: 12px, weight 500
Help text: 10px
Badge: 9px, weight 600
Tooltip: 12px, weight 500, letter-spacing 0.005em
```

### Spacing
```
Header padding: 8px 20px
Scale column min-width: 270px
Scales container gap: 16px, padding: 16px 32px
Swatch rows: no padding (full-width color blocks), flex: 1 (major) / 0.55 (minor)
Swatch list gap: 1px, padding: 2px (hover outline breathing room)
Swatch overlay padding: 0 8px
Curve panel padding: 10px 20px 14px
Curve canvas height: 220px
Validation sidebar width: 200px
Modal width: 580px
Modal padding: 16px
Dropdown min-width: 180px
Settings popover min-width: 240px
```

### Border Radius
```css
--radius: 6px;       /* Default */
--radius-sm: 4px;    /* Small elements */
/* Other values used directly: */
8px  — Source panel gradient, swatch row hover
10px — Status badges
12px — Selected column
16px — Modal
```

### Shadows
```css
/* Tooltip */
box-shadow: 0 4px 12px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08);

/* Dropdown */
box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06);

/* Modal */
box-shadow: 0 20px 60px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06);

/* Buttons (layered) */
box-shadow:
  0 0 0 0px transparent,       /* spacer */
  0 0 0 1px var(--border),     /* border */
  0 0 0 0px transparent,       /* outline */
  0 0 0 0px transparent;       /* ring */
/* Hover: 0 0 0 2px var(--bg), 0 0 0 3px var(--border-hover) */

/* Toast */
box-shadow: 0 4px 16px rgba(0,0,0,0.2);

/* Selected column */
box-shadow: 0 0 0 8px var(--scale-step0), inset 0 0 0 2px var(--outline-active);
```

### Animations
```css
/* Theme color transition */
transition: 0.18s ease (on all --color properties)

/* Curve panel slide up/down */
curveSlideUp: 0.22s cubic-bezier(0.22, 0.61, 0.36, 1) — translateY(16px) → 0, opacity 0→1
curveSlideDown: 0.18s cubic-bezier(0.55, 0.06, 0.68, 0.19) — reverse

/* Source panel in/out */
sourcePanelIn: 0.28s cubic-bezier(0.16, 1, 0.3, 1) — translateY(-6px) → 0, opacity 0→1
sourcePanelOut: 0.2s cubic-bezier(0.4, 0, 0.7, 0.2) — reverse

/* Dropdown */
dropdownIn: 0.12s ease-out — translateY(-4px) scale(0.97) → identity, opacity 0→1

/* Modal overlay */
fadeIn: 0.15s — opacity 0→1
slideUp: 0.2s — translateY(8px) → 0, opacity 0→1

/* Mode slider (CSS Anchor Positioning) */
transition: top/left/width/height 0.18s cubic-bezier(0.4, 0, 0.2, 1), background/box-shadow 0.18s ease

/* Button hover */
box-shadow: ease-in-out 100ms
background: ease-in-out 100ms

/* General hover */
transition: background 0.12s, color 0.12s

/* Swatch action fade */
transition: opacity 0.12s
```

---

## Color Engine Details

### Step Labels (35 total)
```
0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750,
800, 810, 820, 830, 840, 850, 860, 870, 880, 890, 900
```

### Major Steps (19): `0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900`

### Contrast Constraints
| Gap between steps | Required ratio | WCAG Level |
|-------------------|----------------|------------|
| ≥450              | 3:1            | A (large text) |
| ≥550              | 4.5:1          | AA (normal text) |
| ≥650              | 7:1            | AAA (enhanced) |

### Curve Interpolation
- **Catmull-Rom spline** (Hermite basis) for C channel
- **Circular interpolation** with hue unwrapping for H channel
- L uses a fixed linear schedule from `lightnessMax` (step 0) to `lightnessMin` (step 900)

### Gamut Clamping
- Binary search to find maximum in-gamut chroma at given L and H
- 20 iterations for precision
- Gamut-clamped swatches get an orange dot indicator

---

## Default Palettes
The tool ships with 9 default scales:
```
Gray:    19 source colors from #faf9f5 → #1a1918
Red:     9 source colors from #fceded → #300b0b
Orange:  9 source colors from #faefeb → #301107
Yellow:  9 source colors from #faf3e8 → #301901
Green:   9 source colors from #f1f7e9 → #0e2402
Aqua:    9 source colors from #e9f7f2 → #02211c
Blue:    9 source colors from #edf5fc → #011a33
Violet:  9 source colors from #f1f0ff → #141133
Magenta: 9 source colors from #fcf0f4 → #2e0b17
```

---

## Assets
- **No external assets**. All icons are inline SVGs defined in `icons.js`.
- **No external fonts**. Uses system font stack (`-apple-system`, etc.).
- **No images**. All visuals are generated via Canvas 2D or CSS.

---

## Files
All design/implementation files are included in this handoff package:

| File | Description |
|------|-------------|
| `index.html` | Entry point |
| `style.css` | Complete stylesheet |
| `icons.js` | SVG icon library |
| `color-engine.js` | OKLCH color math engine |
| `curve-editor.js` | Canvas curve editor component |
| `scale-manager.js` | Scale generation with constraint enforcement |
| `figma-push.js` | Figma API integration |
| `ui.js` | UI controller and rendering |

---

## Implementation Notes for Developer

1. **Self-theming**: The app themes itself using the first scale's generated colors. The first scale's step values are mapped to CSS custom properties at runtime. This means the UI color scheme changes as you edit colors.

2. **No build step**: The prototype runs directly in the browser with plain `<script>` tags. For production, consider bundling.

3. **Scrollbar hiding**: Custom scrollbar styles hide scrollbars until hover. Uses both WebKit and Firefox approaches.

4. **Button border technique**: Buttons use a multi-layer `box-shadow` trick instead of `border` for sub-pixel control and smooth transitions between states (default → hover → active).

5. **Tooltip anchor positioning**: Uses CSS Anchor Positioning (`position-anchor`, `anchor()`) with JS fallback for horizontal clamping. This is a newer CSS feature — check browser support.

6. **Canvas DPR handling**: All canvas operations scale by `window.devicePixelRatio` for crisp rendering on Retina displays.

7. **`@property` declarations**: CSS `@property` declarations register custom properties with `<color>` syntax and provide pre-JS colored fallbacks for semantic role tokens.

8. **CSS Logical Properties**: The codebase uses logical properties (`inline-size`, `block-size`, `inset-block-start`, `margin-inline`, `padding-block`, etc.) for writing-mode-aware layout. Exceptions: `overflow-x`/`overflow-y` (limited browser support for logical equivalents), contrast pill positioning via JS (`.style.top`/`.style.height`), and elements in `writing-mode: vertical-lr` where axis-swapping makes logical properties counterintuitive.

9. **Scroll-snap with IntersectionObserver arrows**: Scale columns use `scroll-snap-align: start`. Sentinel elements at container edges are observed to show/hide gradient-faded arrow buttons.
