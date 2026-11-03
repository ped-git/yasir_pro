import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const normalizePhrase = (value) => value.normalize('NFC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();

export async function loadPassagePlan(root) {
  const files = ['passage-underlines.json', 'passage-underlines-expanded.json', 'passage-underlines-systematic.json'];
  return (await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(root, 'data/beta', file), 'utf8'))))).flat();
}

export function expandOccurrences(entries, decisions) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const decision = decisions.find((decision) => decision.surah === entry[0] && decision.verse === entry[1] && normalizePhrase(decision.phrase) === normalizePhrase(entry[2]));
    const occurrences = decision?.occurrences ?? [0];
    assert(occurrences.length && occurrences.every((value) => Number.isInteger(value) && value >= 0), 'Invalid explicit underline occurrence');
    for (const occurrence of occurrences) {
      const key = `${entry[0]}|${entry[1]}|${normalizePhrase(entry[2])}|${entry[4]}|${occurrence}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push([...entry.slice(0, 7), occurrence]);
    }
  }
  return result;
}

export function reviewedPhrasePosition(mapped, anchor, firstIndex, limit, occurrence = 0) {
  let cursor = firstIndex;
  for (let index = 0; index <= occurrence; index++) {
    cursor = mapped.indexOf(normalizePhrase(anchor), cursor);
    if (cursor < firstIndex || cursor < 0 || cursor >= limit) return null;
    if (index < occurrence) cursor += normalizePhrase(anchor).length;
  }
  return cursor;
}

export function allocatePassageGrays(entries, assigned) {
  const positions = new Map();
  for (const entry of entries) {
    const id = `beta-${entry[0]}-${entry[4]}`;
    if (!positions.has(id)) positions.set(id, new Set());
    positions.get(id).add(entry[1]);
  }
  const neighbors = new Map([...positions.keys()].map((id) => [id, new Set()]));
  for (const [first, verses] of positions) for (const [second, others] of positions) {
    if (first === second) continue;
    if ([...verses].some((verse) => [...others].some((other) => Math.abs(verse - other) <= 2))) neighbors.get(first).add(second);
  }
  const palette = [100, 180, 150, 220, 200, 120, 160, 80, 140, 240, 90, 110, 130, 170, 190, 210, 230];
  const pending = new Set(positions.keys());
  while (pending.size) {
    const ordered = [...pending].sort((first, second) => {
      const saturation = (id) => new Set([...neighbors.get(id)].filter((neighbor) => !pending.has(neighbor)).map((neighbor) => assigned.get(neighbor))).size;
      return saturation(second) - saturation(first) || neighbors.get(second).size - neighbors.get(first).size || first.localeCompare(second);
    });
    const id = ordered[0];
    const used = new Set([...neighbors.get(id)].filter((neighbor) => !pending.has(neighbor)).map((neighbor) => assigned.get(neighbor)));
    const color = palette.find((value) => !used.has(value));
    assert(color !== undefined, 'Reviewed neighboring groups need more distinct gray levels');
    assigned.set(id, color); pending.delete(id);
  }
  return assigned;
}