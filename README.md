# Yasir Pro

A source refactor of `../yasir`, not a redesign. Open `index.html` directly in a browser. No build or server is required.

## Structure

- Original page URLs, Arabic text, element order, text whitespace, font files, and backup files are retained.
- `fonts.css` defines the original fonts using their original paths.
- `Surah/Style_CSS/` retains each surah's stylesheet entry point.
- `Surah/Style_CSS/shared/` contains identical, ordered rule prefixes shared between surahs. Entry-point imports preserve the original cascade; page-specific declarations follow them.
- `styles/index.css` and `styles/explanation.css` replace the original embedded stylesheets.
- `styles/inline.css` contains reusable named styles extracted from inline attributes. The reserved specificity guard preserves inline styles' priority over ordinary stylesheet rules without introducing new `!important` declarations. Do not assign the ID `yasir-pro-reserved-inline-specificity` to an element.
- `tools/class-map.json` records every original class and its replacement. Annotation names describe visual presentation, not an interpretation of the text. Short suffixes distinguish exact, stable declaration variants.

## Modular Underlines

`styles/underlines.css` defines independent property classes instead of a separate rule for every underline combination. For example:

```html
<span class="annotation underline ul-sides-open ul-pattern-solid ul-thickness-1px ul-color-gray-100 ul-pad-y-1px ul-pad-x-0mm">...</span>
```

- `annotation underline`: identifies an annotated underline.
- `ul-pattern-solid`, `ul-pattern-dashed`, `ul-pattern-dotted`, `ul-pattern-double`: bottom-border pattern.
- `ul-thickness-1px`, `ul-thickness-2px`: bottom-border thickness. Exact millimeter variants retain their original units, with `p` representing a decimal point in class names.
- `ul-color-gray-100`, `ul-color-green-100-180-100`: exact border color. Gray names give the shared RGB channel; other names include all three RGB channels.
- `ul-pad-y-*`, `ul-pad-x-*`, `ul-pad-top-*`, `ul-pad-bottom-*`: padding on the indicated axis or side.
- `ul-sides-open`: removes the top, left, and right borders. Three-sided annotations instead have explicit side-border modules.
- `ul-image-gradient`, `ul-gradient-to-left` or `ul-gradient-to-right`, `ul-stops-*`, `ul-image-slice-1`: independently select a border-image gradient, its direction, its color stops, and its slice.
- `ul-decoration-*`: controls text-decoration-based underlines, including wavy patterns and offsets. These retain the original rendering technique rather than replacing it with a border.
- `ul-zigzag-*` and `ul-background-*`: control the original zigzag background technique.

Replace the existing class in a category rather than adding a second competing class from that category. For example, replace `ul-pattern-solid` with `ul-pattern-dashed` to change only the line pattern. Class order in HTML does not determine CSS precedence. The shared stylesheet lists all available exact values; it intentionally does not approximate legacy colors or distances.

`tools/underline-map.json` records the exact modular replacement for each used legacy underline class on each page. This is page-specific because the same original class sometimes had different declarations in different surahs. Regeneration applies the decomposition automatically. Gradient custom properties are reset on each nested underline to avoid unintended inheritance.

## Preservation Rules

The original dimensions, units, declaration order, fonts, colors, print rules, and even ineffective declarations are intentional compatibility constraints. Do not normalize these values or reformat text between inline elements without rerunning the comparisons. Mobile output deliberately retains the original layout rather than introducing a responsive redesign.

Backups (`*.bak`) are archival copies and are intentionally byte-identical to their originals. Repository metadata (`.git`) and Finder metadata (`.DS_Store`) are not copied.

## Verification

```sh
cd tools
npm ci
npx playwright install chromium
npm run verify
```

Verification checks every original file against `source-manifest.json`, checks copied assets and backups byte-for-byte, and compares parsed content trees. It also checks every HTML page in Chromium at desktop (1440px), mobile (390px), and print-media settings using full-page screenshots, computed styles, pseudo-elements, element bounds, and text line bounds. Any screenshot mismatch fails the check; there is no tolerance threshold. Print-media checks do not certify physical printer pagination.

The new internal `--ul-*` gradient variables are excluded from computed-style comparisons; their resolved visual properties, as well as all existing properties, remain checked. Run `npm test` from `tools` for focused decomposition and module-independence tests.

The results are recorded in `tools/verification-report.json`. Failure details are written to `tools/.artifacts/`. To check one page, run `npm run verify -- --page=001_Fatiha`.

`npm run refactor` regenerates the copy from the neighboring original folder. It overwrites refactored site files, so do not run it after making manual changes to this copy unless regeneration is intended. It never writes to the original folder.