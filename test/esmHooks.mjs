// Module customization hooks (module.register, Node >= 20.6) used by the renderer-side tests:
//  - the renderer's DOM-dependent modules are replaced by test/stubs/*
//  - renderer .js files are loaded as ES modules (the package has no "type": "module")
const JS    = new URL('../src/renderer/js/', import.meta.url).href;
const STUBS = new URL('./stubs/', import.meta.url).href;
const STUBBED = new Set(['elements', 'state', 'format', 'statusBar', 'tree']);

export async function resolve(specifier, context, nextResolve) {
  const m = /^\.\/(\w+)\.js$/.exec(specifier);
  if (m && STUBBED.has(m[1]) && context.parentURL && context.parentURL.startsWith(JS)) {
    return { url: STUBS + m[1] + '.js', format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith(JS) || url.startsWith(STUBS)) {
    return nextLoad(url, { ...context, format: 'module' });
  }
  return nextLoad(url, context);
}
