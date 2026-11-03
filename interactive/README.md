# Interactive Yasir

Open `index.html` directly, or serve the containing `yasir_pro` directory and visit `/interactive/`. The reader is static HTML, CSS, and JavaScript; no backend or build is needed for use. Existing Yasir Pro HTML, CSS, fonts, and backups are not edited.

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

`data/curated-groups.json` is the editable source of explicit relationships. Each page has an array of group definitions with an ID, a label, and members. Members can be exact Arabic phrases (diacritics are ignored for matching), `{ "text": "...", "occurrence": 0 }` for a repeated phrase, or an existing underline ID. Occurrences are zero-based among matching underlines.

For example, append a group definition to the appropriate page array:

```json
{
  "id": "my-group",
  "label": "Description of the relationship",
  "members": [{ "id": "p001-u0001" }, { "id": "p001-u0004" }]
}
```

Run the build after editing that file. Curated members are excluded from automatic suggestions, but can participate in multiple curated groups. Ambiguous phrases and unknown IDs cause a build error rather than silently tagging the wrong text.

All group assignment happens before display. Each page embeds an explicit `reader-group-data` JSON index, synchronized with its sidecar annotation JSON. The reader only looks up those saved memberships; it does not analyze wording, proximity, colors, or underline appearance at startup. The visual editor in `../inetractive_edit` updates both forms when saving manual changes. Manually edited pages listed in `data/editor-edits.json` are preserved by subsequent annotation builds.

To prevent a phrase from joining any automatic group, assign it a curated group with just that one member. This is also a way to record a deliberate exception to a recurring visual pattern.

`data/pages/` contains generated annotations: exact phrase text, its checksum and DOM selector, underline appearance, verse position, nesting and section IDs, group memberships, and section excerpts. `data/catalog.json` indexes all pages. `data/grouping-audit.json` records coverage and added/removed relationships relative to the preceding build. These files are a reference/export, not the editing source: a rebuild replaces them. IDs remain stable while page order and source structure remain unchanged; review them after structural source changes.

## Editorial Status

Reviewed groups cover selected relationships in Al-Fatiha, Al-Baqarah, Al-Kahf, Yasin, Al-Rahman, and Al-Mulk. These include repeated headings across paragraphs, rhetorical parallels, contrasts, and coordinated lists. The remaining multi-phrase groups are **suggestions**, not a completed semantic annotation of the Quran, and require editorial review.

Each group records `reviewStatus` (`curated`, `suggested`, or `unassigned`), its matching `basis`, and the evidence used for automatic suggestions. Nearby matching forms can link across paragraph boundaries within bounded verse and block distances in the same section. New speech boundaries stop that local matching. Repeated non-generic phrases can link across sections when their underline forms also match. Red/green paired contrasts require matching structure and local coordinating text. Mere adjacency does not connect different forms; symbolic marker letters are excluded from automatic text groups. Nested underline layers stay independent. Promote, replace, or separate relationships through the curated file.

## Tools

```sh
npm ci --prefix interactive/tools
npm test --prefix interactive/tools
npm run build --prefix interactive/tools
npm run verify --prefix interactive/tools
npm run serve --prefix interactive/tools
```

Run these commands from `yasir_pro`. Chromium must be installed for verification (`npx playwright install chromium` from `interactive/tools`). The server binds to loopback, starting at port 4173 and trying another port if occupied.

The build reads only existing files within `yasir_pro` and writes only within `interactive`. Fonts and base styles are shared through relative links, so publish the complete containing `yasir_pro` directory, not `interactive` alone. Site-internal page links stay within the interactive copy. No network APIs or remote scripts are required.

## Verification

The verifier checks unchanged source hashes and parsed body content, complete underline/line annotation coverage, group references, underline-only emphasis without text/background changes, vertical-line hover, nested underline isolation, visibly folded short excerpts, nested collapse-state retention, keyboard toggling, and exact expansion restoration. It compares all 117 idle pages against existing Yasir Pro at desktop (1440px), mobile (390px), and print-media settings: 351 zero-tolerance full-page screenshot comparisons, plus computed styles, pseudo-elements, text bounds, and element geometry. Grouping regression tests cover missed cross-paragraph/repeated relationships and false matches from adjacency, speech boundaries, and symbol markers; these tests are not a guarantee of semantic annotation accuracy.

Full results are recorded in `data/verification-full.json`. A faster representative run is `npm run verify --prefix interactive/tools -- --quick`. Print-media checks do not certify physical printer pagination. Other browser engines have not been certified.