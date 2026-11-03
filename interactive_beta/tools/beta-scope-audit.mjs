import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
const audit = JSON.parse(await readFile(path.join(root, 'data/beta/changes.json'), 'utf8'));
const attrs = (node) => Object.fromEntries((node.attrs ?? []).map((attribute) => [attribute.name, attribute.value]));
const normalize = (value) => value.normalize('NFC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
const findings = [];
let groupCount = 0;
let underlineCount = 0;
for (const entry of catalog.pages) {
  const document = parse(await readFile(path.join(root, entry.page), 'utf8'), { sourceCodeLocationInfo: true });
  const nodes = [];
  const texts = [];
  const walk = (node) => {
    nodes.push(node);
    if (node.nodeName === '#text' && node.parentNode?.tagName !== 'script' && node.sourceCodeLocation) texts.push(node);
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(document);
  const saved = nodes.find((node) => node.tagName === 'script' && attrs(node).id === 'reader-group-data');
  assert(saved, `No precomputed group index: ${entry.page}`);
  const index = JSON.parse(saved.childNodes.map((node) => node.value ?? '').join(''));
  assert.equal(index.version, 1);
  const data = JSON.parse(await readFile(path.join(root, entry.data), 'utf8'));
  assert.deepEqual(index.groups, Object.fromEntries(data.groups.map((group) => [group.id, group.members])), `Saved grouping mismatch: ${entry.page}`);
  const rendered = new Map(nodes.filter((node) => attrs(node)['data-underline-id']).map((node) => [attrs(node)['data-underline-id'], attrs(node)]));
  for (const [id, attributes] of rendered) {
    const memberships = attributes['data-underline-groups'].split(/\s+/).filter(Boolean);
    for (const group of memberships) assert(index.groups[group]?.includes(id), `Unsaved group membership ${entry.page} ${id}`);
  }
  for (const [id, members] of Object.entries(index.groups)) for (const member of members) assert(rendered.has(member), `Missing group member ${entry.page} ${id} ${member}`);
  groupCount += Object.keys(index.groups).length;
  underlineCount += rendered.size;
  const quoteNodes = new Map();
  for (const node of nodes) {
    const attributes = attrs(node);
    if (!attributes['data-beta-quote']) continue;
    const id = attributes['data-beta-quote'];
    if (!quoteNodes.has(id)) quoteNodes.set(id, {});
    quoteNodes.get(id)['open' in attributes ? 'open' : 'close'] = node;
  }
  for (const [id, pair] of quoteNodes) {
    assert(pair.open && pair.close);
    const start = pair.open.sourceCodeLocation.endOffset;
    const end = pair.close.sourceCodeLocation.startOffset;
    const inside = texts.filter((node) => node.sourceCodeLocation.startOffset >= start && node.sourceCodeLocation.endOffset <= end);
    const content = normalize(inside.map((node) => node.value).join(' '));
    const reporters = content.match(/(?:^|\s)(?:قال|قالت|قالوا|قالا|قل|فقال|فقالوا|وقال|وقالت|وقالوا|وقل)(?=\s)/g) ?? [];
    const inner = [...quoteNodes.values()].filter((other) => other !== pair && other.open?.sourceCodeLocation.startOffset > start && other.close?.sourceCodeLocation.endOffset <= end);
    if (reporters.length > inner.length) {
      const metadata = audit.changes.find((change) => change.kind === 'quotation' && change.id === id);
      findings.push({ id, page: entry.page, surah: metadata.surah, firstVerse: metadata.firstVerse, lastVerse: metadata.lastVerse, first: metadata.first, until: metadata.until, speaker: metadata.speaker, reporters: reporters.length, nested: inner.length, ending: content.slice(-420), opening: content.slice(0, 170) });
    }
  }
}
await writeFile(path.join(root, 'data/beta/scope-audit.json'), JSON.stringify({ savedGrouping: { pages: catalog.pages.length, groups: groupCount, underlines: underlineCount, inferredAtRuntime: false }, quotationCandidates: findings }, null, 2) + '\n');
console.log(`Saved grouping verified on ${catalog.pages.length} pages: ${underlineCount} underlines, ${groupCount} groups; memberships are persisted in HTML and JSON.`);
console.log(`Found ${findings.length} quotation scopes with internal reporting cues for editorial inspection; a cue alone is not an automatic error.`);
for (const item of findings.slice(0, 22)) console.log(JSON.stringify(item));