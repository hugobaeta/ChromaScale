# ChromaScale v5.2 — HTML-First Restructure

**Goal:** Move static content out of JS template strings into `index.html`. Use native `<dialog>`, Popover API, and Invoker Commands with graceful fallback. JS becomes a slot-filler and behavior layer, not a markup generator.

**Guiding principles:**
- If it never changes → HTML
- If it's a list of N things → JS builds the list, HTML holds the container
- If it's a value in a fixed slot → HTML has the slot (`<span data-slot="...">`), JS fills it
- Open/close behavior → native attributes (`commandfor`, `popovertarget`) where possible

---

## Browser support & fallback strategy

| Feature | Support | Our use |
|---|---|---|
| `<dialog>` + `showModal()` | Baseline 2022, ~97% | All modals |
| Popover API (`popover`, `popovertarget`) | Baseline 2024, ~93% | Settings, dropdowns, tooltips |
| Invoker Commands (`command`, `commandfor`) | Dec 2025, ~79% | Declarative `show-modal` trigger |
| CSS Anchor Positioning | ~85% | Already in use (tooltips, popovers) |

**Fallback approach:** Put `commandfor`/`command` attributes on trigger buttons. If the browser doesn't support them, a ~15-line polyfill in `ui.js` finds `[commandfor]` buttons and wires a click handler to call `.showModal()` / `.close()`. Invoker-capable browsers ignore the JS handler (native wins via `e.preventDefault()` check on `command` events is unnecessary — native commands fire before click).

```js
// Polyfill for commandfor when not native
if (!('command' in HTMLButtonElement.prototype)) {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[commandfor]');
    if (!btn) return;
    const target = document.getElementById(btn.getAttribute('commandfor'));
    if (!target) return;
    const cmd = btn.getAttribute('command');
    if (cmd === 'show-modal' && target.showModal) target.showModal();
    else if (cmd === 'close' && target.close) target.close();
    else if (cmd === 'toggle-popover' && target.togglePopover) target.togglePopover();
  });
}
```

No polyfill needed for `popovertarget` — that's our support floor already.

---

## Inventory & decisions

Ranked by how much static content is trapped in JS:

| Component | Static % | Target | Slot count | Behavior after |
|---|---|---|---|---|
| About modal | 100% | `<dialog>` in HTML | 0 | Zero JS |
| Ghost new-scale column | 100% | HTML | 0 | Click handler only |
| Scroll arrows | 100% | HTML | 0 | Click + IntersectionObserver |
| Scale dropdown | ~90% | `<div popover>` in HTML | 2 labels toggle | Minimal JS |
| Export modal | ~70% | `<dialog>` in HTML | 4 `<pre>` + selectors | JS fills content on open |
| Share modal | ~60% | `<dialog>` in HTML | 2 fields + 1 conditional | JS fills on open |
| Import confirm | ~60% | `<dialog>` in HTML | 2 text + 1 input default | JS fills on open |
| Settings popover | ~60% | `<div popover>` in HTML | 5 inputs | JS fills + handles commit |
| Curve panel | ~30% | HTML shell | Scale name, validation | Canvas + callbacks stay JS |
| Set dropdown | ~10% | HTML popover shell | Entire list is dynamic | JS builds list on open |
| Source panel | ~5% | Keep JS-built | — | Inline overlay, per-scale |
| Scale columns | 0% | Keep JS-built | — | Generated per scale |
| Figma panel | 0% | Keep JS-built | — | Genuinely state-driven |
| Tooltip | — | Keep as-is | — | Already `popover="manual"` |

---

## New conventions

### Slot pattern
Named elements JS can find and populate:
```html
<span data-slot="activeSetName">—</span>
<pre data-slot="cssExport"></pre>
<input data-slot="shareUrl" readonly>
```
```js
const slot = (name) => document.querySelector(`[data-slot="${name}"]`);
slot('activeSetName').textContent = this.store.getActive().name;
```

### Conditional sections
```html
<section data-show-if="httpUrl">…</section>
```
```js
const showIf = (flag, cond) => {
  document.querySelectorAll(`[data-show-if="${flag}"]`).forEach(el => el.hidden = !cond);
};
```

### Icons → inline SVG sprite
Currently `icon('x', 14)` generates SVG strings in JS. Problem: icons in HTML would duplicate the paths.

**Solution:** inline sprite sheet in `index.html`:
```html
<svg width="0" height="0" style="position:absolute">
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></symbol>
  <symbol id="i-info" viewBox="0 0 24 24">...</symbol>
  <!-- ... all 28 icons -->
</svg>
```

HTML usage:
```html
<svg width="14" height="14"><use href="#i-x"/></svg>
```

