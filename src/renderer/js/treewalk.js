import { S } from './state.js';

export function walkFiles(node, cb) {
  if (!node) return;
  if (node.isDir && node.children) {
    for (const child of node.children) {
      if (!S.settings?.showHidden && child.name && child.name.startsWith('.')) continue;
      walkFiles(child, cb);
    }
  } else if (!node.isDir) {
    cb(node);
  }
}

export function collectFiles(node, filterFn) {
  const result = [];
  walkFiles(node, (file) => {
    if (!filterFn || filterFn(file)) {
      result.push(file);
    }
  });
  return result;
}
