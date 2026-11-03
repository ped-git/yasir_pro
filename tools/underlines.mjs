import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { format } from 'prettier';

function colorName(value) {
  const channels = valueParser(value).nodes.filter((node) => node.type === 'word').map((node) => Number(node.value));
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) return value;
  if (channels.every((channel) => channel === channels[0])) return `gray-${channels[0]}`;
  const maximum = Math.max(...channels);
  const family = ['red', 'green', 'blue'][channels.indexOf(maximum)];
  return `${family}-${channels.join('-')}`;
}

function token(value) {
  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type === 'function' && node.value === 'rgb') {
      node.type = 'word';
      node.value = colorName(valueParser.stringify(node.nodes));
      delete node.nodes;
    }
  });
  return parsed.toString().trim()
    .replace(/(^|[\s,(])-([\d.])/g, '$1minus-$2')
    .replace(/\./g, 'p')
    .replace(/%/g, 'pct')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function words(value) {
  return valueParser(value).nodes.filter((node) => node.type !== 'space' && node.type !== 'comment').map((node) => valueParser.stringify(node));
}

function borderProperties(value) {
  let width = 'medium';
  let pattern = 'none';
  let color = 'currentColor';
  for (const part of words(value)) {
    if (/^(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/.test(part)) pattern = part;
    else if (/^(thin|medium|thick|0|[\d.]+(?:px|mm|em|rem|pt))$/.test(part)) width = part;
    else color = part;
  }
  return { 'border-bottom-width': width, 'border-bottom-style': pattern, 'border-bottom-color': color };
}

function decorationProperties(value) {
  const properties = {
    'text-decoration-line': 'none',
    'text-decoration-style': 'solid',
    'text-decoration-color': 'currentColor',
    'text-decoration-thickness': 'auto',
  };
  const lines = [];
  for (const part of words(value)) {
    if (/^(none|underline|overline|line-through|blink)$/.test(part)) lines.push(part);
    else if (/^(solid|double|dotted|dashed|wavy)$/.test(part)) properties['text-decoration-style'] = part;
    else if (/^(auto|from-font|[\d.]+(?:px|mm|em|rem|pt|%))$/.test(part)) properties['text-decoration-thickness'] = part;
    else properties['text-decoration-color'] = part;
  }
  if (lines.length) properties['text-decoration-line'] = lines.join(' ');
  return properties;
}

function paddingProperties(value) {
  const parts = words(value);
  if (parts.length > 4 || parts.some((part) => /^-\d/.test(part))) return { padding: value };
  const [top, right = top, bottom = top, left = right] = parts;
  return { 'padding-top': top, 'padding-right': right, 'padding-bottom': bottom, 'padding-left': left };
}

export function decomposeUnderline(rule, registry = new Map()) {
  const properties = new Map();
  for (const declaration of rule.nodes) {
    if (declaration.type !== 'decl') continue;
    assert(!declaration.important, 'Underline !important declarations need an explicit precedence strategy');
    let expanded = { [declaration.prop]: declaration.value };
    if (declaration.prop === 'border-bottom') expanded = borderProperties(declaration.value);
    if (declaration.prop === 'padding') expanded = paddingProperties(declaration.value);
    if (declaration.prop === 'text-decoration') expanded = decorationProperties(declaration.value);
    for (const [property, value] of Object.entries(expanded)) properties.set(property, value);
  }
  const classes = ['underline'];
  const register = (name, declarations) => {
    const signature = JSON.stringify(declarations);
    if (registry.has(name)) assert.equal(registry.get(name).signature, signature, `Utility name collision: ${name}`);
    else registry.set(name, { signature, declarations });
    classes.push(name);
  };
  if (['left', 'right', 'top'].every((side) => /^0(?:mm|px)?$/.test(properties.get(`border-${side}`) ?? ''))) {
    register('ul-sides-open', { 'border-left': '0', 'border-right': '0', 'border-top': '0' });
    for (const side of ['left', 'right', 'top']) properties.delete(`border-${side}`);
  }
  for (const [axis, sides] of [['y', ['top', 'bottom']], ['x', ['left', 'right']]]) {
    const value = properties.get(`padding-${sides[0]}`);
    if (value !== undefined && value === properties.get(`padding-${sides[1]}`)) {
      register(`ul-pad-${axis}-${token(value)}`, Object.fromEntries(sides.map((side) => [`padding-${side}`, value])));
      for (const side of sides) properties.delete(`padding-${side}`);
    }
  }
  const names = {
    'border-bottom-width': 'thickness',
    'border-bottom-style': 'pattern',
    'border-bottom-color': 'color',
    'border-image-slice': 'image-slice',
    'text-decoration-line': 'decoration-line',
    'text-decoration-style': 'decoration-pattern',
    'text-decoration-color': 'decoration-color',
    'text-decoration-thickness': 'decoration-thickness',
    'text-underline-offset': 'decoration-offset',
    'padding-top': 'pad-top',
    'padding-right': 'pad-right',
    'padding-bottom': 'pad-bottom',
    'padding-left': 'pad-left',
  };
  for (const [property, value] of properties) {
    if (property === 'border-image') {
      const gradient = valueParser(value).nodes.find((node) => node.type === 'function' && node.value === 'linear-gradient');
      assert(gradient, `Unsupported underline border image: ${value}`);
      const firstComma = gradient.nodes.findIndex((node) => node.type === 'div' && node.value === ',');
      const direction = valueParser.stringify(gradient.nodes.slice(0, firstComma)).trim();
      const stops = valueParser.stringify(gradient.nodes.slice(firstComma + 1)).trim().replace(/\s+/g, ' ');
      register('ul-image-gradient', { 'border-image': 'linear-gradient(var(--ul-gradient-direction), var(--ul-gradient-stops))' });
      register(`ul-gradient-${token(direction)}`, { '--ul-gradient-direction': direction });
      register(`ul-stops-${token(stops)}`, { '--ul-gradient-stops': stops });
    } else if (property === 'background-image') {
      assert(value.includes('linear-gradient(-45deg') && value.includes('linear-gradient(45deg'), `Unsupported underline background: ${value}`);
      register('ul-zigzag-gray-150', { [property]: value.replace(/\s+/g, ' ') });
    } else {
      register(`ul-${names[property] ?? property}-${token(value)}`, { [property]: value });
    }
  }
  return classes;
}

export function underlineStylesheet(registry) {
  const root = postcss.root();
  const base = postcss.rule({ selector: '.annotation.underline' });
  base.append({ prop: '--ul-gradient-direction', value: 'initial' });
  base.append({ prop: '--ul-gradient-stops', value: 'initial' });
  root.append(base);
  for (const [name, { declarations }] of [...registry].sort(([first], [second]) => first.localeCompare(second))) {
    const rule = postcss.rule({ selector: `.annotation.${name}` });
    for (const [property, value] of Object.entries(declarations)) rule.append({ prop: property, value });
    root.append(rule);
  }
  return root.toString();
}

export async function modularizeUnderlines(directory, pages) {
  const registry = new Map();
  const stylesheets = new Map();
  const pageMaps = {};
  const legacyPattern = /^\.annotation\.(underline-[a-zA-Z0-9-]+)$/;
  const loadStylesheet = async (file, ancestors = new Set()) => {
    assert(!ancestors.has(file), `Stylesheet import cycle: ${file}`);
    if (!stylesheets.has(file)) {
      try {
        stylesheets.set(file, postcss.parse(await readFile(file, 'utf8')));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    }
    const root = stylesheets.get(file);
    const rules = [];
    for (const node of root.nodes) {
      if (node.type === 'atrule' && node.name === 'import') {
        const parameter = valueParser(node.params).nodes.find((entry) => entry.type !== 'space');
        const target = parameter.type === 'function' ? parameter.nodes.find((entry) => entry.type === 'string' || entry.type === 'word').value : parameter.value;
        const inherited = new Set([...ancestors, file]);
        rules.push(...await loadStylesheet(path.resolve(path.dirname(file), target), inherited));
      } else if (node.type === 'rule' && legacyPattern.test(node.selector)) {
        rules.push(node);
      } else if (node.type === 'atrule' && node.nodes) {
        node.walkRules((rule) => assert(!legacyPattern.test(rule.selector), `Conditional underline needs explicit handling: ${file}`));
      }
    }
    return rules;
  };
  const walk = (node, callback) => {
    callback(node);
    for (const child of node.childNodes ?? []) walk(child, callback);
  };
  for (const file of pages) {
    const filename = path.join(directory, file);
    let html = await readFile(filename, 'utf8');
    const document = parse(html, { sourceCodeLocationInfo: true });
    const links = [];
    walk(document, (node) => {
      if (node.tagName !== 'link') return;
      const attributes = Object.fromEntries(node.attrs.map((attribute) => [attribute.name, attribute.value]));
      if (attributes.rel === 'stylesheet') links.push({ node, href: attributes.href });
    });
    const ruleGroups = new Map();
    for (const { href } of links) {
      for (const rule of await loadStylesheet(path.resolve(path.dirname(filename), href))) {
        const name = rule.selector.match(legacyPattern)[1];
        if (!ruleGroups.has(name)) ruleGroups.set(name, postcss.rule({ selector: rule.selector }));
        ruleGroups.get(name).append(rule.nodes.map((node) => node.clone()));
      }
    }
    const replacements = new Map([...ruleGroups].map(([name, rule]) => [name, decomposeUnderline(rule, registry)]));
    const used = {};
    const edits = [];
    let headEnd;
    walk(document, (node) => {
      if (node.tagName === 'head') headEnd = node.sourceCodeLocation?.endTag?.startOffset;
      const attribute = node.attrs?.find((entry) => entry.name === 'class');
      if (!attribute) return;
      const classes = attribute.value.split(/\s+/).filter(Boolean);
      if (!classes.some((name) => replacements.has(name))) return;
      const rewritten = classes.flatMap((name) => {
        if (!replacements.has(name)) return [name];
        used[name] = replacements.get(name);
        return used[name];
      });
      const location = node.sourceCodeLocation.attrs.class;
      edits.push({ start: location.startOffset, end: location.endOffset, value: `class="${rewritten.join(' ')}"` });
    });
    if (edits.length) {
      const beforeInline = links.find(({ href }) => href.endsWith('/inline.css'))?.node.sourceCodeLocation.startOffset;
      const offset = beforeInline ?? headEnd;
      assert(offset !== undefined, `Missing stylesheet insertion point: ${file}`);
      const href = path.posix.relative(path.posix.dirname(file), 'styles/underlines.css');
      edits.push({ start: offset, end: offset, value: `<link rel="stylesheet" href="${href}">\n  ` });
    }
    for (const edit of edits.sort((first, second) => second.start - first.start)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
    await writeFile(filename, html);
    pageMaps[file] = used;
  }
  let removed = 0;
  for (const [file, root] of stylesheets) {
    let changed = false;
    root.walkRules((rule) => {
      if (!legacyPattern.test(rule.selector)) return;
      rule.remove();
      removed++;
      changed = true;
    });
    if (changed) await writeFile(file, await format(root.toString(), { parser: 'css', tabWidth: 2, printWidth: 100 }));
  }
  await writeFile(path.join(directory, 'styles/underlines.css'), await format(underlineStylesheet(registry), { parser: 'css', tabWidth: 2, printWidth: 100 }));
  await writeFile(path.join(directory, 'tools/underline-map.json'), `${JSON.stringify(pageMaps, null, 2)}\n`);
  console.log(`Replaced ${removed} compound underline rules with ${registry.size} independent property modules.`);
}