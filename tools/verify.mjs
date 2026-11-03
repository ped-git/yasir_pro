import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'parse5';
import { chromium } from 'playwright';

const destination = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(destination, '../yasir');
const tools = path.join(destination, 'tools');
const manifest = JSON.parse(await readFile(path.join(tools, 'source-manifest.json'), 'utf8'));
const classMap = JSON.parse(await readFile(path.join(tools, 'class-map.json'), 'utf8'));
const underlineMaps = JSON.parse(await readFile(path.join(tools, 'underline-map.json'), 'utf8'));
const knownClasses = new Set([...Object.values(classMap), ...Object.values(underlineMaps).flatMap((mapping) => Object.values(mapping).flat())]);
const pages = Object.keys(manifest).filter((file) => file.endsWith('.html')).sort();
const requested = process.argv.find((argument) => argument.startsWith('--page='))?.slice(7);
const selectedPages = requested ? pages.filter((file) => file.includes(requested)) : pages;
assert(selectedPages.length, 'No matching HTML pages');

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizedTree(node, original, inHead = false, underlineMap = {}) {
  if (node.tagName === 'style') return null;
  if (node.tagName === 'link' && node.attrs.some((attribute) => attribute.name === 'rel' && attribute.value === 'stylesheet')) return null;
  const head = inHead || node.tagName === 'head';
  if (head && node.nodeName === '#text' && !node.value.trim()) return null;
  const attributes = (node.attrs ?? [])
    .filter((attribute) => attribute.name !== 'style' && attribute.name !== 'class')
    .map((attribute) => [attribute.name, attribute.value]);
  const classes = node.attrs?.find((attribute) => attribute.name === 'class')?.value.split(/\s+/).filter(Boolean) ?? [];
  const originalClasses = original ? classes.flatMap((name) => underlineMap[classMap[name]] ?? [classMap[name]]) : classes.filter((name) => knownClasses.has(name));
  return {
    node: node.nodeName,
    value: node.value ?? node.data ?? null,
    attributes,
    classes: originalClasses,
    children: (node.childNodes ?? []).map((child) => normalizedTree(child, original, head, underlineMap)).filter((child) => child !== null),
    template: node.content ? normalizedTree(node.content, original, head, underlineMap) : null,
  };
}

async function staticChecks() {
  let assets = 0;
  for (const [file, expectedHash] of Object.entries(manifest)) {
    const original = await readFile(path.join(source, file));
    const actual = await readFile(path.join(destination, file));
    assert.equal(hash(original), expectedHash, `Original modified: ${file}`);
    if (!file.endsWith('.html') && !file.endsWith('.css')) {
      assert.equal(hash(actual), expectedHash, `Copied asset or backup differs: ${file}`);
      assets++;
    }
    if (file.endsWith('.html')) {
      const document = parse(actual.toString());
      assert.deepEqual(normalizedTree(document, false), normalizedTree(parse(original.toString()), true, false, underlineMaps[file]), `Content or structure changed: ${file}`);
      const checkStyles = (node) => {
        assert.notEqual(node.tagName, 'style', `Embedded CSS remains: ${file}`);
        assert(!node.attrs?.some((attribute) => attribute.name === 'style'), `Inline CSS remains: ${file}`);
        for (const child of node.childNodes ?? []) checkStyles(child);
      };
      checkStyles(document);
    }
  }
  console.log(`Static checks passed: ${Object.keys(manifest).length} original hashes, ${pages.length} unchanged content trees, ${assets} identical assets/backups, no inline CSS.`);
}

