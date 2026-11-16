'use strict';
// The preload bridge must map each duplicate-search call to its IPC channel with the same arguments.
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const Module = require('node:module');

const calls = [];
let api = null;
const electronStub = {
  contextBridge: { exposeInMainWorld: (name, obj) => { api = obj; } },
  ipcRenderer: {
    invoke: (...args) => { calls.push(args); return Promise.resolve(); },
    sendSync: () => "0.0.0", on() {}, removeAllListeners() {},
  },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, ...rest);
};
require(path.join(__dirname, '..', 'src/preload/index.js'));
Module._load = origLoad;

test('duplicate-search calls reach their channels with their arguments', () => {
  const cases = [
    [() => api.beginDuplicates(), ['dup:begin']],
    [() => api.addDuplicateCandidates('D1', [{ size: 1, paths: ['/a'] }]), ['dup:addCandidates', 'D1', [{ size: 1, paths: ['/a'] }]]],
    [() => api.runDuplicates('D1'), ['dup:run', 'D1']],
    [() => api.duplicateResultChunk('D1', 3), ['dup:resultChunk', 'D1', 3]],
    [() => api.releaseDuplicates('D1'), ['dup:release', 'D1']],
    [() => api.cancelDuplicates(), ['dup:cancel']],
  ];
  for (const [fn, expected] of cases) {
    calls.length = 0;
    fn();
    assert.deepEqual(calls, [expected]);
  }
  assert.equal('findDuplicates' in api, false);
});
