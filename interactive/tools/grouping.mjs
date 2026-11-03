import { createHash } from 'node:crypto';

export function normalizeText(text) {
  return text.normalize('NFC')
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[۰-۹٠-٩0-9]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const stopWords = new Set('الله اللهم رب ربي ربك ربكم ربهم من في علي الي عن ان انا انما انهم انكم انك انه ما لا لم لن كل كان كانوا يكون لكم لهم له لها به بها بما كما هذا هذه ذلك تلك الذين الذي التي هو هي هم هن انت انتم نحن قد اذا اذ او ام ثم الا ولا وما فلا ومن وان يا قل قال قالوا عند قبل بعد'.split(' '));

function contentWords(text) {
  return new Set((normalizeText(text).match(/[\p{L}]+/gu) ?? [])
    .filter((word) => /\p{Script=Arabic}/u.test(word) && word.length > 2 && !stopWords.has(word))
    .map((word) => word.replace(/^[وف](?=.{3})/u, '').replace(/^ال(?=.{3})/u, '').replace(/ا$/u, '')));
}

function relationId(prefix, type, members) {
  const suffix = createHash('sha256').update(members.join('|')).digest('hex').slice(0, 10);
  return `${prefix}-${type}-${suffix}`;
}

export function assignGroups(records, definitions = [], bodyText = '', prefix = 'page') {
  const groups = [];
  const membership = new Map(records.map((record) => [record.id, []]));
  const curated = new Set();
  const pinnedSingles = new Set();
  const seen = new Set();
  const add = (group) => {
    const key = [...group.members].sort().join('|');
    if (group.reviewStatus !== 'curated' && seen.has(key)) return;
    seen.add(key);
    groups.push(group);
    for (const id of group.members) membership.get(id).push(group.id);
  };
  for (const definition of definitions) {
    const members = definition.members.map((member) => {
      const target = typeof member === 'string' ? { text: member } : member;
      if (target.id) {
        if (!membership.has(target.id)) throw new Error(`Unknown curated underline ID: ${target.id}`);
        return target.id;
      }
      const matches = records.filter((record) => normalizeText(record.text) === normalizeText(target.text));
      if (target.occurrence !== undefined) {
        if (!matches[target.occurrence]) throw new Error(`Missing curated occurrence: ${definition.id}: ${target.text}`);
        return matches[target.occurrence].id;
      }
      if (matches.length !== 1) throw new Error(`Curated member must be unambiguous: ${definition.id}: ${target.text} (${matches.length} matches)`);
      return matches[0].id;
    });
    for (const id of members) curated.add(id);
    if (members.length === 1) pinnedSingles.add(members[0]);
    add({ id: `${prefix}-${definition.id}`, label: definition.label, basis: 'editorial-content', reviewStatus: 'curated', members: [...new Set(members)] });
  }
  const eligible = records.filter((record) => !curated.has(record.id) && /\p{Script=Arabic}/u.test(normalizeText(record.text)));
  const signature = (record) => record.appearance?.signature ?? null;
  const sameForm = (first, second) => Boolean(signature(first)) && signature(first) === signature(second);
  const sameLayer = (first, second) => first.parentId === second.parentId;
  const gapText = (first, second) => normalizeText(bodyText.slice(first.end, second.start));
  const coordinated = (first, second) => /^(?:و|او|ام|ثم|ف)?$/.test(gapText(first, second).replace(/[\s\p{P}\p{S}]/gu, ''));
  const sharedContent = (first, second) => {
    const firstWords = contentWords(first.text);
    const secondWords = contentWords(second.text);
    const shared = [...firstWords].filter((word) => secondWords.has(word)).length;
    return { shared, ratio: shared / Math.max(1, new Set([...firstWords, ...secondWords]).size) };
  };
  const suggest = (type, label, members, evidence) => {
    if (members.length < 2) return;
    const ids = members.map((record) => record.id);
    add({ id: relationId(prefix, type, ids), label, basis: type, reviewStatus: 'suggested', evidence, members: ids });
  };
  const buckets = (key) => {
    const result = new Map();
    for (const record of eligible) {
      const value = key(record);
      if (!result.has(value)) result.set(value, []);
      result.get(value).push(record);
    }
    return result.values();
  };
  for (const siblings of buckets((record) => `${record.contextId}|${record.parentId ?? ''}`)) {
    let run = [];
    const flush = () => {
      suggest('textual-coordination', 'Coordinated phrases with matching underline forms', run, ['same-context', 'same-nesting-layer', 'coordinating-text', 'matching-underline']);
      run = [];
    };
    for (const record of siblings) {
      const previous = run.at(-1);
      if (previous && (!sameForm(previous, record) || !coordinated(previous, record))) flush();
      run.push(record);
    }
    flush();
    for (let index = 1; index < siblings.length; index++) {
      const first = siblings[index - 1];
      const second = siblings[index];
      if (sameForm(first, second) || !coordinated(first, second)) continue;
      const colors = new Set([first.appearance?.colorFamily, second.appearance?.colorFamily]);
      if (colors.has('green') && colors.has('red') && first.appearance?.structure === second.appearance?.structure) {
        suggest('paired-contrast', 'Locally coordinated contrasting alternatives', [first, second], ['same-context', 'same-nesting-layer', 'paired-red-green', 'matching-line-structure', 'coordinating-text']);
      }
    }
  }
  for (const siblings of buckets((record) => `${record.sectionId ?? 'page'}|${record.parentId ?? ''}|${signature(record) ?? record.id}`)) {
    let run = [];
    const flush = () => {
      suggest('local-underline-pattern', 'Nearby matching underlines in the same discourse section', run, ['matching-underline', 'same-section', 'same-nesting-layer', 'bounded-verse-distance', 'no-new-speech-boundary']);
      run = [];
    };
    for (const record of siblings) {
      const previous = run.at(-1);
      if (previous) {
        const gap = gapText(previous, record);
        const verseDistance = Math.abs((record.verse ?? 0) - (previous.verse ?? 0));
        const span = Math.abs((record.verse ?? 0) - (run[0].verse ?? 0));
        const blockDistance = Math.abs((record.blockIndex ?? 0) - (previous.blockIndex ?? 0));
        const speechBoundary = /(?:^|\s)(?:قل|قال|قالوا|قالت|يقول|يقولون)(?:\s|$)/u.test(gap);
        if (verseDistance > 2 || span > 4 || blockDistance > 3 || gap.length > 500 || speechBoundary) flush();
      }
      run.push(record);
    }
    flush();
  }
  for (const repeated of buckets((record) => `${record.parentId ?? ''}|${signature(record) ?? record.id}|${normalizeText(record.text)}`)) {
    if (repeated.length < 2 || !signature(repeated[0]) || !contentWords(repeated[0].text).size) continue;
    const phraseWords = normalizeText(repeated[0].text).split(/\s+/).length;
    const sections = new Set(repeated.map((record) => record.sectionId ?? record.contextId));
    if (phraseWords < 2 && sections.size > 1) continue;
    suggest('exact-normalized-text', 'Repeated content phrase with the same underline form', repeated, ['exact-normalized-text', 'matching-underline', 'same-nesting-layer', 'non-generic-content']);
  }
  for (let firstIndex = 0; firstIndex < eligible.length; firstIndex++) {
    const first = eligible[firstIndex];
    for (const second of eligible.slice(firstIndex + 1, firstIndex + 17)) {
      if (!sameLayer(first, second) || !sameForm(first, second)) continue;
      if (normalizeText(first.text) === normalizeText(second.text)) continue;
      if (first.sectionId !== second.sectionId && Math.abs((first.verse ?? 0) - (second.verse ?? 0)) > 8) continue;
      const overlap = sharedContent(first, second);
      if (overlap.shared < 2 || overlap.ratio < 0.65) continue;
      suggest('lexical-parallel', 'Matching underline form and strongly parallel content', [first, second], ['matching-underline', 'same-nesting-layer', 'two-shared-content-words', 'high-lexical-overlap']);
    }
  }
  const colored = records.filter((record) => !pinnedSingles.has(record.id) && ['red', 'green'].includes(record.appearance?.colorFamily));
  const paired = new Set();
  for (const first of colored) {
    const candidates = colored.filter((second) => first.id !== second.id && sameLayer(first, second)
      && first.appearance.colorFamily !== second.appearance.colorFamily
      && first.sectionId === second.sectionId
      && Math.abs((first.verse ?? 0) - (second.verse ?? 0)) <= 4
      && Math.abs((first.blockIndex ?? 0) - (second.blockIndex ?? 0)) <= 8);
    candidates.sort((previous, next) => Math.abs((first.start ?? 0) - (previous.start ?? 0)) - Math.abs((first.start ?? 0) - (next.start ?? 0)));
    const second = candidates[0];
    if (!second) continue;
    const key = [first.id, second.id].sort().join('|');
    if (paired.has(key)) continue;
    paired.add(key);
    const members = new Set([first.id, second.id]);
    for (const group of groups) {
      if (!group.members.some((id) => members.has(id))) continue;
      for (const id of group.members) {
        const record = colored.find((entry) => entry.id === id);
        if (record && sameLayer(first, record) && record.sectionId === first.sectionId && Math.abs((first.verse ?? 0) - (record.verse ?? 0)) <= 4) members.add(id);
      }
    }
    suggest('red-green-pair', 'Paired red and green alternatives', records.filter((record) => members.has(record.id)), ['opposite-red-green', 'same-section', 'same-nesting-layer', 'nearest-local-counterpart', 'saved-before-display']);
  }
  for (const record of records) {
    if (!membership.get(record.id).length) {
      add({ id: `${record.id}-individual`, label: /\p{Script=Arabic}/u.test(normalizeText(record.text)) ? 'Individual phrase; no relationship inferred' : 'Symbol marker; not a textual relationship', basis: 'individual', reviewStatus: 'unassigned', members: [record.id] });
    }
  }
  return { groups, underlines: records.map((record) => ({ ...record, groups: membership.get(record.id) })) };
}