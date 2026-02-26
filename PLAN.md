# ChromaScale v4.0.0 Plan

## Overview

Two major changes:
1. **Remove dark mode entirely** — ChromaScale becomes a mode-independent ramp generator. A scale is step 0 (white) → step 900 (dark), period. Consumers handle their own theming.
2. **Sets + URL sharing** — multiple named workspaces ("Sets"), switchable via header dropdown + management modal. Share any set as a URL hash. Import creates a new set (non-destructive). Works identically under `file://` and HTTP.

**Net LOC impact:** ~555 removed (dark mode) + ~340 added (sets + sharing) = **~215 lines lighter overall**, while gaining multi-workspace + sharing.

---

# Part A: Remove Dark Mode

## Rationale

Scales are already intrinsically "light-mode" internally (step 0 = white = L 1.0, step 900 = dark = L 0.15, decreasing lightness). Dark mode is a derived parallel computation — a second inverted-L pass stored in `scale.darkSteps`. The two share no runtime state. Removing dark mode means deleting the derived path and all UI that toggles between the two arrays.

**What a "scale" is after this:** a 35-step ramp from white to dark, with chroma/hue curves driven by key colors. The concept of "light mode" vs "dark mode" no longer exists in ChromaScale's vocabulary — it's just "the scale."

## A.1 — `scale-manager.js` (~270 LOC removed)

### ScaleManager class
- **Remove** `darkLightnessMax`, `darkLightnessMin` properties (constructor lines 729–730)
- **Remove** `getDarkLinearL(step)` (lines 738–741)
- **Remove** `setDarkLightnessMax()`, `setDarkLightnessMin()` (lines 753–761)
- **Modify** `toConfig()` — drop dark limit serialization (lines 816–817)
- **Modify** `fromConfig()` — drop dark limit deserialization + legacy `darkWhiteLimit`/`darkBlackLimit` migration (lines 831–835)

### Scale class
- **Remove** `_generateDarkMode()` (lines 251–346, 96 LOC) — includes the v3.1.0 chroma-boost calculation
- **Remove** `_enforceDarkConstraints()` (lines 348–393)
- **Remove** `_verifyAndFixDarkContrast()` (lines 395–467)
- **Remove** `getDarkContrastValidation()` (lines 614–627)
- **Modify** `generate()` — drop step 5 call to `_generateDarkMode()` (lines 247–248)
- **Simplify** `getSteps(mode)` → delete entirely; callers use `scale.steps` directly (line 610–612)
- **Simplify** `sampleStep(label)` — return flat `{hex, rgb, oklch}` instead of `{light: {…}, dark: {…}}`. Remove the 19-LOC dark-sample recalculation (lines 644–666)
- **Simplify** `exportJSON()` — flatten from `{light, dark}` to single level (lines 701–718)

### Export functions — drop `{light, dark}` option
- **`exportAllCSS()`** — drop param, emit single `:root { --name-step: #hex; … }` block. Remove `[data-theme="dark"]` + `@media (prefers-color-scheme: dark)` wrappers.
- **`exportAllJSON()`** — inherits flattening from `exportJSON()`
- **`exportW3CTokens()`** — drop param, always flat output
- **`exportTailwindV3()`** — drop param, always raw hex (no `var(--…)` references)
- **`exportTailwindV4()`** — drop param, single `@theme{}` block, no `@variant dark`

## A.2 — `ui.js` (~140 LOC removed)

### State & lifecycle
- **Remove** `this.viewMode = 'light'` (line 8)
- **Remove** `_positionModeSlider(animate)` method (lines 143–160)
- **Remove** dark-limit save lines in `_saveToLocalStorage()` (lines 174–175)
- **Remove** dark-limit load + legacy migration in `_loadFromLocalStorage()` (lines 204–205, 223–227)
- **Remove** dark-limit reset in `_resetToDefaults()` (lines 247–248)

### Header
- **Remove** entire `.header-center` block with mode toggle markup (lines 461–473). Header becomes `.header-left` + `.header-actions` only.
- **Remove** `requestAnimationFrame(() => this._positionModeSlider(false))` call (line 500)
- **Remove** entire mode-switch click handler (lines 502–550). Side effect: `_themeTransitionTimer` property becomes dead — remove it.

