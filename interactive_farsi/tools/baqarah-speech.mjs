import assert from 'node:assert/strict';
import { parse } from 'parse5';

export const baqarahSpeechAlignments = [
  { marker: 6, verse: 13, target: 'ایمان آورید چنان که دیگر مردم ایمان آوردند', edge: 'start' },
  { marker: 10, verse: 14, target: 'ایمان آوردیم', edge: 'start' },
  { marker: 12, verse: 14, target: 'بدون شک ما با شماییم', edge: 'start' },
  { marker: 14, verse: 25, target: 'این همان است که از پیش', edge: 'start' },
  { marker: 16, verse: 26, target: 'بسیاری را به آن مثل', edge: 'start' },
  { marker: 17, verse: 26, target: 'گمراه می‌کند', edge: 'end' },
];

function markerPosition(html, alignment) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const markers = [];
  const textNodes = [];
  let verse = 1;
  const walk = (node, inSymbol = false) => {
    if (['head', 'script', 'style'].includes(node.tagName)) return;
    if (node.tagName === 'speech') {
      markers.push(node);
      return;
    }
    if (node.tagName === 'sup') {
      const number = (node.childNodes ?? [])
        .map((child) => child.value ?? '')
        .join('')
        .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0));
      if (/^\d+$/u.test(number)) verse = Number(number) + 1;
      return;
    }
    const classes = (node.attrs ?? []).find((attribute) => attribute.name === 'class')?.value ?? '';
    const symbol = inSymbol || classes.split(/\s+/u).some((name) => name.startsWith('text-font--'));
    if (node.nodeName === '#text' && !symbol) {
      textNodes.push({ value: node.value, start: node.sourceCodeLocation?.startOffset, verse });
      return;
    }
    for (const child of node.childNodes ?? []) walk(child, symbol);
  };
  walk(document);
  assert(markers[alignment.marker], `Unknown quotation marker ${alignment.marker}`);
  const flattened = [];
  const sourceOffsets = [];
  const verses = [];
  for (const node of textNodes) {
    assert(Number.isInteger(node.start), 'Missing source position for translated text');
    for (let index = 0; index < node.value.length; index++) {
      if (/\s/u.test(node.value[index])) {
        if (flattened.length && flattened.at(-1) !== ' ') {
          flattened.push(' ');
          sourceOffsets.push(node.start + index);
          verses.push(node.verse);
        }
      } else {
        flattened.push(node.value[index]);
        sourceOffsets.push(node.start + index);
        verses.push(node.verse);
      }
    }
  }
  const text = flattened.join('');
  const target = alignment.target.replace(/\s+/gu, ' ').trim();
  let cursor = 0;
  let occurrence = -1;
  let targetIndex = -1;
  while ((cursor = text.indexOf(target, cursor)) !== -1) {
    const end = cursor + target.length;
    if (verses.slice(cursor, end).every((number) => number === alignment.verse)) {
      occurrence++;
      if (occurrence === (alignment.occurrence ?? 0)) {
        targetIndex = cursor;
        break;
      }
    }
    cursor++;
  }
  assert.notEqual(targetIndex, -1, `Quotation cue not found in verse ${alignment.verse}: ${alignment.target}`);
  const cueOffset = alignment.edge === 'start'
    ? sourceOffsets[targetIndex]
    : sourceOffsets[targetIndex + target.length - 1] + 1;
  const location = markers[alignment.marker].sourceCodeLocation;
  assert(location?.startOffset !== undefined && location.endOffset !== undefined, 'Missing quotation marker source range');
  if (cueOffset === location.startOffset || cueOffset === location.endOffset) return null;
  assert(cueOffset < location.startOffset || cueOffset > location.endOffset, 'Quotation cue overlaps its marker');
  return { start: location.startOffset, end: location.endOffset, cueOffset };
}

export function alignBaqarahSpeech(html, alignments = baqarahSpeechAlignments) {
  for (const alignment of alignments) {
    const position = markerPosition(html, alignment);
    if (!position) continue;
    const marker = html.slice(position.start, position.end);
    html = html.slice(0, position.start) + html.slice(position.end);
    const insertion = position.cueOffset > position.end ? position.cueOffset - (position.end - position.start) : position.cueOffset;
    html = html.slice(0, insertion) + marker + html.slice(insertion);
  }
  return html;
}
