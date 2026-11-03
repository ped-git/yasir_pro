import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const corpus = JSON.parse(await readFile(path.join(root, 'data/beta/corpus.json'), 'utf8'));
const changes = JSON.parse(await readFile(path.join(root, 'data/beta/changes.json'), 'utf8'));
const normalize = (value) => value.normalize('NFC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/[۰-۹٠-٩0-9]/g, '').replace(/\s+/g, ' ').trim();
const rows = [];
for (const page of corpus.pages.filter((page) => !page.reference)) {
  const data = JSON.parse(await readFile(path.join(root, 'data/pages', page.file.replace(/\.html$/, '.json')), 'utf8'));
  for (const verse of page.verses) {
    const text = normalize(verse.text);
    const matching = data.underlines.filter((record) => /[\u0621-\u064a]/.test(record.text) && (record.verse === verse.verse || normalize(record.text).includes(text)));
    const reviewed = (changes.coverage ?? []).filter((record) => record.surah === page.surah && record.verse === verse.verse && record.members?.length);
    const conjunctions = (text.match(/(?:^|\s)(?:و|او|ولا|ثم|بل|اما|فاما)(?=[\s\u0621-\u064a])/gu) ?? []).length;
    const directives = /(?:^|\s)(?:لا |قل |اعبد|اتق|اصبر|احسن|اوف|اذكر|سبح|اقم|اقيم|انفق|اصلح|اعدل|اغفر|اعف)/u.test(text);
    const words = text.match(/[\u0621-\u064a]+/gu) ?? [];
    const marked = new Set(matching.flatMap((record) => normalize(record.text).match(/[\u0621-\u064a]+/gu) ?? []));
    const uncovered = words.filter((word) => !marked.has(word)).length;
    const candidate = !reviewed.length && uncovered >= 5 && (conjunctions >= 2 || directives);
    rows.push({ surah: page.surah, verse: verse.verse, text: verse.text, reviewedPhrases: reviewed.length, existingSpans: matching.length, conjunctions, directives, lexicalUncoveredWords: uncovered, candidate, status: reviewed.length ? 'explicit-passage-review' : candidate ? 'structural-candidate-unreviewed' : matching.length ? 'legacy-annotation-not-certified' : 'no-simple-cue-not-certified' });
  }
}
const summary = { targetSurahs: new Set(rows.map((row) => row.surah)).size, versesExamined: rows.length, explicitReviewVerses: rows.filter((row) => row.reviewedPhrases).length, candidates: rows.filter((row) => row.candidate).length, note: 'Lexical coverage and structural cues locate possible omissions; they do not assign polarity, assert that a verse needs underlining, or certify annotations.' };
assert.equal(summary.targetSurahs, 32);
await writeFile(path.join(root, 'data/beta/underline-audit.json'), JSON.stringify({ summary, verses: rows }, null, 2) + '\n');
console.log(JSON.stringify(summary));
for (const surah of process.argv.includes('--samples') ? [...new Set(rows.map((row) => row.surah))] : []) {
  for (const row of rows.filter((row) => row.surah === surah && row.candidate).sort((first, second) => first.existingSpans - second.existingSpans || second.conjunctions - first.conjunctions).slice(0, 3)) {
    console.log(JSON.stringify({ surah, verse: row.verse, existing: row.existingSpans, text: row.text.slice(0, 230) }));
  }
}