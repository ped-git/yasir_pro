import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

export function walk(node, callback) {
  callback(node);
  for (const child of node.childNodes ?? []) walk(child, callback);
}

export function attributes(node) {
  return Object.fromEntries((node.attrs ?? []).map((attribute) => [attribute.name, attribute.value]));
}

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function makeCatalog(dataRoot) {
  const index = JSON.parse(await readFile(path.join(dataRoot, 'data/catalog.json'), 'utf8'));
  const cache = new Map();
  const styles = new Map();
  const load = async (filename) => {
    if (cache.has(filename)) return cache.get(filename);
    let text;
    try { text = await readFile(filename, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const result = [];
    cache.set(filename, result);
    for (const node of postcss.parse(text).nodes) {
      if (node.type === 'atrule' && node.name === 'import') {
        const target = node.params.match(/["']([^"']+)["']/)?.[1];
        if (target) result.push(...await load(path.resolve(path.dirname(filename), target)));
      } else if (node.type === 'rule') result.push(node);
    }
    return result;
  };
  const matches = (selector, classes) => {
    let match = false;
    selectorParser((root) => root.each((branch) => {
      if (branch.nodes.every((node) => node.type === 'class' && classes.has(node.value) || node.type === 'pseudo' && node.value === ':not' && node.toString().includes('yasir-pro-reserved-inline-specificity'))) match = true;
    })).processSync(selector);
    return match;
  };
  const declarations = (rules, names) => rules.filter((rule) => matches(rule.selector, new Set(names))).flatMap((rule) => rule.nodes.filter((node) => node.type === 'decl').map((node) => node.toString()));
  const add = (kind, names, rules, extra = {}) => {
    const values = declarations(rules, names);
    if (!values.length) return;
    const css = values.join(';\n');
    const id = `edit-style-${digest(`${kind}|${css}|${JSON.stringify(extra)}`).slice(0, 12)}`;
    if (styles.has(id)) return;
    const color = values.findLast((value) => /(?:color|background|border-bottom):/.test(value))?.match(/#[a-fA-F0-9]{3,8}|rgba?\([^)]+\)|\b(?:red|green|blue|black|sandybrown)\b/)?.[0] ?? '#555';
    const pattern = names.find((name) => name.startsWith('ul-pattern-'))?.replace('ul-pattern-', '') ?? (names.some((name) => name.includes('wavy')) ? 'wavy' : names.some((name) => name.includes('gradient')) ? 'gradient' : kind);
    const label = kind === 'underline' ? names.filter((name) => /ul-(?:pattern|color|thickness|pad-y|gradient)/.test(name)).map((name) => name.replace(/^ul-/, '')).join(' / ') : names.join(' ');
    styles.set(id, { id, kind, label: label || pattern, color, pattern, sourceClasses: names, declarations: css, css: `.${id}:not(#edit-reserved) {\n${css};\n}`, ...extra });
  };
  for (const entry of index.pages) {
    const file = path.join(dataRoot, entry.page);
    const document = parse(await readFile(file, 'utf8'));
    const sheets = [];
    walk(document, (node) => {
      const attrs = attributes(node);
      if (node.tagName === 'link' && attrs.rel === 'stylesheet' && !attrs.href.includes('interactions.css') && !attrs.href.includes('editor-pages/')) sheets.push(path.resolve(path.dirname(file), attrs.href));
    });
    const rules = (await Promise.all(sheets.map(load))).flat();
    const data = JSON.parse(await readFile(path.join(dataRoot, entry.data), 'utf8'));
    for (const record of data.underlines) if (record.appearance?.signature) add('underline', ['annotation', 'underline', ...record.appearance.signature.split(' ')], rules);
    for (const rule of rules) {
      selectorParser((selectors) => selectors.walkClasses((node) => {
        const name = node.value;
        if (name.startsWith('connection-line--')) {
          const values = declarations(rules, [name]);
          const lineCss = values.join(';\n');
          const id = `edit-style-${digest(`vertical|${lineCss}`).slice(0, 12)}`;
          if (!styles.has(id)) styles.set(id, { id, kind: 'vertical', label: name.replace('connection-line--', ''), color: '#555', sourceClasses: [name], declarations: lineCss, css: `.${id}-line {\n${lineCss};\npointer-events:none;\n}\n.${id}-section {position:relative;}` });
        } else if (/^(?:text-highlight|background-highlight|color-|border-|annotation-uncertain|text-color|text-format|text-font|annotation-format|inferred-sign)/.test(name)) {
          const kind = /^(?:text-highlight|background-highlight)/.test(name) ? 'highlight' : 'effect';
          add(kind, /^(?:border-|annotation-uncertain)/.test(name) ? ['annotation', name] : [name], rules);
        }
      })).processSync(rule.selector);
    }
    walk(document, (node) => {
      const names = (attributes(node).class ?? '').split(/\s+/);
      const lineName = names.find((name) => name.startsWith('connection-line--'));
      if (!lineName) return;
      const ornaments = (node.parentNode.childNodes ?? []).filter((child) => (attributes(child).class ?? '').split(/\s+/).some((name) => name.startsWith('connection-cap--')));
      if (!ornaments.length) return;
      const nodeText = (element) => element.nodeName === '#text' ? element.value : (element.childNodes ?? []).map(nodeText).join('');
      const caps = ornaments.map((ornament) => {
        const sourceClasses = attributes(ornament).class.split(/\s+/);
        return { sourceClasses, text: nodeText(ornament), declarations: declarations(rules, sourceClasses).join(';\n'), bottom: sourceClasses.some((name) => name.startsWith('connection-cap--bottom')) };
      });
      const lineCss = declarations(rules, names).join(';\n');
      const id = `edit-style-${digest(`vertical|${lineCss}|${JSON.stringify(caps)}`).slice(0, 12)}`;
      if (styles.has(id)) return;
      const css = `.${id}-line {\n${lineCss};\npointer-events:none;\n}\n.${id}-section {position:relative;}\n` + caps.map((cap, index) => `.${id}-cap-${index} {\n${cap.declarations};\n}`).join('\n');
      styles.set(id, { id, kind: 'vertical', label: `${lineName.replace('connection-line--', '')} / ${caps[0].sourceClasses[0]}`, color: '#555', sourceClasses: names, declarations: lineCss, caps, css });
    });
  }
  return { pages: index.pages, styles: [...styles.values()].sort((first, second) => first.kind === 'vertical' && second.kind === 'vertical' ? Number(Boolean(second.caps)) - Number(Boolean(first.caps)) : 0) };
}