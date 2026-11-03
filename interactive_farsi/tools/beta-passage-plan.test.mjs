import assert from 'node:assert/strict';
import test from 'node:test';
import { allocatePassageGrays, expandOccurrences, reviewedPhrasePosition } from './beta-passage-plan.mjs';

test('explicit repeated instances are applied separately instead of always choosing the first', () => {
  const entries = [[10, 31, 'object', 'dashed', 'objects', 'reason', 'review']];
  const result = expandOccurrences(entries, [{ surah: 10, verse: 31, phrase: 'object', occurrences: [0, 1] }]);
  assert.deepEqual(result.map((entry) => entry[7]), [0, 1]);
  assert.equal(reviewedPhrasePosition('first object second object', 'object', 0, 26, 1), 20);
});

test('duplicate plans do not inflate coverage or create duplicate wrappers', () => {
  const entry = [10, 31, 'object', 'dashed', 'objects', 'reason', 'review'];
  assert.equal(expandOccurrences([entry, [...entry]], []).length, 1);
});

test('a later occurrence cannot escape into the next verse', () => {
  assert.equal(reviewedPhrasePosition('object next verse object', 'object', 0, 6, 1), null);
});

test('gray allocation considers every occurrence, including a distant repeat beside another group', () => {
  const entries = [[19, 15, 'a', 'dashed', 'times'], [19, 31, 'b', 'solid', 'worship'], [19, 33, 'c', 'dashed', 'times']];
  const assigned = allocatePassageGrays(entries, new Map());
  assert.notEqual(assigned.get('beta-19-times'), assigned.get('beta-19-worship'));
});