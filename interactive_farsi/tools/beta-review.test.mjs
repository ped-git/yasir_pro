import assert from 'node:assert/strict';
import test from 'node:test';
import { isUncertainBoundary, issueStatus, normalizeSearch, stableIssueId, uniqueIssues } from './beta-review-model.mjs';

test('only paired dotted side brackets on Arabic text imply an existing uncertain boundary', () => {
  assert(isUncertainBoundary({ text: '\u0625\u0644\u0649 \u062d\u064a\u0646', style: ['ul-border-left-1px-dotted-gray-100', 'ul-border-right-1px-dotted-gray-100'] }));
  assert(!isUncertainBoundary({ text: '\u0643\u0627\u062a\u0628', style: ['ul-pattern-none', 'ul-decoration-pattern-wavy', 'ul-sides-open'] }));
  assert(!isUncertainBoundary({ text: 'n', style: ['ul-border-left-1px-dotted-gray-100', 'ul-border-right-1px-dotted-gray-100'] }));
});

test('pending coverage checks and mechanical source checks are not called interpretive decisions', () => {
  assert.equal(issueStatus({ category: 'Pending speech-turn review' }), 'pending');
  assert.equal(issueStatus({ category: 'Source numbering' }), 'source-check');
  assert.equal(issueStatus({ category: 'Interpretive question' }), 'decision');
});

test('Arabic search ignores diacritics and accepts Persian and Arabic digit forms', () => {
  assert.equal(normalizeSearch('\u0625\u0650\u0628\u0652\u0631\u064e\u0627\u0647\u0650\u064a\u0645\u064e \u06f1\u06f2'), normalizeSearch('\u0627\u0628\u0631\u0627\u0647\u064a\u0645 12'));
});

test('issue IDs are stable and exact duplicate reports are removed', () => {
  const issue = { surah: 12, firstVerse: 52, lastVerse: 53, category: 'Interpretive question', detail: 'Who is speaking?' };
  assert.equal(stableIssueId(issue), stableIssueId({ ...issue }));
  assert.equal(uniqueIssues([issue, { ...issue }]).length, 1);
});