`icon()` in `icons.js` changes to emit `<use>` references too:
```js
function icon(name, size) {
  return `<svg width="${size}" height="${size}" class="icon"><use href="#i-${name}"/></svg>`;
}
```

Both HTML and JS reference the same sprite. No duplication. `icons.js` shrinks from path data to symbol-builder (runs once at startup).

### `::backdrop` replaces `.modal-overlay`
```css
dialog::backdrop {
  background: rgba(0,0,0,0.35);
  backdrop-filter: blur(3px);
}
dialog { /* existing .modal styles */ }
```
Delete `.modal-overlay` wrapper div entirely.

### `_render()` becomes targeted
Current: `this.root.innerHTML = ''; _renderHeader(); _renderMain(); _renderCurvePanel();`

New: Header lives in HTML, never destroyed. Only `_updateHeaderSlots()` (sets activeSetName). `_renderScales()` rebuilds just `#scales-container` children. Curve panel is a `hidden` HTML element; `_openCurvePanel()` fills its slots + un-hides.

This is the **biggest risk** — many places call `_render()` to reset everything. Each call site needs to be audited and replaced with the minimum targeted update.

---

## Phases

### Phase 0 — Foundations (no user-visible change)
- [ ] Build inline SVG sprite in `index.html` from `ICON_PATHS`/`ICON_FILL_PATHS`
- [ ] Rewrite `icon()` to emit `<use>` refs
- [ ] Add `commandfor` polyfill (~15 lines)
- [ ] Add `slot()` / `showIf()` helpers
- [ ] Add `dialog::backdrop` styles matching `.modal-overlay`
- [ ] **Checkpoint:** app renders identically, all tests pass

### Phase 1 — About modal (proof of concept)
- [ ] Move full About markup into `index.html` as `<dialog id="about-dialog">`
- [ ] Change header button to `commandfor="about-dialog" command="show-modal"`
- [ ] Close button uses `<form method="dialog"><button>` (native close)
- [ ] Delete `_showAboutModal()` entirely
- [ ] **Checkpoint:** open/close, Esc, backdrop click all work; verify in browser without invoker commands (Safari 17 or similar)

### Phase 2 — Remaining modals (Export, Share, Import)
- [ ] Export: `<dialog>` shell in HTML with tabs, `<pre data-slot>` per format, action buttons. `_showExportModal()` becomes `_populateExportDialog()` — fills pres, wires copy/download, then `showModal()`. Figma tab container stays `<div id="figma-api-container">` — `figmaPusher.renderPanel()` untouched.
- [ ] Share: shell with `<section data-show-if="httpUrl">`, two `<input data-slot>` for URL/params, import field. Populate-on-open.
- [ ] Import confirm: shell with `<span data-slot="importScaleCount">` etc, name input. This one is tricky — it's **parameterized** by the decoded payload. Store the pending payload in a property; the open handler reads it.
- [ ] Tab switching in Export: can be CSS-only via `:has(:checked)` on radio inputs, or keep JS. **Decision needed.**
- [ ] **Checkpoint:** all modals open/close, content correct, Figma panel still works

### Phase 3 — Popovers & dropdowns
- [ ] Settings: `<div popover id="settings-popover">` shell. Inputs have `data-slot` attributes; populate on `toggle` event (fires on open). Commit handlers stay JS.
- [ ] Scale dropdown: `<div popover>` with 4 static `<button>` items. Labels need JS toggle (e.g., "Curve editor" ↔ "Close curve editor") — use `data-open-label` / `data-close-label` attrs, JS swaps text. **Complication:** there's one dropdown per scale column, not one global dropdown. Either (a) one shared popover repositioned via anchor (preferred), or (b) keep it JS-built. Going with (a).
- [ ] Set dropdown: `<div popover>` shell + `<div id="set-list">` container. JS builds the list into the container on `toggle`. "New set" button stays static in HTML.
- [ ] Ghost column + scroll arrows: move to HTML inside the wrapper; JS only binds click handlers
- [ ] **Checkpoint:** all popovers open/close via `popovertarget`, light-dismiss works, Esc works

### Phase 4 — Rendering model shift
- [ ] Header stays in HTML; `_updateHeaderSlots()` just sets `activeSetName`
- [ ] `_render()` → `_renderScales()` (rebuilds only `#scales-container`) + `_updateHeaderSlots()`
- [ ] Audit all `_render()` callers (~15 sites):

