import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { isUncertainBoundary } from './beta-review-model.mjs';
import { exactPhraseAnnotation, grayForGroup, nestedPadding, phraseRanges, polarityPattern, quotationAnchorIndex, quotedTextEnd, sourceTextPositions } from './beta-annotation-rules.mjs';
import { semanticStyles } from './beta-semantic-styles.mjs';
import { applyQuotationReview } from './beta-quotation-review.mjs';
import { allocatePassageGrays, expandOccurrences, loadPassagePlan, reviewedPhrasePosition } from './beta-passage-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const corpus = JSON.parse(await readFile(path.join(root, 'data/beta/corpus.json'), 'utf8'));
const plan = JSON.parse(await readFile(path.join(root, 'data/beta/editorial-plan.json'), 'utf8'));
const refinements = JSON.parse(await readFile(path.join(root, 'data/beta/boundary-refinements.json'), 'utf8'));
const additionalUnderlines = JSON.parse(await readFile(path.join(root, 'data/beta/additional-underlines.json'), 'utf8'));
const semanticDecisions = JSON.parse(await readFile(path.join(root, 'data/beta/semantic-role-review.json'), 'utf8'));
const passagePlan = await loadPassagePlan(root);
additionalUnderlines.push(...passagePlan.flatMap((entry) => entry.phrases.map((phrase) => [entry.surah, entry.verse, phrase, polarityPattern(entry.role), entry.group, entry.reason, `Explicit passage review ${entry.surah}:${entry.verse}; role=${entry.role}`])));
const occurrenceDecisions = JSON.parse(await readFile(path.join(root, 'data/beta/underline-occurrences.json'), 'utf8'));
additionalUnderlines.splice(0, additionalUnderlines.length, ...expandOccurrences(additionalUnderlines, occurrenceDecisions));
const additionalContrasts = JSON.parse(await readFile(path.join(root, 'data/beta/additional-contrasts.json'), 'utf8'));
for (const refinement of refinements.updates) {
  const entry = plan.quotes.find((entry) => entry[0] === refinement.surah && entry[1] === refinement.verse && entry[3] === refinement.first);
  assert(entry, `Unknown boundary refinement ${refinement.surah}:${refinement.verse}`);
  if (refinement.omit) { plan.quotes.splice(plan.quotes.indexOf(entry), 1); continue; }
  if (refinement.firstVerse) entry[1] = refinement.firstVerse;
  if (refinement.lastVerse) entry[2] = refinement.lastVerse;
  if (refinement.replaceFirst) entry[3] = refinement.replaceFirst;
  if (refinement.color) entry[4] = refinement.color;
  if (refinement.until) entry[5] = refinement.until;
  if (refinement.removeUntil) entry[5] = null;
  if (refinement.implicit) entry[6] = 'implicit';
}
plan.quotes.push(...refinements.additionalQuotes);
plan.uncertainties.push(...refinements.additionalUncertainties);
applyQuotationReview(plan, JSON.parse(await readFile(path.join(root, 'data/beta/quotation-turn-review.json'), 'utf8')));
const underlineAmbiguities = JSON.parse(await readFile(path.join(root, 'data/beta/underline-ambiguities.json'), 'utf8'));
const evidence = JSON.parse(await readFile(path.join(root, 'data/beta/reference-phrases.json'), 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (value) => value.normalize('NFC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
const attrs = (node) => Object.fromEntries((node.attrs ?? []).map((attribute) => [attribute.name, attribute.value]));
const text = (node) => node.value ?? (node.childNodes ?? []).map(text).join('');
const numeral = (value) => Number(value.replace(/[۰-۹]/g, (digit) => digit.charCodeAt(0) - 0x06f0).replace(/[٠-٩]/g, (digit) => digit.charCodeAt(0) - 0x0660));
function walk(node, callback) { callback(node); for (const child of node.childNodes ?? []) walk(child, callback); }
function mappedText(body, html) {
  let value = '';
  const positions = [];
  const append = (node) => {
    if (node.tagName === 'sup' || node.tagName === 'script' || node.tagName === 'style') return;
    if (node.nodeName === '#text' && node.sourceCodeLocation) {
      const location = node.sourceCodeLocation;
      const raw = html.slice(location.startOffset, location.endOffset);
      const sourcePositions = sourceTextPositions(raw, node.value, location.startOffset);
      let offset = 0;
      for (const character of node.value) {
        const source = sourcePositions.get(offset);
        const absolute = source.start;
        const normalized = normalize(character);
        if (/\s/u.test(character)) {
          if (value && !value.endsWith(' ')) { value += ' '; positions.push({ start: absolute, end: source.end }); }
        } else if (normalized) {
          for (const converted of normalized) { value += converted; positions.push({ start: absolute, end: source.end }); }
        } else if (positions.length) positions.at(-1).end = source.end;
        offset += character.length;
      }
    }
    for (const child of node.childNodes ?? []) append(child);
  };
  append(body);
  return { value, positions };
}
function verticalNodes(document, html) {
  const result = [];
  walk(document, (node) => {
    if (!node.tagName) return;
    const attributes = attrs(node);
    if (attributes['data-reader-section'] || attributes['data-reader-line'] || (attributes.class ?? '').split(/\s+/).some((name) => name.startsWith('connection-line--') || name.startsWith('connection-cap--'))) {
      result.push(html.slice(node.sourceCodeLocation.startTag.startOffset, node.sourceCodeLocation.startTag.endOffset));
    }
  });
  return result;
}
const changes = [];
const contrastGroups = [];
const passageGroups = [];
const coverage = [];
const issues = plan.uncertainties.map(([surah, firstVerse, lastVerse, detail]) => ({ surah, firstVerse, lastVerse, category: 'Interpretive question', detail, action: 'Preserved or bounded conservatively; needs editorial decision' }));
issues.push(...underlineAmbiguities.map((issue) => ({ surah: issue.surah, firstVerse: issue.firstVerse, lastVerse: issue.lastVerse, category: 'Underline scope or type', detail: issue.question, action: issue.recommendation })));
let quotationCount = 0;
let underlineCount = 0;
for (const page of corpus.pages) {
  const filename = path.join(root, page.file);
  let html = await readFile(filename, 'utf8');
  if (process.argv.includes('--reapply') && !page.reference) html = await readFile(path.join(root, 'data/beta/originals', path.basename(page.file)), 'utf8');
  assert.equal(hash(html), page.hash, `Beta source changed since study: ${page.file}; refusing to overwrite`);
  const document = parse(html, { sourceCodeLocationInfo: true });
  let body;
  let head;
  const underlines = new Map();
  const markers = [];
  walk(document, (node) => {
    if (node.tagName === 'body') body = node;
    if (node.tagName === 'head') head = node;
    if (attrs(node)['data-underline-id']) underlines.set(attrs(node)['data-underline-id'], node);
    if (node.tagName === 'sup') markers.push({ verse: numeral(text(node)), start: node.sourceCodeLocation?.startOffset, end: node.sourceCodeLocation?.endOffset });
  });
  const originalText = text(body);
  const originalVertical = verticalNodes(document, html);
  const expected = Math.max(...markers.map((marker) => marker.verse).filter(Number.isFinite));
  const missing = Array.from({ length: expected }, (_, index) => index + 1).filter((verse) => !markers.some((marker) => marker.verse === verse));
  const repeated = [...new Set(markers.map((marker) => marker.verse).filter((verse, index, list) => list.indexOf(verse) !== index))];
  if (missing.length || repeated.length) issues.push({ surah: page.surah, firstVerse: missing[0] ?? repeated[0], lastVerse: missing.at(-1) ?? repeated.at(-1), category: 'Source numbering', detail: `Missing verse labels: ${missing.join(', ') || 'none'}; repeated labels: ${repeated.join(', ') || 'none'}. This is a label audit, not a claim that the Quranic words are absent.`, action: 'Source text and numbering left untouched' });
  for (const record of page.underlines) {
    if (isUncertainBoundary(record)) issues.push({ surah: page.surah, firstVerse: record.verse, lastVerse: record.verse, category: 'Existing uncertain boundary', detail: `The source itself gives this Arabic phrase paired dotted side-boundary marks: ${record.text.slice(0, 250)}`, action: 'Existing uncertainty marker preserved; the exact scope still needs an editorial decision' });
    const reference = evidence[normalize(record.text)] ?? [];
    const patterns = new Set(reference.map((item) => item.pattern));
    if (reference.length >= 2 && !patterns.has(record.pattern) && ['solid', 'dashed', 'dotted'].includes(record.pattern) && !plan.underlineChanges.some((change) => change.ids.includes(record.id))) {
      issues.push({ surah: page.surah, firstVerse: record.verse, lastVerse: record.verse, category: 'Context-sensitive pattern', detail: `Phrase: ${record.text.slice(0, 200)}. Source pattern: ${record.pattern}; reference forms: ${[...patterns].join(', ')} at ${reference.slice(0, 6).map((item) => `${item.surah}:${item.verse}`).join(', ')}. Identical wording does not establish an identical semantic function.`, action: 'No automatic majority-style replacement' });
    }
  }
  const stack = [];
  for (const quote of page.quotes) {
    if ('open' in quote.attributes) stack.push(quote);
    if ('close' in quote.attributes) {
      const previous = stack.pop();
      const color = (record) => ['blue','green','red','black','gray','lightblue','mixed'].find((name) => name in record.attributes) ?? 'inherited';
      if (!previous || color(previous) !== color(quote)) issues.push({ surah: page.surah, firstVerse: quote.verse, lastVerse: quote.verse, category: 'Existing quotation balance', detail: `Existing closing marker ${color(quote)} does not match the currently open marker ${previous ? color(previous) : '(none)'}.`, action: 'Reference/source markers preserved for review' });
    }
  }
  for (const quote of stack) issues.push({ surah: page.surah, firstVerse: quote.verse, lastVerse: quote.verse, category: 'Existing quotation balance', detail: 'Existing opening quotation has no matching closing marker in the source markup.', action: 'Source marker preserved for review' });
  if (page.reference) continue;
  await mkdir(path.join(root, 'data/beta/originals/Surah'), { recursive: true });
  await writeFile(path.join(root, 'data/beta/originals', path.basename(page.file)), html);
  const edits = [];
  const dataFile = path.join(root, 'data/pages', page.file.replace(/\.html$/, '.json'));
  const data = JSON.parse(await readFile(dataFile, 'utf8'));
  data.underlines = data.underlines.filter((record) => !record.id.startsWith('beta-u-'));
  data.groups = data.groups.filter((group) => !['beta-editorial-content', 'beta-semantic-contrast'].includes(group.basis));
  const retainedGroups = new Set(data.groups.map((group) => group.id));
  for (const record of data.underlines) {
    record.groups = (record.groups ?? []).filter((id) => retainedGroups.has(id));
    const node = underlines.get(record.id);
    let parent = node?.parentNode;
    record.parentId = null; record.sectionId = null;
    while (parent) {
      record.parentId ??= attrs(parent)['data-underline-id'] ?? null;
      record.sectionId ??= attrs(parent)['data-reader-section'] ?? null;
      parent = parent.parentNode;
    }
    delete record.betaSemanticRole;
  }
  const mapped = mappedText(body, html);
  const positionRange = (firstVerse, lastVerse) => {
    const previous = markers.find((marker) => marker.verse === firstVerse - 1);
    const last = markers.find((marker) => marker.verse === lastVerse);
    assert(last, `Missing ending verse label ${page.surah}:${lastVerse}`);
    return { start: previous?.end ?? body.sourceCodeLocation.startTag.endOffset, end: last.start };
  };
  const phrasePosition = (verse, phrase, occurrence) => {
    const scope = positionRange(verse, verse);
    const first = mapped.positions.findIndex((position) => position.start !== null && position.start >= scope.start);
    const limit = mapped.positions.findIndex((position) => position.start !== null && position.start >= scope.end);
    const index = reviewedPhrasePosition(mapped.value, phrase, first, limit < 0 ? mapped.value.length : limit, occurrence);
    if (index === null) return null;
    const start = mapped.positions[index]?.start;
    const end = mapped.positions[index + normalize(phrase).length - 1]?.end;
    if (start === null || start === undefined || end === null || end === undefined || end > scope.end) return null;
    return { start, end };
  };
  const existingPhrase = (verse, phrase, occurrence) => {
    const range = phrasePosition(verse, phrase, occurrence);
    if (!range) return null;
    return page.underlines.find((record) => record.verse === verse && normalize(record.text) === normalize(phrase) && record.start <= range.start && record.end >= range.end) ?? null;
  };
  const phraseDecisions = additionalUnderlines.filter((entry) => entry[0] === page.surah).flatMap((entry) => {
    const record = existingPhrase(entry[1], entry[2], entry[7]);
    return record ? [{ surah: page.surah, ids: [record.id], role: entry[3] === 'solid' ? 'good' : entry[3] === 'dotted' ? 'bad' : 'neutral', reason: entry[5] }] : [];
  });
  const semantic = semanticStyles(page, data, [...semanticDecisions, ...phraseDecisions]);
  allocatePassageGrays(additionalUnderlines.filter((entry) => entry[0] === page.surah), semantic.shades);
  contrastGroups.push(...semantic.contrasts.map((group) => ({ ...group, surah: page.surah })));
  for (const group of semantic.contrasts) {
    data.groups.push(group);
    for (const id of group.members) data.underlines.find((record) => record.id === id).groups.push(group.id);
  }
  const styleDecisions = new Map();
  for (const change of plan.underlineChanges.filter((change) => change.surah === page.surah)) {
    for (const id of change.ids) {
      const node = underlines.get(id);
      assert(node, `Unknown underline ${id}`);
      const attributes = attrs(node);
      const previous = attributes.class;
      const next = previous.replace(/\bul-pattern-(?:solid|dashed|dotted)\b/, `ul-pattern-${change.pattern}`);
      styleDecisions.set(id, { id, before: previous, after: next, reason: change.reason, evidence: change.evidence, role: change.pattern === 'dashed' ? 'neutral' : change.pattern === 'dotted' ? 'bad' : 'good' });
    }
  }
  for (const change of semantic.changes) {
    const node = underlines.get(change.id);
    const previous = attrs(node).class;
    const classes = previous.split(/\s+/).filter((name) => !name.startsWith('ul-'));
    styleDecisions.set(change.id, { ...change, before: previous, after: [...classes, ...change.style].join(' '), evidence: ['User-specified semantic convention; explicit target review and existing local contrast annotations'] });
  }
  const plannedExisting = new Map();
  const groupVerses = new Map();
  const addPlannedGroup = (groupId, group, id, verse) => {
    let saved = data.groups.find((entry) => entry.id === groupId);
    if (!saved) { saved = { id: groupId, label: group.replaceAll('-', ' '), basis: 'beta-editorial-content', reviewStatus: 'beta-editorial', members: [] }; data.groups.push(saved); }
    if (!saved.members.includes(id)) saved.members.push(id);
    const record = data.underlines.find((entry) => entry.id === id);
    if (!record.groups.includes(groupId)) record.groups.push(groupId);
    if (!groupVerses.has(groupId)) groupVerses.set(groupId, verse);
  };
  for (const [surah, verse, phrase, pattern, group, reason, reference, occurrence] of additionalUnderlines.filter((entry) => entry[0] === page.surah)) {
    const existing = existingPhrase(verse, phrase, occurrence);
    if (!existing) continue;
    const groupId = `beta-${surah}-${group}`;
    addPlannedGroup(groupId, group, existing.id, verse);
    const role = pattern === 'solid' ? 'good' : pattern === 'dotted' ? 'bad' : 'neutral';
    const previous = attrs(underlines.get(existing.id)).class;
    const selected = styleDecisions.get(existing.id)?.after ?? previous;
    let style = selected.split(/\s+/).filter((name) => name.startsWith('ul-') && !/^ul-(?:pattern-|image-|gradient-|stops-)/.test(name));
    style.push(`ul-pattern-${pattern}`);
    const paired = semantic.contrasts.some((comparison) => comparison.members.includes(existing.id));
    let gray = null;
    if (!paired) {
      const nearby = page.underlines.filter((record) => Math.abs(record.verse - verse) <= 2).map((record) => semantic.groupFor(record.id));
      nearby.push(...[...groupVerses].filter(([id, value]) => id !== groupId && Math.abs(value - verse) <= 2).map(([id]) => id));
      gray = grayForGroup(groupId, semantic.shades, nearby);
      style = style.filter((name) => !name.startsWith('ul-color-')); style.push(`ul-color-gray-${gray}`);
    }
    const classes = previous.split(/\s+/).filter((name) => !name.startsWith('ul-'));
    styleDecisions.set(existing.id, { id: existing.id, before: previous, after: [...classes, ...style].join(' '), role, reason, gray, group: groupId, contrast: paired, evidence: [reference] });
    data.underlines.find((entry) => entry.id === existing.id).betaSemanticRole = role;
    plannedExisting.set(`${verse}|${phrase}|${group}|${occurrence}`, existing.id);
    coverage.push({ surah, verse, phrase, occurrence, groupId, role, outcome: 'existing-reviewed', members: [existing.id] });
  }
  for (const change of styleDecisions.values()) {
    if (change.after === change.before) continue;
    const node = underlines.get(change.id);
    const location = node.sourceCodeLocation.attrs.class;
    edits.push({ start: location.startOffset, end: location.endOffset, value: `class="${change.after}"` });
    changes.push({ ...change, kind: 'underline', surah: page.surah, verse: page.underlines.find((record) => record.id === change.id).verse });
    underlineCount++;
  }
  const spans = [];
  const newUnderlines = [];
  for (const [surah, verse, phrase, pattern, group, reason, reference, occurrence] of additionalUnderlines.filter((entry) => entry[0] === page.surah)) {
    if (plannedExisting.has(`${verse}|${phrase}|${group}|${occurrence}`)) continue;
    const range = phrasePosition(verse, phrase, occurrence);
    if (!range) {
      issues.push({ surah, firstVerse: verse, lastVerse: verse, category: 'Proposed underline not applied', detail: `Exact phrase boundary could not be established safely: ${phrase}`, action: 'Source preserved; no fuzzy match used' });
      coverage.push({ surah, verse, phrase, occurrence, role: pattern === 'solid' ? 'good' : pattern === 'dotted' ? 'bad' : 'neutral', outcome: 'anchor-blocked', members: [] });
      continue;
    }
    const { start, end } = range;
    const groupId = `beta-${surah}-${group}`;
    const nearbyGroups = page.underlines.filter((record) => Math.abs(record.verse - verse) <= 2).map((record) => semantic.groupFor(record.id));
    nearbyGroups.push(...newUnderlines.filter((record) => Math.abs(record.verse - verse) <= 2).map((record) => record.groupId));
    nearbyGroups.push(...[...groupVerses].filter(([id, value]) => id !== groupId && Math.abs(value - verse) <= 2).map(([id]) => id));
    const comparison = additionalContrasts.find((comparison) => comparison.surah === surah && [comparison.good, comparison.bad].includes(group));
    const gray = comparison ? null : grayForGroup(groupId, semantic.shades, nearbyGroups);
    const colorClass = comparison ? comparison.good === group ? 'ul-color-green-100-180-100' : 'ul-color-red-220-150-150' : `ul-color-gray-${gray}`;
    const className = `annotation underline ul-sides-open ul-pad-y-0px ul-pad-x-0px ul-thickness-1px ul-pattern-${pattern} ${colorClass}`;
    const members = [];
    const ranges = phraseRanges(body, html, start, end);
    for (const range of ranges) {
      const id = `beta-u-${surah}-${verse}-${newUnderlines.length + 1}`;
      const containers = [];
      walk(body, (node) => {
        const location = node.sourceCodeLocation;
        if (node.tagName && location?.startTag && location?.endTag && location.startTag.endOffset <= range.start && location.endTag.startOffset >= range.end) containers.push(node);
      });
      containers.sort((first, second) => first.sourceCodeLocation.endOffset - first.sourceCodeLocation.startOffset - (second.sourceCodeLocation.endOffset - second.sourceCodeLocation.startOffset));
      const parentId = containers.map((node) => attrs(node)['data-underline-id']).find(Boolean) ?? null;
      const sectionId = containers.map((node) => attrs(node)['data-reader-section']).find(Boolean) ?? null;
      const span = { id, surah, verse, text: phrase, logicalText: phrase, start: range.start, end: range.end, pattern, groupId, groups: [groupId], gray, className, reason, evidence: [reference], kind: 'new-underline' };
      newUnderlines.push(span); members.push(id);
      const fragment = parse(html.slice(range.start, range.end));
      const fragmentText = text(fragment).replace(/\s+/g, ' ').trim();
      data.underlines.push({ id, text: fragmentText, logicalText: phrase, textHash: hash(fragmentText), selector: `[data-underline-id="${id}"]`, parentId, sectionId, contextId: `beta-${surah}-${verse}`, verse, groups: [], betaSemanticRole: pattern === 'solid' ? 'good' : pattern === 'dotted' ? 'bad' : 'neutral', appearance: { signature: className.split(' ').filter((name) => name.startsWith('ul-')).join(' '), structure: className.split(' ').filter((name) => name.startsWith('ul-') && !name.startsWith('ul-color-')).join(' '), colorFamily: colorClass.split('-')[2] }, betaEditorialReason: reason });
      addPlannedGroup(groupId, group, id, verse);
      changes.push(span); underlineCount++;
    }
    coverage.push({ surah, verse, phrase, occurrence, groupId, role: pattern === 'solid' ? 'good' : pattern === 'dotted' ? 'bad' : 'neutral', outcome: ranges.length > 1 ? 'new-linked-fragments' : 'new-wrapper', members });
  }
  for (const span of newUnderlines) {
    const enclosing = newUnderlines.filter((candidate) => candidate !== span && candidate.start <= span.start && candidate.end >= span.end && (candidate.start < span.start || candidate.end > span.end)).sort((first, second) => first.end - first.start - (second.end - second.start))[0];
    if (enclosing) data.underlines.find((record) => record.id === span.id).parentId = enclosing.id;
  }
  for (const comparison of additionalContrasts.filter((comparison) => comparison.surah === page.surah)) {
    const badIds = data.groups.find((group) => group.id === `beta-${page.surah}-${comparison.bad}`)?.members ?? [];
    const goodIds = data.groups.find((group) => group.id === `beta-${page.surah}-${comparison.good}`)?.members ?? [];
    assert(badIds.length && goodIds.length, `Incomplete explicit comparison ${page.surah}:${comparison.id}`);
    const bad = badIds.map((id) => data.underlines.find((record) => record.id === id));
    const good = goodIds.map((id) => data.underlines.find((record) => record.id === id));
    assert(bad.every((record) => record.betaSemanticRole === 'bad') && good.every((record) => record.betaSemanticRole === 'good'));
    const id = `beta-contrast-${page.surah}-${comparison.id}`;
    const group = { id, label: comparison.id.replaceAll('-', ' '), basis: 'beta-semantic-contrast', reviewStatus: 'beta-editorial', members: [...bad, ...good].map((record) => record.id), evidence: comparison.reason };
    data.groups.push(group); contrastGroups.push({ ...group, surah: page.surah });
    for (const record of [...bad, ...good]) {
      if (!record.groups.includes(id)) record.groups.push(id);
      const sourceNode = underlines.get(record.id);
      const role = goodIds.includes(record.id) ? 'good' : 'bad';
      const color = role === 'good' ? 'ul-color-green-100-180-100' : 'ul-color-red-220-150-150';
      const added = newUnderlines.find((entry) => entry.id === record.id);
      if (added) {
        added.groups = [...record.groups]; added.gray = null;
        added.className = added.className.replace(/\bul-color-[a-zA-Z0-9-]+/g, color);
        record.appearance.signature = added.className.split(/\s+/).filter((name) => name.startsWith('ul-')).join(' ');
        record.appearance.colorFamily = role === 'good' ? 'green' : 'red';
      } else {
        let change = changes.find((entry) => entry.kind === 'underline' && entry.id === record.id);
        const previous = attrs(sourceNode).class;
        const current = change?.after ?? previous;
        const next = current.replace(/\bul-color-[a-zA-Z0-9-]+/g, color);
        const location = sourceNode.sourceCodeLocation.attrs.class;
        let edit = edits.find((entry) => entry.start === location.startOffset && entry.end === location.endOffset);
        if (edit) edit.value = `class="${next}"`;
        else edits.push({ start: location.startOffset, end: location.endOffset, value: `class="${next}"` });
        if (change) Object.assign(change, { after: next, contrast: true, gray: null, role, reason: `${change.reason} Explicit comparison: ${comparison.reason}` });
        else { change = { kind: 'underline', surah: page.surah, verse: record.verse, id: record.id, before: previous, after: next, role, contrast: true, reason: comparison.reason, evidence: ['Explicit passage comparison'] }; changes.push(change); underlineCount++; }
      }
    }
  }
  for (const [surah, firstVerse, lastVerse, first, color, until, status, speaker, anchorOptions] of plan.quotes.filter((entry) => entry[0] === page.surah)) {
    if (status === 'defer') {
      issues.push({ surah, firstVerse, lastVerse, category: 'Indirect-speech decision', detail: `Do not manufacture a quotation around this reporting or narrative expression without a discourse decision: ${first}`, action: 'No quotation added' });
      continue;
    }
    const scope = positionRange(firstVerse, lastVerse);
    const firstScope = positionRange(firstVerse, firstVerse);
    const firstIndex = mapped.positions.findIndex((position) => position.start !== null && position.start >= firstScope.start);
    const firstLimit = mapped.positions.findIndex((position) => position.start !== null && position.start >= firstScope.end);
    const normalized = normalize(first);
    const options = { ...(anchorOptions ?? {}) };
    if (options.startCue) options.startCue = normalize(options.startCue);
    const startIndex = quotationAnchorIndex(mapped.value, normalized, firstIndex, firstLimit < 0 ? mapped.value.length : firstLimit, options);
    assert(startIndex >= firstIndex && (firstLimit < 0 || startIndex < firstLimit), `Quotation start not found: ${surah}:${firstVerse} ${first}`);
    const start = mapped.positions[startIndex].start;
    let end = scope.end;
    if (until) {
      const boundary = mapped.value.indexOf(normalize(until), startIndex + normalized.length);
      assert(boundary >= 0 && mapped.positions[boundary].start < scope.end, `Quotation end not found: ${surah}:${firstVerse} ${until}`);
      end = mapped.positions[boundary].start;
    }
    assert(start !== null && end !== null && start < end, `Unsafe source-text offset ${surah}:${firstVerse}`);
    end = quotedTextEnd(body, html, start, end);
    if (html.slice(start, end).includes('«') || html.slice(start, end).includes('»')) {
      issues.push({ surah, firstVerse, lastVerse, category: 'Existing literal quotation', detail: `Literal quotation signs already occur in the proposed span beginning ${first}.`, action: 'No duplicate quotation added' });
      continue;
    }
    const actualLastVerse = markers.find((marker) => marker.start >= end)?.verse ?? lastVerse;
    spans.push({ id: `beta-q-${String(surah).padStart(3, '0')}-${String(spans.length + 1).padStart(3, '0')}`, surah, firstVerse, lastVerse: actualLastVerse, requestedLastVerse: lastVerse, first, color, until, implicit: status === 'implicit', speaker: speaker ?? null, anchorOptions: options, start, end });
  }
  for (const first of spans) for (const second of spans) {
    if (first === second) continue;
    assert(!(first.start < second.start && second.start < first.end && first.end < second.end), `Crossing quotation ranges ${first.id} / ${second.id}`);
  }
  const insertions = new Map();
  for (const span of spans) {
    for (const [offset, open] of [[span.start, true], [span.end, false]]) {
      if (!insertions.has(offset)) insertions.set(offset, []);
      insertions.get(offset).push({ span, open });
    }
    changes.push({ kind: 'quotation', ...span, reason: span.implicit ? 'Explicitly reviewed inferred/indirect speech layer; underlined quotation signs.' : 'Explicitly reviewed speaker turn or bounded continuation; no verse-only boundary inference.', evidence: span.color === 'blue' ? ['2:30', '20:11-17'] : span.color === 'green' ? ['20:18', '20:25-35'] : span.color === 'red' ? ['2:8', '2:11'] : span.color === 'black' ? ['9:40', '11:46 (local color exception)'] : ['2:104', '20:39-40'] });
  }
  for (const span of newUnderlines) {
    for (const [offset, open] of [[span.start, true], [span.end, false]]) {
      if (!insertions.has(offset)) insertions.set(offset, []);
      insertions.get(offset).push({ span, open });
    }
  }
  for (const [offset, items] of insertions) {
    items.sort((first, second) => Number(first.open) - Number(second.open) || (first.open ? second.span.end - first.span.end : second.span.start - first.span.start));
    const value = items.map(({ span, open }) => span.kind === 'new-underline' ? open ? `<span class="${span.className}" data-beta-underline="true" data-underline-id="${span.id}" data-underline-groups="${span.groups.join(' ')}">` : '</span>' : `<speech class="beta-speech" ${open ? 'open' : 'close'}="" ${span.color}=""${span.implicit ? ' underline=""' : ''} data-beta-quote="${span.id}"></speech>`).join('');
    edits.push({ start: offset, end: offset, value });
  }
  const end = head.sourceCodeLocation.endTag.startOffset;
  if (data.groups.some((group) => ['beta-editorial-content', 'beta-semantic-contrast'].includes(group.basis))) {
    let savedIndex;
    walk(document, (node) => { if (node.tagName === 'script' && attrs(node).id === 'reader-group-data') savedIndex = node.sourceCodeLocation; });
    assert(savedIndex, `Missing saved group index ${page.surah}`);
    const index = JSON.stringify({ version: 1, groups: Object.fromEntries(data.groups.map((group) => [group.id, group.members])) }).replaceAll('<', '\\u003c');
    edits.push({ start: savedIndex.startOffset, end: savedIndex.endOffset, value: `<script id="reader-group-data" type="application/json">${index}</script>` });
  }
  edits.push({ start: end, end, value: '<link rel="stylesheet" href="../assets/beta-annotations.css">\n' });
  for (const [id, node] of underlines) {
    const tags = data.underlines.find((record) => record.id === id).groups.join(' ');
    if (tags !== attrs(node)['data-underline-groups']) {
      const location = node.sourceCodeLocation.attrs['data-underline-groups'];
      edits.push({ start: location.startOffset, end: location.endOffset, value: `data-underline-groups="${tags}"` });
    }
  }
  for (const edit of edits.sort((first, second) => second.start - first.start || second.end - first.end)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  let updated = parse(html, { sourceCodeLocationInfo: true });
  const renderedUnderlines = new Map();
  walk(updated, (node) => { if (attrs(node)['data-underline-id']) renderedUnderlines.set(attrs(node)['data-underline-id'], node); });
  const addedIds = new Set(newUnderlines.map((record) => record.id));
  const childrenById = new Map();
  for (const [id, node] of renderedUnderlines) {
    let parent = node.parentNode;
    while (parent && !attrs(parent)['data-underline-id']) parent = parent.parentNode;
    const parentId = parent ? attrs(parent)['data-underline-id'] : null;
    if (parentId) { if (!childrenById.has(parentId)) childrenById.set(parentId, []); childrenById.get(parentId).push(id); }
  }
  const padding = new Map();
  const introduced = new Map();
  const paddingEdits = [];
  const assignPadding = (id) => {
    if (padding.has(id)) return padding.get(id);
    const node = renderedUnderlines.get(id);
    const classes = attrs(node).class.split(/\s+/);
    const token = classes.find((name) => name.startsWith('ul-pad-y-')) ?? classes.find((name) => name.startsWith('ul-pad-bottom-'));
    const match = token?.match(/(\d+(?:p\d+)?)(px|mm)$/);
    const existing = match ? Number(match[1].replace('p', '.')) * (match[2] === 'mm' ? 96 / 25.4 : 1) : 1;
    const children = childrenById.get(id) ?? [];
    const values = children.map(assignPadding);
    const fresh = addedIds.has(id) || children.some((child) => introduced.get(child));
    const next = nestedPadding(existing, values, fresh);
    padding.set(id, next); introduced.set(id, fresh);
    if (next !== existing) {
      const after = [...classes.filter((name) => !name.startsWith('ul-pad-y-') && !name.startsWith('ul-pad-top-') && !name.startsWith('ul-pad-bottom-')), `ul-pad-y-${next}px`].join(' ');
      const location = node.sourceCodeLocation.attrs.class;
      paddingEdits.push({ start: location.startOffset, end: location.endOffset, value: `class="${after}"` });
      const added = newUnderlines.find((record) => record.id === id);
      if (added) added.className = after;
      else {
        const change = changes.find((change) => change.kind === 'underline' && change.id === id);
        if (change) { change.after = after; change.reason += ' Separate the newly nested underline levels so their different patterns remain visible.'; }
        else { changes.push({ kind: 'underline', surah: page.surah, verse: page.underlines.find((record) => record.id === id).verse, id, before: attrs(underlines.get(id)).class, after, reason: 'Separate newly nested underline levels without changing the existing semantic pattern.', evidence: ['Nested annotation visibility'], spacingOnly: true }); underlineCount++; }
      }
      const record = data.underlines.find((record) => record.id === id);
      record.appearance.signature = after.split(/\s+/).filter((name) => name.startsWith('ul-')).join(' ');
      record.appearance.structure = after.split(/\s+/).filter((name) => name.startsWith('ul-') && !name.startsWith('ul-color-')).join(' ');
    }
    return next;
  };
  for (const id of renderedUnderlines.keys()) assignPadding(id);
  for (const edit of paddingEdits.sort((first, second) => second.start - first.start)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  if (paddingEdits.length) updated = parse(html, { sourceCodeLocationInfo: true });
  let updatedBody;
  walk(updated, (node) => { if (node.tagName === 'body') updatedBody = node; });
  assert.equal(text(updatedBody), originalText, `Quranic text or whitespace changed in ${page.surah}`);
  assert.deepEqual(verticalNodes(updated, html), originalVertical, `Vertical markup changed in ${page.surah}`);
  walk(updatedBody, (node) => {
    const id = attrs(node)['data-underline-id'];
    if (!id) return;
    const record = data.underlines.find((record) => record.id === id);
    assert(record, `Unknown rendered underline ${id}`);
    record.parentId = null; record.sectionId = null;
    let ancestor = node.parentNode;
    while (ancestor) {
      record.parentId ??= attrs(ancestor)['data-underline-id'] ?? null;
      record.sectionId ??= attrs(ancestor)['data-reader-section'] ?? null;
      ancestor = ancestor.parentNode;
    }
    record.selector = `[data-underline-id="${id}"]`;
  });
  await writeFile(filename, html);
  for (const change of changes.filter((change) => change.kind === 'underline' && change.surah === page.surah)) {
    const record = data.underlines.find((record) => record.id === change.id);
    if (record.appearance) {
      const style = change.after.split(/\s+/).filter((name) => name.startsWith('ul-'));
      record.appearance.signature = style.join(' ');
      record.appearance.structure = style.filter((name) => !name.startsWith('ul-color-')).join(' ');
      record.appearance.colorFamily = style.find((name) => /^ul-color-/.test(name))?.split('-')[2] ?? null;
    }
    record.betaEditorialReason = change.reason;
    record.betaSemanticRole = change.role;
  }
  data.betaQuotations = spans;
  passageGroups.push(...data.groups.filter((group) => group.basis === 'beta-editorial-content').map((group) => ({ ...group, surah: page.surah })));
  data.betaEditorialStatus = 'conservative-transfer-with-review-queue';
  await writeFile(dataFile, JSON.stringify(data, null, 2) + '\n');
  quotationCount += spans.length;
  for (const verse of page.verses) {
    const value = normalize(verse.text);
    const cues = value.match(/(?:^|\s)(?:قال|قالت|قالوا|قالا|قل|يقول|يقولون|قيل|نادى|نودي|نادوا|فتقول|فقال|فقالوا|وقال|وقالوا|وقل|فقل|ناداها)(?=\s|$)/gu) ?? [];
    if (!cues.length) continue;
    const covered = spans.filter((span) => span.firstVerse <= verse.verse && span.lastVerse >= verse.verse);
    if (!covered.length || cues.length > covered.filter((span) => span.firstVerse === verse.verse).length + 1) {
      issues.push({ surah: page.surah, firstVerse: verse.verse, lastVerse: verse.verse, category: 'Pending speech-turn review', detail: `${verse.text.slice(0, 330)} — ${cues.length} reporting cue(s); ${covered.length} reviewed quotation span(s) cover this verse. Remaining boundaries/voices are not certified.`, action: 'Existing unreviewed content preserved, not silently auto-annotated' });
    }
  }
}
await writeFile(path.join(root, 'data/beta/changes.json'), JSON.stringify({ referenceNumbers: corpus.referenceNumbers, quotationCount, underlineCount, targetSurahs: corpus.pages.filter((page) => !page.reference).map((page) => page.surah), contrastGroups, passageGroups, coverage, changes }, null, 2) + '\n');
issues.sort((first, second) => first.surah - second.surah || first.firstVerse - second.firstVerse || first.category.localeCompare(second.category));
await writeFile(path.join(root, 'data/beta/review-issues.json'), JSON.stringify(issues, null, 2) + '\n');
const catalogFile = path.join(root, 'data/catalog.json');
const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
const totals = { pages: catalog.pages.length, underlines: 0, linkedUnderlines: 0, symbolUnderlines: 0, sections: 0, groups: {} };
for (const entry of catalog.pages) {
  const data = JSON.parse(await readFile(path.join(root, entry.data), 'utf8'));
  entry.underlines = data.underlines.length;
  entry.sections = data.sections.length;
  totals.underlines += entry.underlines;
  totals.sections += entry.sections;
  totals.linkedUnderlines += new Set(data.groups.filter((group) => group.members.length > 1).flatMap((group) => group.members)).size;
  totals.symbolUnderlines += data.underlines.filter((record) => !/\p{Script=Arabic}/u.test(normalize(record.text))).length;
  for (const group of data.groups) totals.groups[group.reviewStatus] = (totals.groups[group.reviewStatus] ?? 0) + 1;
}
catalog.totals = totals;
await writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Applied ${quotationCount} reviewed quotation spans and ${underlineCount} underline changes in 32 targets; all reference pages and vertical markup remain unchanged.`);
console.log(`Recorded ${issues.length} specific review items; pending items are not claimed as resolved.`);