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

// ---- URL encoding (gzip + base64url) ------------------------------
// These are async because CompressionStream/DecompressionStream are
// stream-based. The pipeline is: JSON → UTF-8 bytes → gzip → base64url.

async function gzip(str) {
  const bytes = new TextEncoder().encode(str);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

function base64urlEncode(bytes) {
  // chunk to avoid "Maximum call stack size exceeded" on large inputs
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  // restore standard base64 alphabet + padding
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Serialize a payload → compact URL-safe string
async function encodeSet(payload) {
  // Stabilize float precision to 3 decimals to keep URLs short & deterministic
  const json = JSON.stringify(payload, (k, v) =>
    typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v
  );
  return base64urlEncode(await gzip(json));
}

// Parse an encoded string → payload. Throws on bad input.
async function decodeSet(str) {
  const json = await gunzip(base64urlDecode(str));
  const payload = JSON.parse(json);
  if (payload.v !== 1) throw new Error(`Unsupported share format v${payload.v}`);
  if (!Array.isArray(payload.scales) || payload.scales.length === 0) {
    throw new Error('Share payload has no scales');
  }
  return payload;
}

// ---- exports ------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SetStore, SETS_KEY, OLD_KEY,
    encodeSet, decodeSet, base64urlEncode, base64urlDecode, gzip, gunzip
  };
}
if (typeof window !== 'undefined') {
  window.SetStore = SetStore;
  window.encodeSet = encodeSet;
  window.decodeSet = decodeSet;
}