### Settings popover
- **Remove** `darkWhiteLimit`/`darkBlackLimit` reads (lines 580–581)
- **Rename** "Light Mode" section header → just "Lightness" (line 616)
- **Remove** entire "Dark Mode" settings section HTML (lines 631–646)
- **Remove** `darkWarningEl` + dark range warning logic (lines 651, 657–659)
- **Remove** input handlers for dark setters (lines 690–693)

### Rendering paths — replace `getSteps(mode)` with `scale.steps`
- `_applyThemeFromScale()` (lines 397, 403)
- `_refreshSwatches()` (lines 707, 711)
- `_createScaleColumn()` (line 822)
- `_createScaleColumn()` validation branch — always `getContrastValidation()` (line 855)
- `_drawGradientStrip()` — always `getLinearL()` (lines 1591, 1595)
- `_createContrastValidation()` — always `getContrastValidation()` (lines 1737, 1739)

### Export modal
- **Remove** `getModeOpts()` (lines 1857–1860)
- **Modify** `getContent(key)` — drop opts passing (lines 1864–1874)
- **Remove** `<div class="export-mode-toggles">` markup (lines 1888–1891)
- **Remove** checkbox change handler with "at least one" guard (lines 1957–1968)

## A.3 — `style.css` (~130 LOC removed)

### Classes to delete
- `:root.theme-transitioning { … }` (lines 43–62) — only existed to animate mode switch. The `@property` declarations (lines 4–38) stay; they're useful for other transitions.
- All 18 `body.dark-mode …` selectors (scattered, see research notes)
- Entire `.mode-toggle`, `.mode-slider`, `.mode-btn`, `.mode-icon`, `.mode-label` block (lines 1000–1082, ~83 LOC)
- `.export-mode-toggles`, `.export-mode-toggle`, `.export-mode-toggle input` (lines 1506–1524)
- Stale comment about dark-mode `.mode-btn` shadow (line 1090)

### Selector to modify
- Line 1743: `.mode-icon svg, .drag-handle svg { … }` → drop `.mode-icon svg,` prefix

### Keep unchanged
- `@supports (anchor-name: --x)` block (lines 357–365) — this is for tooltips, not the mode toggle

## A.4 — `figma-push.js` (~15 LOC simplified)

- **Remove** `darkModeId` (line 42)
- **Modify** per-variable loop (lines 63–80): read only `scale.steps` (or `sampleStep().hex` with new flat return shape), push single mode value
- **Modify** `variableModes` array (lines 91–94): single `UPDATE` for the default mode, no `CREATE Dark`
- **Modify** `modesCreated: 1` (line 122)
- **Modify** `valueCount = varCount` (line 166)
- **Modify** UI summary text — drop "mode values" phrasing or change to "values" (line 251)
- **Modify** success message — drop "with Light + Dark modes" (line 373)

## A.5 — Tests

- **Delete** 4 dark-only tests: `produces exactly 35 dark steps`, `dark mode steps have monotonically increasing L`, `all constrained pairs meet requirements (dark mode)`, `dark mode uses linear L from darkLightnessMin to darkLightnessMax`
- **Rewrite** 6 tests for flattened return shapes: `sampleStep`, `exportJSON`, `exportAllCSS` (drop `prefers-color-scheme` assertion), `exportAllJSON`, `toConfig` (drop dark assertions), `fromConfig` (drop dark fixture keys)
- **Rename** `step 0 is always #FFFFFF in light mode` → `step 0 is always #FFFFFF`

## A.6 — `ui.html` (component catalog)

- **Remove** TOC link `#mode-toggle` (line 113)
- **Remove** entire Mode Toggle demo section (lines 405–423)
- **Rename** Settings popover "Light Mode" header (line 429)
- **Remove** Export modal `.export-mode-toggles` demo (lines 454–456)
- **Update** note text mentioning `.export-mode-toggles` (line 487)
- **Remove** Animation table row "Mode slider FLIP" (line 577)
- **Remove** Class index row "Mode Toggle" (line 588)
- **Update** Class index Modal row — remove `.export-mode-*` classes (line 601)
- **Remove** Class index row "Dark Mode `body.dark-mode`" (line 603)
- **Remove** Class index row "Theme Transition" (line 604)
- **Remove** JS comment about mode slider (line 628)

## A.7 — Documentation

