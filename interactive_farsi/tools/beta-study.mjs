import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(root, '../interactive');
if (process.argv.includes('--copy')) {
  assert(!(await readdir(root)).includes('Surah'), 'The beta copy already exists; refusing to overwrite it');
  await cp(source, root, { recursive: true, force: false, errorOnExist: false });
  console.log('Copied interactive to interactive_beta without changing the source.');
}
const { parse } = await import('./node_modules/parse5/dist/index.js');
const referenceNumbers = [1, 2, 9, 11, 20, 22, 25, 31, 32, 34, 35, ...Array.from({ length: 71 }, (_, index) => index + 44)];
const references = new Set(referenceNumbers);
export const normalize = (text) => text.normalize('NFC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
const attrs = (node) => Object.fromEntries((node.attrs ?? []).map((attribute) => [attribute.name, attribute.value]));
const classes = (node) => (attrs(node).class ?? '').split(/\s+/).filter(Boolean);
const text = (node) => node.value ?? (node.childNodes ?? []).map(text).join('');
const hash = (value) => createHash('sha256').update(value).digest('hex');
function walk(node, callback) { callback(node); for (const child of node.childNodes ?? []) walk(child, callback); }
function number(text) { return Number(text.replace(/[۰-۹]/g, (digit) => digit.charCodeAt(0) - 0x06f0).replace(/[٠-٩]/g, (digit) => digit.charCodeAt(0) - 0x0660)); }
async function files(relative = '') {
  const result = [];
  for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
    if (['node_modules', '.artifacts', '.DS_Store', '.git'].includes(entry.name)) continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await files(name)); else result.push(name);
  }
  return result.sort();
}
const manifestFile = path.join(root, 'data/beta-source-manifest.json');
try { await readFile(manifestFile); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const hashes = {};
  for (const file of await files()) hashes[file] = hash(await readFile(path.join(source, file)));
  await writeFile(manifestFile, JSON.stringify(hashes, null, 2) + '\n');
}
const pages = [];
const phraseEvidence = new Map();
for (const filename of (await readdir(path.join(root, 'Surah'))).filter((file) => /^\d{3}.*\.html$/.test(file)).sort()) {
  const surah = Number(filename.slice(0, 3));
  const html = await readFile(path.join(root, 'Surah', filename), 'utf8');
  const document = parse(html, { sourceCodeLocationInfo: true });
  const nodes = [];
  walk(document, (node) => { if (node.tagName) nodes.push(node); });
  const verseMarkers = nodes.filter((node) => node.tagName === 'sup' && Number.isFinite(number(text(node)))).map((node) => ({ end: node.sourceCodeLocation?.endOffset ?? 0, verse: number(text(node)) }));
  const verseAt = (node) => verseMarkers.find((marker) => marker.end >= node.sourceCodeLocation?.startOffset)?.verse ?? verseMarkers.at(-1)?.verse ?? 1;
  const underlines = [];
  const quotes = [];
  const vertical = [];
  const verses = [];
  let body;
  walk(document, (node) => { if (node.tagName === 'body') body = node; });
  let running = '';
  let previousVerse = 0;
  const verseWalk = (node) => {
    if (node.nodeName === '#text') running += node.value;
    if (node.tagName === 'sup') {
      const verse = number(text(node));
      if (verse > previousVerse) { verses.push({ verse, text: running.replace(/\s+/g, ' ').trim() }); previousVerse = verse; running = ''; }
      return;
    }
    for (const child of node.childNodes ?? []) verseWalk(child);
  };
  verseWalk(body);
  for (const node of nodes) {
    const attributes = attrs(node);
    if (classes(node).includes('underline')) {
      const style = classes(node).filter((name) => name.startsWith('ul-'));
      const record = { id: attributes['data-underline-id'], verse: verseAt(node), text: text(node).replace(/\s+/g, ' ').trim(), style, pattern: style.find((name) => name.startsWith('ul-pattern-'))?.slice(11) ?? (style.some((name) => name.includes('wavy')) ? 'wavy' : 'other'), color: style.find((name) => name.startsWith('ul-color-')) ?? null, start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset };
      underlines.push(record);
      if (references.has(surah) && normalize(record.text).split(/\s+/).length >= 2 && /\p{Script=Arabic}/u.test(record.text)) {
        const key = normalize(record.text);
        if (!phraseEvidence.has(key)) phraseEvidence.set(key, []);
        phraseEvidence.get(key).push({ surah, verse: record.verse, text: record.text, pattern: record.pattern, color: record.color, style: record.style });
      }
    }
    if (node.tagName === 'speech') {
      const parentText = text(node.parentNode).replace(/\s+/g, ' ').trim();
      quotes.push({ verse: verseAt(node), attributes, context: parentText.slice(0, 550), start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset });
    }
    if (classes(node).some((name) => name.startsWith('connection-line--') || name.startsWith('connection-cap--')) || attributes['data-reader-line'] || attributes['data-reader-section']) {
      vertical.push({ tag: node.tagName, attrs: node.attrs, startTag: html.slice(node.sourceCodeLocation.startTag.startOffset, node.sourceCodeLocation.startTag.endOffset) });
    }
  }
  pages.push({ surah, file: `Surah/${filename}`, reference: references.has(surah), title: nodes.find((node) => node.tagName === 'title')?.childNodes[0]?.value ?? '', hash: hash(html), underlines, quotes, vertical, verses });
}
await mkdir(path.join(root, 'data/beta'), { recursive: true });
await writeFile(path.join(root, 'data/beta/corpus.json'), JSON.stringify({ referenceNumbers, pages }, null, 2) + '\n');
await writeFile(path.join(root, 'data/beta/reference-phrases.json'), JSON.stringify(Object.fromEntries(phraseEvidence), null, 2) + '\n');
console.log(JSON.stringify({ surahs: pages.length, references: pages.filter((page) => page.reference).length, targets: pages.filter((page) => !page.reference).map((page) => page.surah), referenceUnderlines: pages.filter((page) => page.reference).reduce((total, page) => total + page.underlines.length, 0), referenceQuotationMarks: pages.filter((page) => page.reference).reduce((total, page) => total + page.quotes.length, 0) }, null, 2));