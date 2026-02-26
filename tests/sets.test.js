const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ---- localStorage mock (in-memory Map) ---------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

const {
  SetStore, SETS_KEY, OLD_KEY,
  encodeSet, decodeSet, base64urlEncode, base64urlDecode
} = require('../sets.js');

beforeEach(() => store.clear());

// ---- fixtures ----------------------------------------------------
const cfgA = () => ({
  lightnessMax: 1.0,
  lightnessMin: 0.15,
  scales: [{ name: 'Blue', keyColors: ['#2c84db'] }]
});
const cfgB = () => ({
  lightnessMax: 0.95,
  lightnessMin: 0.2,
  scales: [
    { name: 'Red', keyColors: ['#e04343'] },
    { name: 'Green', keyColors: ['#76ad2a'] }
  ]
});

// ------------------------------------------------------------------

describe('SetStore — empty load', () => {
  it('starts empty when no localStorage data', () => {
    const s = new SetStore();
    s.load();
    assert.equal(s.sets.length, 0);
    assert.equal(s.activeId, null);
    assert.equal(s.getActive(), null);
  });
});

describe('SetStore — create / switchTo / getActive', () => {
  it('create returns id, set is retrievable, config is deep-copied', () => {
    const s = new SetStore();
    s.load();
    const cfg = cfgA();
    const id = s.create('Alpha', cfg);

    assert.equal(typeof id, 'string');
    assert.ok(id.length >= 4);
    assert.equal(s.sets.length, 1);

    // mutating the source config must not affect stored copy
    cfg.scales[0].name = 'MUTATED';
    assert.equal(s.sets[0].config.scales[0].name, 'Blue');
  });

  it('switchTo sets activeId and getActive returns the set', () => {
    const s = new SetStore();
    s.load();
    const idA = s.create('A', cfgA());
    const idB = s.create('B', cfgB());

    s.switchTo(idB);
    assert.equal(s.activeId, idB);
    assert.equal(s.getActive().name, 'B');

    s.switchTo(idA);
    assert.equal(s.getActive().name, 'A');
  });

  it('switchTo unknown id throws', () => {
    const s = new SetStore();
    s.load();
    s.create('A', cfgA());
    assert.throws(() => s.switchTo('nope'), /not found/i);
  });

  it('auto-dedupes names with (2), (3) suffix', () => {
    const s = new SetStore();
    s.load();
    s.create('Foo', cfgA());
    s.create('Foo', cfgA());
    s.create('Foo', cfgA());
    const names = s.sets.map(x => x.name);
    assert.deepEqual(names.sort(), ['Foo', 'Foo (2)', 'Foo (3)']);
  });
});

describe('SetStore — duplicate / rename / delete', () => {
  it('duplicate produces independent config with " copy" suffix', () => {
    const s = new SetStore();
    s.load();
    const id = s.create('Original', cfgB());
    const dupId = s.duplicate(id);

    assert.notEqual(dupId, id);
    const dup = s.sets.find(x => x.id === dupId);
    assert.equal(dup.name, 'Original copy');

    // independence check
    dup.config.scales[0].name = 'changed';
    const orig = s.sets.find(x => x.id === id);
    assert.equal(orig.config.scales[0].name, 'Red');
  });

  it('rename updates name and bumps modified', async () => {
    const s = new SetStore();
    s.load();
    const id = s.create('Old', cfgA());
    const before = s.sets[0].modified;
    // ensure timestamp advances
    await new Promise(r => setTimeout(r, 5));
    s.rename(id, 'New');
    assert.equal(s.sets[0].name, 'New');
    assert.ok(s.sets[0].modified > before);
  });

  it('delete removes set; refuses last remaining', () => {
    const s = new SetStore();
    s.load();
    const idA = s.create('A', cfgA());
    const idB = s.create('B', cfgB());

    s.switchTo(idA);
    s.delete(idB);
    assert.equal(s.sets.length, 1);
    assert.equal(s.sets[0].id, idA);
    assert.equal(s.activeId, idA);

    assert.throws(() => s.delete(idA), /last set/i);
  });

  it('deleting active set reassigns activeId to first remaining', () => {
    const s = new SetStore();
    s.load();
    const idA = s.create('A', cfgA());
    const idB = s.create('B', cfgB());

    s.switchTo(idA);
    s.delete(idA);
    assert.equal(s.activeId, idB);
  });
});

