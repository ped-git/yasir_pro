import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/interactions.js', import.meta.url), 'utf8');
const loader = source.slice(0, source.indexOf('  function drawUnderline(')) + '\n globalThis.loadedGroups = groups;\n})();';
function load(data, elements = []) {
  const context = {
    document: {
      querySelectorAll: () => elements,
      getElementById: () => data === null ? null : { textContent: JSON.stringify(data) },
    },
  };
  vm.runInNewContext(loader, context);
  return JSON.parse(JSON.stringify(context.loadedGroups));
}

test('the viewer loads the exact persisted groups, not relationships inferred from matching content or appearance', () => {
  const data = { version: 1, groups: { first: ['a'], second: ['b'] } };
  const elements = [{ dataset: { underlineId: 'a', underlineGroups: 'first' }, textContent: 'same' }, { dataset: { underlineId: 'b', underlineGroups: 'second' }, textContent: 'same' }];
  assert.deepEqual(load(data, elements), data.groups);
});

test('missing group data is rejected instead of silently constructing a fallback', () => {
  assert.throws(() => load(null), /Missing precomputed/);
});

test('an invalid saved grouping schema is rejected', () => {
  assert.throws(() => load({ version: 2, groups: {} }), /Invalid precomputed/);
  assert.throws(() => load({ version: 1, groups: [] }), /Invalid precomputed/);
});