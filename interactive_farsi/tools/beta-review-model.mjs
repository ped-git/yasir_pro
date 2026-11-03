import { createHash } from 'node:crypto';

export function isUncertainBoundary(record) {
  return /[\u0621-\u064a]/u.test(record.text)
    && record.style.some((name) => /^ul-border-left-.*dotted/.test(name))
    && record.style.some((name) => /^ul-border-right-.*dotted/.test(name));
}

export function normalizeSearch(value) {
  return value.normalize('NFC').toLocaleLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/\s+/g, ' ').trim();
}

export function issueStatus(issue) {
  if (issue.category === 'Pending speech-turn review') return 'pending';
  if (['Source numbering', 'Existing quotation balance'].includes(issue.category)) return 'source-check';
  return 'decision';
}

export function stableIssueId(issue) {
  return `issue-${issue.surah}-${createHash('sha256').update(`${issue.surah}|${issue.firstVerse}|${issue.lastVerse}|${issue.category}|${issue.detail}`).digest('hex').slice(0, 10)}`;
}

export function uniqueIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const id = stableIssueId(issue);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}