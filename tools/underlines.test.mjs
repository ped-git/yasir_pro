import assert from 'node:assert/strict';
import test from 'node:test';
import postcss from 'postcss';
import { chromium } from 'playwright';
import { decomposeUnderline, underlineStylesheet } from './underlines.mjs';

function compile(css, registry = new Map()) {
  const rule = postcss.parse(`.annotation.example { ${css} }`).first;
  return { classes: decomposeUnderline(rule, registry), registry };
}

test('solid underlines have independent pattern, thickness, color, sides, and padding', () => {
  const { classes } = compile('border-bottom: 1px solid rgb(100, 100, 100); border-left: 0; border-right: 0; border-top: 0; padding: 1px 0mm;');
  for (const expected of ['underline', 'ul-pattern-solid', 'ul-thickness-1px', 'ul-color-gray-100', 'ul-sides-open', 'ul-pad-y-1px', 'ul-pad-x-0mm']) assert(classes.includes(expected));
});

test('gradient direction and color stops are independent and reset on nested underlines', () => {
  const { classes, registry } = compile('border-bottom: 1px solid; border-image: linear-gradient(to left, black, white); border-image-slice: 1;');
  for (const expected of ['ul-image-gradient', 'ul-gradient-to-left', 'ul-stops-black-white', 'ul-image-slice-1']) assert(classes.includes(expected));
  assert.match(underlineStylesheet(registry), /--ul-gradient-direction: initial/);
  assert.match(underlineStylesheet(registry), /--ul-gradient-stops: initial/);
});

test('identical properties share modules across different underline combinations', () => {
  const registry = new Map();
  compile('border-bottom: 1px dashed rgb(100, 100, 100);', registry);
  compile('border-bottom: 2px solid rgb(100, 100, 100);', registry);
  assert.equal(registry.size, 5);
});

test('invalid negative legacy padding remains invalid rather than partially applying', () => {
  const { registry } = compile('padding: -3mm 0px;');
  assert.deepEqual(registry.get('ul-padding-minus-3mm-0px').declarations, { padding: '-3mm 0px' });
});

test('shorthand defaults and later longhand overrides are preserved', () => {
  const { classes } = compile('border-bottom: 0; text-decoration: underline; text-decoration-thickness: 2px; padding: 1px 0mm; padding-bottom: 6px;');
  for (const expected of ['ul-pattern-none', 'ul-color-currentcolor', 'ul-decoration-pattern-solid', 'ul-decoration-color-currentcolor', 'ul-decoration-thickness-2px', 'ul-pad-bottom-6px', 'ul-pad-top-1px']) assert(classes.includes(expected));
  assert(!classes.includes('ul-pad-y-1px'));
});

test('changing HTML property classes independently changes pattern, color, thickness, and gradient direction', async () => {
  const registry = new Map();
  const solid = compile('border-bottom: 1px solid rgb(100, 100, 100); padding: 1px 0mm;', registry).classes;
  compile('border-bottom: 2px dashed rgb(100, 180, 100);', registry);
  const gradient = compile('border-bottom: 1px solid; border-image: linear-gradient(to left, black, white); border-image-slice: 1;', registry).classes;
  compile('border-image: linear-gradient(to right, black, white);', registry);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>${underlineStylesheet(registry)}</style><span id="solid" class="annotation ${solid.join(' ')}">text</span><span id="gradient" class="annotation ${gradient.join(' ')}">text<span id="nested" class="annotation underline">nested</span></span>`);
    const original = await page.locator('#solid').evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderBottomStyle, style.borderBottomColor, style.borderBottomWidth, style.paddingTop];
    });
    assert.deepEqual(original, ['solid', 'rgb(100, 100, 100)', '1px', '1px']);
    await page.locator('#solid').evaluate((element) => element.classList.replace('ul-pattern-solid', 'ul-pattern-dashed'));
    assert.deepEqual(await page.locator('#solid').evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderBottomStyle, style.borderBottomColor, style.borderBottomWidth, style.paddingTop];
    }), ['dashed', 'rgb(100, 100, 100)', '1px', '1px']);
    await page.locator('#solid').evaluate((element) => {
      element.classList.replace('ul-color-gray-100', 'ul-color-green-100-180-100');
      element.classList.replace('ul-thickness-1px', 'ul-thickness-2px');
    });
    assert.deepEqual(await page.locator('#solid').evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderBottomStyle, style.borderBottomColor, style.borderBottomWidth, style.paddingTop];
    }), ['dashed', 'rgb(100, 180, 100)', '2px', '1px']);
    await page.locator('#gradient').evaluate((element) => element.classList.replace('ul-gradient-to-left', 'ul-gradient-to-right'));
    assert.match(await page.locator('#gradient').evaluate((element) => getComputedStyle(element).borderImageSource), /^linear-gradient\(to right,/);
    assert.equal(await page.locator('#nested').evaluate((element) => getComputedStyle(element).getPropertyValue('--ul-gradient-direction')), '');
  } finally {
    await browser.close();
  }
});