describe('SetStore — updateActive', () => {
  it('replaces active config and persists', () => {
    const s = new SetStore();
    s.load();
    const id = s.create('X', cfgA());
    s.switchTo(id);

    s.updateActive(cfgB());
    assert.equal(s.getActive().config.scales.length, 2);

    // round-trip through a fresh store
    const s2 = new SetStore();
    s2.load();
    assert.equal(s2.getActive().config.scales.length, 2);
    assert.equal(s2.getActive().config.lightnessMax, 0.95);
  });
});

describe('SetStore — list', () => {
  it('returns sets sorted by modified desc', async () => {
    const s = new SetStore();
    s.load();
    s.create('First', cfgA());
    await new Promise(r => setTimeout(r, 5));
    s.create('Second', cfgA());
    await new Promise(r => setTimeout(r, 5));
    s.create('Third', cfgA());

    const names = s.list().map(x => x.name);
    assert.deepEqual(names, ['Third', 'Second', 'First']);
  });
});

describe('SetStore — persistence round-trip', () => {
  it('save/load preserves all sets and activeId', () => {
    const s1 = new SetStore();
    s1.load();
    const idA = s1.create('A', cfgA());
    const idB = s1.create('B', cfgB());
    s1.switchTo(idB);

    const s2 = new SetStore();
    s2.load();
    assert.equal(s2.sets.length, 2);
    assert.equal(s2.activeId, idB);
    assert.equal(s2.getActive().name, 'B');
    assert.equal(s2.sets.find(x => x.id === idA).config.scales[0].name, 'Blue');
  });

  it('activeId pointing to missing set gets repaired on load', () => {
    // manually corrupt stored data
    localStorage.setItem(SETS_KEY, JSON.stringify({
      v: 1,
      activeId: 'missing',
      sets: [{ id: 'real', name: 'R', modified: Date.now(), config: cfgA() }]
    }));
    const s = new SetStore();
    s.load();
    assert.equal(s.activeId, 'real');
  });

  it('corrupt JSON in sets key → treated as empty', () => {
    localStorage.setItem(SETS_KEY, '{not valid json');
    const s = new SetStore();
    s.load();
    assert.equal(s.sets.length, 0);
  });
});

describe('SetStore — migration from v3.x localStorage', () => {
  it('migrates object-shaped old key into single set', () => {
    localStorage.setItem(OLD_KEY, JSON.stringify({
      lightnessMax: 0.98,
      lightnessMin: 0.12,
      scales: [
        { name: 'Blue', keyColors: ['#2c84db', '#011a33'] },
        { name: 'Red', keyColors: ['#e04343'] }
      ]
    }));

    const s = new SetStore();
    s.load();

    assert.equal(s.sets.length, 1);
    assert.equal(s.sets[0].name, 'My Palette');
    assert.equal(s.activeId, s.sets[0].id);
    assert.equal(s.sets[0].config.lightnessMax, 0.98);
    assert.equal(s.sets[0].config.scales.length, 2);
    assert.equal(s.sets[0].config.scales[0].name, 'Blue');

    // old key removed, new key written
    assert.equal(localStorage.getItem(OLD_KEY), null);
    assert.ok(localStorage.getItem(SETS_KEY));
  });

  it('migrates array-shaped old key (pre-v3) using whiteLimit/blackLimit', () => {
    localStorage.setItem(OLD_KEY, JSON.stringify([
      { name: 'Blue', keyColors: ['#2c84db'], whiteLimit: 0.97, blackLimit: 0.18 },
      { name: 'Green', keyColors: ['#76ad2a'] }
    ]));

    const s = new SetStore();
    s.load();

    assert.equal(s.sets.length, 1);
    assert.equal(s.sets[0].config.lightnessMax, 0.97);
    assert.equal(s.sets[0].config.lightnessMin, 0.18);
    assert.equal(s.sets[0].config.scales.length, 2);
  });

  it('migrates old key with legacy whiteLimit/blackLimit at top level', () => {
    localStorage.setItem(OLD_KEY, JSON.stringify({
      whiteLimit: 0.99,
      blackLimit: 0.1,
      scales: [{ name: 'X', keyColors: ['#888888'] }]
    }));

    const s = new SetStore();
    s.load();
    assert.equal(s.sets[0].config.lightnessMax, 0.99);
    assert.equal(s.sets[0].config.lightnessMin, 0.1);
  });

  it('does NOT migrate if sets key already exists', () => {
    localStorage.setItem(SETS_KEY, JSON.stringify({
      v: 1,
      activeId: 'abc',
      sets: [{ id: 'abc', name: 'Existing', modified: 1, config: cfgA() }]
    }));
    localStorage.setItem(OLD_KEY, JSON.stringify({
      lightnessMax: 0.5, lightnessMin: 0.5,
      scales: [{ name: 'ShouldNotAppear', keyColors: ['#000000'] }]
    }));

    const s = new SetStore();
    s.load();
    assert.equal(s.sets.length, 1);
    assert.equal(s.sets[0].name, 'Existing');
    // old key left alone (we only delete it when we actually migrate)
    assert.ok(localStorage.getItem(OLD_KEY));
  });

  it('ignores old key with empty scales', () => {
    localStorage.setItem(OLD_KEY, JSON.stringify({ scales: [] }));
    const s = new SetStore();
    s.load();
    assert.equal(s.sets.length, 0);
  });
});

