import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'parse5';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(root, '..');
const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'data/source-manifest.json'), 'utf8'));
const quick = process.argv.includes('--quick');
const requested = process.argv.find((argument) => argument.startsWith('--page='))?.slice(7);
const entries = requested ? catalog.pages.filter((entry) => entry.page.includes(requested)) : quick ? catalog.pages.filter((entry) => /001_Fatiha|002_Baqarah|^index|^explanation/.test(entry.page)) : catalog.pages;
assert(entries.length, 'No matching pages');
const artifacts = path.join(root, 'tools/.artifacts');

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function visit(node, callback) {
  callback(node);
  for (const child of node.childNodes ?? []) visit(child, callback);
}

function bodyTree(node) {
  return {
    name: node.nodeName,
    value: node.value ?? node.data ?? null,
    attrs: (node.attrs ?? []).filter((attribute) => !/^(data-underline-|data-reader-|aria-expanded$|aria-label$|role$|tabindex$)/.test(attribute.name)),
    children: (node.childNodes ?? []).map(bodyTree),
  };
}

async function checkSources() {
  for (const [file, expected] of Object.entries(manifest)) assert.equal(hash(await readFile(path.join(source, file))), expected, `Existing source changed: ${file}`);
}

async function staticChecks() {
  await checkSources();
  let tagged = 0;
  let lines = 0;
  for (const entry of catalog.pages) {
    const original = parse(await readFile(path.join(source, entry.page), 'utf8'));
    const actual = parse(await readFile(path.join(root, entry.page), 'utf8'));
    let originalBody;
    let actualBody;
    visit(original, (node) => { if (node.tagName === 'body') originalBody = node; });
    visit(actual, (node) => { if (node.tagName === 'body') actualBody = node; });
    assert.deepEqual(bodyTree(actualBody), bodyTree(originalBody), `Body content changed: ${entry.page}`);
    const data = JSON.parse(await readFile(path.join(root, entry.data), 'utf8'));
    const underlines = new Map(data.underlines.map((record) => [record.id, record]));
    const groups = new Map(data.groups.map((group) => [group.id, group]));
    let embeddedGroups;
    visit(actual, (node) => {
      if (node.tagName === 'script' && node.attrs.some((attribute) => attribute.name === 'id' && attribute.value === 'reader-group-data')) embeddedGroups = JSON.parse(node.childNodes.map((child) => child.value ?? '').join('')).groups;
    });
    assert.deepEqual(embeddedGroups, Object.fromEntries(data.groups.map((group) => [group.id, group.members])), `Embedded saved grouping differs: ${entry.page}`);
    const seen = new Set();
    visit(actualBody, (node) => {
      const attrs = Object.fromEntries((node.attrs ?? []).map((attribute) => [attribute.name, attribute.value]));
      if ((attrs.class ?? '').split(/\s+/).includes('underline')) {
        const id = attrs['data-underline-id'];
        assert(id && !seen.has(id), `Missing or duplicated underline ID: ${entry.page}`);
        seen.add(id);
        const record = underlines.get(id);
        assert(record, `Unknown underline ID: ${id}`);
        assert.equal(attrs['data-underline-groups'], record.groups.join(' '));
        for (const group of record.groups) assert(groups.get(group)?.members.includes(id), `Broken group reference: ${id}`);
        tagged++;
      }
      if ((attrs.class ?? '').split(/\s+/).some((name) => name.startsWith('connection-line--'))) {
        assert(attrs['data-reader-line'], `Unannotated vertical line: ${entry.page}`);
        lines++;
      }
    });
    assert.equal(seen.size, data.underlines.length);
    for (const group of groups.values()) for (const id of group.members) assert(underlines.has(id), `Group has an unknown member: ${group.id}`);
  }
  console.log(`Static checks passed: ${catalog.pages.length} unchanged content trees, ${tagged} underline tags, ${lines} vertical lines, ${Object.keys(manifest).length} preserved source files.`);
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function open(page, directory, file) {
  await page.goto(pathToFileURL(path.join(directory, file)).href, { waitUntil: 'load' });
  if (directory === root) await page.waitForFunction(() => document.documentElement.dataset.readerReady === 'true');
  await settle(page);
}

async function fingerprint(page) {
  return page.evaluate(async () => {
    const elements = [document.documentElement, document.body, ...document.body.querySelectorAll('*')].filter((element) => !element.closest('.reader-controls'));
    const result = { styles: [], geometry: [], generated: [], text: [] };
    const rectangle = (bounds) => [bounds.x + scrollX, bounds.y + scrollY, bounds.width, bounds.height];
    const range = document.createRange();
    const styleValues = (style) => [...style].map((property) => [property, style.getPropertyValue(property)]);
    for (const element of elements) {
      result.styles.push(styleValues(getComputedStyle(element)));
      result.geometry.push([element.tagName, rectangle(element.getBoundingClientRect()), element.scrollWidth, element.scrollHeight]);
      result.generated.push(['::before', '::after', '::marker'].map((pseudo) => styleValues(getComputedStyle(element, pseudo))));
      for (const child of element.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE || child.parentElement.closest('.reader-controls')) continue;
        range.selectNodeContents(child);
        result.text.push([child.textContent, [...range.getClientRects()].map(rectangle)]);
      }
    }
    const hashes = {};
    for (const [name, values] of Object.entries(result)) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
      hashes[name] = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    return { hashes, elements: elements.length, size: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
  });
}

async function screenshot(page) {
  return page.screenshot({ fullPage: true, animations: 'disabled', timeout: 120000 });
}

async function compareIdle(browser, scenario, file) {
  const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
  try {
    const original = await context.newPage();
    const actual = await context.newPage();
    const errors = { original: [], actual: [] };
    for (const [name, page] of [['original', original], ['actual', actual]]) {
      page.on('pageerror', (error) => errors[name].push(error.message));
      page.on('requestfailed', (request) => errors[name].push(decodeURIComponent(request.url()).replace(pathToFileURL(path.resolve(root)).href, 'SITE').replace(pathToFileURL(source).href, 'SITE')));
      await page.emulateMedia({ media: scenario.media });
    }
    await Promise.all([open(original, source, file), open(actual, root, file)]);
    await actual.locator('.reader-controls').evaluateAll((elements) => elements.forEach((element) => element.remove()));
    assert.deepEqual(errors.actual.sort(), errors.original.sort(), `New resource or script error: ${file}`);
    const [expected, observed] = await Promise.all([fingerprint(original), fingerprint(actual)]);
    assert.deepEqual(observed, expected, `Idle computed rendering changed: ${scenario.name} ${file}`);
    const [expectedImage, observedImage] = await Promise.all([screenshot(original), screenshot(actual)]);
    if (!expectedImage.equals(observedImage)) {
      await mkdir(artifacts, { recursive: true });
      await writeFile(path.join(artifacts, 'original.png'), expectedImage);
      await writeFile(path.join(artifacts, 'interactive.png'), observedImage);
      throw new Error(`Idle screenshot differs: ${scenario.name} ${file}; see interactive/tools/.artifacts`);
    }
    return { page: file, scenario: scenario.name, screenshot: hash(observedImage), ...observed };
  } finally {
    await context.close();
  }
}

async function highlighted(page) {
  return page.locator('.reader-related').evaluateAll((elements) => elements.map((element) => element.dataset.underlineId).sort());
}

async function toggleLine(page, id) {
  const line = page.locator(`[data-reader-owner="${id}"]`).first();
  await line.scrollIntoViewIfNeeded();
  const coordinates = await line.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const left = parseFloat(style.borderLeftWidth);
    return { x: left ? bounds.left + left / 2 : bounds.right - parseFloat(style.borderRightWidth) / 2, y: bounds.top + Math.min(12, bounds.height / 2) };
  });
  await page.mouse.dblclick(coordinates.x, coordinates.y);
  await settle(page);
}

