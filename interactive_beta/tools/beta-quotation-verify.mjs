import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const root = fileURLToPath(new URL('../', import.meta.url));
const corpus = JSON.parse(await readFile(path.join(root, 'data/beta/corpus.json'), 'utf8'));
const revisedSnapshot = path.join(root, 'data/beta/quotation-review-baseline-underlines-v2.json');
let snapshotFile = path.join(root, 'data/beta/quotation-review-baseline.json');
if (process.argv.includes('--record-underline-revision')) snapshotFile = revisedSnapshot;
else {
  try { await readFile(revisedSnapshot); snapshotFile = revisedSnapshot; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function withoutQuotes(html) {
  let body;
  const quotes = [];
  const walk = (node) => {
    if (node.tagName === 'body') body = node;
    if (node.tagName === 'speech' && node.attrs.some((attribute) => attribute.name === 'data-beta-quote')) {
      assert.equal(node.childNodes.length, 0, 'Quotation markers cannot contain or replace source words');
      quotes.push(node.sourceCodeLocation);
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(parse(html, { sourceCodeLocationInfo: true }));
  const start = body.sourceCodeLocation.startTag.endOffset;
  let raw = html.slice(start, body.sourceCodeLocation.endTag.startOffset);
  for (const location of quotes.sort((first, second) => second.startOffset - first.startOffset)) raw = raw.slice(0, location.startOffset - start) + raw.slice(location.endOffset - start);
  return createHash('sha256').update(raw).digest('hex');
}

const actual = {};
for (const page of corpus.pages) actual[page.file] = withoutQuotes(await readFile(path.join(root, page.file), 'utf8'));
if (process.argv.includes('--record') || process.argv.includes('--record-underline-revision')) {
  await writeFile(snapshotFile, JSON.stringify(actual, null, 2) + '\n', { flag: 'wx' });
  console.log(process.argv.includes('--record-underline-revision') ? 'Recorded a separate baseline for explicitly reviewed underline changes; the earlier quotation-only baseline is retained.' : 'Recorded quotation-only baseline for all 114 surahs.');
} else {
  const expected = JSON.parse(await readFile(snapshotFile, 'utf8'));
  assert.deepEqual(actual, expected, 'This quotation review changed non-quotation markup, text, underlines, groups, or vertical lines');
  const audit = JSON.parse(await readFile(path.join(root, 'data/beta/changes.json'), 'utf8'));
  const turns = audit.changes.filter((change) => change.kind === 'quotation');
  const find = (surah, verse, first) => {
    const turn = turns.find((turn) => turn.surah === surah && turn.firstVerse === verse && turn.first === first);
    assert(turn, `Missing reviewed turn ${surah}:${verse} ${first}`);
    return turn;
  };
  const chronological = (entries) => {
    for (let index = 1; index < entries.length; index++) assert(entries[index - 1].end <= entries[index].start, 'Separate speaker turns overlap or appear in the wrong order');
  };
  chronological([find(4, 97, '\u0641\u064a\u0645 \u0643\u0646\u062a\u0645'), find(4, 97, '\u0643\u0646\u0627 \u0645\u0633\u062a\u0636\u0639\u0641\u064a\u0646 \u0641\u064a \u0627\u0644\u0623\u0631\u0636'), find(4, 97, '\u0623\u0644\u0645 \u062a\u0643\u0646 \u0623\u0631\u0636 \u0627\u0644\u0644\u0647 \u0648\u0627\u0633\u0639\u0629')]);
  chronological([find(12, 36, '\u0625\u0646\u064a \u0623\u0631\u0627\u0646\u064a \u0623\u0639\u0635\u0631 \u062e\u0645\u0631\u0627'), find(12, 36, '\u0625\u0646\u064a \u0623\u0631\u0627\u0646\u064a \u0623\u062d\u0645\u0644 \u0641\u0648\u0642 \u0631\u0623\u0633\u064a \u062e\u0628\u0632\u0627'), find(12, 36, '\u0646\u0628\u0626\u0646\u0627 \u0628\u062a\u0623\u0648\u064a\u0644\u0647')]);
  chronological([find(12, 51, '\u0645\u0627 \u062e\u0637\u0628\u0643\u0646 \u0625\u0630 \u0631\u0627\u0648\u062f\u062a\u0646 \u064a\u0648\u0633\u0641'), find(12, 51, '\u062d\u0627\u0634 \u0644\u0644\u0647 \u0645\u0627 \u0639\u0644\u0645\u0646\u0627 \u0639\u0644\u064a\u0647 \u0645\u0646 \u0633\u0648\u0621'), find(12, 51, '\u0627\u0644\u0622\u0646 \u062d\u0635\u062d\u0635 \u0627\u0644\u062d\u0642')]);
  const outer = find(12, 80, '\u0623\u0644\u0645 \u062a\u0639\u0644\u0645\u0648\u0627 \u0623\u0646 \u0623\u0628\u0627\u0643\u0645');
  const inner = find(12, 81, '\u0623\u0628\u0627\u0646\u0627 \u0625\u0646 \u0627\u0628\u0646\u0643 \u0633\u0631\u0642');
  assert(outer.start < inner.start && inner.end <= outer.end, 'The proposed message is not nested inside the instruction');
  const messenger = find(19, 21, '\u0643\u0630\u0644\u0643 \u0642\u0627\u0644 \u0631\u0628\u0643');
  const divine = find(19, 21, '\u0647\u0648 \u0639\u0644\u064a \u0647\u064a\u0646');
  assert(messenger.start < divine.start && divine.end <= messenger.end && divine.until === '\u0648\u0643\u0627\u0646 \u0623\u0645\u0631\u0627 \u0645\u0642\u0636\u064a\u0627', 'The cited divine first-person continuation is misplaced');
  assert.equal(find(28, 31, '\u064a\u0627 \u0645\u0648\u0633\u0649 \u0623\u0642\u0628\u0644 \u0648\u0644\u0627 \u062a\u062e\u0641').lastVerse, 32, 'An uninterrupted turn was split at a verse boundary');
  assert(!turns.some((turn) => turn.surah === 12 && [52, 53].includes(turn.firstVerse)), 'Disputed verses 12:52-53 were assigned a speaker without a decision');
  const review = JSON.parse(await readFile(path.join(root, 'data/beta/quotation-turn-review.json'), 'utf8'));
  const normalize = (value) => value.normalize('NFC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  for (const [surah, firstVerse, lastVerse, first, color, until, status] of review.additions) {
    const source = corpus.pages.find((page) => page.surah === surah);
    assert(source && !source.reference);
    const verse = source.verses.find((verse) => verse.verse === firstVerse);
    const scope = source.verses.filter((verse) => verse.verse >= firstVerse && verse.verse <= lastVerse).map((verse) => verse.text).join(' ');
    assert(verse && normalize(verse.text).includes(normalize(first)), `Invalid source anchor ${surah}:${firstVerse} ${first}`);
    if (until) assert(normalize(scope).includes(normalize(until)), `Invalid source ending ${surah}:${firstVerse} ${until}`);
    if (status !== 'defer') find(surah, firstVerse, first);
  }
  await writeFile(path.join(root, 'data/beta/quotation-anchor-review.json'), JSON.stringify({ proposed: review.additions.length, applied: review.additions.filter((entry) => entry[6] !== 'defer').length, deferred: review.additions.filter((entry) => entry[6] === 'defer').length, targetSurahs: new Set(review.additions.map((entry) => entry[0])).size, failures: [] }, null, 2) + '\n');
  console.log('PASS: all non-quotation body markup is unchanged across 114 surahs.');
  console.log('PASS: mixed-speaker verses, nested proposed messages, nested divine report, continuous speech, and protected attribution uncertainty.');
}