import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'parse5';
import { chromium } from 'playwright';
import { underlineFamily } from './beta-semantic-styles.mjs';
import { loadPassagePlan } from './beta-passage-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const original = path.resolve(root, '../interactive');
const sharedInteractionStyles = ['assets/interactions.css'];
const approvedInteractiveChanges = new Set([...sharedInteractionStyles, 'assets/interactions.js', 'tools/verify.mjs', 'tools/bullets.test.mjs']);
const corpus = JSON.parse(await readFile(path.join(root, 'data/beta/corpus.json'), 'utf8'));
const audit = JSON.parse(await readFile(path.join(root, 'data/beta/changes.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'data/beta-source-manifest.json'), 'utf8'));
const index = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
const passagePlan = await loadPassagePlan(root);
const occurrenceDecisions = JSON.parse(await readFile(path.join(root, 'data/beta/underline-occurrences.json'), 'utf8'));
const underlineInventory = JSON.parse(await readFile(path.join(root, 'data/beta/underline-audit.json'), 'utf8'));
const patternChanges = new Map(audit.changes.filter((change) => change.kind === 'underline').map((change) => [change.id, change]));
const newUnderlines = new Map(audit.changes.filter((change) => change.kind === 'new-underline').map((change) => [change.id, change]));
const newGroups = new Set([...newUnderlines.values()].map((change) => change.groupId).concat((audit.contrastGroups ?? []).map((group) => group.id), (audit.passageGroups ?? []).map((group) => group.id)));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const attrs = (node) => Object.fromEntries((node.attrs ?? []).map((attribute) => [attribute.name, attribute.value]));
const quick = process.argv.includes('--quick');
function walk(node, callback) { callback(node); for (const child of node.childNodes ?? []) walk(child, callback); }
function canonical(node, head = false) {
  const attributes = attrs(node);
  if (node.tagName === 'speech' && (attributes.class ?? '').split(/\s+/).includes('beta-speech')) {
    assert.equal(node.childNodes?.length ?? 0, 0, 'Beta quotation markers must not replace Quranic words');
    return null;
  }
  if (node.tagName === 'link' && attributes.href === '../assets/beta-annotations.css') return null;
  const inHead = head || node.tagName === 'head';
  if (inHead && node.nodeName === '#text' && !node.value.trim()) return null;
  const children = [];
  for (const child of (node.childNodes ?? []).map((child) => canonical(child, inHead)).filter((child) => child !== null)) {
    for (const value of child.name === '#transparent' ? child.children : [child]) {
      if (value.name === '#text' && children.at(-1)?.name === '#text') children.at(-1).value += value.value;
      else children.push(value);
    }
  }
  if ('data-beta-underline' in attributes) {
    assert(newUnderlines.has(attributes['data-underline-id']), 'Undocumented beta underline wrapper');
    return { name: '#transparent', children };
  }
  if (node.tagName === 'script' && attributes.id === 'reader-group-data') {
    const data = JSON.parse(children.map((child) => child.value ?? '').join(''));
    data.groups = Object.fromEntries(Object.entries(data.groups).filter(([id]) => !newGroups.has(id)));
    return { name: node.nodeName, value: null, attributes: node.attrs, children: [{ name: '#text', value: JSON.stringify(data), attributes: [], children: [] }] };
  }
  return {
    name: node.nodeName,
    value: node.value ?? node.data ?? null,
    attributes: (node.attrs ?? []).map((attribute) => {
      const change = patternChanges.get(attributes['data-underline-id']);
      if (change && attribute.name === 'class') return { ...attribute, value: change.before };
      if (attribute.name === 'data-underline-groups') return { ...attribute, value: attribute.value.split(/\s+/).filter((id) => !newGroups.has(id)).join(' ') };
      return attribute;
    }),
    children,
  };
}
function vertical(document, html) {
  const values = [];
  walk(document, (node) => {
    const attributes = attrs(node);
    if (attributes['data-reader-section'] || attributes['data-reader-line'] || (attributes.class ?? '').split(/\s+/).some((name) => name.startsWith('connection-line--') || name.startsWith('connection-cap--'))) {
      const location = node.sourceCodeLocation.startTag;
      values.push(html.slice(location.startOffset, location.endOffset));
    }
  });
  return values;
}

function restoredBaselineHtml(html) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const edits = [];
  walk(document, (node) => {
    const attributes = attrs(node);
    const location = node.sourceCodeLocation;
    if (node.tagName === 'speech' && attributes['data-beta-quote'] || node.tagName === 'link' && attributes.href === '../assets/beta-annotations.css') {
      edits.push({ start: location.startOffset, end: location.endOffset, value: '' });
    } else if ('data-beta-underline' in attributes) {
      assert(newUnderlines.has(attributes['data-underline-id']));
      edits.push({ start: location.startTag.startOffset, end: location.startTag.endOffset, value: '' });
      edits.push({ start: location.endTag.startOffset, end: location.endTag.endOffset, value: '' });
    } else if (patternChanges.has(attributes['data-underline-id'])) {
      const change = patternChanges.get(attributes['data-underline-id']);
      edits.push({ start: location.attrs.class.startOffset, end: location.attrs.class.endOffset, value: `class="${change.before}"` });
    }
    if (location?.attrs?.['data-underline-groups'] && !('data-beta-underline' in attributes)) {
      const tags = attributes['data-underline-groups'].split(/\s+/);
      if (tags.some((id) => newGroups.has(id))) {
        const attribute = location.attrs['data-underline-groups'];
        edits.push({ start: attribute.startOffset, end: attribute.endOffset, value: `data-underline-groups="${tags.filter((id) => !newGroups.has(id)).join(' ')}"` });
      }
    }
  });
  for (const edit of edits.sort((first, second) => second.start - first.start || second.end - first.end)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  return html;
}

function rawBody(html) {
  let location;
  walk(parse(html, { sourceCodeLocationInfo: true }), (node) => { if (node.tagName === 'body') location = node.sourceCodeLocation; });
  return html.slice(location.startTag.endOffset, location.endTag.startOffset);
}

for (const [file, expected] of Object.entries(manifest)) {
  if (approvedInteractiveChanges.has(file)) continue;
  assert.equal(hash(await readFile(path.join(original, file))), expected, `Original interactive file changed: ${file}`);
}
for (const file of sharedInteractionStyles) {
  assert.equal(hash(await readFile(path.join(original, file))), hash(await readFile(path.join(root, file))), `Shared reader control asset differs: ${file}`);
}
for (const file of ['assets/interactions.js']) {
  const sourceScript = await readFile(path.join(original, file), 'utf8');
  const betaScript = await readFile(path.join(root, file), 'utf8');
  for (const script of [sourceScript, betaScript]) {
    for (const feature of ['function addReaderControls()', 'reader-simple-text', 'reader-underlines-hidden']) assert(script.includes(feature), `Missing reader control behavior in ${file}: ${feature}`);
  }
}
let protectedCount = 0;
let quotes = 0;
for (const page of corpus.pages) {
  const baselineHtml = await readFile(path.join(original, page.file), 'utf8');
  const betaHtml = await readFile(path.join(root, page.file), 'utf8');
  if (page.reference) { assert.equal(hash(betaHtml), page.hash, `Protected reference changed: ${page.surah}`); protectedCount++; }
  const baselineDocument = parse(baselineHtml, { sourceCodeLocationInfo: true });
  const betaDocument = parse(betaHtml, { sourceCodeLocationInfo: true });
  assert.deepEqual(canonical(betaDocument), canonical(baselineDocument), `Changes outside approved underlines/quotations in ${page.surah}`);
  assert.deepEqual(vertical(betaDocument, betaHtml), vertical(baselineDocument, baselineHtml), `Vertical markup changed in ${page.surah}`);
  if (!page.reference) assert.equal(rawBody(restoredBaselineHtml(betaHtml)), rawBody(baselineHtml), `Raw body differs outside approved annotations in ${page.surah}`);
  const stack = [];
  const ids = new Map();
  walk(betaDocument, (node) => {
    const attributes = attrs(node);
    if (!attributes['data-beta-quote']) return;
    const id = attributes['data-beta-quote'];
    if ('open' in attributes) {
      assert(!ids.has(id), `Duplicate quotation ${id}`);
      stack.push(id); ids.set(id, attributes); quotes++;
    }
    if ('close' in attributes) {
      assert.equal(stack.pop(), id, `Incorrect quotation nesting in ${page.surah}`);
      const opening = ids.get(id);
      for (const color of ['blue', 'green', 'red', 'black', 'gray', 'lightblue', 'mixed', 'underline']) assert.equal(color in attributes, color in opening, `Quotation role mismatch: ${id}`);
    }
  });
  assert.equal(stack.length, 0, `Unclosed quotation in ${page.surah}`);
  if (!page.reference) {
    const data = JSON.parse(await readFile(path.join(root, 'data/pages', page.file.replace(/\.html$/, '.json')), 'utf8'));
    assert.equal(ids.size, data.betaQuotations.length, `Quotation metadata mismatch ${page.surah}`);
    let savedGroups;
    const actualIds = new Set();
    walk(betaDocument, (node) => {
      const attributes = attrs(node);
      if (attributes['data-underline-id']) {
        const id = attributes['data-underline-id'];
        actualIds.add(id);
        let parent = node.parentNode;
        let parentId = null;
        while (parent && !parentId) { parentId = attrs(parent)['data-underline-id'] ?? null; parent = parent.parentNode; }
        assert.equal(data.underlines.find((record) => record.id === id)?.parentId ?? null, parentId, `Nested metadata mismatch ${id}`);
      }
      if (attributes['data-underline-id']) {
        const style = (attributes.class ?? '').split(/\s+/);
        const family = underlineFamily(style);
        if (family) {
          assert(style.includes(family === 'red' ? 'ul-pattern-dotted' : 'ul-pattern-solid'), `Compared semantic pattern mismatch ${attributes['data-underline-id']}`);
          assert((audit.contrastGroups ?? []).some((group) => group.members.includes(attributes['data-underline-id'])), `Unpaired comparison color remains on ${attributes['data-underline-id']}`);
        }
      }
      if (node.tagName === 'script' && attributes.id === 'reader-group-data') savedGroups = JSON.parse(node.childNodes.map((child) => child.value ?? '').join('')).groups;
    });
    assert.equal(actualIds.size, data.underlines.length, `Underline metadata count mismatch ${page.surah}`);
    assert.deepEqual(savedGroups, Object.fromEntries(data.groups.map((group) => [group.id, group.members])), `Saved group data mismatch ${page.surah}`);
    for (const record of data.underlines) assert(actualIds.has(record.id), `Missing underline ${record.id}`);
    assert.equal(index.pages.find((entry) => entry.page === page.file).underlines, data.underlines.length);
  }
}
assert.equal(quotes, audit.quotationCount);
assert.equal(protectedCount, 82);
for (const entry of passagePlan) for (const phrase of entry.phrases) {
  const record = (audit.coverage ?? []).find((record) => record.surah === entry.surah && record.verse === entry.verse && record.phrase === phrase && record.groupId === `beta-${entry.surah}-${entry.group}`);
  assert(record?.members?.length && record.role === entry.role, `Missing reviewed passage phrase ${entry.surah}:${entry.verse} ${phrase}`);
  for (const id of record.members) {
    const change = newUnderlines.get(id) ?? patternChanges.get(id);
    if (change) assert((change.className ?? change.after).split(/\s+/).includes(`ul-pattern-${{ good: 'solid', bad: 'dotted', neutral: 'dashed' }[entry.role]}`), `Wrong reviewed phrase type ${id}`);
  }
}
assert(!(audit.coverage ?? []).some((record) => !record.members?.length), 'A planned underline occurrence remains unapplied');
for (const decision of occurrenceDecisions) for (const occurrence of decision.occurrences) {
  assert((audit.coverage ?? []).some((record) => record.surah === decision.surah && record.verse === decision.verse && record.phrase === decision.phrase && record.occurrence === occurrence && record.members.length), `Missing reviewed repeated occurrence ${decision.surah}:${decision.verse} ${decision.phrase} #${occurrence}`);
}
assert.equal(underlineInventory.summary.targetSurahs, 32);
assert.equal(underlineInventory.verses.length, corpus.pages.filter((page) => !page.reference).reduce((total, page) => total + page.verses.length, 0), 'The omission inventory skipped an indexed target verse');
const grayAssignments = new Map();
for (const record of newUnderlines.values()) {
  if (record.gray === null || record.gray === undefined) continue;
  if (grayAssignments.has(record.groupId)) assert.equal(grayAssignments.get(record.groupId), record.gray, `Inconsistent group gray ${record.groupId}`);
  grayAssignments.set(record.groupId, record.gray);
  for (const other of newUnderlines.values()) {
    if (other.gray === null || other.gray === undefined || other.id === record.id || other.groupId === record.groupId || other.surah !== record.surah || Math.abs(other.verse - record.verse) > 2) continue;
    assert.notEqual(record.gray, other.gray, `Adjacent independent groups share a gray level: ${record.groupId} / ${other.groupId}`);
  }
}
for (const change of patternChanges.values()) {
  if (!change.role) continue;
  const expected = { good: 'solid', bad: 'dotted', neutral: 'dashed' }[change.role];
  assert(expected && change.after.split(/\s+/).includes(`ul-pattern-${expected}`), `Semantic pattern mismatch ${change.id}`);
}
for (const group of audit.contrastGroups ?? []) {
  const page = corpus.pages.find((page) => page.surah === group.surah);
  const colors = new Set(group.members.map((id) => underlineFamily(patternChanges.get(id)?.after.split(/\s+/) ?? newUnderlines.get(id)?.className.split(/\s+/) ?? page.underlines.find((record) => record.id === id)?.style ?? [])));
  assert(colors.has('red') && colors.has('green'), `Unpaired comparison color group ${group.id}`);
}
const vow = audit.changes.find((change) => change.kind === 'quotation' && change.surah === 4 && change.first === 'لأتخذن من عبادك');
assert(vow && vow.firstVerse === 118 && vow.lastVerse === 119 && vow.until === 'ومن يتخذ', 'The continuous vow in 4:118-119 regressed');
for (const [verse, first] of [[50, 'هل يستوي الأعمى والبصير'], [56, 'لا أتبع أهواءكم']]) {
  assert(audit.changes.some((change) => change.kind === 'quotation' && change.surah === 6 && change.firstVerse === verse && change.first === first), `Missing second reporting-command response in 6:${verse}`);
}
console.log(`Static preservation passed: ${Object.keys(manifest).filter((file) => !approvedInteractiveChanges.has(file)).length} unchanged source files, approved interaction assets/tests accounted for, 82 byte-identical references, 114 protected text/vertical trees, ${quotes} balanced quotation spans.`);

const browser = await chromium.launch();
const results = [];
const artifacts = path.join(root, 'tools/.artifacts/beta');
await mkdir(artifacts, { recursive: true });
const selected = quick ? index.pages.filter((page) => /001_Fatiha|003_AleImran|005_Maedah|027_Naml|043_Zokhrof|^index|^explanation/.test(page.page)) : index.pages;
const scenarios = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, media: 'screen' },
  { name: 'mobile', viewport: { width: 390, height: 844 }, media: 'screen' },
  { name: 'print', viewport: { width: 1440, height: 1000 }, media: 'print' },
];
try {
  for (const scenario of scenarios) {
    for (const page of selected) {
      const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
      try {
        const baseline = await context.newPage();
        const beta = await context.newPage();
        const surah = corpus.pages.find((entry) => entry.file === page.page);
        if (surah && !surah.reference) {
          const restored = restoredBaselineHtml(await readFile(path.join(root, page.page), 'utf8'));
          const url = pathToFileURL(path.join(root, page.page)).href;
          await beta.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: restored }));
        }
        for (const current of [baseline, beta]) await current.emulateMedia({ media: scenario.media });
        await Promise.all([baseline.goto(pathToFileURL(path.join(original, page.page)).href), beta.goto(pathToFileURL(path.join(root, page.page)).href)]);
        for (const current of [baseline, beta]) await current.evaluate(async () => { await document.fonts.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        const expected = await baseline.screenshot({ fullPage: true, animations: 'disabled', timeout: 120000 });
        const actual = await beta.screenshot({ fullPage: true, animations: 'disabled', timeout: 120000 });
        if (!expected.equals(actual)) {
          await writeFile(path.join(artifacts, 'baseline.png'), expected);
          await writeFile(path.join(artifacts, 'beta-baseline-view.png'), actual);
          throw new Error(`Unexpected visual difference outside approved annotations: ${scenario.name} ${page.page}`);
        }
        results.push({ page: page.page, scenario: scenario.name, mode: surah && !surah.reference ? 'approved-annotation-delta-masked' : 'unchanged', screenshot: hash(actual) });
        if (results.length % 10 === 0) console.log(`Passed ${results.length}/${selected.length * scenarios.length}: ${scenario.name} ${page.page}`);
      } finally { await context.close(); }
    }
  }
  const preview = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const scriptErrors = [];
  preview.on('pageerror', (error) => scriptErrors.push(error.message));
  const controlPage = corpus.pages.find((page) => page.surah === 3);
  await preview.setViewportSize({ width: 390, height: 844 });
  await preview.goto(pathToFileURL(path.join(root, controlPage.file)).href);
  await preview.waitForFunction(() => document.documentElement.dataset.readerReady === 'true' && document.fonts.status === 'loaded');
  const controls = preview.locator('.reader-controls input[type="checkbox"]');
  assert.equal(await controls.count(), 2, 'Each beta surah should have two reading checkboxes');
  const toolbarBounds = await preview.locator('.reader-controls').boundingBox();
  assert(toolbarBounds.x >= 0 && toolbarBounds.x + toolbarBounds.width <= 390, 'Beta reading controls are not visible at the top-left on mobile');
  const sourceState = await preview.evaluate(() => ({ text: document.body.textContent, verses: document.querySelectorAll('sup').length, lines: document.querySelectorAll('[data-reader-line]').length }));
  assert(sourceState.lines > 0);
  assert.equal(await controls.nth(0).isChecked(), true, 'Beta structured layout should be checked initially');
  await controls.nth(0).uncheck();
  const simpleState = await preview.evaluate(() => ({
    text: document.body.textContent,
    verses: document.querySelectorAll('sup').length,
    visibleLines: [...document.querySelectorAll('[data-reader-line]')].filter((element) => getComputedStyle(element).display !== 'none').length,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  assert.equal(simpleState.text, sourceState.text, 'Simple text mode changed beta Quranic text');
  assert.equal(simpleState.verses, sourceState.verses, 'Simple text mode changed beta verse markers');
  assert.equal(simpleState.visibleLines, 0, 'Simple text mode did not hide beta vertical lines');
  assert.equal(simpleState.overflow, false, 'Simple text mode overflows beta on mobile');
  const firstUnderline = preview.locator('[data-underline-id]:visible').first();
  await controls.nth(1).uncheck();
  assert.equal(await firstUnderline.evaluate((element) => getComputedStyle(element).borderBottomColor), 'rgba(0, 0, 0, 0)', 'Beta underline checkbox did not hide the line');
  await firstUnderline.hover();
  assert.equal(await preview.locator('[data-reader-underline-overlay]').count(), 0, 'Hidden beta underlines reappeared on hover');
  await preview.mouse.move(0, 0);
  await controls.nth(1).check();
  await controls.nth(0).check();
  const restoredState = await preview.evaluate(() => ({
    simple: document.documentElement.classList.contains('reader-simple-text'),
    underlinesHidden: document.documentElement.classList.contains('reader-underlines-hidden'),
    visibleLines: [...document.querySelectorAll('[data-reader-line]')].filter((element) => getComputedStyle(element).display !== 'none').length,
    verses: document.querySelectorAll('sup').length,
    text: document.body.textContent,
  }));
  assert.equal(restoredState.simple, false);
  assert.equal(restoredState.underlinesHidden, false);
  assert.equal(restoredState.visibleLines, sourceState.lines);
  assert.equal(restoredState.verses, sourceState.verses);
  assert.equal(restoredState.text, sourceState.text);
  await preview.setViewportSize({ width: 1440, height: 1000 });
  for (const number of [3, 4, 5, 6, 7, 12, 17, 18, 19, 24, 26, 27, 28, 37, 38, 40, 41, 42, 43]) {
    const page = corpus.pages.find((page) => page.surah === number);
    await preview.goto(pathToFileURL(path.join(root, page.file)).href);
    await preview.waitForFunction(() => document.documentElement.dataset.readerReady === 'true' && document.fonts.status === 'loaded');
    const quotes = await preview.locator('speech.beta-speech').evaluateAll((elements) => elements.map((element) => ({ content: getComputedStyle(element, '::before').content, color: getComputedStyle(element, '::before').color, open: element.hasAttribute('open'), implicit: element.hasAttribute('underline'), decoration: getComputedStyle(element, '::before').textDecorationLine })));
    assert(quotes.length > 0);
    for (const quote of quotes) {
      assert(quote.content.includes(quote.open ? '\u00ab' : '\u00bb'));
      if (quote.implicit) assert(quote.decoration.includes('underline'));
    }
    if ([6, 18, 38].includes(number)) {
      const readTurn = async (verse, first) => {
        const turn = audit.changes.find((entry) => entry.kind === 'quotation' && entry.surah === number && entry.firstVerse === verse && entry.first === first);
        assert(turn, `Missing exact scope regression ${number}:${verse} ${first}`);
        const quoted = await preview.evaluate((id) => {
          const opening = document.querySelector(`[data-beta-quote="${id}"][open]`);
          const closing = document.querySelector(`[data-beta-quote="${id}"][close]`);
          const range = document.createRange(); range.setStartAfter(opening); range.setEndBefore(closing);
          return range.toString();
        }, turn.id);
        return quoted.normalize('NFC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
      };
      if (number === 6) assert.equal(await readTurn(91, '\u0627\u0644\u0644\u0647'), '\u0627\u0644\u0644\u0647', 'The short answer still captures an earlier narrative mention');
      if (number === 18) {
        const instructions = await readTurn(95, '\u0645\u0627 \u0645\u0643\u0646\u064a \u0641\u064a\u0647 \u0631\u0628\u064a \u062e\u064a\u0631');
        assert(instructions.includes('\u0627\u062a\u0648\u0646\u064a \u0632\u0628\u0631 \u0627\u0644\u062d\u062f\u064a\u062f'));
        assert(!instructions.includes('\u062d\u062a\u0649 \u0627\u0630\u0627 \u0633\u0627\u0648\u0649'), 'Narrated levelling remains inside the instruction');
        assert.equal(await readTurn(96, '\u0627\u0646\u0641\u062e\u0648\u0627'), '\u0627\u0646\u0641\u062e\u0648\u0627', 'The blowing instruction includes narrated heating');
      }
      if (number === 38) assert.equal(await readTurn(23, '\u0623\u0643\u0641\u0644\u0646\u064a\u0647\u0627'), '\u0627\u0643\u0641\u0644\u0646\u064a\u0647\u0627', 'The inner alleged demand includes surrounding narration');
    }
    if (number === 4 || number === 12 || number === 19) {
      const expected = number === 4 ? { verse: 97, first: '\u0623\u0644\u0645 \u062a\u0643\u0646 \u0623\u0631\u0636 \u0627\u0644\u0644\u0647 \u0648\u0627\u0633\u0639\u0629', excluded: '\u0641\u0623\u0648\u0644\u0626\u0643 \u0645\u0623\u0648\u0627\u0647\u0645' }
        : number === 12 ? { verse: 50, first: '\u0627\u0626\u062a\u0648\u0646\u064a \u0628\u0647', excluded: '\u0641\u0644\u0645\u0627 \u062c\u0627\u0621\u0647 \u0627\u0644\u0631\u0633\u0648\u0644' }
        : { verse: 21, first: '\u0647\u0648 \u0639\u0644\u064a \u0647\u064a\u0646', excluded: '\u0648\u0643\u0627\u0646 \u0623\u0645\u0631\u0627 \u0645\u0642\u0636\u064a\u0627' };
      const turn = audit.changes.find((entry) => entry.kind === 'quotation' && entry.surah === number && entry.firstVerse === expected.verse && entry.first === expected.first);
      assert(turn);
      const quoted = await preview.evaluate((id) => {
        const opening = document.querySelector(`[data-beta-quote="${id}"][open]`);
        const closing = document.querySelector(`[data-beta-quote="${id}"][close]`);
        const range = document.createRange(); range.setStartAfter(opening); range.setEndBefore(closing);
        return range.toString();
      }, turn.id);
      const normalize = (value) => value.normalize('NFC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
      assert(normalize(quoted).startsWith(normalize(expected.first)), `Quotation opens at the wrong actual word ${number}:${expected.verse}`);
      assert(!normalize(quoted).includes(normalize(expected.excluded)), `Quotation includes following narration ${number}:${expected.verse}`);
      if (number === 19) assert(normalize(quoted).includes(normalize('\u0648\u0631\u062d\u0645\u0629 \u0645\u0646\u0627')), 'Nested divine continuation was omitted');
    }
    for (const entry of [...newUnderlines.values()].filter((entry) => entry.surah === number)) {
      const underline = preview.locator(`[data-underline-id="${entry.id}"]`);
      assert.equal(await underline.evaluate((element) => getComputedStyle(element).borderBottomStyle), entry.pattern, `New underline style mismatch ${entry.id}`);
    }
    if (number === 12) {
      await preview.locator('[data-underline-id^="beta-u-12-4-"]').first().hover();
      assert.equal(await preview.locator('.reader-related').count(), 3, 'Precomputed dream-object group is not linked');
      await preview.mouse.move(0, 0);
    }
    if (number === 17 || number === 24) {
      const verse = number === 17 ? 32 : 30;
      const outerText = number === 17 ? '\u0644\u0627 \u062a\u0642\u0631\u0628\u0648\u0627 \u0627\u0644\u0632\u0646\u0649' : '\u064a\u063a\u0636\u0648\u0627 \u0645\u0646 \u0623\u0628\u0635\u0627\u0631\u0647\u0645';
      const innerText = number === 17 ? '\u0627\u0644\u0632\u0646\u0649' : '\u0623\u0628\u0635\u0627\u0631\u0647\u0645';
      const outer = audit.coverage.find((record) => record.surah === number && record.verse === verse && record.phrase === outerText);
      const inner = audit.coverage.find((record) => record.surah === number && record.verse === verse && record.phrase === innerText);
      assert(outer?.members.length && inner?.members.length);
      const innerElement = preview.locator(`[data-underline-id="${inner.members[0]}"]`);
      const ancestry = await innerElement.evaluate((element) => { const result = []; for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.dataset.underlineId) result.push(parent.dataset.underlineId); return result; });
      assert(outer.members.some((id) => ancestry.includes(id)), `Missing semantic nested layer ${number}:${verse}`);
      const outerElement = preview.locator(`[data-underline-id="${outer.members[0]}"]`);
      assert(await outerElement.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom)) >= await innerElement.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom)) + 2, `Nested patterns overlap visually ${number}:${verse}`);
      assert.equal(await innerElement.evaluate((element) => getComputedStyle(element).borderBottomStyle), number === 17 ? 'dotted' : 'dashed');
      await innerElement.hover();
      const related = await preview.locator('.reader-related').evaluateAll((elements) => elements.map((element) => element.dataset.underlineId));
      assert(!outer.members.some((id) => related.includes(id)), `Inner semantic layer incorrectly activates outer group ${number}:${verse}`);
      await preview.mouse.move(0, 0);
    }
    await preview.screenshot({ path: path.join(artifacts, `surah-${number}.png`), animations: 'disabled' });
  }
  await preview.goto(pathToFileURL(path.join(root, 'annotation-review.html')).href);
  assert.equal(await preview.locator('.surah').count(), 114);
  assert.equal(await preview.locator('.review-item[data-status="pending"]:visible').count(), 0, 'Pending coverage checks must not masquerade as default confusion items');
  assert(await preview.locator('.review-item[data-status="decision"]:visible').count() > 0);
  await preview.locator('#status-filter').selectOption('source-check');
  assert.equal(await preview.locator('.review-item:visible').count(), 2);
  await preview.locator('#reset-filters').click();
  await preview.locator('#surah-filter').selectOption('19');
  await preview.locator('#search-filter').fill('\u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627');
  assert(await preview.locator('.review-item:visible').count() > 0, 'Diacritic-insensitive Arabic search failed');
  await preview.locator('#search-filter').fill('this-text-does-not-exist');
  assert.equal(await preview.locator('#empty-state').isVisible(), true);
  await preview.locator('#reset-filters').click();
  const pendingId = await preview.locator('.review-item[data-status="pending"]').first().getAttribute('id');
  await preview.goto(pathToFileURL(path.join(root, 'annotation-review.html')).href + `#${pendingId}`);
  assert.equal(await preview.locator(`#${pendingId}`).isVisible(), true, 'Permanent link did not reveal a hidden issue');
  assert.equal(await preview.locator(`#${pendingId}`).evaluate((element) => element.open), true);
  await preview.locator('#reset-filters').click();
  await preview.locator('#status-filter').selectOption('');
  await preview.locator('#surah-filter').selectOption('19');
  assert.equal(await preview.locator('.surah:visible').count(), 1);
  assert(await preview.locator('.review-item:visible').count() > 0);
  await preview.locator('#surah-filter').selectOption('');
  await preview.locator('#scope-filter').selectOption('true');
  assert.equal(await preview.locator('.surah:visible').count(), 82);
  await preview.locator('#reset-filters').click();
  await preview.screenshot({ path: path.join(artifacts, 'review-desktop.png') });
  await preview.setViewportSize({ width: 390, height: 844 });
  await preview.screenshot({ path: path.join(artifacts, 'review-mobile.png') });
  assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Review page overflows on mobile');
  assert.equal(await preview.locator('#coverage-table tbody tr').count(), passagePlan.length);
  assert.equal(await preview.locator('#quotation-coverage tbody tr').count(), 32);
  assert.equal(await preview.locator('#underline-inventory tbody tr').count(), underlineInventory.summary.versesExamined);
  await preview.locator('#underline-inventory').evaluate((element) => { element.open = true; });
  await preview.locator('#inventory-state').selectOption('explicit-passage-review');
  assert.equal(await preview.locator('#underline-inventory tbody tr:visible').count(), underlineInventory.summary.explicitReviewVerses);
  await preview.locator('#inventory-surah').selectOption('19');
  assert(await preview.locator('#underline-inventory tbody tr:visible').count() > 0);
  await preview.locator('#inventory-search').fill('this-inventory-text-does-not-exist');
  assert.equal(await preview.locator('#underline-inventory tbody tr:visible').count(), 0);
  await preview.locator('#inventory-search').fill('');
  await preview.locator('#inventory-surah').selectOption('');
  await preview.locator('#inventory-state').selectOption('structural-candidate-unreviewed');
  assert.equal(await preview.locator('#underline-inventory tbody tr:visible').count(), underlineInventory.summary.candidates);
  assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'The full underline inventory overflows the mobile page');
  await preview.locator('#underline-inventory').evaluate((element) => { element.open = false; });
  await preview.locator('#coverage-table').evaluate((element) => { element.open = true; });
  await preview.locator('#quotation-coverage').evaluate((element) => { element.open = true; });
  assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Expanded passage coverage overflows on mobile');
  await preview.locator('#coverage-table').evaluate((element) => { element.open = false; });
  await preview.locator('#quotation-coverage').evaluate((element) => { element.open = false; });
  await preview.locator('#surah-filter').selectOption('12');
  await preview.locator('#expand-all').click();
  const question = preview.locator('.review-item:visible').filter({ hasText: 'Who speaks the statements in verses 52-53?' });
  assert.equal(await question.count(), 1);
  await question.screenshot({ path: path.join(artifacts, 'review-question.png') });
  assert.deepEqual(scriptErrors, []);
  await writeFile(path.join(root, `data/beta/verification-${quick ? 'quick' : 'full'}.json`), JSON.stringify({ protectedReferences: protectedCount, quotationSpans: quotes, underlinePatternChanges: patternChanges.size, newUnderlines: newUnderlines.size, baselineComparisons: results.length, comparisonNote: 'Target comparisons remove only approved quotation/new-underline markers and restore documented pattern changes; the real beta deliberately displays those additions.', results }, null, 2) + '\n');
} finally { await browser.close(); }
console.log(`PASS: ${results.length} baseline-equivalence render checks; target annotations intentionally visible in the real beta. Review filters and quotation rendering passed.`);