async function interactionChecks(browser) {
  const results = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await open(page, root, 'Surah/001_Fatiha_html.html');
      const baseline = await fingerprint(page);
      const initialScroll = await page.evaluate(() => [scrollX, scrollY]);
      const originalImage = await screenshot(page);
      const controls = page.locator('.reader-controls input[type="checkbox"]');
      assert.equal(await controls.count(), 2, 'Each surah should have two reading checkboxes');
      const verticalLineCount = await page.locator('[data-reader-line]').count();
      const toolbarBounds = await page.locator('.reader-controls').boundingBox();
      assert(toolbarBounds.x >= 0 && toolbarBounds.x + toolbarBounds.width <= viewport.width, 'Reading checkboxes are not visible at the top-left');
      const sourceText = await page.locator('body').textContent();
      const verseCount = await page.locator('sup').count();
      assert.equal(await controls.nth(0).isChecked(), true, 'Structured layout should be checked initially');
      await controls.nth(0).uncheck();
      const simpleMode = await page.evaluate(() => ({
        lines: [...document.querySelectorAll('[data-reader-line]')].filter((element) => getComputedStyle(element).display !== 'none').length,
        verses: document.querySelectorAll('sup').length,
        text: document.body.textContent,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(simpleMode.lines, 0, 'Simple text mode should hide vertical lines');
      assert.equal(simpleMode.verses, verseCount, 'Simple text mode changed verse markers');
      assert.equal(simpleMode.text, sourceText, 'Simple text mode changed source text');
      assert.equal(simpleMode.overflow, false, 'Simple text mode overflows the viewport');
      const first = page.locator('[data-underline-id]').first();
      await controls.nth(1).uncheck();
      assert.equal(await first.evaluate((element) => getComputedStyle(element).borderBottomColor), 'rgba(0, 0, 0, 0)', 'Underline checkbox did not hide the line');
      await first.hover();
      assert.equal(await page.locator('[data-reader-underline-overlay]').count(), 0, 'Hidden underlines reappeared on hover');
      await page.mouse.move(0, 0);
      await controls.nth(1).check();
      await controls.nth(0).check();
      await page.evaluate(() => document.activeElement?.blur());
      await page.evaluate(([left, top]) => window.scrollTo(left, top), initialScroll);
      await settle(page);
      const restored = await fingerprint(page);
      assert.equal(restored.hashes.geometry, baseline.hashes.geometry, 'Disabling the reading modes did not restore layout');
      assert.equal(restored.hashes.text, baseline.hashes.text, 'Disabling the reading modes did not restore text layout');
      assert.deepEqual(restored.size, baseline.size, 'Disabling the reading modes changed page dimensions');
      assert.equal(await page.locator('[data-reader-line]').evaluateAll((elements) => elements.filter((element) => getComputedStyle(element).display !== 'none').length), verticalLineCount, 'Vertical lines did not return after disabling simple text mode');
      const firstId = await first.getAttribute('data-underline-id');
      const normalText = await first.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.color, style.backgroundColor, style.fontWeight];
      });
      await first.hover();
      assert.equal((await highlighted(page)).length, 4, 'Opening attributes should highlight together');
      assert((await highlighted(page)).includes(firstId));
      const emphasized = await fingerprint(page);
      assert.equal(emphasized.hashes.geometry, baseline.hashes.geometry, 'Underline emphasis changed element layout');
      assert.equal(emphasized.hashes.text, baseline.hashes.text, 'Underline emphasis changed text layout');
      assert.deepEqual(await first.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.color, style.backgroundColor, style.fontWeight];
      }), normalText, 'Underline emphasis changed the text instead of just its line');
      assert(await page.locator('[data-reader-underline-overlay] [data-reader-emphasis-pattern="solid"]').count() > 0);
      assert(!originalImage.equals(await screenshot(page)), 'Hover has no visible effect');
      const contrast = page.locator('[data-underline-groups$="contrasting-paths"]').first();
      await contrast.hover();
      assert.equal((await highlighted(page)).length, 3, 'Contrasting paths should group across different colors');
      await page.mouse.move(0, 0);
      assert.deepEqual(await highlighted(page), []);
      assert.equal(await page.locator('[data-reader-underline-overlay]').count(), 0);
      const cleared = await fingerprint(page);
      assert.equal(cleared.hashes.geometry, baseline.hashes.geometry);
      assert.equal(cleared.hashes.text, baseline.hashes.text);
      await open(page, root, 'Surah/002_Baqarah_html.html');
      await screenshot(page);
      await settle(page);
      const beforeImage = await screenshot(page);
      const before = await fingerprint(page);
      const beforeScroll = await page.evaluate(() => [scrollX, scrollY]);
      const beforeBody = await page.locator('body').innerHTML();
      const inner = page.locator('[data-underline-id] [data-underline-id]').first();
      const outerId = await inner.evaluate((element) => element.parentElement.closest('[data-underline-id]').dataset.underlineId);
      await inner.hover();
      assert(!(await highlighted(page)).includes(outerId), 'An inner underline incorrectly activated its outer group');
      await page.mouse.move(0, 0);
      const ids = await page.locator('[data-reader-section]').first().evaluate((element) => [element.dataset.readerSection, element.querySelector('[data-reader-section]').dataset.readerSection]);
      const child = page.locator(`[data-reader-section="${ids[1]}"]`);
      const initialHeight = await child.evaluate((element) => element.getBoundingClientRect().height);
      const ornamentsBefore = await child.locator(':scope > [class*="connection-cap--"]').evaluateAll((elements) => elements.map((element) => {
        const style = getComputedStyle(element);
        return [style.fontFamily, style.fontSize, style.lineHeight, style.width, style.height, style.transform, style.backgroundColor, style.border];
      }));
      const line = page.locator(`[data-reader-owner="${ids[1]}"]`).first();
      await line.scrollIntoViewIfNeeded();
      const lineBounds = await line.boundingBox();
      await page.mouse.move(lineBounds.x + 0.5, lineBounds.y + 12);
      await settle(page);
      assert(await line.evaluate((element) => element.classList.contains('reader-line-related')), 'Vertical line has no hover emphasis');
      assert.notEqual(await line.evaluate((element) => getComputedStyle(element).boxShadow), 'none');
      await page.mouse.move(0, 0);
      await settle(page);
      assert.equal(await page.locator('.reader-line-related').count(), 0);
      await toggleLine(page, ids[1]);
      assert.equal(await child.getAttribute('data-reader-collapsed'), 'true');
      assert(await child.evaluate((element) => element.getBoundingClientRect().height) < initialHeight, 'Collapsed section did not shrink');
      const summary = child.locator(':scope > [data-reader-excerpt]');
      assert.equal(await summary.locator('.reader-omission').textContent(), '[ \u2026 ]');
      const excerptWords = await summary.locator('.reader-excerpt-start, .reader-excerpt-end').allTextContents();
      assert(excerptWords.join(' ').split(/\s+/).length <= 16, 'Summary is not a short beginning/end excerpt');
      assert.equal(await summary.evaluate((element) => getComputedStyle(element).borderTopStyle), 'dashed', 'Collapsed excerpt is not visibly distinguished');
      assert.deepEqual(await child.locator(':scope > [class*="connection-cap--"]').evaluateAll((elements) => elements.map((element) => {
        const style = getComputedStyle(element);
        return [style.fontFamily, style.fontSize, style.lineHeight, style.width, style.height, style.transform, style.backgroundColor, style.border];
      })), ornamentsBefore, 'Collapsing changed the original bullet ornaments');
      await toggleLine(page, ids[0]);
      assert.equal(await page.locator(`[data-reader-section="${ids[0]}"]`).getAttribute('data-reader-collapsed'), 'true');
      await toggleLine(page, ids[0]);
      assert.equal(await child.getAttribute('data-reader-collapsed'), 'true', 'Nested collapsed state was lost');
      await toggleLine(page, ids[1]);
      await page.mouse.move(0, 0);
      await page.evaluate(([left, top]) => window.scrollTo(left, top), beforeScroll);
      await settle(page);
      assert.equal(await page.locator('body').innerHTML(), beforeBody, 'Expansion did not restore original DOM');
      assert.deepEqual(await fingerprint(page), before, 'Expansion did not restore exact geometry and styles');
      assert(beforeImage.equals(await screenshot(page)), 'Expansion did not restore the full-page screenshot');
      const keyboardLine = page.locator(`[data-reader-owner="${ids[1]}"]`).first();
      await keyboardLine.focus();
      await keyboardLine.press('Enter');
      assert.equal(await child.getAttribute('data-reader-collapsed'), 'true');
      await keyboardLine.press('Space');
      assert.equal(await child.getAttribute('data-reader-collapsed'), null);
      results.push({ width: viewport.width, underlineOnlyEmphasis: true, verticalLineHover: true, nestedHover: true, distinctExcerpts: true, nestedCollapse: true, exactExpansion: true, keyboard: true });
    } finally {
      await context.close();
    }
  }
  console.log('Interaction checks passed: desktop/mobile hover, nested groups, short excerpts, nested collapse, keyboard, exact expansion restoration.');
  return results;
}

await staticChecks();
const browser = await chromium.launch();
const results = [];
let interactions;
try {
  interactions = await interactionChecks(browser);
  const scenarios = [
    { name: 'desktop', viewport: { width: 1440, height: 1000 }, media: 'screen' },
    { name: 'mobile', viewport: { width: 390, height: 844 }, media: 'screen' },
    { name: 'print', viewport: { width: 1440, height: 1000 }, media: 'print' },
  ];
  for (const scenario of scenarios) {
    for (const entry of entries) {
      results.push(await compareIdle(browser, scenario, entry.page));
      if (results.length % 10 === 0) console.log(`Passed ${results.length}/${entries.length * 3}: ${scenario.name} ${entry.page}`);
    }
  }
  await checkSources();
  await writeFile(path.join(root, `data/verification-${requested ? 'page' : quick ? 'quick' : 'full'}.json`), `${JSON.stringify({ browser: browser.version(), comparisons: results.length, interactions, results }, null, 2)}\n`);
} finally {
  await browser.close();
}
console.log(`PASS: ${results.length} byte-identical idle screenshot comparisons; existing source files remain untouched.`);