| Call site | Why it renders | Replacement |
|---|---|---|
| `init()` | Initial load | Keep — but header already exists |
| `_switchSet()` | New set loaded | `_renderScales()` + `_updateHeaderSlots()` |
| `onLimitChange` | lMax/lMin changed | `_renderScales()` |
| `commitSteps` | Step schedule changed | `_renderScales()` |
| Divisor change | isMajor changed | `_renderScales()` (or `_refreshSwatches` if we're clever) |
| Scale add/remove/rename/move | List changed | `_renderScales()` |
| Set dropdown "New set" / delete | Switch happened | `_renderScales()` + `_updateHeaderSlots()` + reopen dropdown |

- [ ] Curve panel becomes `<div hidden>` in HTML. `_openCurvePanel()` fills slots, creates CurveEditor in the container, un-hides. `_closeCurvePanel()` hides + destroys editor.
- [ ] **Checkpoint:** everything still works, no visual regressions, undo the settings-popover-reopen dance (popover stays open through `_renderScales()` now since header isn't destroyed)

### Phase 5 — Polish & docs
- [ ] Delete dead code: `.modal-overlay` CSS, old JS modal creators
- [ ] `DESIGN.md`: document the slot/showIf pattern, the popover/dialog distinction, the render-model shift
- [ ] `ui.html`: update demos for new `<dialog>`/`popover` markup
- [ ] `CHANGELOG.md`: v5.2 entry
- [ ] Consider: can the Export tabs be CSS-only (`<input type="radio">` + `:checked ~` sibling selector)? Would eliminate tab JS.

---

## Files changed

| File | Nature of change |
|---|---|
| `index.html` | **Major** — grows from 20 lines to ~400. Sprite sheet, 4 dialogs, settings/scale/set popovers, header, scroll arrows, ghost column, curve-panel shell |
| `icons.js` | **Rewrite** — builds sprite sheet on load; `icon()` emits `<use>` |
| `ui.js` | **Major** — delete modal creators (~250 lines), delete `_renderHeader()`, rewrite `_render()` as `_renderScales()` + slot helpers, add `commandfor` polyfill |
| `style.css` | Medium — `::backdrop`, `dialog[open]` states, delete `.modal-overlay`, popover-as-popover (not JS-positioned) styles |
| `figma-push.js` | None |
| `curve-editor.js` | None |
| `scale-manager.js` | None |
| `sets.js` | None |
| `DESIGN.md` | Architecture section rewrite |
| `ui.html` | Demo sync |
| `CHANGELOG.md` | v5.2 entry |

**Net LOC estimate:** `index.html` +380, `ui.js` -250, `icons.js` -20, `style.css` +30/-20. Roughly +120 total, but content moves to a more editable place.

---

## Risks & open questions

| Risk | Mitigation |
|---|---|
| **`_render()` audit misses a site** — something calls it expecting full nuke, gets partial | Search exhaustively; keep `_render()` as an alias for `_renderScales()` + `_updateHeaderSlots()` during transition |
| **Settings-popover-inside-header** — currently the reopen-after-render dance exists because `_render()` destroys it. If header stays in HTML, the popover survives, but its *values* are stale after a lMax change. Need to re-populate slots on every change, not just on open. | Wire `_updateSettingsSlots()` called after every setting commit |
| **Scale dropdown as shared popover** — one `<div popover>` repositioned to whichever "..." was clicked. Anchor positioning makes this clean, but the dropdown needs to know *which* scale it's acting on. Store on the popover element (`popover.dataset.scaleId`) before opening. | Click handler sets `scaleId` then calls `showPopover()` |
| **Import-confirm parameterization** — the payload varies per import. Can't put the data in HTML. | Store `this._pendingImport = payload` before `showModal()`; `_populateImportDialog()` reads it |
| **Icon sprite FOUC** — if sprite is at bottom of `<body>`, `<use>` refs in the header resolve to nothing until parse completes. | Put sprite at *top* of `<body>`, right after `<div id="app">`. Or in `<head>` (valid for inline SVG). |
| **Testing** — no automated DOM tests; this is a large refactor of the UI layer. Manual test surface is big. | Do it phase-by-phase with a checkpoint after each. Don't rush. |

**Open question — Export tabs:** pure CSS tab switching via `<input type="radio" name="export-tab">` + `:checked` sibling selectors works but is fiddly (requires specific DOM order). JS version is 10 lines. Worth it? *Lean: keep JS, it's trivial behavior code not content.*

**Open question — v5.2 or v6.0?** This is a big internal restructure but zero user-facing feature changes. Semver says minor (5.1). But if the `_render()` shift breaks anything subtle, it's a breaking change to how the app can be extended. *Lean: 5.1 since no public API.*

---

## Estimated scope

This is roughly the same size as the v5.0.0 refactor (~1400 LOC touched). Phase 0+1 is a good standalone increment to validate the approach; phases 2-4 can follow once that's solid.
