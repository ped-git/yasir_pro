import assert from 'node:assert/strict';
import test from 'node:test';
import { assignGroups, normalizeText } from './grouping.mjs';

test('Arabic normalization removes recitation marks without changing the displayed source', () => {
  assert.equal(normalizeText('إِيَّاكَ نَعْبُدُ'), 'اياك نعبد');
});

test('explicit content groups can connect differently styled phrases and support multiple tags', () => {
  const records = [{ id: 'first', text: 'أَنْعَمْتَ عَلَيْهِمْ' }, { id: 'second', text: 'الْمَغْضُوبِ عَلَيْهِمْ' }];
  const result = assignGroups(records, [
    { id: 'paths', label: 'Contrasting paths', members: records.map((record) => record.text) },
    { id: 'favored', label: 'Favored path', members: [records[0].text] },
  ]);
  assert.equal(result.underlines[0].groups.length, 2);
  assert.equal(result.underlines[1].groups[0], result.underlines[0].groups[0]);
});

test('nested underline layers never share an automatic coordination group', () => {
  const records = [
    { id: 'outer', text: 'الرحمن الرحيم', contextId: 'verse', start: 0, end: 13 },
    { id: 'inner', text: 'الرحمن', parentId: 'outer', contextId: 'verse', start: 0, end: 6 },
  ];
  const result = assignGroups(records, [], 'الرحمن الرحيم');
  assert(!result.underlines[0].groups.some((group) => result.underlines[1].groups.includes(group)));
});

test('same appearance or distant unrelated phrases do not create a group', () => {
  const records = [
    { id: 'first', text: 'السماء', contextId: 'verse-a', sectionId: 'section-a', start: 0, end: 6 },
    { id: 'second', text: 'السماء', contextId: 'verse-b', sectionId: 'section-b', start: 0, end: 6 },
  ];
  const result = assignGroups(records);
  assert(result.groups.every((group) => group.basis === 'individual'));
});

test('local conjunctions produce reviewable suggestions instead of asserted interpretations', () => {
  const text = 'السماوات و الأرض';
  const records = [
    { id: 'first', text: 'السماوات', appearance: { signature: 'solid-gray' }, contextId: 'verse', start: 0, end: 8 },
    { id: 'second', text: 'الأرض', appearance: { signature: 'solid-gray' }, contextId: 'verse', start: 11, end: text.length },
  ];
  const result = assignGroups(records, [], text);
  assert.equal(result.groups[0].basis, 'textual-coordination');
  assert.equal(result.groups[0].reviewStatus, 'suggested');
});

test('editable data can assign an existing underline ID without ambiguous text matching', () => {
  const result = assignGroups([{ id: 'phrase-a', text: 'الرحمن' }, { id: 'phrase-b', text: 'الرحيم' }], [
    { id: 'attributes', label: 'Attributes', members: [{ id: 'phrase-a' }, { id: 'phrase-b' }] },
  ]);
  assert.deepEqual(result.groups[0].members, ['phrase-a', 'phrase-b']);
});

test('adjacent different underline forms are not grouped just because a conjunction joins them', () => {
  const text = 'السماوات و الأرض';
  const records = [
    { id: 'first', text: 'السماوات', contextId: 'verse', appearance: { signature: 'solid-gray' }, start: 0, end: 8 },
    { id: 'second', text: 'الأرض', contextId: 'verse', appearance: { signature: 'dotted-gray' }, start: 11, end: text.length },
  ];
  assert(assignGroups(records, [], text).groups.every((group) => group.members.length === 1));
});

test('matching nearby underlines can connect across paragraph boundaries in the same section', () => {
  const records = [
    { id: 'first', text: 'وآية لهم الأرض الميتة', contextId: 'paragraph-a', sectionId: 'signs', parentId: null, verse: 33, blockIndex: 1, appearance: { signature: 'solid-gray' }, start: 0, end: 10 },
    { id: 'second', text: 'وآية لهم الليل', contextId: 'paragraph-b', sectionId: 'signs', parentId: null, verse: 34, blockIndex: 2, appearance: { signature: 'solid-gray' }, start: 20, end: 30 },
  ];
  const result = assignGroups(records, [], ' '.repeat(40));
  assert(result.groups.some((group) => group.basis === 'local-underline-pattern' && group.members.length === 2));
});

test('matching appearance alone cannot cross distant verses or a new speech boundary', () => {
  const appearance = { signature: 'solid-gray' };
  const distant = [
    { id: 'first', text: 'الشمس والقمر', parentId: null, contextId: 'a', verse: 1, appearance, start: 0, end: 5 },
    { id: 'second', text: 'الجبال والأرض', parentId: null, contextId: 'b', verse: 10, appearance, start: 15, end: 25 },
  ];
  assert(assignGroups(distant).groups.every((group) => group.members.length === 1));
  const speech = distant.map((record) => ({ ...record, verse: 1 }));
  assert(assignGroups(speech, [], '12345 قال لهم 123456789012345').groups.every((group) => group.members.length === 1));
});

test('repeated headings across sections group when text and underline form both agree', () => {
  const records = [
    { id: 'first', text: 'وَآيَةٌ لَّهُمُ', contextId: 'a', sectionId: 'earth', parentId: null, appearance: { signature: 'solid-gray' }, verse: 33 },
    { id: 'second', text: 'وَآيَةٌ لَّهُمْ', contextId: 'b', sectionId: 'night', parentId: null, appearance: { signature: 'solid-gray' }, verse: 37 },
  ];
  assert(assignGroups(records).groups.some((group) => group.basis === 'exact-normalized-text' && group.members.length === 2));
});

test('symbol-font marker letters never create automatic text relationships', () => {
  const records = [
    { id: 'first', text: 'n', contextId: 'same', appearance: { signature: 'solid-gray' } },
    { id: 'second', text: 'n', contextId: 'same', appearance: { signature: 'solid-gray' } },
  ];
  assert(assignGroups(records).groups.every((group) => group.basis === 'individual'));
});

test('local red and green alternatives share a saved group even with different line patterns', () => {
  const records = [
    { id: 'good', text: 'جنة ونعيم', parentId: null, sectionId: 'contrast', contextId: 'first', verse: 1, start: 0, end: 9, appearance: { signature: 'solid-green', colorFamily: 'green' } },
    { id: 'bad', text: 'نار وعذاب', parentId: null, sectionId: 'contrast', contextId: 'second', verse: 2, start: 20, end: 30, appearance: { signature: 'dotted-red', colorFamily: 'red' } },
  ];
  const result = assignGroups(records);
  assert(result.groups.some((group) => group.basis === 'red-green-pair' && group.members.includes('good') && group.members.includes('bad')));
});