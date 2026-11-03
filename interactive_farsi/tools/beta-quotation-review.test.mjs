import assert from 'node:assert/strict';
import test from 'node:test';
import { applyQuotationReview } from './beta-quotation-review.mjs';

test('a reviewed missing reply is added as an explicit turn with its own scope', () => {
  const plan = { quotes: [[12, 4, 4, 'first', 'green']], uncertainties: [] };
  applyQuotationReview(plan, { additions: [[12, 5, 6, 'reply', 'green', null, 'explicit', 'Parent reply']] });
  assert.equal(plan.quotes.length, 2);
  assert.equal(plan.quotes[1][2], 6);
  assert.equal(plan.quotes[1][7], 'Parent reply');
});

test('a corrected boundary replaces the original turn rather than nesting an accidental duplicate', () => {
  const plan = { quotes: [[12, 50, 50, 'reply', 'green', 'too late']], uncertainties: [] };
  applyQuotationReview(plan, { corrections: [{ surah: 12, verse: 50, first: 'reply', until: 'narration' }] });
  assert.equal(plan.quotes.length, 1);
  assert.equal(plan.quotes[0][5], 'narration');
});

test('duplicate turns and unanchored corrections are rejected', () => {
  const plan = { quotes: [[12, 4, 4, 'first', 'green']], uncertainties: [] };
  assert.throws(() => applyQuotationReview(plan, { additions: [[12, 4, 4, 'first', 'red']] }), /Duplicate/);
  assert.throws(() => applyQuotationReview(plan, { corrections: [{ surah: 12, verse: 9, first: 'absent' }] }), /Unknown/);
});

test('a correction can disambiguate a quotation introduced by the same review', () => {
  const plan = { quotes: [], uncertainties: [] };
  applyQuotationReview(plan, { additions: [[6, 91, 91, 'answer', 'black']], corrections: [{ surah: 6, verse: 91, first: 'answer', startCue: 'said answer', occurrence: 0 }] });
  assert.deepEqual(plan.quotes[0][8], { startCue: 'said answer', occurrence: 0 });
});