- **README.md** — remove 3 dark-mode feature bullets (lines 7, 15–16)
- **DESIGN.md** — major rewrite, ~25 sections reference dark mode. Remove "Dark Mode Generation" section entirely, update mode toggle spec, localStorage schema, shadows, animations.
- **CHANGELOG.md** — leave historical entries alone, add v4.0.0 entry noting removal

## A.8 — Unchanged files
- `color-engine.js` — zero dark-specific code. `maxChroma()` stays; it's mode-neutral.
- `index.html` — bare `<div id="app">` shell
- `curve-editor.js` — `invalidateTheme()` becomes unused (only caller was mode-switch handler) but is harmless; can optionally remove
- `icons.js` — `sun`/`moon` become unused but are 2 LOC each; optionally remove

---

# Part B: Sets + URL Sharing

## Concept

Introduce **Sets** — named, switchable workspaces. What was previously "the app's one palette" becomes one Set among many. Each Set contains a full `ScaleManager` config (lightness limits + scales).

Sharing encodes the **current Set** into a URL. Importing a shared URL creates a **new Set** — it never overwrites the user's own work. This eliminates the "shared-view mode" / Keep-Discard complexity from the earlier plan: import is always non-destructive.

## B.1 — Set Storage

### localStorage schema (new key)
```js
// Key: 'chromascale-sets'
{
  v: 1,
  activeId: "k7x2a9",
  sets: [
    {
      id: "k7x2a9",                    // random short ID, stable across sessions
      name: "My Palette",
      modified: 1708876800000,         // Date.now() on last change, for sorting/display
      config: {                        // identical to ScaleManager.toConfig() minus selectedId
        lightnessMax: 1.0,
        lightnessMin: 0.15,
        scales: [{ name, keyColors, curvePoints? }, …]
      }
    },
    …
  ]
}
```

**Note on curve points:** unlike current localStorage (which drops them), Sets storage uses `toConfig()` which includes `curvePoints`. This means **curve edits now persist across reloads** — a quiet upgrade from v3.x behavior.

### Migration from v3.x
On first load in v4, if `'chromascale-sets'` doesn't exist but the old `'chromascale-color-scales'` key does:
1. Read old format
2. Wrap in a single Set: `{ id: <random>, name: "My Palette", modified: Date.now(), config: <old data reshaped> }`
3. Write to new key
4. Delete old key

Silent, one-time, preserves the user's existing work.

### SetStore (new, ~60 LOC)
Lightweight manager on `window.SetStore` (or inline in `ui.js` — decide at implementation):

```js
class SetStore {
  load()                        // read from localStorage, migrate if needed
  save()                        // write to localStorage
  getActive()                   // → {id, name, modified, config}
  switchTo(id)                  // save current active, change activeId, return new active
  create(name, config?)         // new set; config defaults to DEFAULTS; returns id
  duplicate(id)                 // clone set, append " copy" to name; returns new id
  rename(id, name)
  delete(id)                    // throw if last set
  list()                        // → sets sorted by modified desc
}
```