async function snapshot(page, detailed = false) {
  return page.evaluate(async (withDetails) => {
    const elements = [...document.body.querySelectorAll('*')];
    elements.unshift(document.documentElement, document.body);
    const styles = [];
    const geometry = [];
    const generated = [];
    const text = [];
    const range = document.createRange();
    const rectangle = (bounds) => [bounds.x, bounds.y, bounds.width, bounds.height];
    for (const element of elements) {
      const computed = getComputedStyle(element);
      styles.push([...computed].filter((property) => !property.startsWith('--ul-')).map((property) => [property, computed.getPropertyValue(property)]));
      geometry.push([element.tagName, rectangle(element.getBoundingClientRect()), element.scrollWidth, element.scrollHeight]);
      generated.push(['::before', '::after', '::marker'].map((pseudo) => {
        const computedPseudo = getComputedStyle(element, pseudo);
        return [...computedPseudo].filter((property) => !property.startsWith('--ul-')).map((property) => [property, computedPseudo.getPropertyValue(property)]);
      }));
      for (const child of element.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE) continue;
        range.selectNodeContents(child);
        text.push([child.textContent, [...range.getClientRects()].map(rectangle)]);
      }
    }
    const groups = { styles, geometry, generated, text };
    if (withDetails) return groups;
    const hashes = {};
    for (const [name, values] of Object.entries(groups)) {
      const buffer = new TextEncoder().encode(JSON.stringify(values));
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      hashes[name] = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    return { elements: elements.length, hashes, dimensions: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
  }, detailed);
}

async function ready(page, root, file) {
  await page.goto(pathToFileURL(path.join(root, file)).href, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function compare(browser, scenario, file) {
  const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
  const original = await context.newPage();
  const actual = await context.newPage();
  const failures = { original: [], actual: [] };
  for (const [name, page] of [['original', original], ['actual', actual]]) {
    page.on('requestfailed', (request) => failures[name].push(decodeURIComponent(request.url()).replace(pathToFileURL(path.resolve(name === 'original' ? source : destination)).href, 'SITE')));
    page.on('pageerror', (error) => failures[name].push(error.message));
    await page.emulateMedia({ media: scenario.media });
  }
  try {
    await Promise.all([ready(original, source, file), ready(actual, destination, file)]);
    assert.deepEqual(failures.actual.sort(), failures.original.sort(), `New resource errors: ${file}`);
    const [expectedState, actualState] = await Promise.all([snapshot(original), snapshot(actual)]);
    if (JSON.stringify(expectedState) !== JSON.stringify(actualState)) {
      const [expectedDetails, actualDetails] = await Promise.all([snapshot(original, true), snapshot(actual, true)]);
      const differences = [];
      for (const category of Object.keys(expectedDetails)) {
        for (let index = 0; index < Math.max(expectedDetails[category].length, actualDetails[category].length); index++) {
          if (JSON.stringify(expectedDetails[category][index]) !== JSON.stringify(actualDetails[category][index])) {
            differences.push({ category, index, original: expectedDetails[category][index], actual: actualDetails[category][index] });
            break;
          }
        }
      }
      const artifacts = path.join(tools, '.artifacts');
      await mkdir(artifacts, { recursive: true });
      await writeFile(path.join(artifacts, 'differences.json'), JSON.stringify({ file, scenario: scenario.name, differences }, null, 2));
      throw new Error(`Computed rendering differs: ${scenario.name} ${file}; see tools/.artifacts/differences.json`);
    }
    const [expectedImage, actualImage] = await Promise.all([
      original.screenshot({ fullPage: true, animations: 'disabled', timeout: 120000 }),
      actual.screenshot({ fullPage: true, animations: 'disabled', timeout: 120000 }),
    ]);
    if (!expectedImage.equals(actualImage)) {
      const artifacts = path.join(tools, '.artifacts');
      await mkdir(artifacts, { recursive: true });
      await writeFile(path.join(artifacts, 'original.png'), expectedImage);
      await writeFile(path.join(artifacts, 'refactored.png'), actualImage);
      throw new Error(`Screenshot differs: ${scenario.name} ${file}; see tools/.artifacts/`);
    }
    return { file, scenario: scenario.name, elements: actualState.elements, screenshot: hash(actualImage), ...actualState };
  } finally {
    await context.close();
  }
}

await staticChecks();
const scenarios = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, media: 'screen' },
  { name: 'mobile', viewport: { width: 390, height: 844 }, media: 'screen' },
  { name: 'print', viewport: { width: 1440, height: 1000 }, media: 'print' },
];
const browser = await chromium.launch();
const results = [];
try {
  for (const scenario of scenarios) {
    for (const file of selectedPages) {
      results.push(await compare(browser, scenario, file));
      if (results.length % 10 === 0) console.log(`Passed ${results.length}/${selectedPages.length * scenarios.length}: ${scenario.name} ${file}`);
    }
  }
} finally {
  await browser.close();
}
const report = { browser: 'chromium', browserVersion: browser.version(), pages: selectedPages.length, comparisons: results.length, scenarios: scenarios.map((scenario) => scenario.name), results };
await writeFile(path.join(tools, 'verification-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`PASS: ${results.length} full-page screenshot comparisons and matching computed styles, pseudo-elements, text, and geometry.`);