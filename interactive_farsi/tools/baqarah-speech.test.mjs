import assert from 'node:assert/strict';
import test from 'node:test';
import { alignBaqarahSpeech } from './baqarah-speech.mjs';

test('moves a quotation opener to the exact translated phrase boundary', () => {
  const html = '<html><body><p>می گویند: <speech open="" red=""></speech>پیش‌گفتار ما به خدا ایمان آوردیم.<speech close="" red=""></speech><sup>۱</sup></p></body></html>';
  const result = alignBaqarahSpeech(html, [
    { marker: 0, verse: 1, target: 'ما به خدا', edge: 'start' },
  ]);
  assert.match(result, /پیش‌گفتار <speech open="" red=""><\/speech>ما به خدا/u);
});
