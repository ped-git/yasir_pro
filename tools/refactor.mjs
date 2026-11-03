import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';
import { format } from 'prettier';
import { modularizeUnderlines } from './underlines.mjs';

const destination = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(destination, '../yasir');

async function listFiles(directory, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.DS_Store') continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(directory, name));
    else files.push(name);
  }
  return files.sort();
}

function visit(node, callback) {
  callback(node);
  for (const child of node.childNodes ?? []) visit(child, callback);
  if (node.content) visit(node.content, callback);
}

async function audit() {
  const files = await listFiles(source);
  const classes = new Set();
  const sheets = new Map();
  const report = { files: files.length, html: 0, css: 0, inlineStyles: 0, styleBlocks: 0, scripts: 0 };
  for (const file of files) {
    if (file.endsWith('.html')) {
      report.html++;
      visit(parse(await readFile(path.join(source, file), 'utf8')), (node) => {
        if (node.tagName === 'script') report.scripts++;
        if (node.tagName === 'style') report.styleBlocks++;
        for (const attribute of node.attrs ?? []) {
          if (attribute.name === 'class') attribute.value.split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
          if (attribute.name === 'style') report.inlineStyles++;
        }
      });
    } else if (file.endsWith('.css')) {
      report.css++;
      const text = await readFile(path.join(source, file), 'utf8');
      const fingerprint = createHash('sha256').update(text).digest('hex');
      sheets.set(fingerprint, [...(sheets.get(fingerprint) ?? []), file]);
      postcss.parse(text).walkRules((rule) => {
        selectorParser((selectors) => selectors.walkClasses((node) => classes.add(node.value))).processSync(rule.selector);
      });
    }
  }
  console.log(JSON.stringify({ ...report, uniqueStylesheets: sheets.size, classes: [...classes].sort(), stylesheetGroups: [...sheets.values()].map((group) => ({ count: group.length, example: group[0] })) }, null, 2));
}

const classNames = new Map();
const inlineRules = new Map();
const originalHashes = {};

function fingerprint(text) {
  return createHash('sha256').update(text).digest('hex');
}

function renameClass(name) {
  if (classNames.has(name)) return classNames.get(name);
  const exact = {
    'ordinary-far': 'verse-paragraph--spaced',
    'ordinary-near': 'verse-paragraph--compact',
    container: 'verse-group',
    boxed: 'annotation',
    boxed3: 'annotation--variant-3',
    square: 'border-horizontal',
    header: 'print-header',
    content: 'print-content',
    'my-inline-block': 'print-page-spacer',
    notsure: 'annotation-uncertain',
    far: 'spacing-expanded',
    hero: 'guide-header',
    card: 'guide-example',
    grid: 'guide-examples',
    guide: 'reading-guide',
    note: 'guide-note',
    sample: 'guide-sample',
    contrast: 'guide-contrast',
    signs: 'guide-signs',
    speech: 'guide-speech',
    symbol: 'guide-symbol',
    uncertain: 'guide-uncertainty',
    closing: 'guide-closing',
    solid: 'border-solid',
    dashed: 'border-dashed',
    dotted: 'border-dotted',
    green: 'color-green',
    red: 'color-red',
    gray: 'color-gray',
    'dashed3side': 'border-three-sided--dashed',
    'inline-line': 'annotation-inline-line',
  };
  let renamed = exact[name];
  if (!renamed) {
    renamed = name
      .replace(/^inner-paragraph-/, 'verse-indent-')
      .replace(/^zero-margin/, 'spacing-reset')
      .replace(/^backhighlight/, 'background-highlight')
      .replace(/^highlight/, 'text-highlight')
      .replace(/^boxed-/, 'border-')
      .replace(/^thin-vertical-line-/, 'connection-line--thin-')
      .replace(/^vertical-line-/, 'connection-line--')
      .replace(/solid(green|red|blue|yellow)/g, 'solid-$1')
      .replace(/dotted(green|red)/g, 'dotted-$1')
      .replace(/(black|green)dotted/g, '$1-dotted')
      .replace(/blackdashed/g, 'black-dashed')
      .replace(/gradient(green|red|gray)/g, 'gradient-$1')
      .replace(/gradientsym/g, 'gradient-symmetric')
      .replace(/gradientrev/g, 'gradient-reverse')
      .replace(/gradientfar/g, 'gradient-spaced')
      .replace(/gradientdotted/g, 'gradient-dotted')
      .replace(/gradblue/g, 'gradient-blue')
      .replace(/dashedgreen/g, 'dashed-green')
      .replace(/dashedred/g, 'dashed-red')
      .replace(/dashedbold/g, 'dashed-bold')
      .replace(/threerev/g, 'three-reverse')
      .replace(/threeback/g, 'three-back')
      .replace(/greenrev/g, 'green-reverse')
      .replace(/redrev/g, 'red-reverse')
      .replace(/-veryfar/g, '--extra-spaced')
      .replace(/-far2/g, '--spaced-2')
      .replace(/-far/g, '--spaced')
      .replace(/-near2/g, '--compact-2')
      .replace(/-near/g, '--compact')
      .replace(/([a-z])(\d+)/g, '$1-$2');
    if (renamed.startsWith('top-')) renamed = `connection-cap--${renamed}`;
    if (renamed.startsWith('bottom-')) renamed = `connection-cap--${renamed}`;
  }
  if ([...classNames.values()].includes(renamed)) {
    renamed += `--${fingerprint(name).slice(0, 6)}`;
  }
  classNames.set(name, renamed);
  return renamed;
}

