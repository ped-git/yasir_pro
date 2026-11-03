# Yasir Studio

A local visual editor for `../interactive` and `../interactive_beta`. This folder contains software only. Documents, page-local styles, saved group memberships, edit registries, and backup history remain isolated in the selected reader folder.

## Start

```sh
npm ci
npm start
```

Run these commands in `inetractive_edit`, or launch `Start.command` on macOS. Node.js is required. The server prints a loopback URL, normally `http://127.0.0.1:4180/`; it chooses another port if occupied. Keep the terminal running while editing.

## Editing

- Choose `interactive` or `interactive_beta` in the top-bar workspace selector, then select a document. Switching with unsaved edits asks before discarding them. The iframe renders the selected workspace's actual HTML, fonts, and styles without a content-editable layer. Initial pixels match the reader at the same viewport.
- A first-open guide walks through the editor. Reopen it with the help button in the top bar; choose `Do not show automatically again` to keep it dismissed on later launches.
- Select text and right-click to choose an underline, vertical section, highlight, or text effect. The searchable visual catalog shows existing CSS variants and previews. Styles from another surah become page-local CSS rather than importing conflicting surah stylesheets.
- Selecting inside an underline creates a nested underline. Selections spanning paragraphs create separate inline wrappers with a common saved group, rather than invalid inline wrappers around blocks.
- A vertical section can wrap selected text or paragraphs and can be nested. Block selections extend to enclosing sibling blocks to preserve markup. The catalog includes original line-cap variants. Their glyph fonts and ornament shapes are retained during collapse. Remove a selected nested section with the eraser; undo restores it.
- Select a quote and use `Pair selection` to add opening/closing marks, or select either existing mark to recolor its pair. The color choices are blue, green, red, black, gray, light blue, and mixed. The eraser or `Remove quotation pair` removes both marks without removing quoted text.
- Click an annotation and use Selected Layer to choose its enclosing layer. The eraser removes only that layer, preserving nested annotations and text.
- Check underlines in the list, or Ctrl/Command-click them in the canvas. Choose a saved group to select its members. Use `Replace`, `Add`, or `Remove` for specific memberships, or `Ungroup` to clear all memberships from the checked underlines. IDs support spaces-separated multiple groups; labels are editable. Undo reverses every membership change.
- Undo/redo tracks unsaved changes. Save writes only to the selected workspace. The external-link button opens the last saved page in that same reader. Reader scripts are suppressed in the editor canvas so gestures edit instead of collapsing sections.

## Saving

Save updates the selected workspace's HTML, page-local CSS under `styles/editor-pages`, JSON under `data/pages`, and its `data/catalog.json`. It also updates the page's embedded `reader-group-data` index. These are explicit memberships: neither opening the editor nor opening the reader infers groups.

Each reader's `data/editor-edits.json` marks its manually edited pages. The annotation builder preserves these pages rather than regenerating their groups or overwriting their markup. Deliberate regeneration requires backing up the page and removing its registry entry first.

Previous files are backed up under the selected reader's `data/editor-history`. Saves check document and CSS hashes, reject external conflicts, preserve document text/whitespace, and stage replacement files before renaming. Original Yasir Pro HTML and shared styles outside the selected reader are never written. Annotation-only ornament glyphs are separate from protected document text. Normal version control is still recommended.

## Tests

```sh
npm test
npx playwright install chromium
npm run test:browser
```

Tests use disposable data under `interactive/tools/.artifacts`, not live documents. They check workspace switching and save isolation, exact initial canvas pixels, first-open guide behavior, right-click annotations, nested underlines and sections, quote-pair colors/removal, group selection and membership changes, effects, undo/redo, save/reopen, multi-paragraph editing, compact layout, backups, conflicts, and saved-index synchronization.