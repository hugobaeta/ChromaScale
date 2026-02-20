const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const UndoManager = require('../undo-manager.js');

describe('UndoManager', () => {
  it('snapshot and undo returns previous state', () => {
    const um = new UndoManager();
    um.snapshot({ value: 1 });
    const prev = um.undo({ value: 2 });
    assert.deepEqual(prev, { value: 1 });
  });

  it('redo returns next state after undo', () => {
    const um = new UndoManager();
    um.snapshot({ value: 1 });
    um.undo({ value: 2 });
    const next = um.redo({ value: 1 });
    assert.deepEqual(next, { value: 2 });
  });

  it('redo stack clears on new snapshot', () => {
    const um = new UndoManager();
    um.snapshot({ value: 1 });
    um.snapshot({ value: 2 });
    um.undo({ value: 3 }); // redo stack now has {value:3}
    assert.equal(um.canRedo(), true);
    um.snapshot({ value: 4 }); // new action clears redo
    assert.equal(um.canRedo(), false);
  });

  it('canUndo / canRedo reflect stack state', () => {
    const um = new UndoManager();
    assert.equal(um.canUndo(), false);
    assert.equal(um.canRedo(), false);
    um.snapshot({ a: 1 });
    assert.equal(um.canUndo(), true);
    assert.equal(um.canRedo(), false);
    um.undo({ a: 2 });
    assert.equal(um.canUndo(), false);
    assert.equal(um.canRedo(), true);
  });

  it('undo returns null when nothing to undo', () => {
    const um = new UndoManager();
    assert.equal(um.undo({ x: 1 }), null);
  });

  it('redo returns null when nothing to redo', () => {
    const um = new UndoManager();
    assert.equal(um.redo({ x: 1 }), null);
  });

  it('respects max history cap', () => {
    const um = new UndoManager(3);
    um.snapshot({ v: 1 });
    um.snapshot({ v: 2 });
    um.snapshot({ v: 3 });
    um.snapshot({ v: 4 }); // oldest (v:1) should be evicted
    assert.equal(um.canUndo(), true);

    // Undo 3 times (the max)
    um.undo({ v: 5 }); // returns {v:4}
    um.undo({ v: 4 }); // returns {v:3}
    um.undo({ v: 3 }); // returns {v:2}
    assert.equal(um.canUndo(), false); // {v:1} was evicted
  });

  it('clear empties both stacks', () => {
    const um = new UndoManager();
    um.snapshot({ a: 1 });
    um.snapshot({ a: 2 });
    um.undo({ a: 3 });
    assert.equal(um.canUndo(), true);
    assert.equal(um.canRedo(), true);
    um.clear();
    assert.equal(um.canUndo(), false);
    assert.equal(um.canRedo(), false);
  });

  it('handles multiple undo/redo cycles', () => {
    const um = new UndoManager();
    um.snapshot({ v: 'A' });
    um.snapshot({ v: 'B' });
    um.snapshot({ v: 'C' });
    // Current state is D (not snapshotted)
    const c = um.undo({ v: 'D' }); // returns C
    assert.deepEqual(c, { v: 'C' });
    const b = um.undo({ v: 'C' }); // returns B
    assert.deepEqual(b, { v: 'B' });
    const c2 = um.redo({ v: 'B' }); // returns C
    assert.deepEqual(c2, { v: 'C' });
    const d = um.redo({ v: 'C' }); // returns D
    assert.deepEqual(d, { v: 'D' });
    assert.equal(um.canRedo(), false);
  });
});
