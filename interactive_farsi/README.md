# Interactive Yasir

Open `index.html` directly, or serve the containing `yasir_pro` directory and visit `/interactive_farsi/`. This is an independent Persian edition based on the `interactive_beta` reader. The original `yasir`, `interactive`, and `interactive_beta` folders are not modified by the Farsi import.

## Behavior

- Hover over an underlined phrase to emphasize the underlines sharing any of its group IDs. The innermost underline under the pointer is the active one. Outer and inner layers do not activate one another unless explicitly assigned a shared group.
- Emphasis reinforces the underline stroke using a bottom shadow, or increases text-decoration thickness for decoration-based underlines. Text foreground, background, font weight, border widths, padding, and line wrapping are unchanged.
- Hover over a painted right-side vertical line to reinforce that line. Hit testing distinguishes nearby nested lines and does not highlight the surrounding text. Geometry is cached and invalidated on resize and collapse.
- Double-click the painted right-side vertical line to collapse its section to short beginning/end excerpts (up to eight whitespace-delimited tokens at each end). Double-click again to expand. A dashed frame and a bracketed omission marker `[ ... ]` distinguish the folded text from continuous text.
- Nested sections retain their own collapsed state when an ancestor is collapsed and expanded. Original content nodes remain attached and are hidden only while collapsed.
- Collapsed excerpts preserve the original font of each text fragment, including symbol-font bullets. Original line-cap ornaments retain their typography and shape while the section is collapsed.
- Lines are keyboard-focusable: Enter or Space toggles a focused line. Escape clears a highlight. Keyboard focus has a visible outline; mouse-free, unfocused pages have no added visual controls.
- Collapse state is temporary and resets when a page is reloaded. Hover highlights are cleared before printing.

## Editable Groups

The HTML uses space-separated data tags:

```html
<span data-underline-id="p001-u0001"
      data-underline-groups="p001-divine-attributes">...</span>
```

A phrase can belong to several groups. Matching underline appearance is evidence of a relationship, not an unconditional rule; explicit curated relationships can connect different colors or forms.

Saved group IDs, memberships, and appearance metadata are carried over from beta. The nine Al-Fatiha phrases and selected Baqarah underline and quote boundaries have explicit Persian anchors; remaining boundaries are proportional mappings and have not been semantically reviewed against the Persian wording.

For example, append a group definition to the appropriate page array:

```json
{
  "id": "my-group",
  "label": "Description of the relationship",
  "members": [{ "id": "p001-u0001" }, { "id": "p001-u0004" }]
}
```

Do not run the inherited beta `build.mjs` in this folder: it rebuilds from the Arabic source tree. Use the Farsi importer only when regenerating this edition.

Each page embeds an explicit `reader-group-data` index and a sidecar annotation file. The sidecars contain Persian phrase text and checksums. Most group relationships and underline boundaries are carried over from beta and have not been semantically re-reviewed against Ansarian's wording; the Baqarah phrase anchors listed in the change report are exceptions. The current editor workspace selector does not include `interactive_farsi`.

To prevent a phrase from joining any automatic group, assign it a curated group with just that one member. This is also a way to record a deliberate exception to a recurring visual pattern.

`data/pages/` contains generated annotations: exact phrase text, its checksum and DOM selector, underline appearance, verse position, nesting and section IDs, group memberships, and section excerpts. `data/catalog.json` indexes all pages. `data/grouping-audit.json` records coverage and added/removed relationships relative to the preceding build. These files are a reference/export, not the editing source: a rebuild replaces them. IDs remain stable while page order and source structure remain unchanged; review them after structural source changes.

## Annotation Status

The saved annotations retain the beta edition's underlines, group memberships, speech markers, bullets, and nested sections. In addition to the nine phrase-level Al-Fatiha anchors, selected Baqarah underlines and six speech boundaries are explicitly aligned to Persian phrases. Remaining boundaries are proportionally remapped for visual continuity and are not a complete Persian-language semantic review.

Running `import:ansarian` regenerates pages from the untouched beta templates, so it replaces any manual edits made to this Farsi copy. Use `node import-ansarian.mjs --chapter=2` from `interactive_farsi/tools` to regenerate only Baqarah without rewriting the other surah pages. Baqarah spacing, punctuation, identified malformed explanatory brackets, selected underline anchors, and six speech boundaries are normalized during import. Use `node import-ansarian.mjs --report-only` to refresh the change report without rewriting any surah page or sidecar.

## Tools

```sh
npm ci --prefix interactive_farsi/tools
npm test --prefix interactive_farsi/tools
npm run import:ansarian --prefix interactive_farsi/tools
npm run serve --prefix interactive_farsi/tools
```

Run these commands from `yasir_pro`. The importer reads the bundled Ansarian XML and untouched beta templates, validates all 114 chapters and 6,236 ayahs, updates the surah pages and sidecars, and regenerates `translation-changes.html`. The server binds to loopback, starting at port 4173 and trying another port if occupied.

Fonts and base styles are shared through relative links, so publish the complete containing `yasir_pro` directory, not `interactive_farsi` alone. Site-internal page links stay within this copy. No runtime network APIs or remote scripts are required.

## Verification

The importer validates exact source and page verse counts, sequential verse order, and complete coverage. Unit tests validate Baqarah text and speech corrections along with saved groups, line interaction helpers, and annotation utilities. The translation-change report records source provenance, each marker correction, per-surah annotation counts, and the difference between manually aligned and proportionally mapped boundaries.

The report is available at `translation-changes.html`.