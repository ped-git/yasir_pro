import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const root = fileURLToPath(new URL('../', import.meta.url));
const corpus = JSON.parse(await readFile(path.join(root, 'data/beta/corpus.json'), 'utf8'));
const actual = {};
for (const page of corpus.pages) {
  const document = parse(await readFile(path.join(root, page.file), 'utf8'));
  const markers = [];
  let text = '';
  const visit = (node) => {
    if (['head', 'script', 'style'].includes(node.tagName)) return;
    if (node.tagName === 'speech') markers.push({ offset: text.length, attributes: node.attrs });
    if (node.nodeName === '#text') text += node.value;
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);
  actual[page.file] = { text: createHash('sha256').update(text).digest('hex'), quotationMarkers: markers };
}
const originalFilename = path.join(root, 'data/beta/underline-review-quote-baseline.json');
const waqfFilename = path.join(root, 'data/beta/waqf-review-quote-baseline.json');
const currentFilename = path.join(root, 'data/beta/waqf-whitespace-review-quote-baseline.json');
if (process.argv.includes('--record')) {
  await writeFile(originalFilename, JSON.stringify(actual, null, 2) + '\n', { flag: 'wx' });
  console.log('Recorded the original text and quotation-marker positions.');
} else if (process.argv.includes('--record-waqf-revision')) {
  await writeFile(waqfFilename, JSON.stringify(actual, null, 2) + '\n', { flag: 'wx' });
  console.log('Recorded a separate waqf-aware quote-position baseline; earlier snapshots are retained.');
} else if (process.argv.includes('--record-waqf-whitespace-revision')) {
  await writeFile(currentFilename, JSON.stringify(actual, null, 2) + '\n', { flag: 'wx' });
  console.log('Recorded the no-gap waqf quote-position baseline; earlier snapshots are retained.');
} else {
  assert.deepEqual(actual, JSON.parse(await readFile(currentFilename, 'utf8')), 'The underline review changed text or waqf-aware quotation marker positions');
  console.log('PASS: all Quranic text and waqf-aware quotation marker positions are unchanged across 114 surahs.');
}