function rewriteSelectors(root) {
  root.walkRules((rule) => {
    rule.selector = selectorParser((selectors) => {
      selectors.walkClasses((node) => { node.value = renameClass(node.value); });
      selectors.walkAttributes((node) => {
        if (node.attribute === 'class' && node.value) {
          node.setValue(node.value.split(/\s+/).map(renameClass).join(' '));
        }
      });
    }).processSync(rule.selector);
  });
  return root;
}

function rebaseUrls(root, originalFile) {
  root.walkDecls((declaration) => {
    const value = valueParser(declaration.value);
    value.walk((node) => {
      if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return;
      const target = node.nodes.find((child) => child.type === 'string' || child.type === 'word');
      if (!target || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(target.value)) return false;
      const resolved = new URL(target.value, `https://yasir.invalid/${originalFile}`);
      target.value = `${path.posix.relative('styles', decodeURIComponent(resolved.pathname.slice(1)))}${resolved.search}${resolved.hash}`;
      return false;
    });
    declaration.value = value.toString();
  });
  return root;
}

async function save(relative, content) {
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function saveCss(relative, content) {
  await save(relative, await format(content, { parser: 'css', tabWidth: 2, printWidth: 100 }));
}

function attributeValue(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('\u00a0', '&nbsp;');
}

function styleName(style, node) {
  const properties = new Map();
  postcss.parse(`x { ${style} }`).first.walkDecls((declaration) => properties.set(declaration.prop, declaration.value));
  let family = 'text-format';
  if (properties.has('margin-right') || properties.has('margin-left') || properties.has('margin')) family = 'text-spacing';
  if (node.tagName === 'p') family = 'verse-layout';
  if (node.tagName === 'p' && properties.get('text-align') === 'center') family = 'verse-centered';
  if (node.tagName === 'p' && properties.has('background-color')) family = 'surah-heading';
  if (node.tagName === 'body') family = 'page-layout';
  if (properties.has('color')) family = 'text-color';
  if (properties.has('border') || [...properties.keys()].some((name) => name.startsWith('border-'))) family = 'annotation-format';
  if (properties.has('font-family')) family = 'text-font';
  if (properties.has('display')) family = 'display-format';
  if (properties.has('position')) family = 'position-format';
  return `${family}--${fingerprint(style).slice(0, 8)}`;
}

async function refactorHtml(file, text) {
  const document = parse(text, { sourceCodeLocationInfo: true });
  const edits = [];
  const relativeStyles = path.posix.relative(path.posix.dirname(file), 'styles') || '.';
  let embeddedIndex = 0;
  let headEnd;
  let hasInlineStyles = false;
  visit(document, (node) => {
    const location = node.sourceCodeLocation;
    if (node.tagName === 'head') headEnd = location?.endTag?.startOffset;
    if (!location?.startTag) return;
    if (node.tagName === 'style') {
      const css = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
      const name = `${path.basename(file, '.html')}${embeddedIndex++ ? `-${embeddedIndex}` : ''}.css`;
      const attributes = node.attrs.filter((attribute) => attribute.name !== 'type');
      edits.push({
        start: location.startOffset,
        end: location.endOffset,
        value: `<link rel="stylesheet" href="${relativeStyles}/${name}"${attributes.map((attribute) => ` ${attribute.name}="${attributeValue(attribute.value)}"`).join('')}>`,
      });
      node.extractedCss = { name, css };
      return;
    }
    const attributes = node.attrs.map((attribute) => ({ ...attribute }));
    const classes = attributes.find((attribute) => attribute.name === 'class');
    if (classes) classes.value = classes.value.split(/\s+/).filter(Boolean).map(renameClass).join(' ');
    const inline = attributes.find((attribute) => attribute.name === 'style');
    if (inline) {
      hasInlineStyles = true;
      const rebased = rebaseUrls(postcss.parse(`x { ${inline.value} }`), file).first.nodes.map((node) => node.toString()).join(';');
      let entry = inlineRules.get(rebased);
      if (!entry) {
        entry = { name: styleName(rebased, node), css: rebased };
        inlineRules.set(rebased, entry);
      }
      if (classes) classes.value += ` ${entry.name}`;
      else attributes.push({ name: 'class', value: entry.name });
      attributes.splice(attributes.indexOf(inline), 1);
    }
    edits.push({
      start: location.startTag.startOffset,
      end: location.startTag.endOffset,
      value: `<${node.tagName}${attributes.map((attribute) => ` ${attribute.name}="${attributeValue(attribute.value)}"`).join('')}>`,
    });
  });
  const extracted = [];
  visit(document, (node) => { if (node.extractedCss) extracted.push(node.extractedCss); });
  for (const { name, css } of extracted) await saveCss(`styles/${name}`, rebaseUrls(rewriteSelectors(postcss.parse(css)), file).toString());
  if (hasInlineStyles) {
    if (headEnd === undefined) throw new Error(`Missing explicit head in ${file}`);
    edits.push({ start: headEnd, end: headEnd, value: `  <link rel="stylesheet" href="${relativeStyles}/inline.css">\n` });
  }
  for (const edit of edits.sort((first, second) => second.start - first.start)) {
    text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
  }
  await save(file, text);
}

async function shareStylesheets(stylesheets) {
  const trie = { children: new Map(), files: [] };
  const generated = new Set();
  for (const [file, css] of stylesheets) {
    let branch = trie;
    branch.files.push(file);
    for (const node of postcss.parse(css).nodes) {
      const content = await format(node.toString(), { parser: 'css', tabWidth: 2, printWidth: 100 });
      if (!branch.children.has(content)) branch.children.set(content, { children: new Map(), files: [] });
      branch = branch.children.get(content);
      branch.files.push(file);
    }
  }
  let modules = 0;
  async function emit(branch, imports = []) {
    let content = '';
    let cursor = branch;
    while (cursor.children.size === 1) {
      const [rule, child] = [...cursor.children][0];
      if (child.files.length !== cursor.files.length) break;
      content += `${rule}\n`;
      cursor = child;
    }
    let inherited = imports;
    if (content && cursor.files.length > 1) {
      const firstRule = postcss.parse(content).nodes.find((node) => node.type === 'rule');
      const label = (firstRule?.selector ?? 'base').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
      const moduleName = `shared/${label}-${fingerprint(content).slice(0, 8)}.css`;
      await saveCss(`Surah/Style_CSS/${moduleName}`, content);
      generated.add(path.basename(moduleName));
      inherited = [...imports, moduleName];
      content = '';
      modules++;
    }
    if (cursor.files.length === 1) {
      let remainder = cursor;
      while (remainder.children.size) {
        const [rule, child] = [...remainder.children][0];
        content += `${rule}\n`;
        remainder = child;
      }
      await saveCss(cursor.files[0], `${inherited.map((name) => `@import url("${name}");`).join('\n')}\n\n${content}`);
      return;
    }
    const continuing = new Set([...cursor.children.values()].flatMap((child) => child.files));
    for (const file of cursor.files.filter((name) => !continuing.has(name))) {
      await saveCss(file, `${inherited.map((name) => `@import url("${name}");`).join('\n')}\n${content}`);
    }
    for (const [rule, child] of cursor.children) {
      const wrapper = { files: child.files, children: new Map([[rule, child]]) };
      await emit(wrapper, inherited);
    }
  }
  await emit(trie);
  const sharedDirectory = path.join(destination, 'Surah/Style_CSS/shared');
  for (const file of await readdir(sharedDirectory)) {
    if (/-[a-f0-9]{8}\.css$/.test(file) && !generated.has(file)) await unlink(path.join(sharedDirectory, file));
  }
  return modules;
}

async function refactor() {
  const files = await listFiles(source);
  const stylesheets = new Map();
  let maximumIds = 0;
  for (const file of files) {
    const buffer = await readFile(path.join(source, file));
    originalHashes[file] = fingerprint(buffer);
    if (file.endsWith('.css')) {
      const root = rewriteSelectors(postcss.parse(buffer.toString()));
      root.walkRules((rule) => {
        let ids = 0;
        selectorParser((selectors) => selectors.walkIds(() => { ids++; })).processSync(rule.selector);
        maximumIds = Math.max(maximumIds, ids);
      });
      if (file.startsWith('Surah/Style_CSS/')) stylesheets.set(file, root.toString());
      else await saveCss(file, root.toString());
    } else if (!file.endsWith('.html')) {
      await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
      await copyFile(path.join(source, file), path.join(destination, file));
    }
  }
  for (const file of files.filter((name) => name.endsWith('.html'))) {
    await refactorHtml(file, await readFile(path.join(source, file), 'utf8'));
  }
  const specificity = ':not(#yasir-pro-reserved-inline-specificity)'.repeat(maximumIds + 1);
  const css = [...inlineRules.values()].map(({ name, css }) => `.${name}${specificity} {\n${css}\n}`).join('\n\n');
  await saveCss('styles/inline.css', css);
  for (const [file, css] of stylesheets) await saveCss(file, css);
  await modularizeUnderlines(destination, files.filter((file) => file.endsWith('.html')));
  for (const file of stylesheets.keys()) stylesheets.set(file, await readFile(path.join(destination, file), 'utf8'));
  const modules = await shareStylesheets(stylesheets);
  await save('tools/class-map.json', `${JSON.stringify(Object.fromEntries([...classNames].sort()), null, 2)}\n`);
  await save('tools/source-manifest.json', `${JSON.stringify(originalHashes, null, 2)}\n`);
  console.log(`Refactored ${files.filter((file) => file.endsWith('.html')).length} HTML pages and ${stylesheets.size + 1} stylesheets.`);
  console.log(`Extracted ${inlineRules.size} reusable style variants; shared ${modules} identical stylesheet prefixes.`);
}

if (process.argv.includes('--audit')) await audit();
else await refactor();