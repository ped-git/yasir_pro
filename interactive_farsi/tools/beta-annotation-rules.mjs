import { decodeHTML } from 'entities';
import { Tokenizer } from 'parse5';

const inlineTags = new Set(['span', 'a', 'b', 'i', 'em', 'strong', 'small']);

export function sourceTextPositions(raw, value, absoluteStart) {
  const positions = new Map();
  let decoded = '';
  for (const token of raw.matchAll(/&(?:#[xX][0-9a-fA-F]+;?|#[0-9]+;?|[A-Za-z][A-Za-z0-9]*;?)|\r\n|[\s\S]/gu)) {
    const text = token[0] === '\r\n' || token[0] === '\r' ? '\n' : token[0].startsWith('&') ? decodeHTML(token[0]) : token[0];
    for (const character of text) {
      positions.set(decoded.length, { start: absoluteStart + token.index, end: absoluteStart + token.index + token[0].length });
      decoded += character;
    }
  }
  if (decoded !== value) {
    let tokenText = '';
    const tokenPositions = new Map();
    const character = (token) => {
      const location = token.location;
      const fragment = raw.slice(location.startOffset, location.endOffset);
      const offsets = sourceTextPositions(fragment, token.chars, absoluteStart + location.startOffset);
      for (const [offset, position] of offsets) tokenPositions.set(tokenText.length + offset, position);
      tokenText += token.chars;
    };
    const ignore = () => {};
    const tokenizer = new Tokenizer({ sourceCodeLocationInfo: true }, { onCharacter: character, onWhitespaceCharacter: character, onNullCharacter: character, onStartTag: ignore, onEndTag: ignore, onComment: ignore, onDoctype: ignore, onEof: ignore });
    tokenizer.write(raw, true);
    if (tokenText !== value) throw new Error('HTML source/text decoding differs; refusing unsafe annotation offsets');
    return tokenPositions;
  }
  return positions;
}

export function quotationAnchorIndex(value, anchor, start, limit, options = {}) {
  const candidates = [];
  let cursor = start;
  while ((cursor = value.indexOf(anchor, cursor)) >= 0 && cursor < limit) { candidates.push(cursor); cursor += anchor.length; }
  if (!candidates.length) throw new Error(`Quotation anchor not found: ${anchor}`);
  if (options.startCue) {
    const cues = [];
    let offset = start;
    while ((offset = value.indexOf(options.startCue, offset)) >= 0 && offset < limit) { cues.push(offset); offset += options.startCue.length; }
    const occurrence = options.occurrence ?? 0;
    if (!Number.isInteger(occurrence) || cues[occurrence] === undefined) throw new Error(`Quotation start cue not found: ${options.startCue}`);
    const cue = cues[occurrence];
    const selected = candidates.find((candidate) => candidate >= cue && candidate < cue + options.startCue.length);
    if (selected === undefined) throw new Error(`Quotation anchor is outside the reviewed cue: ${anchor}`);
    return selected;
  }
  if (options.occurrence !== undefined) {
    if (!Number.isInteger(options.occurrence) || candidates[options.occurrence] === undefined) throw new Error(`Invalid quotation occurrence: ${anchor}`);
    return candidates[options.occurrence];
  }
  if (candidates.length !== 1) throw new Error(`Ambiguous quotation anchor requires a reviewed cue or occurrence: ${anchor}`);
  return candidates[0];
}

export function quotedTextEnd(body, html, start, boundary) {
  let end = null;
  let owner = null;
  const visit = (node) => {
    if (['sup', 'script', 'style'].includes(node.tagName)) return;
    if (node.nodeName === '#text' && node.sourceCodeLocation) {
      const location = node.sourceCodeLocation;
      if (location.startOffset < boundary && location.endOffset > start) {
        const prefix = html.slice(Math.max(start, location.startOffset), Math.min(boundary, location.endOffset));
        if (/[\u0621-\u064a]/u.test(prefix)) {
          const trimmed = prefix.replace(/[\s\u06d6-\u06dc]+$/u, '');
          end = Math.max(start, location.startOffset) + trimmed.length;
          owner = node.parentNode;
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(body);
  if (end === null) throw new Error('No Arabic quotation text exists before the requested boundary');
  while (owner && inlineTags.has(owner.tagName) && owner.sourceCodeLocation?.endTag) {
    const tag = owner.sourceCodeLocation.endTag;
    if (tag.endOffset > boundary || html.slice(end, tag.startOffset).trim()) break;
    end = tag.endOffset;
    owner = owner.parentNode;
  }
  return end;
}

export function polarityPattern(role) {
  const patterns = { good: 'solid', bad: 'dotted', neutral: 'dashed' };
  if (!patterns[role]) throw new Error(`Unknown semantic role: ${role}`);
  return patterns[role];
}

export function exactPhraseAnnotation(records, verse, phrase) {
  const normalize = (value) => value.normalize('NFC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  return records.find((record) => record.verse === verse && normalize(record.text) === normalize(phrase)) ?? null;
}

export function phraseRanges(body, html, start, end) {
  const elements = [];
  const texts = [];
  const visit = (node) => {
    if (['sup', 'script', 'style'].includes(node.tagName)) return;
    if (node.tagName && node.sourceCodeLocation?.startTag && node.sourceCodeLocation?.endTag) elements.push(node);
    if (node.nodeName === '#text' && node.sourceCodeLocation) texts.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(body);
  const actualText = (first, last) => texts.filter((node) => node.sourceCodeLocation.startOffset < last && node.sourceCodeLocation.endOffset > first).map((node) => html.slice(Math.max(first, node.sourceCodeLocation.startOffset), Math.min(last, node.sourceCodeLocation.endOffset))).join('');
  let first = start;
  let last = end;
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of elements.filter((node) => inlineTags.has(node.tagName))) {
      const location = node.sourceCodeLocation;
      if (location.startTag.endOffset <= first && first < location.endTag.startOffset && location.endTag.endOffset < last && !actualText(location.startTag.endOffset, first).trim()) {
        first = location.startOffset; expanded = true;
      }
      if (first < location.startTag.startOffset && location.startTag.endOffset <= last && last <= location.endTag.startOffset && !actualText(last, location.endTag.startOffset).trim()) {
        last = location.endOffset; expanded = true;
      }
    }
  }
  const crossesElement = elements.some((node) => {
    const location = node.sourceCodeLocation;
    if (['p', 'div', 'section', 'li'].includes(node.tagName) && first < location.startOffset && last > location.startOffset) return true;
    const startInside = location.startTag.endOffset <= first && first < location.endTag.endOffset;
    const endInside = location.startOffset < last && last <= location.endTag.startOffset;
    return startInside && last > location.endTag.endOffset || first < location.startOffset && endInside;
  });
  if (!crossesElement) return [{ start: first, end: last }];
  return texts.filter((node) => node.sourceCodeLocation.startOffset < end && node.sourceCodeLocation.endOffset > start)
    .map((node) => ({ start: Math.max(start, node.sourceCodeLocation.startOffset), end: Math.min(end, node.sourceCodeLocation.endOffset) }))
    .filter((range) => html.slice(range.start, range.end).trim());
}

export function grayForGroup(group, assigned, nearby = []) {
  if (assigned.has(group)) return assigned.get(group);
  const levels = [100, 180, 150, 220, 200, 120, 160, 80, 140, 240];
  const used = new Set(nearby.map((id) => assigned.get(id)).filter((value) => value !== undefined));
  const level = levels.find((value) => !used.has(value)) ?? levels[assigned.size % levels.length];
  assigned.set(group, level);
  return level;
}

export function nestedPadding(current, children, introduced) {
  if (!children.length || !introduced) return current;
  const required = Math.max(...children) + 2;
  if (current >= required) return current;
  const level = [2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32].find((level) => level >= required);
  if (level === undefined) throw new Error('Nested underline spacing exceeds the supported levels');
  return level;
}