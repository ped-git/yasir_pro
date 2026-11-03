import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, serialize } from 'parse5';
import postcss from 'postcss';
import { attributes, digest, walk } from './catalog.mjs';

export function safeFile(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\0')) throw new Error('Invalid document path');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Path must remain inside interactive');
  return resolved;
}

export function textContent(node) {
  return node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(textContent).join('');
}

function documentText(node) {
  const attrs = attributes(node);
  if ('data-reader-ornament' in attrs || 'data-reader-line' in attrs || (attrs.class ?? '').split(/\s+/).some((name) => name.startsWith('connection-cap--'))) return '';
  return node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(documentText).join('');
}

function restoreTrailingDocumentWhitespace(body, whitespace) {
  const textNodes = [];
  const collect = (node) => {
    const attrs = attributes(node);
    if ('data-reader-ornament' in attrs || 'data-reader-line' in attrs || (attrs.class ?? '').split(/\s+/).some((name) => name.startsWith('connection-cap--'))) return;
    if (node.nodeName === '#text') textNodes.push(node);
    else for (const child of node.childNodes ?? []) collect(child);
  };
  collect(body);
  for (const node of textNodes.reverse()) {
    node.value = node.value.replace(/\s+$/u, '');
    if (node.value) break;
  }
  if (whitespace) body.childNodes.push({ nodeName: '#text', value: whitespace, parentNode: body });
}

function nodePath(node) {
  const parts = [];
  for (let current = node; current?.tagName && current.tagName !== 'html'; current = current.parentNode) {
    const siblings = current.parentNode.childNodes.filter((child) => child.tagName === current.tagName);
    parts.unshift(`${current.tagName}:nth-of-type(${siblings.indexOf(current) + 1})`);
  }
  return parts.join(' > ');
}

function bodyOf(html) {
  let body;
  const document = parse(html, { sourceCodeLocationInfo: true });
  walk(document, (node) => { if (node.tagName === 'body') body = node; });
  return { document, body };
}

