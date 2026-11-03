import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parse } from 'parse5';
import { chromium } from 'playwright';
import { exactPhraseAnnotation, grayForGroup, nestedPadding, phraseRanges, polarityPattern, quotationAnchorIndex, quotedTextEnd, sourceTextPositions } from './beta-annotation-rules.mjs';
import { semanticStyles, underlineFamily } from './beta-semantic-styles.mjs';

function body(html) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  return document.childNodes.find((node) => node.tagName === 'html').childNodes.find((node) => node.tagName === 'body');
}

test('a closing quote stays after speech, not inside the following paragraph or bullet', () => {
  const html = '<html><body><p>\u0642\u0627\u0644 \u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645\n</p><p><span>n </span>\u0641\u0644\u0645\u0627 \u0631\u0622\u0647</p></body></html>';
  const end = quotedTextEnd(body(html), html, html.indexOf('\u0627\u0644\u0633\u0644\u0627\u0645'), html.indexOf('\u0641\u0644\u0645\u0627'));
  assert.equal(html.slice(end, end + 5), '\n</p>');
});

test('a closing quote is outside a final underlined span, not part of that underline', () => {
  const html = '<html><body><p>\u0642\u0627\u0644 <span class="underline">\u0633\u0644\u0627\u0645</span> <sup>1</sup></p></body></html>';
  const end = quotedTextEnd(body(html), html, html.indexOf('\u0633\u0644\u0627\u0645'), html.indexOf('<sup>'));
  assert.equal(html.slice(0, end).slice(-7), '</span>');
});

test('a closing quote is inserted before an immediately following waqf sign', () => {
  for (const sign of ['\u06d6', '\u06d7', '\u06d8', '\u06d9', '\u06da', '\u06db', '\u06dc']) {
    const html = `<html><body><p>\u0633\u0644\u0627\u0645 ${sign} <sup>1</sup></p></body></html>`;
    const end = quotedTextEnd(body(html), html, html.indexOf('\u0633\u0644\u0627\u0645'), html.indexOf('<sup>'));
    assert.equal(end, html.indexOf('\u0633\u0644\u0627\u0645') + '\u0633\u0644\u0627\u0645'.length);
  }
});

test('semantic pattern is determined by good, bad, or neutral, never by group shade', () => {
  assert.equal(polarityPattern('good'), 'solid');
  assert.equal(polarityPattern('bad'), 'dotted');
  assert.equal(polarityPattern('neutral'), 'dashed');
});

test('adjacent independent groups have distinct gray levels while members retain their group shade', () => {
  const assigned = new Map();
  const first = grayForGroup('first', assigned);
  const second = grayForGroup('second', assigned, ['first']);
  assert.notEqual(first, second);
  assert.equal(grayForGroup('first', assigned, ['second']), first);
});

test('a compared red bad alternative is dotted, not solid, and remains paired with solid green', () => {
  const page = { surah: 12, underlines: [
    { id: 'good', verse: 1, start: 0, style: ['ul-pattern-solid', 'ul-color-green-100-180-100'] },
    { id: 'bad', verse: 2, start: 20, style: ['ul-pattern-solid', 'ul-color-red-220-150-150'] },
  ] };
  const data = { underlines: [{ id: 'good', groups: ['g'], parentId: null, sectionId: 's' }, { id: 'bad', groups: ['b'], parentId: null, sectionId: 's' }], groups: [{ id: 'g', members: ['good'] }, { id: 'b', members: ['bad'] }] };
  const result = semanticStyles(page, data, []);
  assert(result.changes.find((change) => change.id === 'bad').style.includes('ul-pattern-dotted'));
  assert(result.changes.find((change) => change.id === 'bad').style.includes('ul-color-red-220-150-150'));
  assert.equal(result.contrasts.length, 1);
});

test('unpaired red is converted to gray but retains its bad dotted role', () => {
  const page = { surah: 12, underlines: [{ id: 'bad', verse: 1, start: 0, style: ['ul-pattern-solid', 'ul-color-red-220-150-150'] }] };
  const data = { underlines: [{ id: 'bad', groups: ['b'], parentId: null, sectionId: 's' }], groups: [{ id: 'b', members: ['bad'] }] };
  const result = semanticStyles(page, data, []);
  assert(result.changes[0].style.includes('ul-pattern-dotted'));
  assert(result.changes[0].style.some((name) => name.startsWith('ul-color-gray-')));
  assert.equal(result.contrasts.length, 0);
});

