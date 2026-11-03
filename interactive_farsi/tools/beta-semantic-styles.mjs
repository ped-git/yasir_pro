import assert from 'node:assert/strict';
import { grayForGroup, polarityPattern } from './beta-annotation-rules.mjs';

export function underlineFamily(style) {
  const plain = style.find((name) => /^ul-color-(red|green)-/.test(name))?.split('-')[2];
  if (plain) return plain;
  const stops = style.filter((name) => name.startsWith('ul-stops-')).join(' ');
  return /(?:^|-)red-\d/.test(stops) ? 'red' : /(?:^|-)green-\d/.test(stops) ? 'green' : null;
}

export function semanticStyles(page, data, decisions) {
  const records = new Map(data.underlines.map((record) => [record.id, record]));
  const source = new Map(page.underlines.map((record) => [record.id, record]));
  const groups = new Map(data.groups.map((group) => [group.id, group]));
  const shades = new Map();
  const groupFor = (id) => {
    const record = records.get(id);
    const candidates = (record?.groups ?? []).map((group) => groups.get(group)).filter((group) => group?.members.length > 1).sort((first, second) => first.members.length - second.members.length);
    return candidates[0]?.id ?? record?.groups?.[0] ?? id;
  };
  for (const record of page.underlines) {
    const level = record.style.find((name) => /^ul-color-gray-\d+$/.test(name));
    if (level && !shades.has(groupFor(record.id))) shades.set(groupFor(record.id), Number(level.split('-').at(-1)));
  }
  const family = (record) => underlineFamily(record.style);
  const explicitRoles = new Map(decisions.filter((decision) => decision.surah === page.surah).flatMap((decision) => decision.ids.map((id) => [id, decision.role])));
  const colored = page.underlines.filter((record) => family(record) && (!explicitRoles.has(record.id) || explicitRoles.get(record.id) === (family(record) === 'red' ? 'bad' : 'good')));
  const parent = new Map(colored.map((record) => [record.id, record.id]));
  const find = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  const join = (first, second) => parent.set(find(first), find(second));
  for (const first of colored) {
    const context = records.get(first.id);
    const candidates = colored.filter((second) => first.id !== second.id && family(first) !== family(second)
      && context?.parentId === records.get(second.id)?.parentId
      && context?.sectionId === records.get(second.id)?.sectionId
      && Math.abs(first.verse - second.verse) <= 2);
    candidates.sort((previous, next) => Math.abs(first.start - previous.start) - Math.abs(first.start - next.start));
    if (candidates.length) join(first.id, candidates[0].id);
  }
  const components = new Map();
  for (const record of colored) {
    const key = find(record.id);
    if (!components.has(key)) components.set(key, []);
    components.get(key).push(record.id);
  }
  const contrasts = [];
  const paired = new Set();
  for (const members of components.values()) {
    if (new Set(members.map((id) => family(source.get(id)))).size < 2) continue;
    const id = `beta-contrast-${page.surah}-${[...members].sort()[0].replace(/^p\d+-/, '')}`;
    contrasts.push({ id, label: 'Compared good and bad alternatives', basis: 'beta-semantic-contrast', reviewStatus: 'beta-editorial', members, evidence: 'Existing opposite-color annotations, nearest local counterpart, same nested layer, same section, and at most two verses apart.' });
    for (const member of members) paired.add(member);
  }
  const reviewed = new Map();
  for (const decision of decisions.filter((decision) => decision.surah === page.surah)) {
    for (const id of decision.ids) {
      assert(source.has(id), `Unknown semantic review target: ${id}`);
      reviewed.set(id, { role: decision.role, reason: decision.reason, explicit: true });
    }
  }
  for (const record of colored) if (!reviewed.has(record.id)) reviewed.set(record.id, {
    role: family(record) === 'red' ? 'bad' : 'good',
    reason: paired.has(record.id) ? 'Existing red/green comparison: the good alternative is solid and the bad alternative dotted; color identifies the contrast rather than replacing semantic pattern.' : 'Preserve the existing annotated semantic role but remove unpaired comparison color; gray is group identity only.',
    explicit: false,
  });
  const changes = [];
  for (const [id, decision] of reviewed) {
    const record = source.get(id);
    const pattern = polarityPattern(decision.role);
    let style = [...record.style];
    style = style.filter((name) => !name.startsWith('ul-pattern-'));
    style.push(`ul-pattern-${pattern}`);
    if (decision.explicit && style.includes('ul-image-gradient')) style = style.filter((name) => !/^ul-(?:image-|gradient-|stops-)/.test(name));
    if (family(record) && style.includes('ul-image-gradient') && (decision.role === 'bad' || !paired.has(id))) {
      style = style.filter((name) => !/^ul-(?:image-|gradient-|stops-)/.test(name) && !name.startsWith('ul-color-'));
      style.push(family(record) === 'red' ? 'ul-color-red-220-150-150' : 'ul-color-green-100-180-100');
    }
    let group = groupFor(id);
    let gray = null;
    if (!paired.has(id)) {
      const nearby = page.underlines.filter((other) => Math.abs(other.verse - record.verse) <= 2 && records.get(other.id)?.parentId === records.get(id)?.parentId).map((other) => groupFor(other.id));
      gray = grayForGroup(group, shades, nearby);
      style = style.filter((name) => !name.startsWith('ul-color-'));
      style.push(`ul-color-gray-${gray}`);
    }
    const existing = new Set(record.style);
    if (style.length === existing.size && style.every((name) => existing.has(name))) continue;
    changes.push({ id, role: decision.role, reason: decision.reason, style, contrast: paired.has(id), group, gray });
  }
  return { changes, contrasts, shades, groupFor };
}