// ------------------------------------------------------------------

describe('base64url', () => {
  it('round-trips arbitrary binary including + / padding edge cases', () => {
    // bytes that would produce + and / in standard base64, plus lengths
    // that exercise all three padding cases (0, 1, 2 padding chars)
    const cases = [
      new Uint8Array([251, 239, 190]),           // +++ in std b64
      new Uint8Array([255, 255, 255, 255]),      // /// case
      new Uint8Array([0]),                       // == padding
      new Uint8Array([0, 0]),                    // = padding
      new Uint8Array([0, 0, 0]),                 // no padding
      new Uint8Array(Array.from({length: 256}, (_, i) => i)),  // full byte range
    ];
    for (const orig of cases) {
      const enc = base64urlEncode(orig);
      assert.ok(!/[+/=]/.test(enc), `encoding contains forbidden char: ${enc}`);
      const dec = base64urlDecode(enc);
      assert.deepEqual(Array.from(dec), Array.from(orig));
    }
  });
});

describe('encodeSet / decodeSet', () => {
  const samplePayload = () => ({
    v: 1,
    name: 'Test Palette',
    lMax: 1.0,
    lMin: 0.15,
    scales: [
      { n: 'Blue', k: ['2c84db', '011a33'] },
      { n: 'Red', k: ['e04343'], c: [[0, 0], [0.5, 0.3], [1, 0]] }
    ]
  });

  it('round-trips a payload exactly', async () => {
    const orig = samplePayload();
    const enc = await encodeSet(orig);
    assert.equal(typeof enc, 'string');
    assert.ok(enc.length > 0);
    assert.ok(!/[+/=#]/.test(enc), 'encoded string must be URL-safe');

    const dec = await decodeSet(enc);
    assert.equal(dec.v, 1);
    assert.equal(dec.name, 'Test Palette');
    assert.equal(dec.lMax, 1.0);
    assert.equal(dec.lMin, 0.15);
    assert.equal(dec.scales.length, 2);
    assert.equal(dec.scales[0].n, 'Blue');
    assert.deepEqual(dec.scales[0].k, ['2c84db', '011a33']);
    assert.equal(dec.scales[0].c, undefined);  // omitted stays omitted
    assert.deepEqual(dec.scales[1].c, [[0, 0], [0.5, 0.3], [1, 0]]);
  });

  it('rounds floats to 3 decimals', async () => {
    const enc = await encodeSet({
      v: 1, name: 'X', lMax: 0.123456789, lMin: 0.15,
      scales: [{ n: 'A', k: ['888888'], c: [[0.111111, 0.999999]] }]
    });
    const dec = await decodeSet(enc);
    assert.equal(dec.lMax, 0.123);
    assert.deepEqual(dec.scales[0].c, [[0.111, 1]]);
  });

  it('rejects unsupported version', async () => {
    const enc = await encodeSet({ v: 99, name: 'X', scales: [{ n: 'A', k: ['888'] }] });
    await assert.rejects(decodeSet(enc), /unsupported.*v99/i);
  });

  it('rejects payload with no scales', async () => {
    const enc = await encodeSet({ v: 1, name: 'X', scales: [] });
    await assert.rejects(decodeSet(enc), /no scales/i);
  });

  it('rejects garbage input', async () => {
    await assert.rejects(decodeSet('not-valid-base64-gzip-json'));
  });

  it('compresses meaningfully vs raw JSON', async () => {
    // A realistic 9-scale payload should compress to well under raw JSON size
    const big = {
      v: 1, name: 'Big', lMax: 1, lMin: 0.15,
      scales: Array.from({length: 9}, (_, i) => ({
        n: `Scale${i}`,
        k: Array.from({length: 9}, (_, j) => `${i}${j}aabb`.padStart(6, '0'))
      }))
    };
    const enc = await encodeSet(big);
    const rawLen = JSON.stringify(big).length;
    // gzip + base64url should beat raw JSON for repetitive data
    assert.ok(enc.length < rawLen, `encoded ${enc.length} should be < raw ${rawLen}`);
  });
});