test('RTL quotation signs place the opener before the first word on the right and closer after the last word on the left', async () => {
  const css = await readFile(new URL('../assets/beta-annotations.css', import.meta.url), 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<html dir="rtl"><head><style>${css}p{width:700px;font:24px serif}</style></head><body><p><speech id="open" class="beta-speech" open green></speech><span id="words">\u0647\u0630\u0627 \u0646\u0635 \u0639\u0631\u0628\u064a</span><speech id="close" class="beta-speech" close green></speech></p></body></html>`);
    const positions = await page.evaluate(() => {
      const bounds = (id) => document.getElementById(id).getBoundingClientRect().toJSON();
      return { open: bounds('open'), words: bounds('words'), close: bounds('close'), direction: getComputedStyle(document.getElementById('open')).direction, isolation: getComputedStyle(document.getElementById('open')).unicodeBidi };
    });
    assert(positions.open.right >= positions.words.right && positions.close.left <= positions.words.left);
    assert.equal(positions.direction, 'rtl');
    assert.equal(positions.isolation, 'isolate');
  } finally { await browser.close(); }
});

test('red and green gradient stops obey the same semantic convention as ordinary border colors', () => {
  assert.equal(underlineFamily(['ul-stops-white-red-220-150-150']), 'red');
  assert.equal(underlineFamily(['ul-stops-green-100-180-100-white']), 'green');
  const page = { surah: 12, underlines: [
    { id: 'good', verse: 1, start: 0, style: ['ul-pattern-solid', 'ul-color-green-100-180-100'] },
    { id: 'bad', verse: 2, start: 20, style: ['ul-pattern-solid', 'ul-color-currentcolor', 'ul-image-gradient', 'ul-gradient-to-left', 'ul-stops-white-red-220-150-150'] },
  ] };
  const data = { underlines: [{ id: 'good', groups: ['g'], parentId: null, sectionId: 's' }, { id: 'bad', groups: ['b'], parentId: null, sectionId: 's' }], groups: [{ id: 'g', members: ['good'] }, { id: 'b', members: ['bad'] }] };
  const result = semanticStyles(page, data, []);
  const bad = result.changes.find((change) => change.id === 'bad');
  assert(bad.style.includes('ul-pattern-dotted'));
  assert(!bad.style.includes('ul-image-gradient'), 'A border image must not conceal the dotted bad pattern');
  assert.equal(result.contrasts.length, 1);
});

test('an existing whole-phrase annotation is corrected rather than duplicated, while a subphrase can receive a nested underline', () => {
  const records = [{ id: 'outer', verse: 1, text: '\u0622\u0645\u0646\u0648\u0627 \u0648\u0639\u0645\u0644\u0648\u0627 \u0627\u0644\u0635\u0627\u0644\u062d\u0627\u062a' }];
  assert.equal(exactPhraseAnnotation(records, 1, '\u0627\u0645\u0646\u0648\u0627 \u0648\u0639\u0645\u0644\u0648\u0627 \u0627\u0644\u0635\u0627\u0644\u062d\u0627\u062a')?.id, 'outer');
  assert.equal(exactPhraseAnnotation(records, 1, '\u0639\u0645\u0644\u0648\u0627 \u0627\u0644\u0635\u0627\u0644\u062d\u0627\u062a'), null);
  assert.equal(exactPhraseAnnotation(records, 2, records[0].text), null);
});

test('an explicit neutral review overrides a legacy red color instead of retaining a red neutral underline', () => {
  const page = { surah: 12, underlines: [
    { id: 'object', verse: 1, start: 0, style: ['ul-pattern-solid', 'ul-color-red-220-150-150'] },
    { id: 'other', verse: 1, start: 20, style: ['ul-pattern-solid', 'ul-color-green-100-180-100'] },
  ] };
  const data = { underlines: [{ id: 'object', groups: ['a'], parentId: null, sectionId: 's' }, { id: 'other', groups: ['b'], parentId: null, sectionId: 's' }], groups: [{ id: 'a', members: ['object'] }, { id: 'b', members: ['other'] }] };
  const result = semanticStyles(page, data, [{ surah: 12, ids: ['object'], role: 'neutral', reason: 'Reviewed neutral object' }]);
  const change = result.changes.find((change) => change.id === 'object');
  assert(change.style.includes('ul-pattern-dashed'));
  assert(change.style.some((name) => name.startsWith('ul-color-gray-')));
  assert(!change.style.some((name) => name.startsWith('ul-color-red-')));
});

test('a whole directive can wrap an existing nested object span without breaking its markup', () => {
  const html = '<html><body><p>\u0644\u0627 \u062a\u0642\u0631\u0628\u0648\u0627 <span class="underline">\u0627\u0644\u0632\u0646\u0649</span> \u0627\u0644\u0646\u0647\u0627\u064a\u0629</p></body></html>';
  const start = html.indexOf('\u0644\u0627 \u062a\u0642\u0631\u0628\u0648\u0627');
  const end = html.indexOf('\u0627\u0644\u0632\u0646\u0649') + '\u0627\u0644\u0632\u0646\u0649'.length;
  const ranges = phraseRanges(body(html), html, start, end);
  assert.equal(ranges.length, 1);
  assert.equal(html.slice(ranges[0].start, ranges[0].end), '\u0644\u0627 \u062a\u0642\u0631\u0628\u0648\u0627 <span class="underline">\u0627\u0644\u0632\u0646\u0649</span>');
});

test('a phrase partially crossing existing markup is represented by linked safe fragments instead of skipped', () => {
  const html = '<html><body><p><span>\u0642\u0628\u0644 \u0628\u062f\u0627\u064a\u0629</span> \u0627\u0644\u0646\u0647\u0627\u064a\u0629</p></body></html>';
  const ranges = phraseRanges(body(html), html, html.indexOf('\u0628\u062f\u0627\u064a\u0629'), html.indexOf('\u0627\u0644\u0646\u0647\u0627\u064a\u0629') + '\u0627\u0644\u0646\u0647\u0627\u064a\u0629'.length);
  assert.equal(ranges.length, 2);
  assert.equal(ranges.map((range) => html.slice(range.start, range.end)).join('').trim(), '\u0628\u062f\u0627\u064a\u0629 \u0627\u0644\u0646\u0647\u0627\u064a\u0629');
});

test('new nested underlines have separate vertical levels instead of a solid parent concealing its dotted child', () => {
  assert.equal(nestedPadding(0, [0], true), 2);
  assert.equal(nestedPadding(0, [2], true), 4);
  assert.equal(nestedPadding(6, [2], true), 6);
  assert.equal(nestedPadding(0, [0], false), 0);
});

test('a repeated short quotation start cannot silently select an earlier narrative mention', () => {
  const value = '\u0648\u0645\u0627 \u0642\u062f\u0631\u0648\u0627 \u0627\u0644\u0644\u0647 \u0642\u0627\u0644\u0648\u0627 \u0645\u0627 \u0627\u0646\u0632\u0644 \u0627\u0644\u0644\u0647 \u0642\u0644 \u0627\u0644\u0644\u0647 \u062b\u0645 \u0630\u0631\u0647\u0645';
  assert.throws(() => quotationAnchorIndex(value, '\u0627\u0644\u0644\u0647', 0, value.length), /Ambiguous/);
  assert.equal(quotationAnchorIndex(value, '\u0627\u0644\u0644\u0647', 0, value.length, { startCue: '\u0642\u0644 \u0627\u0644\u0644\u0647' }), value.lastIndexOf('\u0627\u0644\u0644\u0647'));
});

test('an HTML entity does not make the Arabic words in the same text node unannotatable', () => {
  const raw = '&nbsp \u0648\u0633\u062e\u0631\u0646\u0627 \u0627\u0644\u062c\u0628\u0627\u0644';
  const value = '\u00a0 \u0648\u0633\u062e\u0631\u0646\u0627 \u0627\u0644\u062c\u0628\u0627\u0644';
  const positions = sourceTextPositions(raw, value, 100);
  assert.equal(positions.get(value.indexOf('\u0627\u0644\u062c\u0628\u0627\u0644')).start, 100 + raw.indexOf('\u0627\u0644\u062c\u0628\u0627\u0644'));
  assert.deepEqual(positions.get(0), { start: 100, end: 105 });
});

test('numeric Arabic character references retain their exact source extent', () => {
  const positions = sourceTextPositions('&#1575;', '\u0627', 10);
  assert.deepEqual(positions.get(0), { start: 10, end: 17 });
});

test('parser-merged whitespace around an ignored legacy closing tag retains safe source positions', () => {
  const raw = '\n      </body>\n    ';
  const value = '\n      \n    ';
  const positions = sourceTextPositions(raw, value, 0);
  assert.equal(positions.get(7).start, raw.indexOf('\n', 1));
});