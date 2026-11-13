import assert from 'node:assert/strict';

// Reference: VNote src/core/theme.cpp translatePaletteObjectOnce / translateStyleByPalette.
export function prepareVnote(palette, style) {
  assert.equal(palette.metadata?.['backfill-system-palette'] ?? false, false,
    'A system-backed VNote palette requires captured Qt palette values');
  const paths = new Set();
  function resolve(path, trail = []) {
    assert.ok(!trail.includes(path), `Cyclic VNote palette reference: ${[...trail, path].join(' -> ')}`);
    const value = path.split('#').reduce((item, key) => item?.[key], palette);
    assert.equal(typeof value, 'string', `Missing VNote palette string: ${path}`);
    paths.add(path);
    const ref = /^@(\w+(?:#\w+)*)$/u.exec(value);
    return ref ? resolve(ref[1], [...trail, path]) : value;
  }
  let replacements = 0;
  const css = style.replace(/(\s|:|")@(\w+(?:#\w+)*)(?![\w#:-])/gu, (_, prefix, path) => {
    if (!/^(?:palette|base|widgets)(?:#|$)/u.test(path)) return `${prefix}@${path}`;
    replacements++;
    return `${prefix}${resolve(path)}`;
  });
  assert.ok(!/@(?:palette|base|widgets)#/u.test(css), 'Unresolved VNote CSS reference');
  return { css, resolve, report: { replacements, referencedPaths: [...paths].sort(), unresolved: [] } };
}
