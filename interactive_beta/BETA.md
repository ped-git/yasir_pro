# Editorial Beta

Open `index.html` for the reader, `annotation-review.html` for the English all-surah review, or `annotation-review-fa.html` for its Persian counterpart. Both reports are generated from the same review data. This copy was created from the neighboring `interactive` folder. Work for this pass is confined to `interactive_beta`.

## Protected Scope

Surahs 1, 2, 9, 11, 20, 22, 25, 31, 32, 34, 35, and 44 through 114 are the reference set (82 pages). Their HTML remains byte-identical to the source. All Quranic text, whitespace, verse labels, vertical section structure, line classes, and line-cap markup remain unchanged throughout all 114 surahs.

Only the other 32 surahs receive underline-class changes, selected new underline spans, and new empty quotation marker elements. Those additions are deliberately visible; exact visual identity with the original is not claimed for these intended annotation changes. Shared styles outside this copy are not edited. New quotation styling is scoped to the beta's new markers.

## Editorial Results

The current beta has an expanded turn-by-turn quotation review and three passage-level underline plans spanning all 32 target surahs. Actual reviewed phrase, occurrence, passage, quotation, and underline totals are recorded in `data/beta/changes.json` and displayed in the review HTML. All planned phrases have an explicit applied or blocked outcome; this is not a claim that every remaining phrase has been certified.

The latest inventory examines every indexed target verse rather than only selected examples. `data/beta/underline-audit.json` and the report's inventory table distinguish explicit passage review, legacy annotation, unreviewed structural candidates, and verses with no simple detected cue. Candidate detection never assigns a semantic type. Remaining candidates are not hidden or presented as solved. Specific ambiguous scopes/types have written alternatives in `data/beta/underline-ambiguities.json` and appear in the report's decision view.

Source mapping preserves character-reference offsets, including Arabic text after legacy `&nbsp` and parser-merged text around ignored closing tags. Explicit occurrence decisions in `data/beta/underline-occurrences.json` prevent repeated phrases from silently selecting only the first instance. Gray allocation considers every occurrence of each reviewed group before generation, avoiding collisions when a group recurs in another passage.

Solid means good, dotted means bad, and dashed means neutral. The complete directive and its inner object can have different roles: a prohibition of wrongdoing is good while the named wrongdoing is bad; an approved action can have neutral object nouns. Exact existing phrases are corrected in place rather than duplicated. Missing subphrases can receive nested underlines. Phrases crossing existing inline markup use a balanced wrapper or linked fragments instead of being silently skipped. Nested lines have separate vertical padding levels so a solid outer underline cannot hide a dotted or dashed inner underline.

Gray distinguishes nearby independent groups and does not carry semantic polarity. Red/green is used for reviewed good/bad comparisons; memberships are saved in advance. Explicit passage decisions override old color-derived role guesses. Automatic comparisons outside this passage review remain suggestions rather than proof of interpretation.

Quotation reviews repaired earlier starts and continuations, missing replies, and an unsupported direct-utterance layer around the reporting instruction in 17:53. Closing signs now follow the final quoted text outside ending inline underline spans rather than spilling into subsequent paragraphs or bullets. Explicit RTL isolation keeps opening and closing signs associated with the right and left ends respectively. Text, source reference pages, and vertical markup remain protected.

This is not a completed semantic annotation. Remaining attribution, narration/speech boundaries, reference inconsistencies, and still-unreviewed speech cues are listed explicitly in `annotation-review.html`. An automatically detected pending cue is not represented as a resolved interpretation.

## Review Questions

The regenerated review defaults to decision items. Pending speech-coverage checks and mechanical source checks are separate views, not counted as demonstrated interpretive confusion. Exact current counts are generated in the report and `data/beta/review-model.json`. Forty false flags were removed: wavy text-decoration underlines and symbol-only markers are not uncertainty brackets. Only paired dotted side boundaries on Arabic text produce that source-boundary flag.

Important ambiguity cases include concrete alternatives, the exact current beta range/choice, and a suggested review action. Multi-verse previews show the first and last verse rather than hiding the ending behind a first-three-verses excerpt. Stable permanent links reveal the linked item's view automatically; Arabic search ignores diacritics and accepts Persian/Arabic digits. `data/beta/review-model.json` records the report model, and `data/beta/review-decisions.json` contains the explicit question alternatives.

## Audit Files

