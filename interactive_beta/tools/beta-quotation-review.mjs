import assert from 'node:assert/strict';

export function applyQuotationReview(plan, review) {
  for (const entry of review.additions ?? []) {
    assert(!plan.quotes.some((existing) => existing[0] === entry[0] && existing[1] === entry[1] && existing[3] === entry[3]), `Duplicate reviewed quotation ${entry[0]}:${entry[1]} ${entry[3]}`);
    plan.quotes.push(entry);
  }
  for (const correction of review.corrections ?? []) {
    const entry = plan.quotes.find((entry) => entry[0] === correction.surah && entry[1] === correction.verse && entry[3] === correction.first);
    assert(entry, `Unknown reviewed quotation: ${correction.surah}:${correction.verse} ${correction.first}`);
    if (correction.omit) { plan.quotes.splice(plan.quotes.indexOf(entry), 1); continue; }
    if (correction.firstVerse) entry[1] = correction.firstVerse;
    if (correction.lastVerse) entry[2] = correction.lastVerse;
    if (correction.replaceFirst) entry[3] = correction.replaceFirst;
    if ('until' in correction) entry[5] = correction.until;
    if (correction.color) entry[4] = correction.color;
    if ('implicit' in correction) entry[6] = correction.implicit ? 'implicit' : 'explicit';
    if ('startCue' in correction || 'occurrence' in correction) entry[8] = { ...(entry[8] ?? {}), ...('startCue' in correction ? { startCue: correction.startCue } : {}), ...('occurrence' in correction ? { occurrence: correction.occurrence } : {}) };
  }
  plan.uncertainties.push(...review.uncertainties ?? []);
  return plan;
}