async function optionalJson(filename, fallback) {
  try { return JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function readDocument(root, page, entries) {
  const entry = entries.find((item) => item.page === page);
  if (!entry) throw new Error('Unknown document');
  const html = await readFile(safeFile(root, page), 'utf8');
  const cssFile = `styles/editor-pages/${page.replace(/\.html$/, '.css')}`;
  let css = '';
  try { css = await readFile(safeFile(root, cssFile), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { page, html, css, hash: digest(html), cssHash: digest(css), data: await optionalJson(safeFile(root, entry.data), { underlines: [], sections: [], groups: [] }) };
}

export function previewHtml(html, page, workspace = null) {
  const { document, body } = bodyOf(html);
  const edits = [];
  const trailingWhitespace = (html.slice(body.sourceCodeLocation.endTag.endOffset).match(/^\s*/)?.[0] ?? '');
  if (trailingWhitespace) edits.push({
    start: body.sourceCodeLocation.endTag.endOffset,
    end: body.sourceCodeLocation.endTag.endOffset + trailingWhitespace.length,
    value: '',
  });
  walk(document, (node) => {
    if (node.tagName === 'script') edits.push({ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset, value: '' });
    if (node.tagName === 'head') {
      const base = workspace ? `/${encodeURIComponent(workspace)}/${page.split('/').map(encodeURIComponent).join('/')}` : `/book/${page.split('/').map(encodeURIComponent).join('/')}`;
      edits.push({ start: node.sourceCodeLocation.startTag.endOffset, end: node.sourceCodeLocation.startTag.endOffset, value: `<base href="${base}">` });
    }
  });
  for (const edit of edits.sort((first, second) => second.start - first.start || second.end - first.end)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  return html;
}

export async function saveDocument(root, payload, entries) {
  const loaded = await readDocument(root, payload.page, entries);
  assert.equal(loaded.hash, payload.hash, 'Document changed on disk; reload before saving');
  assert.equal(loaded.cssHash, payload.cssHash, 'Page CSS changed on disk; reload before saving');
  assert(typeof payload.body === 'string' && payload.body.length < 6_000_000, 'Invalid document body');
  assert(typeof payload.css === 'string' && payload.css.length < 2_000_000, 'Invalid page CSS');
  const current = bodyOf(loaded.html);
  let bodyHtml = payload.body;
  const edited = bodyOf(`<!doctype html><html><head></head><body>${bodyHtml}</body></html>`);
  const bodyEndTag = current.body.sourceCodeLocation.endTag;
  const trailingWhitespaceOutsideBody = loaded.html.slice(bodyEndTag.endOffset).match(/^\s*/)?.[0] ?? '';
  let expectedText = documentText(current.body);
  const normalizedOutsideWhitespace = trailingWhitespaceOutsideBody.replace(/\r\n?/g, '\n');
  if (normalizedOutsideWhitespace && expectedText.endsWith(normalizedOutsideWhitespace)) {
    expectedText = expectedText.slice(0, -normalizedOutsideWhitespace.length);
  }
  let editedText = documentText(edited.body);
  const expectedTrailingWhitespace = expectedText.match(/\s*$/u)[0];
  const expectedContent = expectedText.slice(0, expectedText.length - expectedTrailingWhitespace.length);
  if (expectedContent === editedText.replace(/\s+$/u, '')) {
    restoreTrailingDocumentWhitespace(edited.body, expectedTrailingWhitespace);
    editedText = documentText(edited.body);
    bodyHtml = serialize(edited.body);
  }
  if (editedText !== expectedText) {
    let offset = 0;
    while (offset < expectedText.length && expectedText[offset] === editedText[offset]) offset++;
    const context = (value) => [...value.slice(Math.max(0, offset - 12), offset + 20)].map((character) => `U+${character.codePointAt(0).toString(16).toUpperCase()}`);
    throw new Error(`Saving must not change document text or whitespace (first mismatch at ${offset}; expected ${context(expectedText).join(' ')}, received ${context(editedText).join(' ')})`);
  }
  walk(edited.body, (node) => {
    assert(!['script', 'iframe', 'object', 'embed', 'base', 'link'].includes(node.tagName), 'Unsafe element in document');
    for (const attribute of node.attrs ?? []) {
      assert(!attribute.name.startsWith('on') && !/^javascript:/i.test(attribute.value), 'Unsafe document attribute');
      assert(!attribute.name.startsWith('data-editor-'), 'Temporary editor attributes cannot be saved');
    }
  });
  const cssTree = postcss.parse(payload.css);
  cssTree.walkAtRules(() => { throw new Error('Page CSS cannot import external files'); });
  const quoteSelector = /^\.edit-quote-(?:open|close|color-(?:blue|green|red|black|gray|lightblue|mixed))::before$/;
  cssTree.walkRules((rule) => assert(/^\.edit-style-[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+|:not\(#edit-reserved\))?$/.test(rule.selector) || quoteSelector.test(rule.selector), 'Unexpected annotation CSS selector'));
  cssTree.walkDecls((declaration) => assert(!/url\s*\(/i.test(declaration.value), 'Annotation CSS cannot load external resources'));
  const ids = new Set();
  const underlines = [];
  const sections = [];
  const groups = new Map();
  const oldGroups = new Map(loaded.data.groups.map((group) => [group.id, group]));
  const oldUnderlines = new Map(loaded.data.underlines.map((record) => [record.id, record]));
  const parentAttribute = (node, name) => {
    for (let parent = node.parentNode; parent; parent = parent.parentNode) if (attributes(parent)[name]) return attributes(parent)[name];
    return null;
  };
  walk(edited.body, (node) => {
    const attrs = attributes(node);
    if (attrs['data-underline-id']) {
      const id = attrs['data-underline-id'];
      assert(!ids.has(id), 'Duplicate underline ID');
      ids.add(id);
      const tags = [...new Set((attrs['data-underline-groups'] ?? '').split(/\s+/).filter(Boolean))];
      assert(tags.every((tag) => /^[a-zA-Z0-9_-]+$/.test(tag)), 'Group IDs may contain letters, numbers, hyphens, and underscores');
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, { ...(oldGroups.get(tag) ?? {}), id: tag, label: payload.groupLabels?.[tag] ?? oldGroups.get(tag)?.label ?? tag, basis: 'saved-manual-membership', reviewStatus: 'manual', members: [] });
        groups.get(tag).members.push(id);
      }
      const text = textContent(node).replace(/\s+/g, ' ').trim();
      underlines.push({ ...(oldUnderlines.get(id) ?? {}), id, text, textHash: digest(text), selector: nodePath(node), parentId: parentAttribute(node, 'data-underline-id'), sectionId: parentAttribute(node, 'data-reader-section'), groups: tags });
    }
    if (attrs['data-reader-section']) {
      const section = { id: attrs['data-reader-section'], parentId: parentAttribute(node, 'data-reader-section'), selector: nodePath(node), lines: [], excerpt: {} };
      for (const child of node.childNodes ?? []) if (attributes(child)['data-reader-line']) section.lines.push(attributes(child)['data-reader-line']);
      const words = textContent(node).trim().split(/\s+/);
      section.excerpt = { first: words.slice(0, 8).join(' '), last: words.slice(-8).join(' ') };
      sections.push(section);
    }
  });
  for (const group of groups.values()) {
    const previous = oldGroups.get(group.id);
    if (previous && previous.label === group.label && JSON.stringify([...previous.members].sort()) === JSON.stringify([...group.members].sort())) {
      group.reviewStatus = previous.reviewStatus;
      group.basis = previous.basis;
    }
  }
  const location = current.body.sourceCodeLocation;
  let html = loaded.html.slice(0, location.startTag.endOffset) + bodyHtml
    + loaded.html.slice(bodyEndTag.startOffset, bodyEndTag.endOffset)
    + loaded.html.slice(bodyEndTag.endOffset + trailingWhitespaceOutsideBody.length);
  const cssFile = `styles/editor-pages/${payload.page.replace(/\.html$/, '.css')}`;
  if (!html.includes(`data-editor-stylesheet="true"`)) {
    const href = path.posix.relative(path.posix.dirname(payload.page), cssFile);
    const parsed = bodyOf(html);
    let end;
    walk(parsed.document, (node) => { if (node.tagName === 'head') end = node.sourceCodeLocation.endTag.startOffset; });
    html = html.slice(0, end) + `<link rel="stylesheet" data-editor-stylesheet="true" href="${href}">\n` + html.slice(end);
  }
  const indexData = JSON.stringify({ version: 1, groups: Object.fromEntries([...groups.values()].map((group) => [group.id, group.members])) }).replaceAll('<', '\\u003c');
  const indexScript = `<script id="reader-group-data" type="application/json">${indexData}</script>`;
  const indexed = bodyOf(html);
  let scriptLocation;
  let headEnd;
  walk(indexed.document, (node) => {
    if (node.tagName === 'script' && attributes(node).id === 'reader-group-data') scriptLocation = node.sourceCodeLocation;
    if (node.tagName === 'head') headEnd = node.sourceCodeLocation.endTag.startOffset;
  });
  if (scriptLocation) html = html.slice(0, scriptLocation.startOffset) + indexScript + html.slice(scriptLocation.endOffset);
  else html = html.slice(0, headEnd) + indexScript + '\n' + html.slice(headEnd);
  const savedAt = new Date().toISOString();
  const data = { ...loaded.data, underlines, sections, groups: [...groups.values()], editorSavedAt: savedAt, manual: true };
  const registryFile = 'data/editor-edits.json';
  const registry = await optionalJson(safeFile(root, registryFile), {});
  registry[payload.page] = { savedAt, htmlHash: digest(html), cssFile };
  const index = await optionalJson(safeFile(root, 'data/catalog.json'), { pages: entries });
  const entry = index.pages.find((item) => item.page === payload.page);
  entry.underlines = underlines.length;
  entry.sections = sections.length;
  if (index.totals) {
    index.totals.underlines = index.pages.reduce((total, item) => total + item.underlines, 0);
    index.totals.sections = index.pages.reduce((total, item) => total + item.sections, 0);
  }
  const writes = [
    [payload.page, html], [cssFile, payload.css], [entry.data, JSON.stringify(data, null, 2) + '\n'],
    [registryFile, JSON.stringify(registry, null, 2) + '\n'], ['data/catalog.json', JSON.stringify(index, null, 2) + '\n'],
  ];
  const backup = `data/editor-history/${Date.now()}-${randomUUID()}`;
  await mkdir(safeFile(root, backup), { recursive: true });
  for (const [file] of writes) {
    try {
      const original = await readFile(safeFile(root, file));
      const target = safeFile(root, `${backup}/${file}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, original);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const staged = [];
  for (const [file, content] of writes) {
    const target = safeFile(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, content);
    staged.push([temporary, target]);
  }
  assert.equal(digest(await readFile(safeFile(root, payload.page))), loaded.hash, 'Document changed while saving');
  for (const [temporary, target] of staged) await rename(temporary, target);
  return { ...await readDocument(root, payload.page, index.pages), backup, savedAt };
}