- `data/beta/corpus.json`: original inventory across all 114 surahs.
- `data/beta/reference-phrases.json`: reference underline examples.
- `data/beta/editorial-plan.json`: initial explicit quotation and underline decisions.
- `data/beta/boundary-refinements.json`: second-pass discourse-boundary decisions.
- `data/beta/additional-underlines.json`: explicit phrase roles and evidence for new underline groups.
- `data/beta/semantic-role-review.json`: explicit semantic decisions for existing target phrases.
- `data/beta/passage-underlines.json`: 107 passage groups with 240 source-anchored phrase roles and reasons.
- `data/beta/passage-underlines-expanded.json`: additional source-anchored missing phrases, nested roles, and outcomes in all target surahs.
- `data/beta/passage-underlines-systematic.json`: systematic passage additions from the all-verse omission inventory.
- `data/beta/underline-occurrences.json`: reviewed selections for repeated anchors.
- `data/beta/underline-ambiguities.json`: concrete unresolved scope/type questions and alternatives.
- `data/beta/underline-audit.json`: full target-verse inventory and remaining candidate queue.
- `data/beta/underline-review-quote-baseline.json`: immutable pre-waqf quote-position baseline, retained as audit history.
- `data/beta/waqf-review-quote-baseline.json`: immutable first waqf-aware quote-position revision.
- `data/beta/waqf-whitespace-review-quote-baseline.json`: current immutable text and quote-position baseline; closers precede waqf signs without retaining preceding whitespace.
- `data/beta/scope-audit.json`: all-page persisted-group consistency and quotation-scope diagnostics.
- `data/beta/quotation-turn-review.json`: missing dialogue turns, speaker/context notes, conservative boundaries, and deferred entries.
- `data/beta/quotation-review-baseline.json`: non-quotation body hashes proving that the quotation-only review did not alter underlines, groups, text, or vertical lines.
- `data/beta/additional-contrasts.json`: explicitly reviewed comparisons among newly added spans.
- `tools/beta-semantic-styles.mjs`: deterministic role/pattern and saved contrast application, not browser-time inference.
- `data/beta/changes.json`: applied edits and their reference evidence.
- `data/beta/review-issues.json`: filterable report data.
- `data/beta/originals/`: beta-local originals of changed target pages.
- `data/beta-source-manifest.json`: hashes verifying that the neighboring source was not modified.

## Verification

```sh
node tools/beta-verify.mjs
```

Static checks enforce protected reference hashes, unchanged source files, exact text/structure except approved annotation deltas, unchanged vertical markup, balanced/nested quotation pairs, semantic pattern rules, paired comparison colors, distinct neighboring new gray groups, and metadata consistency. Browser checks compare desktop, mobile, and print baselines. Only documented quotation, underline-style, and saved-group deltas are restored to baseline before target comparisons; reference pages are compared without masking. The actual beta is also checked with annotations visible, and the review page is tested on desktop and mobile.

`node tools/beta-verify.mjs --quick` runs representative browser checks while retaining all static preservation checks. Results are saved under `data/beta/verification-*.json`.

`node tools/beta-quotation-verify.mjs` verifies quotation-only preservation plus regression cases for mixed-speaker verses, a nested proposed message, a nested divine report, and uninterrupted speech across verses. `--record` creates a new baseline only if none exists; do not overwrite it to hide unrelated changes. Quote boundaries are reviewed against actual source words; actual ending-verse metadata can be narrower than the search range used to locate a boundary.

Repeated quotation starts are rejected unless a reviewed cue/occurrence disambiguates them. The 6:91 answer is anchored after قل الله, and the 18:95-96 construction account separates narration from later instructions. `node tools/beta-scope-audit.mjs` checks saved grouping on every cataloged HTML page. The viewer requires `reader-group-data`, reads its arrays directly, and never derives group membership from text, appearance, distance, or nesting at startup.

The original quotation-only baseline is retained. An explicitly reviewed underline revision can create a separate immutable baseline with `node tools/beta-quotation-verify.mjs --record-underline-revision` only after preservation checks pass; it refuses to overwrite an existing revision baseline. Subsequent quotation checks use that revision without deleting the earlier audit history.

For subsequent underline-only passes, run `node tools/beta-underline-only-verify.mjs`: it checks unchanged text and exact waqf-aware quotation-marker positions while permitting explicitly audited underline changes. Earlier exact-position snapshots are retained; `--record-waqf-whitespace-revision` creates the current no-gap baseline once and refuses to overwrite it. Closing markers precede trailing waqf signs U+06D6-U+06DC, including any immediately preceding whitespace. Run `node tools/beta-underline-audit.mjs` before regenerating the report to refresh its inventory; add `--samples` for a concise sample from each target.

Do not run the inherited generic annotation builder as an editorial regeneration command. The beta-specific application tool is `tools/beta-apply.mjs`; it refuses to overwrite a changed baseline. Its `--reapply` option intentionally discards beta target annotations and rebuilds them from beta-local originals, so use it only when regenerating this documented editorial pass is intended. `node tools/beta-review.mjs` regenerates the review HTML from the saved issue data.