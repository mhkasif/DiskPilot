'use strict';
// Per-window (webContents) state held by the main process: the running scan, the finished scan
// waiting to be pulled in chunks, snapshot uploads in progress, snapshot loads waiting to be
// pulled in chunks, and the duplicate search. One state object per sender id; it is dropped
// (and the running scan and duplicate search cancelled) when the window is destroyed or its
// renderer crashes, so nothing a window left behind outlives it.

const states = new Map(); // sender id -> { id, scan, transfer, uploads, loads, dup }
const hooked = new Set(); // sender ids whose listeners are attached (until the sender is destroyed)

function dropState(id) {
  const st = states.get(id);
  if (!st) return;
  if (st.scan) st.scan.ctrl.cancelled = true;
  st.scan = null;
  if (st.dup) st.dup.ctrl.cancelled = true;
  st.dup = null;
  st.transfer = null;
  st.uploads.clear();
  st.loads.clear();
  states.delete(id);
}

// State of the calling window; created on first use.
function stateFor(sender) {
  const id = sender.id; // read now: a destroyed WebContents throws on property access
  let st = states.get(id);
  if (st) return st;
  st = { id, scan: null, transfer: null, uploads: new Map(), loads: new Map(), dup: null };
  states.set(id, st);
  if (!hooked.has(id)) { // once per webContents: a crashed renderer keeps the same one
    hooked.add(id);
    sender.once('destroyed', () => { hooked.delete(id); dropState(id); });
    sender.on('render-process-gone', () => dropState(id));
  }
  return st;
}

// State of the calling window, or undefined if it has none.
function existingState(sender) {
  return states.get(sender.id);
}

module.exports = { stateFor, existingState };
