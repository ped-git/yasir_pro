import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { makeCatalog } from '../catalog.mjs';
import { createEditorServer } from '../server.mjs';

const site = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(site, 'interactive');
const artifacts = path.join(source, 'tools/.artifacts');
await mkdir(artifacts, { recursive: true });
console.log('Discovering styles');
const complete = await makeCatalog(source);
const entries = complete.pages.filter((entry) => /001_Fatiha|002_Baqarah/.test(entry.page));
const fixture = await mkdtemp(path.join(artifacts, 'browser-'));
const betaFixture = await mkdtemp(path.join(artifacts, 'browser-beta-'));
for (const entry of entries) {
  for (const file of [entry.page, entry.data]) {
    for (const root of [fixture, betaFixture]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await cp(path.join(source, file), path.join(root, file));
    }
  }
}
const testCatalog = { ...complete, pages: entries };
for (const root of [fixture, betaFixture]) {
  await cp(path.join(source, 'assets'), path.join(root, 'assets'), { recursive: true });
  await mkdir(path.join(root, 'data'), { recursive: true });
  await writeFile(path.join(root, 'data/catalog.json'), JSON.stringify({ pages: entries }));
}
const legacyQuoteCss = path.join(fixture, 'styles/editor-pages', entries[0].page.replace(/\.html$/, '.css'));
await mkdir(path.dirname(legacyQuoteCss), { recursive: true });
await writeFile(legacyQuoteCss, '.edit-quote-open::before { content: "«"; position: relative; top: 1.5mm; }\n.edit-quote-close::before { content: "»"; position: relative; top: 1.5mm; }');
const { server } = await createEditorServer({
  siteRoot: site,
  workspaces: {
    interactive: { dataRoot: fixture, catalog: testCatalog },
    interactive_beta: { dataRoot: betaFixture, catalog: testCatalog },
  },
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1720, height: 1082 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => { dialogs.push(dialog.message()); return dialog.accept(); });
  console.log('Opening editor');
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved');
  assert.equal(await page.locator('#guide-dialog').evaluate((element) => element.open), true, 'Editing guide should open on first launch');
  assert.equal(await page.locator('.guide-steps li').count(), 7);
  await page.locator('#guide-dont-show').check();
  await page.locator('#guide-start').click();
  await page.locator('#open-guide').click();
  assert.equal(await page.locator('#guide-dialog').evaluate((element) => element.open), true, 'Guide button should reopen the guide');
  await page.locator('#guide-start').click();
  assert.equal(await page.locator('#guide-dialog').evaluate((element) => element.open), false, 'Guide should close before editing');
  let frame = page.frames().find((entry) => entry.url().includes('/document?'));
  await frame.waitForFunction(() => document.fonts.status === 'loaded');
  console.log('Comparing canvas');
  const box = await page.locator('#document').boundingBox();
  const original = await browser.newPage({ viewport: { width: box.width, height: box.height }, deviceScaleFactor: 1 });
  await original.goto(pathToFileURL(path.join(source, entries[0].page)).href);
  await original.waitForFunction(() => document.fonts.status === 'loaded');
  await original.locator('.reader-controls').evaluate((element) => element.remove());
  const expected = await original.screenshot();
  const canvas = await page.locator('#document').screenshot();
  await writeFile(path.join(artifacts, 'editor-original.png'), expected);
  await writeFile(path.join(artifacts, 'editor-canvas.png'), canvas);
  assert(canvas.equals(expected), 'Editor document canvas differs from the original at the same viewport');
  await original.close();
  const sidebarWidth = Number(await page.locator('#sidebar-resizer').getAttribute('aria-valuenow'));
  await page.locator('#sidebar-resizer').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(Number(await page.locator('#sidebar-resizer').getAttribute('aria-valuenow')), sidebarWidth + 20, 'Keyboard resizing did not enlarge the sidebar');
  const memberResizer = page.locator('#member-list-resizer');
  const memberList = page.locator('#member-list');
  const memberBox = await memberList.boundingBox();
  const listHeight = Number(await memberResizer.getAttribute('aria-valuenow'));
  await memberResizer.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(Number(await memberResizer.getAttribute('aria-valuenow')), listHeight + 20, 'Keyboard resizing did not enlarge the underline list');
  await memberResizer.scrollIntoViewIfNeeded();
  const memberHandleBox = await memberResizer.boundingBox();
  await page.mouse.move(memberHandleBox.x + memberHandleBox.width / 2, memberHandleBox.y + memberHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(memberHandleBox.x + memberHandleBox.width / 2, memberHandleBox.y + memberHandleBox.height / 2 + 45, { steps: 5 });
  await page.mouse.up();
  assert((await memberList.boundingBox()).height > memberBox.height + 20, 'Underline checkbox list could not be dragged larger');
  console.log('Canvas pixels match');

  const select = async (selector, text = null) => {
    await frame.locator(selector).first().scrollIntoViewIfNeeded();
    await frame.evaluate(({ selector, text }) => {
      const element = document.querySelector(selector);
      const range = document.createRange();
      if (text) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let found;
        while (walker.nextNode()) if (walker.currentNode.textContent.includes(text)) { found = walker.currentNode; break; }
        if (!found) throw new Error(`Missing selection text: ${text}`);
        const start = found.textContent.indexOf(text);
        range.setStart(found, start); range.setEnd(found, start + text.length);
      } else range.selectNodeContents(element);
      const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    }, { selector, text });
  };
  const assertMillimeters = async (locator, property, millimeters) => {
    const pixels = await locator.evaluate((element, cssProperty) => parseFloat(getComputedStyle(element)[cssProperty]), property);
    assert(Math.abs(pixels - millimeters * 96 / 25.4) < 0.01, `Expected ${property} to equal ${millimeters}mm, got ${pixels}px`);
  };
  const apply = async (kind) => {
    await page.locator(`[data-kind="${kind}"]`).click();
    if (kind === 'underline') {
      const builder = page.locator('#style-list');
      assert.equal(await builder.locator('[data-setting="distance"]').getAttribute('max'), '9');
      await builder.locator('[data-setting="type"]').selectOption('wavy');
      await builder.locator('[data-setting="distance"]').evaluate((element) => { element.value = '9'; element.dispatchEvent(new Event('input', { bubbles: true })); });
      assert.equal(await builder.locator('[data-value="distance"]').textContent(), '9.0 mm');
      await assertMillimeters(builder.locator('.custom-underline-sample'), 'textUnderlineOffset', 9);
      for (const [setting, value] of [['distance', '1.2'], ['color', '#cc3344'], ['thickness', '1']]) {
        await builder.locator(`[data-setting="${setting}"]`).evaluate((element, next) => {
          element.value = next;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
      }
      const sample = builder.locator('.custom-underline-sample');
      assert.equal(await sample.evaluate((element) => getComputedStyle(element).textDecorationStyle), 'wavy');
      assert.equal(await builder.locator('[data-value="distance"]').textContent(), '1.2 mm');
      await assertMillimeters(sample, 'textUnderlineOffset', 1.2);
      assert.equal(await sample.evaluate((element) => getComputedStyle(element).textDecorationColor), 'rgb(204, 51, 68)');
      assert.equal(await builder.locator('[data-value="thickness"]').textContent(), '1.0 mm');
      await assertMillimeters(sample, 'textDecorationThickness', 1);
      assert.equal(await builder.locator('.style-option').count(), 0, 'Underline tab still renders the full style gallery');
      await builder.locator('.apply-underline').click();
      const customUnderline = frame.locator('[data-underline-id][class*="edit-style-custom-"]').last();
      assert.equal(await customUnderline.evaluate((element) => getComputedStyle(element).borderTopWidth), '0px', 'Custom underline retained the annotation box border');
      assert.equal(await customUnderline.evaluate((element) => getComputedStyle(element).borderLeftWidth), '0px', 'Custom underline retained the annotation box border');
      assert.equal(await customUnderline.evaluate((element) => getComputedStyle(element).paddingTop), '0px', 'Custom underline retained annotation box padding');
      assert.equal(await customUnderline.evaluate((element) => getComputedStyle(element).textDecorationLine), 'underline');
      const actualUnderline = await customUnderline.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          style: style.textDecorationStyle,
          color: style.textDecorationColor,
          thickness: style.textDecorationThickness,
          offset: style.textUnderlineOffset,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          outline: style.outlineStyle,
        };
      });
      const previewUnderline = await sample.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          style: style.textDecorationStyle,
          color: style.textDecorationColor,
          thickness: style.textDecorationThickness,
          offset: style.textUnderlineOffset,
          fontFamily: style.fontFamily,
        };
      });
      assert.equal(previewUnderline.style, actualUnderline.style);
      assert.equal(previewUnderline.color, actualUnderline.color);
      assert.equal(previewUnderline.thickness, actualUnderline.thickness);
      assert.equal(previewUnderline.offset, actualUnderline.offset);
      assert.equal(previewUnderline.fontFamily, await customUnderline.evaluate((element) => getComputedStyle(element).fontFamily));
      const stableBounds = await customUnderline.evaluate((element) => {
        const before = element.getBoundingClientRect();
        element.removeAttribute('data-editor-selected');
        const unselected = element.getBoundingClientRect();
        element.setAttribute('data-editor-selected', '');
        return { before: [before.x, before.y, before.width, before.height], unselected: [unselected.x, unselected.y, unselected.width, unselected.height] };
      });
      assert.deepEqual(stableBounds.before, stableBounds.unselected, 'Emphasizing an underline changed its layout position');
      assert.equal(actualUnderline.outline, 'none', 'Selection emphasis still uses a moving dashed outline');
    } else await page.locator('#style-list .style-option').first().click();
    assert.equal(await page.locator('#error-dialog').evaluate((element) => element.open), false, await page.locator('#error-message').textContent());
  };
  const readWorkspaceDocument = async (workspace, page = entries[0].page) => (await fetch(`${origin}/api/document?workspace=${workspace}&page=${encodeURIComponent(page)}`)).json();
  const switchWorkspace = async (workspace) => {
    await page.locator('#workspace-select').selectOption(workspace);
    await page.waitForFunction((expected) => new URL(location.href).searchParams.get('workspace') === expected, workspace);
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved');
    frame = page.frames().find((entry) => entry.url().includes('/document?'));
  };
  assert.deepEqual(await page.locator('#workspace-select option').evaluateAll((options) => options.map((option) => option.value)), ['interactive', 'interactive_beta']);
  assert.equal(await page.locator('#workspace-select').inputValue(), 'interactive');
  const interactiveBeforeSwitch = await readWorkspaceDocument('interactive');
  await select('.verse-paragraph--spaced', '\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f');
  await apply('underline');
  assert.equal(await page.locator('#save').isDisabled(), false, 'Workspace switch test needs an unsaved edit');
  const betaBeforeSwitch = await readWorkspaceDocument('interactive_beta');
  await switchWorkspace('interactive_beta');
  assert(dialogs.some((text) => text.includes('Discard unsaved changes and switch readers?')), 'Switching with unsaved changes should require confirmation');
  assert.equal((await readWorkspaceDocument('interactive')).hash, interactiveBeforeSwitch.hash, 'Discarded workspace changes reached disk');
  await select('.verse-paragraph--spaced', '\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f');
  await apply('underline');
  const betaSourceText = await frame.evaluate((html) => {
    const bodyText = new DOMParser().parseFromString(html, 'text/html').body.textContent;
    const outsideWhitespace = html.match(/<\/body>(\s*)<\/html>/i)?.[1] ?? '';
    return outsideWhitespace ? bodyText.slice(0, -outsideWhitespace.length) : bodyText;
  }, betaBeforeSwitch.html);
  assert.equal(await frame.locator('body').textContent(), betaSourceText, 'Beta underline insertion changed source text before save');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved' || document.querySelector('#error-dialog').open);
  assert.equal(await page.locator('#error-dialog').evaluate((element) => element.open), false, await page.locator('#error-message').textContent());
  const betaAfterSwitch = await readWorkspaceDocument('interactive_beta');
  const interactiveAfterSwitch = await readWorkspaceDocument('interactive');
  assert.notEqual(betaAfterSwitch.hash, interactiveBeforeSwitch.hash, 'Beta workspace save did not update its own document');
  assert(betaAfterSwitch.css.includes('text-decoration-style: wavy'));
  assert(betaAfterSwitch.css.includes('text-underline-offset: 1.2mm'));
  assert(betaAfterSwitch.css.includes('text-decoration-color: #cc3344'));
  assert(betaAfterSwitch.css.includes('text-decoration-thickness: 1mm'));
  assert.equal(interactiveAfterSwitch.hash, interactiveBeforeSwitch.hash, 'Beta workspace save modified interactive');
  await select('.verse-paragraph--spaced', '\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f');
  await page.locator('[data-kind="underline"]').click();
  const gradientBuilder = page.locator('#style-list');
  const gradientBackgrounds = {};
  for (const type of ['linear-gradient', 'repeating-linear-gradient', 'radial-gradient', 'repeating-radial-gradient']) {
    await gradientBuilder.locator('[data-setting="type"]').selectOption(type);
    gradientBackgrounds[type] = await gradientBuilder.locator('.custom-underline-sample').evaluate((element) => ({
      image: getComputedStyle(element).backgroundImage,
      size: getComputedStyle(element).backgroundSize,
    }));
  }
  assert.notEqual(gradientBackgrounds['linear-gradient'].image, gradientBackgrounds['repeating-linear-gradient'].image);
  assert.notEqual(gradientBackgrounds['radial-gradient'].image, gradientBackgrounds['repeating-radial-gradient'].image);
  assert.match(gradientBackgrounds['radial-gradient'].image, /12%/);
  assert.match(gradientBackgrounds['repeating-radial-gradient'].image, /2px.*5px/);
  assert.notEqual(gradientBackgrounds['repeating-radial-gradient'].size, gradientBackgrounds['radial-gradient'].size);
  await gradientBuilder.locator('[data-setting="type"]').selectOption('radial-gradient');
  await gradientBuilder.locator('[data-setting="color"]').evaluate((element) => { element.value = '#112233'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await gradientBuilder.locator('[data-setting="color2"]').evaluate((element) => { element.value = '#aabbcc'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  for (const side of ['right', 'top', 'left']) await gradientBuilder.locator(`[data-side="${side}"]`).check();
  await gradientBuilder.getByRole('button', { name: 'Move top border earlier' }).click();
  assert.deepEqual(await gradientBuilder.locator('.side-order li span').allTextContents(), ['Top', 'Right', 'Left']);
  const gradientPreview = await gradientBuilder.evaluate((element) => ({ type: element.querySelector('[data-setting="type"]').value, background: getComputedStyle(element.querySelector('.custom-underline-sample')).backgroundImage }));
  assert.equal(gradientPreview.type, 'radial-gradient');
  assert.match(gradientPreview.background, /radial-gradient/);
  await gradientBuilder.locator('.apply-underline').click();
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved' || document.querySelector('#error-dialog').open);
  assert.equal(await page.locator('#error-dialog').evaluate((element) => element.open), false, await page.locator('#error-message').textContent());
  const gradientSaved = await readWorkspaceDocument('interactive_beta');
  const gradientRule = gradientSaved.css.match(/\.edit-style-custom-v4-radial-gradient-[^}]+}/)?.[0] ?? '';
  const topBorderPosition = gradientRule.indexOf('border-top:');
  const rightBorderPosition = gradientRule.indexOf('border-right:');
  const leftBorderPosition = gradientRule.indexOf('border-left:');
  assert(gradientRule.includes('radial-gradient(ellipse at center, #112233 0%, #aabbcc 12%, #aabbcc 100%)'));
  assert(gradientRule.includes('border-top: 0.5mm solid #112233'));
  assert(topBorderPosition >= 0 && rightBorderPosition > topBorderPosition && leftBorderPosition > rightBorderPosition, 'Selected border sides were not saved in the selected order');
  await switchWorkspace('interactive');
  const count = () => frame.locator('[data-underline-id]').count();
  const initial = await count();
  await select('.verse-paragraph--spaced', '\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f');
  await frame.locator('.verse-paragraph--spaced').first().dispatchEvent('contextmenu', { clientX: 100, clientY: 100 });
  await page.locator('#context-menu button').filter({ hasText: /^Underlines$/ }).click();
  await page.locator('#context-menu .apply-underline').click();
  assert.equal(await count(), initial + 1);
  await page.locator('#undo').click(); assert.equal(await count(), initial);
  await page.locator('#redo').click(); assert.equal(await count(), initial + 1);
  const originalId = (await frame.locator('[data-underline-id]').all()).length;
  await select('.verse-paragraph--spaced', '\u0631\u064e\u0628\u0651\u0650');
  await apply('underline');
  assert.equal(await count(), originalId + 1);
  assert(await frame.locator('[data-underline-id] [data-underline-id]').count() > 0);
  const innerId = await frame.locator('[data-underline-id] [data-underline-id]').first().getAttribute('data-underline-id');
  const outerId = await frame.locator(`[data-underline-id="${innerId}"]`).evaluate((element) => element.parentElement.closest('[data-underline-id]').dataset.underlineId);
  await frame.locator(`[data-underline-id="${innerId}"]`).click();
  const originalMemberships = (await frame.locator(`[data-underline-id="${innerId}"]`).getAttribute('data-underline-groups')).split(/\s+/).filter(Boolean);
  await page.locator('#group-input').fill('manual-review-pair');
  await page.locator('#group-label').fill('My reviewed group');
  await page.locator('#add-to-groups').click();
  assert.deepEqual((await frame.locator(`[data-underline-id="${innerId}"]`).getAttribute('data-underline-groups')).split(/\s+/).sort(), [...originalMemberships, 'manual-review-pair'].sort());
  assert.equal(await page.locator('#group-list .group-row > button:not(.delete-group)').filter({ hasText: 'My reviewed group' }).count(), 1);
  await page.locator('#group-input').fill('temporary-group');
  await page.locator('#add-to-groups').click();
  assert.deepEqual((await frame.locator(`[data-underline-id="${innerId}"]`).getAttribute('data-underline-groups')).split(/\s+/).sort(), [...originalMemberships, 'manual-review-pair', 'temporary-group'].sort());
  await page.locator('#group-input').fill('temporary-group');
  await page.locator('#remove-from-groups').click();
  assert.deepEqual((await frame.locator(`[data-underline-id="${innerId}"]`).getAttribute('data-underline-groups')).split(/\s+/).sort(), [...originalMemberships, 'manual-review-pair'].sort());
  await page.locator('#ungroup-selected').click();
  assert.equal(await frame.locator(`[data-underline-id="${innerId}"]`).getAttribute('data-underline-groups'), '');
  await page.locator('#group-input').fill('manual-review-pair');
  await page.locator('#group-label').fill('My reviewed group');
  await page.locator('#add-to-groups').click();
  await frame.locator(`[data-underline-id="${outerId}"]`).evaluate((element) => element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })));
  await page.locator('#remove').click();
  assert.equal(await frame.locator(`[data-underline-id="${outerId}"]`).count(), 0);
  assert.equal(await frame.locator(`[data-underline-id="${innerId}"]`).count(), 1, 'Removing an outer underline removed its nested underline');
  await select('.verse-paragraph--spaced', '\u0627\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0650');
  await apply('highlight');
  assert.equal(await frame.locator('[data-annotation-effect="highlight"]').count(), 1);
  await select('.verse-paragraph--spaced', '\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f');
  await page.locator('#quote-color').selectOption('red');
  await page.locator('#add-quote-pair').click();
  let quotePair = frame.locator('speech[data-quote-pair]');
  assert.equal(await quotePair.count(), 2);
  const quotePairId = await quotePair.first().getAttribute('data-quote-pair');
  assert.equal(await quotePair.first().evaluate((element) => getComputedStyle(element, '::before').content), '"«"');
  for (const mark of await quotePair.all()) {
    const fontSize = await mark.evaluate((element) => parseFloat(getComputedStyle(element, '::before').fontSize));
    assert(Math.abs(fontSize - 8 * 96 / 25.4) < 0.01, `Quotation mark should match the 8mm Baqarah size, got ${fontSize}px`);
  }
  await quotePair.first().evaluate((element) => element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.locator('#quote-color').selectOption('green');
  await page.locator('#apply-quote-color').click();
  quotePair = frame.locator(`speech[data-quote-pair="${quotePairId}"]`);
  assert.equal(await quotePair.count(), 2);
  assert.equal(await quotePair.first().getAttribute('green'), '');
  assert.equal(await quotePair.last().getAttribute('green'), '');
  await quotePair.last().evaluate((element) => element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.locator('#remove-quote-pair').click();
  assert.equal(await frame.locator(`speech[data-quote-pair="${quotePairId}"]`).count(), 0);
  const quotedText = '\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f';
  await select('.verse-paragraph--spaced', quotedText);
  await apply('underline');
  const underline = frame.locator('[data-underline-id]').filter({ hasText: quotedText }).last();
  const underlineId = await underline.getAttribute('data-underline-id');
  await select(`[data-underline-id="${underlineId}"]`, quotedText);
  await page.locator('#add-quote-pair').click();
  quotePair = frame.locator('speech[data-quote-pair]');
  const underlinedQuoteId = await quotePair.last().getAttribute('data-quote-pair');
  quotePair = frame.locator(`speech[data-quote-pair="${underlinedQuoteId}"]`);
  assert.equal(await quotePair.count(), 2);
  for (const mark of await quotePair.all()) {
    assert.equal(await mark.evaluate((element) => element.closest('[data-underline-id]')), null, 'Quotation mark inherited the underline');
  }
  assert.equal(await frame.locator('[data-underline-id]:empty').count(), 0, 'Quotation insertion left an empty underline');
  const exactUnderlineCount = () => frame.locator('[data-underline-id]').evaluateAll((elements, text) => elements.filter((element) => element.textContent === text).length, quotedText);
  assert((await exactUnderlineCount()) > 0, 'Adding quotation marks changed the underlined text');
  await quotePair.first().evaluate((element) => element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.locator('#remove-quote-pair').click();
  assert((await exactUnderlineCount()) > 0, 'Removing quotation marks changed the underlined text');
  await select('.verse-paragraph--spaced');
  await apply('vertical');
  assert.equal(await frame.locator('[data-reader-section]').count(), 1);
  await select('[data-reader-section]', '\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f');
  await apply('vertical');
  assert.equal(await frame.locator('[data-reader-section] [data-reader-section]').count(), 1);
  const nestedSections = await frame.locator('[data-reader-section]').count();
  await page.locator('#remove').click();
  assert.equal(await frame.locator('[data-reader-section]').count(), nestedSections - 1, 'Removing a nested section should remove only that layer');
  await page.locator('#undo').click();
  assert.equal(await frame.locator('[data-reader-section]').count(), nestedSections, 'Undo should restore the nested vertical section');
  console.log('Right-click annotation, nesting, removal, groups, effects, undo/redo pass');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved' || document.querySelector('#error-dialog').open);
  assert.equal(await page.locator('#error-dialog').evaluate((element) => element.open), false, await page.locator('#error-message').textContent());
  const persisted = await (await fetch(`${origin}/api/document?page=${encodeURIComponent(entries[0].page)}`)).json();
  assert(persisted.data.groups.some((group) => group.id === 'manual-review-pair'));
  assert.equal(persisted.data.sections.length, 2);
  assert(persisted.css.includes('edit-style-'));
  assert(JSON.parse(await readFile(path.join(fixture, 'data/editor-edits.json'), 'utf8'))[entries[0].page]);
  await frame.locator('[data-underline-id]').first().evaluate((element) => element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })));
  await page.locator('#group-input').fill('second-save-regression');
  await page.locator('#add-to-groups').click();
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved' || document.querySelector('#error-dialog').open);
  assert.equal(await page.locator('#error-dialog').evaluate((element) => element.open), false, await page.locator('#error-message').textContent());
  const savedAgain = await readWorkspaceDocument('interactive');
  assert(savedAgain.data.groups.some((group) => group.id === 'second-save-regression'), 'Second consecutive save did not persist its group');
  const underlineIdsToRemove = await frame.locator('[data-underline-id]').evaluateAll((elements) => elements.slice(0, 2).map((element) => element.dataset.underlineId));
  for (const id of underlineIdsToRemove) {
    await frame.locator(`[data-underline-id="${id}"]`).evaluate((element) => element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })));
    await page.locator('#remove').click();
  }
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved' || document.querySelector('#error-dialog').open);
  assert.equal(await page.locator('#error-dialog').evaluate((element) => element.open), false, await page.locator('#error-message').textContent());
  const underlinesBeforeAddition = await frame.locator('[data-underline-id]').count();
  await select('.verse-paragraph--spaced', '\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f');
  await apply('underline');
  const underlinesAfterAddition = await frame.locator('[data-underline-id]').count();
  assert(underlinesAfterAddition > underlinesBeforeAddition, 'Adding an underline did not create an annotation');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved' || document.querySelector('#error-dialog').open);
  assert.equal(await page.locator('#error-dialog').evaluate((element) => element.open), false, await page.locator('#error-message').textContent());
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved');
  frame = page.frames().find((entry) => entry.url().includes('/document?'));
  assert.equal(await frame.locator('[data-underline-id]').count(), underlinesAfterAddition, 'Underline added after removing annotations was not persisted');
  assert.equal(await page.frameLocator('#document').locator('[data-reader-section] [data-reader-section]').count(), 1);
  await page.locator('#page-select').selectOption(entries[1].page);
  await page.waitForFunction(() => document.querySelector('#document-path').textContent.includes('002_Baqarah') && document.querySelector('#save-state').textContent === 'Saved');
  frame = page.frames().find((entry) => entry.url().includes('/document?'));
  const originalSections = await frame.locator('[data-reader-section]').count();
  const crossParagraph = async () => {
    await frame.evaluate(() => {
      const paragraphs = document.querySelectorAll('.verse-indent-1 p');
      const range = document.createRange(); range.setStart(paragraphs[0], 0); range.setEnd(paragraphs[1], paragraphs[1].childNodes.length);
      const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      paragraphs[0].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
  };
  await crossParagraph(); await apply('underline');
  await crossParagraph(); await apply('vertical');
  assert.equal(await frame.locator('[data-reader-section]').count(), originalSections + 1);
  const baqarahSource = await readWorkspaceDocument('interactive', entries[1].page);
  const textProbe = await frame.evaluate((html) => {
    const textOf = (node) => {
      if (node.nodeType === Node.ELEMENT_NODE && (node.hasAttribute('data-reader-line') || node.hasAttribute('data-reader-ornament') || [...node.classList].some((name) => name.startsWith('connection-cap--')))) return '';
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      return [...node.childNodes].map(textOf).join('');
    };
    const expected = textOf(new DOMParser().parseFromString(html, 'text/html').body);
    const actual = textOf(document.body);
    let index = 0;
    while (index < expected.length && expected[index] === actual[index]) index++;
    return { expectedLength: expected.length, actualLength: actual.length, index, expected: expected.slice(index - 20, index + 35), actual: actual.slice(index - 20, index + 35), same: expected === actual };
  }, baqarahSource.html);
  assert.equal(textProbe.same, true, 'Cross-paragraph underline and vertical edits changed Baqarah text or whitespace');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved' || document.querySelector('#error-dialog').open);
  assert.equal(await page.locator('#error-dialog').evaluate((element) => element.open), false, await page.locator('#error-message').textContent());
  console.log('Cross-paragraph underlines and nested sections save without changing text');
  assert.equal(errors.length, 0, errors.join('; '));
  await page.screenshot({ path: path.join(artifacts, 'editor-desktop.png') });
  await page.setViewportSize({ width: 700, height: 850 });
  await page.screenshot({ path: path.join(artifacts, 'editor-mobile.png') });
  assert(await page.locator('#save').isVisible());
  console.log('PASS: exact canvas, annotation workflow, saved HTML/CSS/JSON, backup, reload, and mobile layout');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(fixture, { recursive: true, force: true });
  await rm(betaFixture, { recursive: true, force: true });
}