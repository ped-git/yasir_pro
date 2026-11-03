import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

test('saved groups are authoritative and collapsing preserves original symbol-font bullets', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const parent = path.resolve(root, '..');
  const artifacts = path.join(root, 'tools/.artifacts');
  await mkdir(artifacts, { recursive: true });
  const temporary = await mkdtemp(path.join(artifacts, 'bullet-'));
  const file = path.join(temporary, 'fixture.html');
  await writeFile(file, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(parent, 'fonts.css')).href}"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'assets/interactions.css')).href}"><style>body{font:22px/2 serif}.verse-group{position:relative;padding-left:40px}.line{position:absolute;left:8px;top:0;height:100%;border-left:1px solid black}.connection-cap--top-test{position:absolute;left:3px;top:0;font-family:Wingdings;font-size:inherit}.symbol{font-family:Wingdings}.underline{border-bottom:1px dashed green}</style><script id="reader-group-data" type="application/json">{"groups":{"saved-a":["first"],"saved-b":["second"]}}</script><script defer src="${pathToFileURL(path.join(root, 'assets/interactions.js')).href}"></script></head><body><div class="verse-group" data-reader-section="test"><span class="connection-cap--top-test">n</span><span class="line" data-reader-line="line" data-reader-owner="test" aria-expanded="true"></span><p><span class="symbol">n</span> one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty</p></div><p><span class="underline" data-underline-id="first" data-underline-groups="saved-a">first</span> <span class="underline" data-underline-id="second" data-underline-groups="saved-b">second</span></p></body></html>`);
  const fixture = await readFile(file, 'utf8');
  await writeFile(file, fixture.replace('{"groups":', '{"version":1,"groups":'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => document.documentElement.dataset.readerReady === 'true' && document.fonts.status === 'loaded');
    await page.locator('.reader-controls').evaluate((element) => element.remove());
    const before = await page.locator('body').innerHTML();
    const marker = page.locator('.connection-cap--top-test');
    const style = () => marker.evaluate((element) => { const computed = getComputedStyle(element); return [computed.fontFamily, computed.fontSize, computed.lineHeight]; });
    const originalMarker = await style();
    await page.locator('[data-underline-id="first"]').hover();
    assert.equal(await page.locator('.reader-related').count(), 1, 'The viewer inferred a group from matching appearance');
    assert.equal(await page.locator('[data-reader-emphasis-pattern="dashed"]').count(), 1);
    const line = await page.locator('.line').boundingBox();
    await page.mouse.dblclick(line.x + 0.5, line.y + 12);
    assert.equal(await page.locator('[data-reader-collapsed]').count(), 1);
    assert.deepEqual(await style(), originalMarker, 'The section bullet changed after collapse');
    const beginning = page.locator('.reader-excerpt-start > span').first();
    assert.equal(await beginning.textContent(), 'n');
    assert.match(await beginning.evaluate((element) => getComputedStyle(element).fontFamily), /Wingdings/, 'Collapsed excerpt lost the original glyph font');
    await page.mouse.dblclick(line.x + 0.5, line.y + 12);
    await page.mouse.move(0, 0);
    assert.equal(await page.locator('body').innerHTML(), before);
  } finally {
    await browser.close();
    await rm(temporary, { recursive: true, force: true });
  }
});