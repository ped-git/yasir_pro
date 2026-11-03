import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { assignGroups, normalizeText } from './grouping.mjs';

const output = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(output, '..');
const definitions = JSON.parse(await readFile(path.join(output, 'data/curated-groups.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(source, 'tools/source-manifest.json'), 'utf8'));
const pages = Object.keys(catalog).filter((file) => file.endsWith('.html')).sort();
let editorEdits = {};
try { editorEdits = JSON.parse(await readFile(path.join(output, 'data/editor-edits.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const manifest = {};

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function sourceFiles(relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
    if (['interactive', 'inetractive_edit', 'tools', 'node_modules', '.git', '.DS_Store'].includes(entry.name)) continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(name));
    else files.push(name);
  }
  return files.sort();
}

function visit(node, callback) {
  callback(node);
  for (const child of node.childNodes ?? []) visit(child, callback);
}

function classes(node) {
  return node.attrs?.find((attribute) => attribute.name === 'class')?.value.split(/\s+/).filter(Boolean) ?? [];
}

function nearest(node, predicate) {
  for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) if (predicate(ancestor)) return ancestor;
  return null;
}

function rawText(node) {
  return node.value ?? (node.childNodes ?? []).map(rawText).join('');
}

function plainText(node) {
  return rawText(node).replace(/\s+/g, ' ').trim();
}

function selectorPath(node) {
  const parts = [];
  for (let current = node; current?.tagName && current.tagName !== 'html'; current = current.parentNode) {
    const siblings = current.parentNode.childNodes.filter((child) => child.tagName === current.tagName);
    parts.unshift(`${current.tagName}:nth-of-type(${siblings.indexOf(current) + 1})`);
  }
  return parts.join(' > ');
}

function excerpt(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const firstCount = Math.min(8, Math.ceil(words.length / 2));
  const lastCount = Math.min(8, words.length - firstCount);
  return { first: words.slice(0, firstCount).join(' '), last: lastCount ? words.slice(-lastCount).join(' ') : '' };
}

function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

async function save(file, value) {
  const target = path.join(output, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
}

function savedGroupScript(groups) {
  const data = JSON.stringify({ version: 1, groups: Object.fromEntries(groups.map((group) => [group.id, group.members])) }).replaceAll('<', '\\u003c');
  return `<script id="reader-group-data" type="application/json">${data}</script>\n`;
}

let underlineCount = 0;
let sectionCount = 0;
let linkedUnderlines = 0;
let symbolUnderlines = 0;
const groupingAudit = [];
const statistics = { curated: 0, suggested: 0, unassigned: 0 };
for (const file of await sourceFiles()) manifest[file] = hash(await readFile(path.join(source, file)));
const pageIndex = [];
for (const [pageIndexNumber, file] of pages.entries()) {
  if (editorEdits[file]) {
    const dataFile = `data/pages/${file.replace(/\.html$/, '.json')}`;
    const data = JSON.parse(await readFile(path.join(output, dataFile), 'utf8'));
    let html = await readFile(path.join(output, file), 'utf8');
    if (!html.includes('id="reader-group-data"')) {
      const document = parse(html, { sourceCodeLocationInfo: true });
      let end;
      visit(document, (node) => { if (node.tagName === 'head') end = node.sourceCodeLocation.endTag.startOffset; });
      html = html.slice(0, end) + savedGroupScript(data.groups) + html.slice(end);
      await save(file, html);
    }
    pageIndex.push({ page: file, data: dataFile, underlines: data.underlines.length, sections: data.sections.length });
    underlineCount += data.underlines.length;
    sectionCount += data.sections.length;
    const linked = new Set(data.groups.filter((group) => group.members.length > 1).flatMap((group) => group.members));
    linkedUnderlines += linked.size;
    symbolUnderlines += data.underlines.filter((record) => !/\p{Script=Arabic}/u.test(normalizeText(record.text))).length;
    for (const group of data.groups) statistics[group.reviewStatus] = (statistics[group.reviewStatus] ?? 0) + 1;
    groupingAudit.push({ page: file, manualEditsPreserved: true, linkedUnderlines: linked.size, addedRelationships: 0, removedRelationships: 0, addedExamples: [], removedExamples: [] });
    continue;
  }
  let html = await readFile(path.join(source, file), 'utf8');
  const document = parse(html, { sourceCodeLocationInfo: true });
  const prefix = `p${String(pageIndexNumber + 1).padStart(3, '0')}`;
  const edits = [];
  const extraAttributes = new Map();
  const annotate = (node, values) => extraAttributes.set(node, { ...(extraAttributes.get(node) ?? {}), ...values });
  const sectionNodes = new Map();
  const underlineNodes = new Map();
  const offsets = new Map();
  const contextNodes = new Map();
  let body;
  let head;
  visit(document, (node) => {
    if (node.tagName === 'body') body = node;
    if (node.tagName === 'head') head = node;
    if (classes(node).includes('verse-group')) sectionNodes.set(node, `${prefix}-s${String(sectionNodes.size + 1).padStart(4, '0')}`);
    if (classes(node).includes('underline')) underlineNodes.set(node, `${prefix}-u${String(underlineNodes.size + 1).padStart(4, '0')}`);
  });
  let bodyText = '';
  const indexText = (node) => {
    const start = bodyText.length;
    if (node.nodeName === '#text') bodyText += node.value;
    for (const child of node.childNodes ?? []) indexText(child);
    offsets.set(node, { start, end: bodyText.length });
  };
  indexText(body);
  const verseEnds = [];
  visit(body, (node) => {
    if (node.tagName !== 'sup') return;
    const numeral = plainText(node).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
    if (/^\d+$/.test(numeral)) verseEnds.push({ end: offsets.get(node).end, verse: Number(numeral) });
  });
  const records = [...underlineNodes].map(([node, id]) => {
    const parent = nearest(node, (ancestor) => underlineNodes.has(ancestor));
    const section = nearest(node, (ancestor) => sectionNodes.has(ancestor));
    const context = nearest(node, (ancestor) => ancestor.tagName === 'p' || classes(ancestor).some((name) => name.startsWith('verse-paragraph')) || sectionNodes.has(ancestor)) ?? body;
    if (!contextNodes.has(context)) contextNodes.set(context, `${prefix}-c${contextNodes.size + 1}`);
    const utilities = classes(node).filter((name) => name.startsWith('ul-')).sort();
    const colorToken = utilities.find((name) => /^ul-color-(green|red|blue|gray)/.test(name));
    const gradientColors = utilities.filter((name) => name.startsWith('ul-stops-')).join(' ');
    const colorFamily = colorToken?.split('-')[2] ?? (gradientColors.includes('green') ? 'green' : gradientColors.includes('red') ? 'red' : null);
    const appearance = { signature: utilities.join(' '), structure: utilities.filter((name) => !name.startsWith('ul-color-') && !name.startsWith('ul-stops-')).join(' '), colorFamily };
    const verse = verseEnds.find((marker) => marker.end >= offsets.get(node).start)?.verse ?? (verseEnds.at(-1)?.verse ?? 1);
    return { id, text: plainText(node), selector: selectorPath(node), textHash: hash(plainText(node)), appearance, verse, blockIndex: Number(contextNodes.get(context).split('-c')[1]), parentId: underlineNodes.get(parent) ?? null, sectionId: sectionNodes.get(section) ?? null, contextId: contextNodes.get(context), ...offsets.get(node) };
  });
  const annotation = assignGroups(records, definitions[file] ?? [], bodyText, prefix);
  const relationships = (groups) => {
    const pairs = new Set();
    for (const group of groups) {
      for (let first = 0; first < group.members.length; first++) {
        for (const second of group.members.slice(first + 1)) pairs.add([group.members[first], second].sort().join('|'));
      }
    }
    return pairs;
  };
  let previousGroups = [];
  try {
    previousGroups = JSON.parse(await readFile(path.join(output, `data/pages/${file.replace(/\.html$/, '.json')}`), 'utf8')).groups;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const previousPairs = relationships(previousGroups);
  const nextPairs = relationships(annotation.groups);
  const addedPairs = [...nextPairs].filter((pair) => !previousPairs.has(pair));
  const removedPairs = [...previousPairs].filter((pair) => !nextPairs.has(pair));
  const linked = new Set(annotation.groups.filter((group) => group.members.length > 1).flatMap((group) => group.members));
  linkedUnderlines += linked.size;
  symbolUnderlines += records.filter((record) => !/\p{Script=Arabic}/u.test(normalizeText(record.text))).length;
  groupingAudit.push({ page: file, linkedUnderlines: linked.size, addedRelationships: addedPairs.length, removedRelationships: removedPairs.length, addedExamples: addedPairs.slice(0, 8).map((pair) => pair.split('|')), removedExamples: removedPairs.slice(0, 8).map((pair) => pair.split('|')) });
  const byId = new Map(annotation.underlines.map((record) => [record.id, record]));
  for (const [node, id] of underlineNodes) annotate(node, { 'data-underline-id': id, 'data-underline-groups': byId.get(id).groups.join(' ') });
  const sections = [];
  let lineCount = 0;
  visit(body, (node) => {
    if (!classes(node).some((name) => name.startsWith('connection-line--'))) return;
    const owner = nearest(node, (ancestor) => sectionNodes.has(ancestor));
    if (!owner || node.parentNode !== owner) return;
    const sectionId = sectionNodes.get(owner);
    const lineId = `${prefix}-l${String(++lineCount).padStart(4, '0')}`;
    annotate(node, { 'data-reader-line': lineId, 'data-reader-owner': sectionId, role: 'button', tabindex: '0', 'aria-expanded': 'true', 'aria-label': 'Collapse or expand this section' });
    annotate(owner, { 'data-reader-section': sectionId });
    let record = sections.find((section) => section.id === sectionId);
    if (!record) {
      const parent = nearest(owner, (ancestor) => sectionNodes.has(ancestor));
      record = { id: sectionId, parentId: sectionNodes.get(parent) ?? null, selector: selectorPath(owner), excerpt: excerpt(plainText(owner)), lines: [] };
      sections.push(record);
    }
    record.lines.push(lineId);
  });
  for (const [node, attributes] of extraAttributes) {
    const offset = node.sourceCodeLocation.startTag.endOffset - 1;
    edits.push({ start: offset, end: offset, value: Object.entries(attributes).map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('') });
  }
  visit(document, (node) => {
    if (node.tagName !== 'link') return;
    const attributes = Object.fromEntries(node.attrs.map((attribute) => [attribute.name, attribute.value]));
    if (attributes.rel !== 'stylesheet') return;
    const target = path.resolve(source, path.dirname(file), attributes.href);
    const href = path.relative(path.dirname(path.join(output, file)), target).split(path.sep).join('/');
    const location = node.sourceCodeLocation.attrs.href;
    edits.push({ start: location.startOffset, end: location.endOffset, value: `href="${escapeAttribute(href)}"` });
  });
  const assets = path.posix.relative(path.posix.dirname(file), 'assets');
  const end = head.sourceCodeLocation.endTag.startOffset;
  edits.push({ start: end, end, value: `<link rel="stylesheet" href="${assets}/interactions.css">\n${savedGroupScript(annotation.groups)}<script defer src="${assets}/interactions.js"></script>\n` });
  for (const edit of edits.sort((first, second) => second.start - first.start)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  await save(file, html);
  const dataFile = `data/pages/${file.replace(/\.html$/, '.json')}`;
  await save(dataFile, `${JSON.stringify({ version: 1, source: file, sourceHash: manifest[file], underlines: annotation.underlines, groups: annotation.groups, sections }, null, 2)}\n`);
  pageIndex.push({ page: file, data: dataFile, underlines: records.length, sections: sections.length });
  underlineCount += records.length;
  sectionCount += sections.length;
  for (const group of annotation.groups) statistics[group.reviewStatus]++;
}
await save('data/source-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
await save('data/catalog.json', `${JSON.stringify({ version: 1, pages: pageIndex, totals: { pages: pages.length, underlines: underlineCount, linkedUnderlines, symbolUnderlines, sections: sectionCount, groups: statistics } }, null, 2)}\n`);
await save('data/grouping-audit.json', `${JSON.stringify({ totals: { linkedUnderlines, symbolUnderlines, addedRelationships: groupingAudit.reduce((total, page) => total + page.addedRelationships, 0), removedRelationships: groupingAudit.reduce((total, page) => total + page.removedRelationships, 0) }, pages: groupingAudit }, null, 2)}\n`);
for (const [file, expected] of Object.entries(manifest)) assert.equal(hash(await readFile(path.join(source, file))), expected, `Source modified during build: ${file}`);
console.log(`Built ${pages.length} interactive pages; tagged ${underlineCount} underlines and ${sectionCount} collapsible sections.`);
console.log(`Group statuses: ${JSON.stringify(statistics)}. Existing source files are unchanged.`);
console.log(`Multi-phrase coverage: ${linkedUnderlines} underlines; ${symbolUnderlines} symbol markers excluded from automatic text groups.`);