`App` owns a `SetStore` instance. Current manager state auto-saves to the active set on every change (same cadence as current localStorage writes, but scoped to the active set's `config`).

## B.2 — Set Switcher UI (dropdown + modal)

### Header dropdown (quick switch)
In `.header-left`, next to the logo:

```
ChromaScale  [My Palette ▾]
                   │
                   ▼
       ┌────────────────────┐
       │ ● My Palette       │  ← active (dot indicator)
       │   Brand 2026       │
       │   Client X         │
       │ ─────────────────  │
       │   Manage sets…     │  ← opens modal
       └────────────────────┘
```

- Click a set name → `store.switchTo(id)` → load config into manager → `_render()`
- "Manage sets…" → opens the management modal
- Reuses existing `.scale-dropdown` styling patterns

### Management modal
Opens from "Manage sets…" in the dropdown, or optionally from a dedicated header button:

```
┌──────────────────────────────────────────────────────┐
│  Sets                                            [×] │
├──────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────┐  │
│  │ ▪▪▪▪▪  My Palette              9 scales    [⋮]│  │  ← active (highlighted)
│  │        Modified 2 hours ago                    │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │ ▪▪▪▪▪  Brand 2026              6 scales    [⋮]│  │
│  │        Modified yesterday                      │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Each [⋮] opens:  Open · Rename · Duplicate · Delete │
│                                                      │
│  ─────────────────────────────────────────────────   │
│  [+ New set]  [↓ Import…]                            │
└──────────────────────────────────────────────────────┘
```

- **Swatch strip `▪▪▪▪▪`** — 5 tiny squares showing primary scale's steps 100/300/500/700/900 (optional polish, ~15 LOC)
- **Per-set `[⋮]` menu**: Open (= switch + close modal), Rename (inline edit), Duplicate, Delete (confirm, can't delete last)
- **"New set"** → creates from DEFAULTS, prompts for name
- **"Import…"** → opens the import section of the share dialog (or inline paste field)
- **Relative timestamps** — "2 hours ago" via simple formatter (~10 LOC), no library

## B.3 — URL Encoding (unchanged from earlier plan)

### Format
```
#s=<base64url(gzip(JSON.stringify(payload)))>
```

- Hash fragment — never sent to server, no practical length limit
- Native `CompressionStream('gzip')` / `DecompressionStream('gzip')` — no deps, async
- base64url — `+→-`, `/→_`, strip `=` padding

### Payload
```js
{
  v: 1,                    // format version
  name: "Brand 2026",      // set name — becomes the suggested name on import
  lMax: 1.0,
  lMin: 0.15,
  scales: [
    {
      n: "Blue",
      k: ["3B82F6", …],    // hex without '#'
      c: [[x,y], …]?,      // chroma curve — ONLY if differs from _initCurves() output
      h: [[x,y], …]?       // hue curve — ONLY if differs
    },
    …
  ]
}
```

Short keys, 3-decimal float precision.

### Curve-point diff check
For each scale: build a throwaway `Scale` from the same key colors, call `_initCurves()`, compare point arrays with epsilon `1e-4`. Omit `c`/`h` if identical. Keeps URLs short for the common case.

## B.4 — Share Dialog

Button in `.header-actions` (icon: `share` — add to icons.js).

```
┌─────────────────────────────────────────┐
│  Share "My Palette"                 [×] │
├─────────────────────────────────────────┤
│  Full URL                               │
│  ┌─────────────────────────────┐        │
│  │ file:///…/index.html#s=eyJ… │ [Copy] │
│  └─────────────────────────────┘        │
│                                         │
│  Parameters only                        │
│  ┌─────────────────────────────┐        │
│  │ eyJ2IjoxLCJuYW1lIjoi…       │ [Copy] │
│  └─────────────────────────────┘        │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  Import a set                           │
│  ┌─────────────────────────────┐        │
│  │ Paste URL or parameters…    │        │
│  └─────────────────────────────┘        │
│                           [Import]      │
└─────────────────────────────────────────┘
```

- **Full URL** = `location.href.split('#')[0] + '#s=' + encoded`
- **Parameters only** = just the encoded string (no `s=` prefix — keeps it symmetric with what decode accepts)
- **Import field** accepts either; strip any leading URL/`#s=` before decoding
- Import → decode → show confirmation (see B.5) → create new set

## B.5 — Import Confirmation Flow

Triggered by **URL hash on page load** OR by **paste in share dialog's import field**.

After successful decode:

```
┌─────────────────────────────────────────┐
│  Import set                             │
├─────────────────────────────────────────┤
│  Name                                   │
│  ┌─────────────────────────────────────┐│
│  │ Brand 2026                          ││  ← pre-filled from payload.name
│  └─────────────────────────────────────┘│
│                                         │
│  6 scales · 47 key colors               │  ← quick summary
│                                         │
│              [Cancel]  [Import]         │
└─────────────────────────────────────────┘
```

- **Name field** pre-filled from `payload.name`, user can edit
- **Collision handling**: if a set with that name exists, append ` (2)`, ` (3)`, etc. on import (or show a subtle warning and let user decide)
- **Import** → `store.create(name, config)` → `store.switchTo(newId)` → clear URL hash → close confirmation → `_render()`
- **Cancel** → clear URL hash, stay on current set

**URL hash clearing**: `history.replaceState(null, '', location.pathname + location.search)` — preserves any query params, drops the hash. Prevents re-prompting on reload.

## B.6 — Load Flow (replaces `async init()` plan from earlier)

```js
async init() {
  this.store = new SetStore();
  this.store.load();                       // reads localStorage, migrates if needed

  if (this.store.sets.length === 0) {
    this.store.create("My Palette", DEFAULTS_CONFIG);
  }

  // Check for shared URL
  const hash = location.hash;
  if (hash.startsWith('#s=')) {
    try {
      const payload = await decodeState(hash.slice(3));
      this._pendingImport = payload;       // defer prompt until after first render
    } catch (e) {
      // Invalid hash — show toast, clear hash, continue normally
    }
  }

  const active = this.store.getActive();
  this._loadConfigIntoManager(active.config);
  this._render();

  if (this._pendingImport) {
    this._showImportConfirmation(this._pendingImport);
  }
}
```

The import prompt appears *over* the user's normal loaded state — if they cancel, their own set is already visible underneath.

## B.7 — Files Changed

### New file: `sets.js` (~100 LOC)
- `SetStore` class (load/save/create/duplicate/rename/delete/switchTo/list/getActive)
- `encodeSet(name, managerConfig)` → async, returns encoded string
- `decodeSet(str)` → async, returns payload
- `gzip(str)` / `gunzip(bytes)` / `base64url(bytes)` / `unbase64url(str)` utilities
- Conditional `module.exports` for Node testing

### `ui.js`
- Constructor → `async init()` refactor; `DOMContentLoaded` awaits it
- Add `this.store = new SetStore()` initialization
- Replace `_saveToLocalStorage()` → `_saveActiveSet()` (writes `manager.toConfig()` into `store.getActive().config`, bumps `modified`, calls `store.save()`)
- Replace `_loadFromLocalStorage()` → `_loadConfigIntoManager(config)` (applies config to `this.manager`, regenerates scales)
- Remove `_resetToDefaults()` — replaced by "New set" which creates a fresh set
- Add set switcher dropdown in `.header-left` markup + click handlers
- Add `_showSetsModal()` — management modal with rename/duplicate/delete
- Add `_showShareDialog()` — share + import
- Add `_showImportConfirmation(payload)` — name field + Import/Cancel
- Add share button in `.header-actions`

### `icons.js`
- Add `share` icon
- Add `folder` or `stack` icon for Sets (dropdown trigger / modal header)
- Add `duplicate` icon (for set actions)

### `style.css`
- `.set-switcher` dropdown (reuse `.scale-dropdown` patterns)
- `.sets-modal` + `.set-card` + `.set-swatch-strip` + `.set-card-actions`
- `.share-dialog` (reuse `.modal` patterns)
- `.import-confirm` (small modal, reuse patterns)

### `index.html`
- Add `<script src="sets.js"></script>` before `ui.js`

### `scale-manager.js`
- `toConfig()` / `fromConfig()` already exist and are tested — **no changes needed** (dark-mode keys already removed in Part A)

### `ui.html`
- Add Set switcher dropdown demo
- Add Sets management modal demo
- Add Share dialog demo
- Add Import confirmation demo
- Update Class index

### Tests
- `tests/sets.test.js` — SetStore CRUD, encode/decode round-trip, curve-diff omission, base64url edge cases (binary data with `/` and `+`), version check, migration from old localStorage format

### Documentation
- `README.md` — add Sets + sharing bullets
- `DESIGN.md` — add "Sets" section (storage schema, switcher UI, modal), "URL Sharing" section (encoding format, import flow)
- `CHANGELOG.md` — v4.0.0 entry

## B.8 — Complexity Summary

| Item | LOC estimate |
|---|---|
| `sets.js` (SetStore + encode/decode + utils) | ~100 |
| ui.js: set switcher dropdown + handlers | ~40 |
| ui.js: sets management modal | ~70 |
| ui.js: share dialog | ~50 |
| ui.js: import confirmation | ~30 |
| ui.js: init refactor + load/save rework | ~30 (net — replaces existing ~40 LOC) |
| style.css: all new components | ~80 |
| icons.js | ~5 |
| Tests | ~60 |
| **Total net add** | **~425 LOC** |

Offsets ~85 LOC saved by not needing shared-view mode/banner/Keep-Discard. Net ~340 LOC for the whole Sets + Sharing layer.

---

# Execution Order

## Phase 1 — Dark mode removal
1. `scale-manager.js` — remove dark generation + simplify exports (foundation)
2. `ui.js` — remove mode toggle + all `viewMode` reads (depends on step 1's `getSteps` removal)
3. `style.css` — remove `body.dark-mode` + `.mode-*` blocks
4. `figma-push.js` — single-mode push
5. Update existing tests to pass
6. `ui.html` sync
7. DESIGN.md / README dark-mode references removed

**Checkpoint:** app works identically to "light mode" of v3.1.0. All tests pass. No dark-mode UI anywhere.

## Phase 2 — Sets infrastructure
8. Create `sets.js`: `SetStore` class (CRUD + localStorage + migration)
9. ui.js: `async init()` refactor, replace `_saveToLocalStorage`/`_loadFromLocalStorage` with set-aware equivalents
10. Wire auto-save to active set on every change
11. Test migration: load app with old localStorage key, verify it wraps into a single set
12. `tests/sets.test.js` — SetStore CRUD + migration

**Checkpoint:** app behaves exactly like Phase 1 but under the hood stores state in the sets schema. No visible UI changes yet.

## Phase 3 — Sets UI
13. Set switcher dropdown in header-left
14. Sets management modal (list, rename, duplicate, delete, new)
15. style.css for both
16. `ui.html` sync

**Checkpoint:** can create/switch/rename/duplicate/delete sets. State persists correctly when switching.

## Phase 4 — URL sharing
17. `sets.js`: encode/decode + gzip/base64url utilities
18. Share dialog (copy full URL / params, paste to import)
19. Import confirmation dialog
20. URL hash detection in `init()` → pending import → confirmation prompt after render
21. `tests/sets.test.js` additions — encode/decode round-trip, curve-diff
22. `ui.html` sync

**Checkpoint:** full share round-trip works across fresh tabs.

## Phase 5 — Finalize
23. CHANGELOG v4.0.0 entry
24. README + DESIGN.md updates
25. Tag `v4.0.0`

---

# Verification

- `node --test tests/` — all pass
- Open `index.html` via `file://` — app loads, no dark mode UI anywhere
- **Migration:** open with old `chromascale-color-scales` key in localStorage → auto-migrates to `chromascale-sets`, existing palette appears as "My Palette" set
- **Switching:** create two sets, edit both, switch back and forth → edits preserved
- **Duplicate:** duplicate a set, edit the copy → original unchanged
- **Delete:** delete a set → gone, can't delete the last one
- **Share:** create a share URL, open in fresh tab (cleared localStorage) → import prompt appears → confirm → set reproduced exactly as a new set
- **Curve persistence:** drag a curve handle, switch sets and back → curve edit preserved (this is new vs v3.x!)
- **Curve in URL:** drag a curve, share → payload includes `c`/`h`. Don't drag, share → no `c`/`h` (verify in devtools decode)
- **Cancel import:** open shared URL, cancel → own sets intact, URL hash cleared

---

# Open Questions / Known Risks

- **CompressionStream async** means URL-hash decode happens after first paint (we defer the import prompt). This is actually *better* UX than blocking — user sees their own workspace load, then a prompt appears over it.
- **base64url** — easy to implement but easy to get wrong. Test with binary data containing `/`, `+`, and trailing zeros.
- **Curve-diff check** depends on `_initCurves()` being deterministic and stable across versions. It is (pure function of key colors). If the curve-init algorithm ever changes, old shared URLs with omitted curves would render slightly different curves — acceptable drift.
- **Figma single-mode** — Figma collections always have a default mode, so `UPDATE` on that mode is safe.
- **localStorage size** — each set is ~1–5 KB (with curves). 100 sets = ~500 KB, well under the 5–10 MB browser limit. No practical cap needed.
- **Name collisions on import** — append ` (2)` suffix on create if name exists. Simple, no prompts.
- **"New set" source** — starts from DEFAULTS (9 standard scales). User can delete unwanted scales from there. Simpler than offering "blank vs defaults" choice.

---

# Deferred / Not in v4

- Unit tests for `color-engine.js` (from old plan) — still valuable but orthogonal to v4 features
- Export/import sets as JSON files (for email/disk sharing without URLs) — natural follow-up, ~30 LOC
- Set "tags" or folders — over-engineering for now
- Cloud sync — out of scope, keep it local-first
