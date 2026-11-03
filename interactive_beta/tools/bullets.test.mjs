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
  await writeFile(file, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(parent, 'fonts.css')).href}"><link rel="stylesheet" href="${pathToFileURL(path.join(root, 'assets/interactions.css')).href}"><style>body{font:22px/2 serif}.verse-group{position:relative;padding-left:40px}.line{position:absolute;left:8px;top:0;height:100%;border-left:1px solid black}.connection-cap--top-test{position:absolute;left:3px;top:0;font-family:Wingdings;font-size:inherit}.symbol{font-family:Wingdings}.underline{border-bottom:1px dashed green}.distance-medium{padding-bottom:8px}.distance-large{padding-bottom:32px;border-bottom-style:dotted}#decoration-fixture{width:160px}.decorated{border:0;text-decoration-line:underline;text-decoration-style:dashed;text-decoration-color:#b5b5b5;text-decoration-thickness:1px;text-underline-offset:7px}.decorated-far{ text-underline-offset:13px}</style><script id="reader-group-data" type="application/json">{"version":1,"groups":{"saved-a":["first","first-medium","first-large"],"saved-b":["second"],"saved-decoration":["decorated-near","decorated-far"]}}</script><script defer src="${pathToFileURL(path.join(root, 'assets/interactions.js')).href}"></script></head><body><div class="verse-group" data-reader-section="test"><span class="connection-cap--top-test">n</span><span class="line" data-reader-line="line" data-reader-owner="test" aria-expanded="true"></span><p><span class="symbol">n</span> one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty</p></div><p><span class="underline" data-underline-id="first" data-underline-groups="saved-a">first</span> <span class="underline distance-medium" data-underline-id="first-medium" data-underline-groups="saved-a">medium</span> <span class="underline distance-large" data-underline-id="first-large" data-underline-groups="saved-a">large</span> <span class="underline" data-underline-id="second" data-underline-groups="saved-b">second</span></p><div id="decoration-fixture"><p><span class="decorated" data-underline-id="decorated-near" data-underline-groups="saved-decoration">Words wrapping across multiple lines keep this dashed underline at its chosen offset.</span></p><p><span class="decorated decorated-far" data-underline-id="decorated-far" data-underline-groups="saved-decoration">Another wrapped phrase with a different underline offset must stay in the same place.</span></p></div></body></html>`);
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
    assert.equal(await page.locator('.reader-related').count(), 3, 'Saved group memberships were not used');
    assert.deepEqual(await page.locator('[data-reader-underline-overlay] > span').evaluateAll((elements) => elements.map((element) => element.dataset.readerEmphasisPattern)), ['dashed', 'dashed', 'dotted']);
    assert.deepEqual(await page.locator('[data-reader-underline-overlay] > span').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).filter)), [
      'drop-shadow(rgb(0, 128, 0) 0px 0px 1px) drop-shadow(rgb(0, 128, 0) 0px 0px 1px)',
      'drop-shadow(rgb(0, 128, 0) 0px 0px 1px) drop-shadow(rgb(0, 128, 0) 0px 0px 1px)',
      'drop-shadow(rgb(0, 128, 0) 0px 0px 1px) drop-shadow(rgb(0, 128, 0) 0px 0px 1px)',
    ]);
    const underlineGeometry = await page.locator('[data-underline-id]').evaluateAll((elements) => elements.slice(0, 3).map((element) => {
      const bounds = element.getClientRects()[0];
      const width = parseFloat(getComputedStyle(element).borderBottomWidth);
      return { left: bounds.left, top: bounds.bottom - width, width: bounds.width, height: width };
    }));
    const emphasizedGeometry = await page.locator('[data-reader-underline-overlay] > span').evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    }));
    assert.deepEqual(emphasizedGeometry, underlineGeometry, 'Emphasis displaced an underline stroke');
    const decorated = page.locator('[data-underline-id="decorated-near"]');
    const decorationBefore = await page.locator('[data-underline-id^="decorated-"]').evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        bounds: [...element.getClientRects()].map((rect) => [rect.x, rect.y, rect.width, rect.height]),
        text: [...range.getClientRects()].map((rect) => [rect.x, rect.y, rect.width, rect.height]),
        thickness: style.textDecorationThickness,
        offset: style.textUnderlineOffset,
      };
    }));
    assert(decorationBefore[0].bounds.length > 1, 'Decoration fixture does not wrap across lines');
    await decorated.hover();
    const decorationEmphasized = await page.locator('[data-underline-id^="decorated-"]').evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        bounds: [...element.getClientRects()].map((rect) => [rect.x, rect.y, rect.width, rect.height]),
        text: [...range.getClientRects()].map((rect) => [rect.x, rect.y, rect.width, rect.height]),
        thickness: style.textDecorationThickness,
        offset: style.textUnderlineOffset,
      };
    }));
    assert.deepEqual(decorationEmphasized.map(({ bounds, text, offset }) => ({ bounds, text, offset })), decorationBefore.map(({ bounds, text, offset }) => ({ bounds, text, offset })), 'Emphasis displaced or reflowed a text-decoration underline');
    assert.deepEqual(decorationEmphasized.map(({ thickness }) => thickness), ['3px', '3px'], 'Text-decoration emphasis was not reinforced');
    await page.mouse.move(0, 0);
    assert.deepEqual(await page.locator('[data-underline-id^="decorated-"]').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).textDecorationThickness)), decorationBefore.map(({ thickness }) => thickness), 'Clearing emphasis did not restore decoration thickness');
    const line = await page.locator('.line').boundingBox();
    await page.mouse.dblclick(line.x + 0.5, line.y + 12);
    assert.equal(await page.locator('[data-reader-collapsed]').count(), 1);
    assert.deepEqual(await style(), originalMarker, 'The section bullet changed after collapse');
    const beginning = page.locator('.reader-excerpt-start > span').first();
    assert.equal(await beginning.textContent(), 'n');
    assert.match(await beginning.evaluate((element) => getComputedStyle(element).fontFamily), /Wingdings/, 'Collapsed excerpt lost the original glyph font');
    await page.mouse.dblclick(line.x + 0.5, line.y + 12);
    await page.mouse.move(0, 0);
    assert.equal((await page.locator('body').innerHTML()).replaceAll(' style=""', ''), before);
  } finally {
    await browser.close();
    await rm(temporary, { recursive: true, force: true });
  }
});