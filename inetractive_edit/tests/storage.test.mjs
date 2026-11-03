import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocument, safeFile, saveDocument, previewHtml } from '../storage.mjs';
import { readRequestBody } from '../server.mjs';

const artifacts = fileURLToPath(new URL('../../interactive/tools/.artifacts/', import.meta.url));
await mkdir(artifacts, { recursive: true });
const entries = [{ page: 'Surah/test.html', data: 'data/pages/Surah/test.json', underlines: 0, sections: 0 }];

async function fixture(callback) {
  const root = await mkdtemp(path.join(artifacts, 'storage-'));
  try {
    await mkdir(path.join(root, 'Surah'), { recursive: true });
    await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(path.join(root, 'Surah/test.html'), '<!DOCTYPE html>\n<html lang="ar" dir="rtl"><head><title>Test</title><script src="../assets/interactions.js"></script></head><body><p>one two three</p></body></html>');
    await writeFile(path.join(root, 'data/catalog.json'), JSON.stringify({ pages: entries }));
    await callback(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('path traversal is rejected', () => {
  assert.throws(() => safeFile('/data', '../outside.html'));
});

test('request decoding preserves Arabic characters split across UTF-8 chunks', async () => {
  const source = Buffer.from('<p>بِسْمِ اللَّهِ</p>');
  const mark = source.indexOf(Buffer.from('ِ'));
  const request = Readable.from([source.subarray(0, mark + 1), source.subarray(mark + 1)]);
  assert.equal(await readRequestBody(request), '<p>بِسْمِ اللَّهِ</p>');
});

test('save preserves text, persists nested memberships, writes only interactive data, and keeps a backup', async () => fixture(async (root) => {
  const loaded = await readDocument(root, entries[0].page, entries);
  const saved = await saveDocument(root, { ...loaded, body: '<p><span class="annotation underline" data-underline-id="outer" data-underline-groups="pair">one <span class="annotation underline" data-underline-id="inner" data-underline-groups="inner-group">two</span></span> three</p>', css: '', groupLabels: { pair: 'Pair' } }, entries);
  assert.equal(saved.data.underlines[1].parentId, 'outer');
  assert.deepEqual(saved.data.groups.find((group) => group.id === 'pair').members, ['outer']);
  assert(saved.html.includes('data-editor-stylesheet'));
  assert(saved.html.includes('"pair":["outer"]'));
  assert(saved.html.includes('"inner-group":["inner"]'));
  assert((await readFile(path.join(root, saved.backup, entries[0].page), 'utf8')).includes('<p>one two three</p>'));
  assert(JSON.parse(await readFile(path.join(root, 'data/editor-edits.json'), 'utf8'))[entries[0].page]);
}));

test('save persists colored quotation pairs and their safe marker styles without changing text', async () => fixture(async (root) => {
  const loaded = await readDocument(root, entries[0].page, entries);
  const body = '<p><speech class="edit-quote-marker edit-quote-open edit-quote-color-green" open="" green="" data-quote-pair="quote-1"></speech>one two<speech class="edit-quote-marker edit-quote-close edit-quote-color-green" close="" green="" data-quote-pair="quote-1"></speech> three</p>';
  const css = '.edit-quote-open::before { content: "«"; position: relative; top: 1.5mm; font-size: 8mm; }\n.edit-quote-close::before { content: "»"; position: relative; top: 1.5mm; font-size: 8mm; }\n.edit-quote-color-green::before { color: rgb(70, 175, 70); }';
  const saved = await saveDocument(root, { ...loaded, body, css }, entries);
  assert.equal(saved.html.match(/data-quote-pair="quote-1"/g)?.length, 2);
  assert(saved.css.includes('.edit-quote-color-green::before'));
  assert(saved.css.includes('font-size: 8mm'));
  assert.equal(saved.data.manual, true);
}));

test('text changes and stale saves are rejected', async () => fixture(async (root) => {
  const loaded = await readDocument(root, entries[0].page, entries);
  await assert.rejects(saveDocument(root, { ...loaded, body: '<p>different</p>', css: '' }, entries), /text/);
  await assert.rejects(saveDocument(root, { ...loaded, hash: 'stale', body: '<p>one two three</p>', css: '' }, entries), /changed/);
}));

test('preview removes scripts without touching body content', () => {
  const html = previewHtml('<html><head><script src="x.js"></script></head><body><p>same</p></body>\n  </html>', 'Surah/test.html');
  assert(!html.includes('<script'));
  assert(html.includes('<body><p>same</p></body>'));
  assert(!html.includes('</body>\n  </html>'));
  assert(html.includes('<base href="/book/Surah/test.html">'));
  const beta = previewHtml('<html><head></head><body><p>same</p></body></html>', 'Surah/test.html', 'interactive_beta');
  assert(beta.includes('<base href="/interactive_beta/Surah/test.html">'));
});

test('saving unchanged groups preserves their original review status and saved index', async () => fixture(async (root) => {
  const body = '<p><span class="annotation underline" data-underline-id="first" data-underline-groups="suggestion">one</span> two three</p>';
  await writeFile(path.join(root, 'Surah/test.html'), `<!doctype html><html><head></head><body>${body}</body></html>`);
  await mkdir(path.join(root, 'data/pages/Surah'), { recursive: true });
  await writeFile(path.join(root, entries[0].data), JSON.stringify({ underlines: [], sections: [], groups: [{ id: 'suggestion', label: 'Suggestion', reviewStatus: 'suggested', basis: 'local-pattern', members: ['first'] }] }));
  const loaded = await readDocument(root, entries[0].page, entries);
  const saved = await saveDocument(root, { ...loaded, body, css: '' }, entries);
  assert.equal(saved.data.groups[0].reviewStatus, 'suggested');
  assert(saved.html.includes('"suggestion":["first"]'));
}));

test('repeated saves canonicalize whitespace after the body end tag', async () => fixture(async (root) => {
  const html = '<!doctype html>\n<html lang="ar"><head><title>Test</title></head><body><p>one two three</p>\n      </body>\n    </html>'.replaceAll('\n', '\r\n');
  const body = '<p><span class="annotation underline" data-underline-id="first" data-underline-groups="pair">one</span> two three</p>\n      ';
  await writeFile(path.join(root, entries[0].page), html);
  const loaded = await readDocument(root, entries[0].page, entries);
  const saved = await saveDocument(root, { ...loaded, body, css: '' }, entries);
  const savedAgain = await saveDocument(root, { ...saved, body, css: '' }, entries);
  assert(!saved.html.includes('</body>\r\n'));
  assert.equal(savedAgain.html, saved.html);
}));

test('save preserves body whitespace separately from whitespace after the body end tag', async () => fixture(async (root) => {
  const html = '<!doctype html>\n<html lang="ar"><head><title>Test</title></head><body><p>one two three\n      </p>\n  \n      </body>\n    </html>';
  const body = '<p><span class="annotation underline" data-underline-id="first" data-underline-groups="pair">one</span> two three\n      </p>\n  \n      ';
  await writeFile(path.join(root, entries[0].page), html);
  const loaded = await readDocument(root, entries[0].page, entries);
  const saved = await saveDocument(root, { ...loaded, body, css: '' }, entries);
  assert(saved.html.includes('</p>\n      \n  \n      </body>'));
  assert(!saved.html.includes('</body>\n'));
  const savedAgain = await saveDocument(root, { ...saved, body, css: '' }, entries);
  assert.equal(savedAgain.html, saved.html);
}));

test('removing then adding underlines saves without accumulating outside-body whitespace', async () => fixture(async (root) => {
  const html = '<!doctype html>\n<html lang="ar"><head><title>Test</title></head><body><p>one <span class="annotation underline" data-underline-id="first">two</span> <span class="annotation underline" data-underline-id="second">three</span>\n      </p>\n  </body>\n    </html>';
  const body = '<p>one two three</p>\n  ';
  await writeFile(path.join(root, entries[0].page), html);
  const loaded = await readDocument(root, entries[0].page, entries);
  const afterRemoval = await saveDocument(root, { ...loaded, body, css: '' }, entries);
  const addedUnderline = '<p>one <span class="annotation underline" data-underline-id="new">two</span> three</p>\n  ';
  const afterAdding = await saveDocument(root, { ...afterRemoval, body: addedUnderline, css: '' }, entries);
  assert(!afterAdding.html.includes('</body>\n'));
  const savedAgain = await saveDocument(root, { ...afterAdding, body: addedUnderline, css: '' }, entries);
  assert.equal(savedAgain.html, afterAdding.html);
}));