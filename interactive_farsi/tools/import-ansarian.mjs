import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { parse } from 'parse5';
import { normalizeBaqarahVerse } from './baqarah-text.mjs';
import { alignBaqarahSpeech, baqarahSpeechAlignments } from './baqarah-speech.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = path.join(root, 'data/ansarian-source.xml');
const surahPath = path.join(root, 'Surah');
const betaSurahPath = path.join(root, '..', 'interactive_beta', 'Surah');
const sidecarPath = path.join(root, 'data/pages/Surah');
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: false,
});
const manualPhraseAlignments = [
  { id: 'p001-u0001', source: 'رَبِّ الْعَالَمِينَ', target: 'مالک و مربّی جهانیان است.' },
  { id: 'p001-u0002', source: 'الرَّحْمَـٰنِ', target: 'رحمتش بی اندازه و' },
  { id: 'p001-u0003', source: 'الرَّحِيمِ', target: 'مهربانی اش همیشگی است.' },
  { id: 'p001-u0004', source: 'مَالِكِ يَوْمِ الدِّينِ', target: 'مالک و فرمانروای روز پاداش و کیفر است.' },
  { id: 'p001-u0005', source: 'إِيَّاكَ نَعْبُدُ', target: '[پروردگارا!] تنها تو را می پرستیم' },
  { id: 'p001-u0006', source: 'إِيَّاكَ نَسْتَعِينُ', target: 'تنها از تو کمک می خواهیم.' },
  { id: 'p001-u0007', source: 'أَنْعَمْتَ عَلَيْهِمْ', target: 'نعمتِ [ایمان، عمل شایسته و اخلاق حسنه] عطاکردی' },
  { id: 'p001-u0008', source: 'الْمَغْضُوبِ عَلَيْهِمْ', target: 'مورد خشم تواند' },
  { id: 'p001-u0009', source: 'الضَّالِّينَ', target: 'گمراه اند.' },
  { id: 'p002-u0001', source: 'يُؤْمِنُونَ بِالْغَيْبِ', target: 'به غیب ایمان دارند' },
  { id: 'p002-u0002', source: 'يُقِيمُونَ الصَّلَاةَ', target: 'نماز را بر پا می دارند' },
  { id: 'p002-u0003', source: 'مِمَّا رَزَقْنَاهُمْ يُنفِقُونَ', target: 'از آنچه به آنان روزی داده ایم، انفاق می کنند.' },
  { id: 'p002-u0007', source: 'بِالْآخِرَةِ هُمْ يُوقِنُونَ', target: 'و به آخرت یقین دارند.' },
  { id: 'p002-u0008', source: 'أَنذَرْتَهُمْ', target: 'بیمشان دهی' },
  { id: 'p002-u0009', source: 'لَمْ تُنذِرْهُمْ', target: 'بیمشان ندهی' },
  { id: 'p002-u0013', source: 'عَلَىٰ أَبْصَارِهِمْ غِشَاوَةٌ', target: 'و بر چشم هایشان پرده ای' },
  { id: 'p002-u0005', source: 'مَا أُنزِلَ إِلَيْكَ', target: 'به سوی تو' },
  { id: 'p002-u0006', source: 'مَا أُنزِلَ مِن قَبْلِكَ', target: 'پیش از تو نازل شده' },
  { id: 'p002-u0011', source: 'عَلَىٰ قُلُوبِهِمْ', target: 'بر دل ها' },
  { id: 'p002-u0012', source: 'عَلَىٰ سَمْعِهِمْ', target: 'و گوش هایشان' },
  { id: 'p002-u0014', source: 'بِاللَّهِ', target: 'به خدا' },
  { id: 'p002-u0015', source: 'بِالْيَوْمِ الْآخِرِ', target: 'روز قیامت' },
  { id: 'p002-u0016', source: 'اللَّهَ', target: 'خدا' },
  { id: 'p002-u0017', source: 'الَّذِينَ آمَنُوا', target: 'اهل ایمان' },
  { id: 'p002-u0022', source: 'مَا رَبِحَت تِّجَارَتُهُمْ', target: 'تجارتشان سود نکرد' },
  { id: 'p002-u0023', source: 'مَا كَانُوا مُهْتَدِينَ', target: 'و از راه یافتگان [به سوی حق] نبودند.' },
  { id: 'p002-u0026', source: 'عُمْيٌ', target: 'کورند' },
  { id: 'p002-u0027', source: 'ظُلُمَاتٌ', target: 'تاریکی ها' },
  { id: 'p002-u0028', source: 'رَعْدٌ', target: 'رعد' },
  { id: 'p002-u0029', source: 'بَرْقٌ', target: 'برق' },
  { id: 'p002-u0030', source: 'كُلَّمَا أَضَاءَ لَهُم مَّشَوْا فِيهِ', target: 'زمانی که آنان را روشنی دهد، در آن روشنی راه می روند' },
  { id: 'p002-u0031', source: 'إِذَا أَظْلَمَ عَلَيْهِمْ قَامُوا', target: 'و چون محیط را بر آنان تاریک کند، می ایستند' },
  { id: 'p002-u0032', source: 'سَمْعِهِمْ', target: 'گوش' },
  { id: 'p002-u0033', source: 'أَبْصَارِهِمْ', target: '[بیناییِ] چشم' },
  { id: 'p002-u0034', source: 'كُمْ', target: 'شما' },
  { id: 'p002-u0035', source: 'الَّذِينَ مِن قَبْلِكُمْ', target: 'پیشینیان شما' },
  { id: 'p002-u0037', source: 'الْأَرْضَ فِرَاشًا', target: 'زمین را برای شما بستری گسترده' },
  { id: 'p002-u0038', source: 'السَّمَاءَ بِنَاءً', target: 'آسمان را سقفی برافراشته' },
  { id: 'p002-u0039', source: 'أَنزَلَ مِنَ السَّمَاءِ مَاءً فَأَخْرَجَ بِهِ مِنَ الثَّمَرَاتِ رِزْقًا لَّكُمْ', target: 'و از آسمان، آبی [مانند برف و باران] نازل کرد و به وسیله آن از میوه های گوناگون، رزق و روزی برای شما بیرون آورد' },
  { id: 'p002-u0040', source: 'فَاتَّقُوا النَّارَ الَّتِي وَقُودُهَا النَّاسُ وَالْحِجَارَةُ ۖ أُعِدَّتْ لِلْكَافِرِينَ', target: 'از آتشی که هیزمش مردم و سنگ هایند، بپرهیزید؛ آتشی که برای کافران آماده شده است.' },
];

function asArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function valueText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value['#text'] === 'string') return value['#text'];
  return String(value ?? '');
}

function decodeDigits(value) {
  return value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

function persianDigits(value) {
  return String(value).replace(/[0-9]/g, (digit) => String.fromCharCode(Number(digit) + 0x06f0));
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function attributes(node) {
  return Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
}

function classNames(node) {
  return (node.attrs?.find((attribute) => attribute.name === 'class')?.value ?? '').split(/\s+/).filter(Boolean);
}

function visit(node, callback) {
  callback(node);
  for (const child of node.childNodes ?? []) visit(child, callback);
}

function sourceMarkup(html, node) {
  const location = node.sourceCodeLocation;
  assert(location, `Missing source location for ${node.tagName ?? node.nodeName}`);
  return html.slice(location.startOffset, location.endOffset);
}

function startMarkup(html, node) {
  const location = node.sourceCodeLocation;
  assert(location?.startTag, `Missing start tag for ${node.tagName}`);
  return html.slice(location.startTag.startOffset, location.startTag.endOffset);
}

function endMarkup(html, node) {
  const location = node.sourceCodeLocation;
  return location?.endTag ? html.slice(location.endTag.startOffset, location.endTag.endOffset) : `</${node.tagName}>`;
}

function measure(text) {
  return text.replace(/\s/gu, '').length;
}

function wordBoundaries(text) {
  const boundaries = new Set([0, text.length]);
  for (const match of text.matchAll(/\S+/gu)) {
    boundaries.add(match.index);
    boundaries.add(match.index + match[0].length);
  }
  return [...boundaries].sort((first, second) => first - second);
}

function nearestBoundary(boundaries, target) {
  let nearest = boundaries[0];
  for (const boundary of boundaries) {
    if (Math.abs(boundary - target) < Math.abs(nearest - target)) nearest = boundary;
  }
  return nearest;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findFlexiblePhrase(text, phrase) {
  const pattern = phrase.trim().split(/[\s\u200c]+/u).map(escapeRegExp).join('[\\s\\u200c]+');
  const match = new RegExp(pattern, 'u').exec(text);
  assert(match, `Manual alignment phrase not found in translation: ${phrase}`);
  return { start: match.index, end: match.index + match[0].length };
}

function normalizeArabicPhrase(value) {
  return value
    .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/gu, '')
    .replaceAll('ٱ', 'ا')
    .replace(/\s+/gu, ' ')
    .trim();
}

function containsVerseMarker(node) {
  let contains = false;
  visit(node, (child) => { if (child.tagName === 'sup') contains = true; });
  return contains;
}

function initialVerseScope(marker) {
  for (let ancestor = marker.parentNode; ancestor && ancestor.tagName !== 'body'; ancestor = ancestor.parentNode) {
    const classes = classNames(ancestor);
    if (ancestor.tagName === 'p' || classes.some((name) => /^(verse-paragraph--|spacing-reset|big-bullet--|small-bullet--)/.test(name))) return ancestor;
  }
  return marker.parentNode;
}

function replaceVerseText(nodes, marker, chapterId, translations, edits, markerFixes, manualAlignments, nextVerseId) {
  const markerText = decodeDigits(innerText(marker)).trim();
  assert(/^\d+$/.test(markerText), `Invalid verse marker in chapter ${chapterId}: ${markerText}`);
  const sourceVerseId = Number(markerText);
  const verseId = nextVerseId;
  if (sourceVerseId !== verseId) {
    const location = marker.sourceCodeLocation;
    assert(location?.startTag && location?.endTag, `Missing superscript source range for ${chapterId}:${verseId}`);
    edits.push({ start: location.startTag.endOffset, end: location.endTag.startOffset, value: persianDigits(verseId) });
    markerFixes.push({ chapter: chapterId, verse: verseId, sourceLabel: sourceVerseId, correctedLabel: verseId });
  }
  const translation = translations.get(`${chapterId}:${verseId}`);
  assert.notEqual(translation, undefined, `Missing translation for ${chapterId}:${verseId}`);
  const sourceNodes = nodes.filter((node) => measure(node.value) > 0);
  const sourceLength = sourceNodes.reduce((total, node) => total + measure(node.value), 0);
  assert(sourceLength > 0, `No source text for ${chapterId}:${verseId}`);
  const boundaries = wordBoundaries(translation);
  const sourceOffsets = [];
  let sourceOffset = 0;
  for (const node of sourceNodes) {
    const start = sourceOffset;
    sourceOffset += measure(node.value);
    sourceOffsets.push({ start, end: sourceOffset });
  }
  const manualById = new Map(manualPhraseAlignments.map((alignment) => [alignment.id, alignment]));
  const sourceRanges = new Map();
  for (const [index, node] of sourceNodes.entries()) {
    for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
      const id = ancestor.attrs?.find((attribute) => attribute.name === 'data-underline-id')?.value;
      if (!id || !manualById.has(id)) continue;
      const range = sourceRanges.get(id) ?? { first: index, last: index, node: ancestor };
      range.first = Math.min(range.first, index);
      range.last = Math.max(range.last, index);
      sourceRanges.set(id, range);
    }
  }
  const anchors = [{ source: 0, target: 0 }, { source: sourceLength, target: translation.length }];
  for (const [id, range] of sourceRanges) {
    const alignment = manualById.get(id);
    assert.equal(normalizeArabicPhrase(plainText(range.node)), normalizeArabicPhrase(alignment.source), `Arabic alignment anchor changed for ${id}`);
    const targetRange = findFlexiblePhrase(translation, alignment.target);
    anchors.push({ source: sourceOffsets[range.first].start, target: targetRange.start, id });
    anchors.push({ source: sourceOffsets[range.last].end, target: targetRange.end, id });
    manualAlignments.push({ chapter: chapterId, verse: verseId, id, source: alignment.source, target: alignment.target });
  }
  anchors.sort((first, second) => first.source - second.source || first.target - second.target);
  const distinctAnchors = [];
  for (const anchor of anchors) {
    const previous = distinctAnchors.at(-1);
    if (previous?.source === anchor.source) {
      const start = Math.min(previous.target, anchor.target);
      const end = Math.max(previous.target, anchor.target);
      assert(/^\s*$/u.test(translation.slice(start, end)), `Conflicting manual phrase boundaries in ${chapterId}:${verseId}: ${JSON.stringify(previous)} / ${JSON.stringify(anchor)}`);
      previous.target = end;
      continue;
    }
    if (previous) assert(anchor.target >= previous.target, `Manual phrase order conflicts with source order in ${chapterId}:${verseId}: ${JSON.stringify(previous)} / ${JSON.stringify(anchor)}`);
    distinctAnchors.push(anchor);
  }
  const mapBoundary = (position) => {
    const exact = distinctAnchors.find((anchor) => anchor.source === position);
    if (exact) return exact.target;
    let nextIndex = distinctAnchors.findIndex((anchor) => anchor.source > position);
    if (nextIndex < 0) nextIndex = distinctAnchors.length - 1;
    const previous = distinctAnchors[Math.max(0, nextIndex - 1)];
    const next = distinctAnchors[nextIndex];
    if (next.source === previous.source) return next.target;
    const ratio = (position - previous.source) / (next.source - previous.source);
    return nearestBoundary(boundaries, previous.target + ratio * (next.target - previous.target));
  };
  for (const [index, node] of sourceNodes.entries()) {
    const targetStart = mapBoundary(sourceOffsets[index].start);
    const targetEnd = mapBoundary(sourceOffsets[index].end);
    assert(targetEnd >= targetStart, `Invalid mapped text range for ${chapterId}:${verseId}`);
    const location = node.sourceCodeLocation;
    assert(location, `Missing text-node source location for ${chapterId}:${verseId}`);
    edits.push({ start: location.startOffset, end: location.endOffset, value: escapeHtml(translation.slice(targetStart, targetEnd)) });
  }
  return verseId + 1;
}

function transformPage(html, chapterId, translations, expectedVerseCount, markerFixes, manualAlignments) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const edits = updateLanguage(html, document);
  let nextVerseId = 1;
  let textNodes = [];
  let started = false;
  let firstMarker = null;
  visit(document, (node) => { if (!firstMarker && node.tagName === 'sup') firstMarker = node; });
  assert(firstMarker, `No verse markers in chapter ${chapterId}`);
  const firstScope = initialVerseScope(firstMarker);
  const flush = (marker) => {
    nextVerseId = replaceVerseText(textNodes, marker, chapterId, translations, edits, markerFixes, manualAlignments, nextVerseId);
    textNodes = [];
  };
  const walk = (node) => {
    if (node === firstScope) started = true;
    const classes = classNames(node);
    if (node.tagName === 'span' && classes.some((name) => name.startsWith('text-font--')) && !containsVerseMarker(node)) return;
    if (node.tagName === 'sup') {
      flush(node);
      started = true;
      return;
    }
    if (node.nodeName === '#text') {
      if (started) textNodes.push(node);
      return;
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(document);
  assert.equal(textNodes.some((node) => node.value.trim()), false, `Unmarked text remains in chapter ${chapterId}`);
  assert.equal(nextVerseId, expectedVerseCount + 1, `Incomplete verse sequence in chapter ${chapterId}`);
  let underlineCount = 0;
  let quoteCount = 0;
  let bulletCount = 0;
  visit(document, (node) => {
    if (node.attrs?.some((attribute) => attribute.name === 'data-underline-id')) underlineCount++;
    if (node.tagName === 'speech') quoteCount++;
    if (node.tagName && classNames(node).some((name) => name.startsWith('big-bullet--') || name.startsWith('small-bullet--'))) bulletCount++;
  });
  const quoteStack = [];
  visit(document, (node) => {
    if (node.tagName !== 'speech') return;
    const attrs = attributes(node);
    const hasOpen = Object.hasOwn(attrs, 'open');
    const hasClose = Object.hasOwn(attrs, 'close');
    assert.notEqual(hasOpen, hasClose, `Invalid speech marker in chapter ${chapterId}`);
    const key = attrs['data-beta-quote'] ?? ['blue', 'red', 'green', 'black'].find((color) => Object.hasOwn(attrs, color)) ?? '';
    if (hasOpen) quoteStack.push(key);
    else {
      assert(quoteStack.length, `Unmatched closing speech marker in chapter ${chapterId}`);
      const openKey = quoteStack.pop();
      if (key && openKey) assert.equal(key, openKey, `Mismatched speech pair in chapter ${chapterId}`);
    }
  });
  assert.equal(quoteStack.length, 0, `Unclosed speech marker in chapter ${chapterId}`);
  return { edits, underlineCount, quoteCount, bulletCount, sectionCount: (html.match(/data-reader-section=/g) ?? []).length };
}

function parseTranslation(xml) {
  const document = parser.parse(xml).HolyQuran;
  assert(document, 'Missing HolyQuran root element in Ansarian XML');
  const chapters = asArray(document.Chapter);
  assert.equal(chapters.length, 114, 'Expected exactly 114 chapters in Ansarian XML');
  const translations = new Map();
  const verseCounts = [];
  for (const [index, chapter] of chapters.entries()) {
    const chapterId = Number(chapter['@_ChapterID']);
    assert.equal(chapterId, index + 1, `Unexpected chapter ID ${chapterId}`);
    const verses = asArray(chapter.Verse);
    assert(verses.length > 0, `Chapter ${chapterId} has no verses`);
    for (const [verseIndex, verse] of verses.entries()) {
      const verseId = Number(verse['@_VerseID']);
      assert.equal(verseId, verseIndex + 1, `Unexpected verse ID in chapter ${chapterId}`);
      const key = `${chapterId}:${verseId}`;
      assert(!translations.has(key), `Duplicate translation for ${key}`);
      const text = valueText(verse);
      translations.set(key, chapterId === 2 ? normalizeBaqarahVerse(verseId, text) : text);
    }
    verseCounts.push(verses.length);
  }
  assert.equal(translations.size, 6236, 'Expected exactly 6,236 translations');
  return { translations, verseCounts, chapterNames: chapters.map((chapter) => chapter['@_ChapterName']) };
}

function updateLanguage(html, document) {
  const edits = [];
  const nodes = [];
  visit(document, (node) => {
    if (node.tagName === 'html' || node.tagName === 'body') nodes.push(node);
  });
  for (const node of nodes) {
    const lang = node.tagName === 'html' ? 'fa' : 'fa-IR';
    const location = node.sourceCodeLocation.attrs?.lang;
    if (location) edits.push({ start: location.startOffset, end: location.endOffset, value: `lang="${lang}"` });
    else edits.push({ start: node.sourceCodeLocation.startTag.endOffset - 1, end: node.sourceCodeLocation.startTag.endOffset - 1, value: ` lang="${lang}"` });
  }
  return edits;
}

function innerText(node) {
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes ?? []).map(innerText).join('');
}

function plainText(node) {
  return innerText(node).replace(/\s+/gu, ' ').trim();
}

function selectorPath(node) {
  const parts = [];
  for (let current = node; current?.tagName && current.tagName !== 'html'; current = current.parentNode) {
    const siblings = current.parentNode.childNodes.filter((child) => child.tagName === current.tagName);
    parts.unshift(`${current.tagName}:nth-of-type(${siblings.indexOf(current) + 1})`);
  }
  return parts.join(' > ');
}

function excerpt(text) {
  const words = text.split(/\s+/u).filter(Boolean);
  const firstCount = Math.min(8, Math.ceil(words.length / 2));
  const lastCount = Math.min(8, words.length - firstCount);
  return { first: words.slice(0, firstCount).join(' '), last: lastCount ? words.slice(-lastCount).join(' ') : '' };
}

async function updateSidecar(file, html, sourceHtml) {
  const sidecarFile = path.join(sidecarPath, file.replace(/\.html$/u, '.json'));
  const data = JSON.parse(await readFile(sidecarFile, 'utf8'));
  const document = parse(html, { sourceCodeLocationInfo: true });
  const sourceDocument = parse(sourceHtml, { sourceCodeLocationInfo: true });
  let body;
  visit(document, (node) => { if (node.tagName === 'body') body = node; });
  assert(body, `Missing body in ${file}`);
  const sourceUnderlines = new Map();
  visit(sourceDocument, (node) => {
    const underlineId = node.attrs?.find((attribute) => attribute.name === 'data-underline-id')?.value;
    if (underlineId) sourceUnderlines.set(underlineId, plainText(node));
  });

  let bodyText = '';
  const offsets = new Map();
  const indexText = (node) => {
    const start = bodyText.length;
    if (node.nodeName === '#text') bodyText += node.value;
    for (const child of node.childNodes ?? []) indexText(child);
    offsets.set(node, { start, end: bodyText.length });
  };
  indexText(body);

  const nodesByUnderlineId = new Map();
  const nodesBySectionId = new Map();
  const verseEnds = [];
  visit(body, (node) => {
    const underlineId = node.attrs?.find((attribute) => attribute.name === 'data-underline-id')?.value;
    if (underlineId) nodesByUnderlineId.set(underlineId, node);
    const sectionId = node.attrs?.find((attribute) => attribute.name === 'data-reader-section')?.value;
    if (sectionId) nodesBySectionId.set(sectionId, node);
    if (node.tagName === 'sup') {
      const verse = Number(decodeDigits(innerText(node)).trim());
      if (Number.isInteger(verse)) verseEnds.push({ end: offsets.get(node).end, verse });
    }
  });

  for (const underline of data.underlines) {
    const node = nodesByUnderlineId.get(underline.id);
    assert(node, `Missing rendered underline ${underline.id} in ${file}`);
    const text = plainText(node);
    const location = offsets.get(node);
    assert(sourceUnderlines.has(underline.id), `Missing source phrase for ${underline.id} in ${file}`);
    underline.sourceText = sourceUnderlines.get(underline.id);
    underline.text = text;
    underline.textHash = createHash('sha256').update(text).digest('hex');
    underline.selector = selectorPath(node);
    underline.start = location.start;
    underline.end = location.end;
    underline.verse = verseEnds.find((marker) => marker.end >= location.start)?.verse ?? verseEnds.at(-1)?.verse ?? 1;
  }
  for (const section of data.sections) {
    const node = nodesBySectionId.get(section.id);
    assert(node, `Missing rendered section ${section.id} in ${file}`);
    section.selector = selectorPath(node);
    section.excerpt = excerpt(plainText(node));
  }
  data.sourceHash = createHash('sha256').update(html).digest('hex');
  await writeFile(sidecarFile, `${JSON.stringify(data, null, 2)}\n`);
}

function verifyPageTranslations(html, chapterId, translations, expectedVerseCount) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const actual = [];
  let started = false;
  let current = '';
  let firstMarker = null;
  visit(document, (node) => { if (!firstMarker && node.tagName === 'sup') firstMarker = node; });
  assert(firstMarker, `No verse markers in chapter ${chapterId}`);
  const firstScope = initialVerseScope(firstMarker);
  const walk = (node) => {
    if (node === firstScope) started = true;
    const classes = classNames(node);
    if (!started && node.tagName === 'p' && classes.some((name) => name.startsWith('verse-centered--')) && !containsVerseMarker(node)) return;
    if (node.tagName === 'span' && classes.some((name) => name.startsWith('text-font--')) && !containsVerseMarker(node)) return;
    if (node.tagName === 'sup') {
      actual.push(current.replace(/\s+/gu, ' ').trim());
      current = '';
      started = true;
      return;
    }
    if (node.nodeName === '#text') {
      if (started) current += node.value;
      return;
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(document);
  assert.equal(actual.length, expectedVerseCount, `Rendered verse count mismatch in chapter ${chapterId}`);
  for (const [index, text] of actual.entries()) {
    const expected = translations.get(`${chapterId}:${index + 1}`).replace(/\s+/gu, ' ').trim();
    assert.equal(text, expected, `Rendered translation mismatch at ${chapterId}:${index + 1}`);
  }
  assert.equal(current.trim(), '', `Unexpected unnumbered text after the final verse in chapter ${chapterId}`);
}

function reportHtml(stats, sourceHash) {
  const rows = stats.pages.map((page) => `<tr><td>${persianDigits(page.chapter)}</td><td>${escapeHtml(page.name)}</td><td>${persianDigits(page.verses)}</td><td>${persianDigits(page.underlines)}</td><td>${persianDigits(page.quotes)}</td><td>${persianDigits(page.sections)}</td><td>${persianDigits(page.bullets)}</td><td>${persianDigits(page.markerCorrections)}</td></tr>`).join('\n');
  const markerRows = stats.markerFixes.map((fix) => `<li>سورهٔ ${persianDigits(fix.chapter)}، آیهٔ ${persianDigits(fix.verse)}: برچسب ${persianDigits(fix.sourceLabel)} به ${persianDigits(fix.correctedLabel)} اصلاح شد تا با ترتیب آیات XML منطبق باشد.</li>`).join('\n');
  const alignmentRows = stats.manualAlignments.map((alignment) => `<li>سورهٔ ${persianDigits(alignment.chapter)}، آیهٔ ${persianDigits(alignment.verse)}، شناسهٔ <code>${alignment.id}</code>: «${escapeHtml(alignment.source)}» با «${escapeHtml(alignment.target)}» هم‌تراز شد.</li>`).join('\n');
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>گزارش تغییرات نسخه فارسی</title>
  <style>
    :root { color-scheme: light; font-family: Tahoma, sans-serif; color: #242824; background: #f5f4ed; }
    body { max-width: 1100px; margin: 0 auto; padding: 32px 20px; line-height: 1.8; }
    h1, h2 { color: #174e43; }
    section { border-top: 1px solid #aeb8ac; padding: 18px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 6px 9px; border-bottom: 1px solid #d5d8ce; text-align: right; }
    th { background: #e5e9dd; }
    code { direction: ltr; unicode-bidi: isolate; }
    a { color: #185f56; }
  </style>
</head>
<body>
  <h1>گزارش تغییرات خوانش فارسی قرآن</h1>
  <section><h2>منبع و دامنه</h2>
    <p>مترجم: حسین انصاریان. منبع داده: فایل XML «Persian-Hussayn-Ansarian.xml»، بستهٔ AlQuraan در SourceForge (شناسهٔ ترجمهٔ ۷۴). واژه‌های ترجمه حفظ شدند؛ فاصله‌گذاری و نشانه‌گذاری چند آیهٔ بقره برای خوانایی اصلاح شد، بدون تغییر معنای ترجمه.</p>
    <p><a href="https://sourceforge.net/projects/alquraan/files/Translations_Single_Package/Persian-Hussayn-Ansarian.zip/download">دریافت بستهٔ XML</a> | <a href="https://download.ghbook.ir/downloads.php?id=2654&amp;file=2654-f-13900322-tarjome-qoran-karim-ostad-ansariyan.htm&amp;packagename=ir.ghbook.reader&amp;platform=site">مشخصات کتاب در کتابخانهٔ غدیر</a></p>
    <p>مشخصات نشر ثبت‌شده: تهران، سازمان دارالقرآن کریم، نشر تلاوت، ۱۳۹۳؛ شابک 978-600-5562-67-5. فایل XML مجوز بازنشر مستقلی اعلام نمی‌کند؛ استفاده از متن برای این پروژه با اجازهٔ اعلام‌شدهٔ کاربر انجام شده است.</p>
    <p>SHA-256 فایل منبع: <code>${sourceHash}</code></p>
  </section>
  <section><h2>تغییرات انجام‌شده</h2>
    <ol>
      <li>یک نسخهٔ مستقل از reader بتا در پوشهٔ <code>interactive_farsi</code> ساخته شد؛ پوشه‌های اصلی و نسخه‌های دیگر تغییر نکردند.</li>
      <li>۱۱۴ سوره و ۶٬۲۳۶ آیه با تطبیق شناسهٔ سوره و شمارهٔ آیه جایگزین شدند؛ هر دو مجموعه شمارش و توالی کامل دارند.</li>
      <li>زبان سند به فارسی تغییر کرد و جهت راست‌به‌چپ حفظ شد.</li>
      <li>${persianDigits(stats.basmalaHeaders)} بسملهٔ بی‌شمارهٔ آغاز سوره‌ها به ترجمهٔ منبع تبدیل شد؛ آیهٔ ۱ فاتحه به‌عنوان آیهٔ شماره‌دار از XML وارد شد و توبه بسملهٔ آغازین ندارد.</li>
      <li>کلاس‌های چیدمان پاراگراف، نشانه‌های فهرست، خطوط عمودی و سر/پایان آن‌ها، شناسه‌ها و گروه‌های ذخیره‌شده حفظ شدند.</li>
      <li>در این نسخه فقط، عرض ثابت ۱۹۰ میلی‌متری و عرض/حاشیهٔ تو‌رفتگی‌ها در صفحه‌نمایش‌های کوچک محدود شد؛ نسخه‌های اصلی دست‌نخورده ماندند.</li>
      <li>برای حفظ قابلیت‌های بصری annotation، بیشتر مرزهای زیرخط و گفتار از متن عربی به نزدیک‌ترین مرز واژه در متن فارسی نگاشت شدند. این نگاشت هندسی است و بازبینی معناییِ کامل محسوب نمی‌شود؛ مرزهای فهرست‌شده در پایین به‌صورت دستی هم‌تراز شدند.</li>
      <li>عبارت عربیِ هر زیرخط در کنار متن فارسی و checksum آن در sidecar سوره نگهداری شد؛ جفت بودن نشانه‌های باز و بستهٔ گفتار نیز هنگام واردسازی کنترل شد.</li>
      <li>${persianDigits(stats.manualAlignments.length)} مرز زیرخط به‌صورت عبارت‌به‌عبارت بازبینی و هم‌تراز شد:
        <ul>${alignmentRows}</ul>
      </li>
      <li>${persianDigits(baqarahSpeechAlignments.length)} مرز گفتار در بقره با عبارت فارسی مربوط هم‌تراز شد؛ دیگر مرزهای گفتار همچنان نگاشت هندسی دارند.</li>
      <li>${persianDigits(stats.markerFixes.length)} شمارهٔ نادرست در نشانگرهای آیه بر اساس ترتیب XML اصلاح شد:
        <ul>${markerRows || '<li>هیچ‌کدام.</li>'}</ul>
      </li>
      <li>اصلاحات متن بقره به فاصله‌گذاری، نشانه‌گذاری و براکت‌های توضیحی محدود است؛ واژه‌های ترجمه و معنای آن تغییر نکرده‌اند.</li>
    </ol>
  </section>
  <section><h2>پوشش سوره‌ها</h2>
    <table><thead><tr><th>شماره</th><th>نام منبع</th><th>آیه</th><th>مرز زیرخط</th><th>نشانهٔ گفتار</th><th>بخش تودرتو</th><th>فهرست</th><th>اصلاح شماره</th></tr></thead><tbody>${rows}</tbody></table>
  </section>
</body>
</html>
`;
}

const source = await readFile(sourcePath, 'utf8');
const { translations, verseCounts, chapterNames } = parseTranslation(source);
const sourceHash = createHash('sha256').update(source).digest('hex');
const reportOnly = process.argv.includes('--report-only');
const requestedChapter = process.argv.find((argument) => argument.startsWith('--chapter='))?.slice(10);
if (requestedChapter !== undefined) {
  assert(/^\d+$/.test(requestedChapter) && Number(requestedChapter) >= 1 && Number(requestedChapter) <= 114, `Invalid chapter selection: ${requestedChapter}`);
}
assert(!(reportOnly && requestedChapter !== undefined), '--report-only cannot be combined with --chapter');
const files = (await readdir(surahPath)).filter((file) => /^\d{3}_.+\.html$/.test(file)).sort();
assert.equal(files.length, 114, 'Expected 114 surah HTML pages');

const stats = { pages: [], totalVerses: 0, basmalaHeaders: 0, markerFixes: [], manualAlignments: [] };
for (const file of files) {
  const chapterId = Number(file.slice(0, 3));
  if (requestedChapter !== undefined && chapterId !== Number(requestedChapter)) continue;
  const sourceHtml = await readFile(path.join(betaSurahPath, file), 'utf8');
  let html = sourceHtml;
  const markerFixes = [];
  const manualAlignments = [];
  const result = transformPage(html, chapterId, translations, verseCounts[chapterId - 1], markerFixes, manualAlignments);
  const edits = [...result.edits];
  const document = parse(html, { sourceCodeLocationInfo: true });
  const paragraphs = [];
  let firstMarker;
  visit(document, (node) => {
    if (node.tagName === 'p') paragraphs.push(node);
    if (!firstMarker && node.tagName === 'sup') firstMarker = node;
  });
  assert(firstMarker, `No verse markers in chapter ${chapterId}`);
  const firstVerseStart = firstMarker.sourceCodeLocation.startOffset;
  for (const paragraph of paragraphs) {
    const markers = [];
    visit(paragraph, (node) => { if (node.tagName === 'sup') markers.push(node); });
    if (!markers.length
      && (paragraph.sourceCodeLocation.endTag?.endOffset ?? paragraph.sourceCodeLocation.endOffset) <= firstVerseStart
        && classNames(paragraph).some((name) => name.startsWith('verse-centered--'))) {
      const currentText = innerText(paragraph).trim();
      const basmala = translations.get('1:1');
      if (/\p{Script=Arabic}/u.test(currentText)) {
        edits.push({ start: paragraph.sourceCodeLocation.startTag.endOffset, end: paragraph.sourceCodeLocation.endTag.startOffset, value: escapeHtml(basmala) });
        stats.basmalaHeaders++;
      }
    }
  }
  const verseCount = verseCounts[chapterId - 1];
  const { underlineCount, quoteCount, bulletCount } = result;
  assert.equal(verseCount, verseCounts[chapterId - 1], `Verse count mismatch for chapter ${chapterId}`);
  for (const edit of edits.sort((first, second) => second.start - first.start)) {
    html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  }
  if (chapterId === 2) html = alignBaqarahSpeech(html);
  verifyPageTranslations(html, chapterId, translations, verseCount);
  if (!reportOnly) {
    await writeFile(path.join(surahPath, file), html);
    await updateSidecar(file, html, sourceHtml);
  }
  stats.totalVerses += verseCount;
  stats.markerFixes.push(...markerFixes);
  stats.manualAlignments.push(...manualAlignments);
  stats.pages.push({ chapter: chapterId, name: chapterNames[chapterId - 1], verses: verseCount, underlines: underlineCount, quotes: quoteCount, sections: result.sectionCount, bullets: bulletCount, markerCorrections: markerFixes.length });
}

if (requestedChapter === undefined) {
  assert.equal(stats.totalVerses, 6236, 'Imported verse total does not match the source');
  await writeFile(path.join(root, 'translation-changes.html'), reportHtml(stats, sourceHash));
}
console.log(reportOnly
  ? `Generated the change report for ${stats.totalVerses} Ansarian verses across ${stats.pages.length} surahs.`
  : `Imported ${stats.totalVerses} Ansarian verses across ${stats.pages.length} surah${stats.pages.length === 1 ? '' : 's'}.`);