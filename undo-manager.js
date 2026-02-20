// ChromaScale — Undo/Redo Manager
// Snapshot-based undo stack for full application state

class UndoManager {
  constructor(maxHistory) {
    this._undoStack = [];
    this._redoStack = [];
    this._maxHistory = maxHistory || 100;
  }

  snapshot(state) {
    this._undoStack.push(JSON.stringify(state));
    if (this._undoStack.length > this._maxHistory) {
      this._undoStack.shift();
    }
    this._redoStack = [];
  }

  undo(currentState) {
    if (this._undoStack.length === 0) return null;
    this._redoStack.push(JSON.stringify(currentState));
    return JSON.parse(this._undoStack.pop());
  }

  redo(currentState) {
    if (this._redoStack.length === 0) return null;
    this._undoStack.push(JSON.stringify(currentState));
    return JSON.parse(this._redoStack.pop());
  }

  canUndo() { return this._undoStack.length > 0; }
  canRedo() { return this._redoStack.length > 0; }
  clear() { this._undoStack = []; this._redoStack = []; }
}

if (typeof module !== 'undefined') module.exports = UndoManager;
