// ChromaScale — Sets (named workspaces)
// SetStore manages multiple named configs in localStorage.
// Phase 2 scope: CRUD + migration. Encode/decode for URL sharing lands in Phase 4.

const SETS_KEY = 'chromascale-sets';
const OLD_KEY = 'chromascale-color-scales';

function genId() {
  // Short, URL-safe, non-colliding in practice (36^6 ≈ 2.1B)
  return Math.random().toString(36).slice(2, 8);
}

class SetStore {
  constructor() {
    this.sets = [];
    this.activeId = null;
  }

  // ---- persistence ------------------------------------------------

  load() {
    let raw;
    try { raw = localStorage.getItem(SETS_KEY); } catch (e) { raw = null; }

    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.sets)) {
          this.sets = data.sets;
          this.activeId = data.activeId;
          // sanity: activeId must point to an existing set
          if (!this.sets.some(s => s.id === this.activeId)) {
            this.activeId = this.sets[0]?.id ?? null;
          }
          return;
        }
      } catch (e) { /* fall through to migration / empty */ }
    }

    // No sets key — try migrating from old single-palette key
    this._migrateOldKey();
  }

  _migrateOldKey() {
    let old;
    try { old = localStorage.getItem(OLD_KEY); } catch (e) { return; }
    if (!old) return;

    let data;
    try { data = JSON.parse(old); } catch (e) { return; }

    // Old format was either:
    //   (a) array of {name, keyColors, whiteLimit?, blackLimit?}
    //   (b) object {lightnessMax?, lightnessMin?, whiteLimit?, blackLimit?, scales: [...]}
    // Normalize to {lightnessMax, lightnessMin, scales: [{name, keyColors}]}
    let config;
    if (Array.isArray(data)) {
      if (data.length === 0) return;
      const first = data[0];
      config = {
        lightnessMax: first.whiteLimit ?? 1.0,
        lightnessMin: first.blackLimit ?? 0.15,
        scales: data.map(s => ({ name: s.name, keyColors: s.keyColors }))
      };
    } else if (data && Array.isArray(data.scales) && data.scales.length > 0) {
      config = {
        lightnessMax: data.lightnessMax ?? data.whiteLimit ?? 1.0,
        lightnessMin: data.lightnessMin ?? data.blackLimit ?? 0.15,
        scales: data.scales.map(s => ({ name: s.name, keyColors: s.keyColors }))
      };
    } else {
      return;
    }

    const id = genId();
    this.sets = [{
      id,
      name: 'My Palette',
      modified: Date.now(),
      config
    }];
    this.activeId = id;

    // Persist and clean up old key
    this.save();
    try { localStorage.removeItem(OLD_KEY); } catch (e) { /* ignore */ }
  }

  save() {
    try {
      localStorage.setItem(SETS_KEY, JSON.stringify({
        v: 1,
        activeId: this.activeId,
        sets: this.sets
      }));
    } catch (e) { /* quota or disabled — swallow */ }
  }

  // ---- CRUD -------------------------------------------------------

  getActive() {
    return this.sets.find(s => s.id === this.activeId) ?? null;
  }

  _uniqueName(base) {
    const names = new Set(this.sets.map(s => s.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} (${n})`)) n++;
    return `${base} (${n})`;
  }

  create(name, config) {
    const id = genId();
    this.sets.push({
      id,
      name: this._uniqueName(name),
      modified: Date.now(),
      // deep copy — callers may pass a live manager config
      config: JSON.parse(JSON.stringify(config))
    });
    this.save();
    return id;
  }

  duplicate(id) {
    const src = this.sets.find(s => s.id === id);
    if (!src) throw new Error('Set not found');
    return this.create(`${src.name} copy`, src.config);
  }

  rename(id, name) {
    const s = this.sets.find(s => s.id === id);
    if (!s) throw new Error('Set not found');
    s.name = name;
    s.modified = Date.now();
    this.save();
  }

  delete(id) {
    if (this.sets.length <= 1) throw new Error('Cannot delete the last set');
    const idx = this.sets.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Set not found');
    this.sets.splice(idx, 1);
    if (this.activeId === id) {
      this.activeId = this.sets[0].id;
    }
    this.save();
  }

  switchTo(id) {
    if (!this.sets.some(s => s.id === id)) throw new Error('Set not found');
    this.activeId = id;
    this.save();
    return this.getActive();
  }

  // Update the active set's config (called on every app-level change)
  updateActive(config) {
    const s = this.getActive();
    if (!s) return;
    s.config = config;
    s.modified = Date.now();
    this.save();
  }

  list() {
    // most-recently-modified first
    return [...this.sets].sort((a, b) => b.modified - a.modified);
  }
}

// ---- exports ------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SetStore, SETS_KEY, OLD_KEY };
}
if (typeof window !== 'undefined') {
  window.SetStore = SetStore;
}
