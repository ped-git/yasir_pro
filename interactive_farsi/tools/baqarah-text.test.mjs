import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBaqarahVerse } from './baqarah-text.mjs';

test('normalizes Persian spacing and punctuation without changing the words', () => {
  assert.equal(normalizeBaqarahVerse(5, 'نمی  کنند،انجام می  دهند .'), 'نمی‌کنند، انجام می‌دهند.');
});

test('repairs malformed explanatory brackets in Baqarah verse 23', () => {
  const result = normalizeBaqarahVerse(
    23,
    'بر بنده خود] محمّد (صلی الله علیه وآله)] نازل کرده ایم، اگر [در گفتار خود که این قرآن ساخته بشر است نه وحی الهی [راستگویید.',
  );
  assert.equal(
    result,
    'بر بنده خود [محمّد (صلی الله علیه وآله)] نازل کرده ایم، اگر [در گفتار خود که این قرآن ساخته بشر است نه وحی الهی] راست‌گویید.',
  );
});

test('repairs nested explanatory brackets in Baqarah verse 37', () => {
  const result = normalizeBaqarahVerse(
    37,
    'پس آدم کلماتی را] مانند توضیح بود] دریافت کرد و [پروردگار [توبه اش را پذیرفت؛ زیرا او بسیار توبه پذیر و مهربان است.',
  );
  assert.equal(
    result,
    'پس آدم کلماتی را [مانند توضیح بود] دریافت کرد و [پروردگار توبه‌اش را پذیرفت؛ زیرا او بسیار توبه‌پذیر و مهربان است].',
  );
});
