# Language Builder — Build Spec for an Agent

This document specifies the **logic** of Language Builder in enough detail that
another AI agent (or developer) can rebuild or extend it from scratch. It is not
a tutorial for end users — it is an implementation contract: data shapes,
module responsibilities, algorithms, and invariants.

Read `HANDOFF.md` for orientation and `README.md` for the user-facing feature
list. This file is the "how it thinks."

---

## 0. What the app is

A single-page, **100% client-side** tool for designing constructed languages
(conlangs). It has no backend, no build step, no framework, and no npm install.
Everything persists to `localStorage`. One vendored library
(`vendor/opentype.min.js`) is used only for TTF export.

If you rebuild it, keep these **hard constraints** unless told otherwise:

- **No modules / no bundler.** Every `js/*.js` file is an IIFE that attaches one
  global (`U`, `Store`, `App`, `GlyphRender`, `GlyphEditor`, `Lexicon`, …). Files
  load via classic `<script>` tags in `index.html`; **load order is the
  dependency graph** (a file may call globals defined by files above it).
- **Runs from `file://`.** No fetch of local resources; images/data come from
  user file inputs as data URLs.
- **Offline and private.** No network calls. Photo tracing, similarity, font
  export, etc. are all computed in-browser.
- **Forward-compatible data.** `Templates.normalize(project)` is the single
  migration layer: it guarantees every project object has every field the current
  code expects, so old/imported/shared data keeps working as the schema grows.
  **Every place that loads a project must run it through `normalize()`.**

---

## 1. Module map (globals & responsibilities)

| File | Global | Responsibility |
|------|--------|----------------|
| `js/util.js` | `U` | DOM/SVG hyperscript (`U.el`, `U.svg`), `U.uid`, `U.clone`, `U.clamp`, modal, toast, download, escape. |
| `js/storage.js` | `Store` | In-memory state + `localStorage` persistence; project CRUD; import/export JSON; `Store.touch()` (mark dirty + save + notify); `Store.backend` swap hook. |
| `js/templates.js` | `Templates` | Canonical schema (`blankProject`), **`normalize()` migration**, starter templates. |
| `js/glyphRender.js` | `GlyphRender` | Pure glyph → SVG. `connectionPath()`, `shapeElement()`, `render()`, `toSVGString()`. No state. |
| `js/glyphEditor.js` | `GlyphEditor` | Interactive grid character designer (nodes, connections, shapes, multi-select transform tool, icon toolbelt). |
| `js/similarity.js` | `Similarity` | Rasterize glyph → occupancy grid → Dice score; confusable-character meter. |
| `js/ruleEngine.js` | `Engine` | Node-graph rule definitions (`DEFS`) + pull-based evaluator (`run`). |
| `js/nodeEditor.js` | `NodeEditor` | Visual node-graph editor for rules + live test. |
| `js/lexicon.js` | `Lexicon` | Dictionary: words, multi-category, meaning combination, character-words. |
| `js/photoImport.js` | `PhotoImport` | "Snap": photo → traced glyph → review menu → dictionary word. |
| `js/sheetImport.js` | `SheetImport` | Import a spreadsheet (CSV/TSV/paste) → column map → review grid (category toggles, auto-assigned characters, per-word symbol picker) → dictionary words. |
| `js/compose.js` | `Compose` | Write text in the script (dictionary lookup + transliteration); run a rule over a word. |
| `js/translator.js` | `Translator` | Two-way word-by-word translation; manage translation languages. |
| `js/fontExport.js` | `FontExport` | Expand strokes to filled outlines; pack into TTF (opentype.js) + SVG font. |
| `js/learn.js` | `Learn` | Lessons, Leitner flashcards, quiz; per-word progress. |
| `js/health.js` | `Health` | Diagnostics: score, "functional?", ranked recommendations. |
| `js/share.js` | `Share` | Share link (`#lang=<base64>`), code, file; boot-time import. |
| `js/overview.js` | `Overview` | Dashboard, language settings, template picker. |
| `js/app.js` | `App` | Boot, tab routing, project switch, theme, import/export. |

**Adding a module:** create `js/x.js` as an IIFE attaching one global, add a
`<script>` in `index.html` at the correct point in load order, and (if it's a
tab) add a `.tab`, a `.view`, and a `case` in `App.renderTab`.

**Tabs → renderers** (in `App.renderTab`): `overview → Overview.render` ·
`glyphs → GlyphEditor.refresh` · `snap → PhotoImport.render` ·
`lexicon → Lexicon.render` · `rules → NodeEditor.refresh` ·
`write → Compose.render` · `translate → Translator.render` ·
`learn → Learn.render` · `health → Health.render`.

---

## 2. Data model (the schema)

`localStorage["language-builder:v1"] = { schema, activeProjectId, projects }`.
Theme is separate: `localStorage["language-builder:theme"]`.

### Project (see `Templates.blankProject`)
```js
{
  id, name, description, createdAt, updatedAt,
  style: { strokeWidth, strokeColor, nodeRadius, showGrid, bg },
  writingSystem: "alphabet" | "syllabary" | "logographic",
  autoWordForNewGlyph: false,      // if true, each new character also becomes a word
  defaultGrid: { cols, rows },     // 1..32
  glyphs: [Glyph], lexicon: [Entry], rules: [Rule],
  partsOfSpeech: [string], genders: [string],
  translationLanguages: [string], // e.g. ["English","Spanish"]
  lessons: [Lesson], progress: { [wordId]: { box, seen, correct } }
}
```

### Glyph (a character)
```js
{
  id, name, romanization, sound,
  meaning,                         // logographic gloss; also what a character-word means
  group,                           // optional family name (sidebar grouping, shared base)
  text,                            // optional literal symbol/emoji rendered as the character
  grid: { cols, rows },
  nodes: [{ id, c, r }],           // c,r are grid coords; MAY BE FRACTIONAL (see §4)
  connections: [{ id, from, to, type, curve }], // type: direct|curved|diagonal|ortho
  shapes: [{ id, type, c, r, w, h, rot }]       // BOUNDING BOX: (c,r)=top-left, w,h=span
}
```
Shape `type`: circle, ring, square, triangle, diamond, arc, dot. Shapes are
inscribed in the `(c,r,w,h)` grid box. Legacy `{c,r,size}` shapes migrate in
`normShape()`.

### Entry (a dictionary word)
```js
{
  id, headword,                    // romanization/spelling — OPTIONAL (see §5)
  translations: { [lang]: string },// meaning per natural language
  definition,                      // = translations[firstLang], kept for compat
  posList: [string], pos,          // MULTI-category; pos = posList[0] (compat)
  genderList: [string], gender,    // MULTI-category; gender = genderList[0] (compat)
  genderMode: "fixed"|"variable",  // "variable" = inherit gender from another word
  genderFrom: wordId | null,       // the word this one agrees with (when variable)
  tags: [string],
  glyphSeq: [glyphId],             // how the word is written, in your characters
  parts: [wordId],                 // compose a word from other words (compounds)
  fromGlyph: glyphId | null,       // set when this word is a single character (§5)
  notes
}
```

### Rule (a node graph) — see §6
```js
{ id, name, category, description,
  graph: { nodes: [{id,type,x,y,params}],
           connections: [{id, from:{node,socket}, to:{node,socket}}] },
  test: { word, params } }
```

**Compatibility rule:** whenever you add a multi-value field, keep the legacy
singular in sync as element `[0]` and migrate the singular into the list in
`normalize()`. Existing examples: `pos/posList`, `gender/genderList`,
`definition/translations`.

---

## 3. Rendering a glyph (`GlyphRender`, pure)

`project(glyph, box)` maps a grid coord `(c,r)` to a pixel via
`cw = box.w/cols, ch = box.h/rows; pt(c,r) = {x: box.x + c*cw, y: box.y + r*ch}`.
**All coordinates are treated as floats** — nothing rounds `c,r`.

- `connectionPath(p1,p2,type,curve)` returns an SVG path `d`:
  - `direct`: `M p1 L p2`.
  - `curved`: quadratic; control point offset perpendicular to the segment by
    `curve * len * 0.5` (curve may be negative to bow the other way).
  - `diagonal`: 45° for `min(|dx|,|dy|)`, then an axis-aligned segment.
  - `ortho`: horizontal then vertical elbow.
- `shapeElement(shape, proj, stroke, sw)` inscribes the shape in its box, applies
  `rotate(rot cx cy)`.
- `render(glyph, opts)` draws shapes (beneath), then connections, then nodes
  (only if `opts.showNodes`), plus optional grid dots. Returns an `<svg>` with
  `_proj` and `_box` attached (the editor reuses them). `opts`: `size, padding,
  style, showGrid, showNodes, background, width, height, strokeWidth, strokeColor`.

---

## 4. Character editor (`GlyphEditor`)

Modes: `node | connect | shape | select | erase`. The transparent grid **hit
layer sits above the nodes**, so nearly all interaction is resolved by grid
coordinate in `onDown` — **preserve this invariant** if you refactor.

- **node**: click a grid point to add a node; drag to move.
- **connect**: drag node→node to connect, or click two nodes; click a drawn line
  to cycle its style.
- **shape**: drag corner-to-corner; the shape fits the grid box.
- **select** (multi-select transform): `E.sel = { nodes, conns, shapes }`.
  - **Marquee**: drag on empty grid → rubber-band; selects nodes inside, plus
    connections/shapes whose midpoints are inside. Shift-click toggles; Ctrl/⌘-A
    selects all.
  - **Move**: drag the selection; grid-snapped relative to drag origin.
  - **Rotate/flip**: about the selection **centroid**. Rotation produces
    **fractional** `c,r` — this is safe because render, similarity and font export
    all treat coordinates as floats. Selected connections pull in their endpoint
    nodes (`effectiveNodes`).
  - **Delete**: button or `Delete` key (`bindKeys`, gated to the active glyphs
    view). `Esc` clears.
  - **Customize afterward**: a one-item selection opens an inspector —
    line style + **curve-amount** slider, or shape type + width/height + rotation.
    Live sliders call `redrawCanvas()` (rebuilds only the SVG so the dragged
    control survives) and `commit()` on release.
- **Toolbelt** is icon-based: inline `ICONS` map + `icon()` / `iconBtn()`
  helpers; connection styles use a 2×2 "split-square" quad.
- **Copy / paste & groups.** Glyphs carry an optional `group` (family name).
  `copyGlyph` stores a drawing to `E.clip` + `localStorage["…:glyphclip"]` (so it
  survives across projects); `pasteAsNew` makes a fresh character from it,
  `pasteInto` overlays the clip's nodes/connections/shapes onto the current glyph
  (shared starting part), and `newVariant` duplicates into the same `group`.
  `regenIds(glyph)` gives copied drawings fresh ids. Ctrl/⌘+C / +V map to copy /
  paste-as-new in `bindKeys` (skipped while text is selected). `renderList`
  buckets characters by `group` under `.glyph-group-head` headers.

`commit()` = `Store.touch()` + re-render workspace + list thumbnail.
`redrawCanvas()` = rebuild only the SVG (used by live sliders/drags).

---

## 5. Words, characters, and categories (`Lexicon`)

This is the part most recently extended — implement it carefully.

- **Multi-category (toggles):** `posList` and `genderList` are arrays; the editor
  renders them as **toggle chips** via `multiChips(options, selected, opts)` →
  `{ el, get() }`. A word can be several parts of speech at once. Table, filter,
  CSV and Learn all read the list (`posOf(e)` / `genderOf(e)` fall back to the
  legacy singular).
- **Variable gender (agreement):** a word's gender/class can be **fixed** or
  **variable** (`genderMode`). When variable, it inherits its gender from another
  word (`genderFrom` = that word's id). `L.effectiveGender(e)` resolves it,
  following the reference recursively **with a cycle guard**; change the source
  word and every dependent follows. The editor offers a Fixed / "Varies · agrees
  with a word" segmented toggle (`.seg`); the table shows a "↳ headword" marker.
  Everything that displays gender goes through `effectiveGender`.
- **Characters can be words** (no romanization required):
  - `headword` is optional. On save, if blank it is derived via
    `L.nameFromGlyphs(glyphSeq)` (join characters' romanizations, else meanings),
    else from the meaning. Only reject if there is no headword, no meaning, and no
    characters.
  - "Name from characters" button fills the headword on demand.
- **A character *as* a word** (`fromGlyph` link):
  - `L.wordFromGlyph(glyph)` — idempotent; creates a word with
    `glyphSeq=[glyph.id]`, `fromGlyph=glyph.id`, meaning = `glyph.meaning`,
    headword = `romanization || meaning || name`.
  - `L.syncWordFromGlyph(glyph)` — keeps that linked word's headword/meaning in
    step when the character is renamed/re-glossed (called from the editor's
    identity inputs).
  - `L.autoWordForGlyph(glyph)` — if `project.autoWordForNewGlyph`, create the
    word. Called by `GlyphEditor.addGlyph`. The toggle lives both in the character
    tab ("New characters auto-become words") and Overview settings.
- **Combine characters into a new word:** `L.combineMeaning(glyphSeq, parts,
  joiner)` joins the meanings of the characters (and any word `parts`) into a
  suggested compound meaning. In the editor, "Combine character meanings →" fills
  the meaning field; a live hint shows the current combination. Word `parts` let a
  word be composed of other words, and "Build spelling from parts" concatenates
  their `glyphSeq`.

**Composition/writing pipeline (`Compose`):** `spell(word)` returns the dictionary
`glyphSeq` if the headword matches, else `transliterate(word)`:
- logographic: whole word → the character whose `meaning` matches;
- otherwise: longest-prefix match over glyph `romanization`.

---

## 6. Node rule engine (`Engine`, `NodeEditor`)

- `Engine.DEFS[type] = { category, title, sockets:{in,out}, params, eval(input,
  params, ctx) }`. Socket types `string`/`bool` color the wires.
- Node types: **inputs** `input`, `param`, `const`, `lookup`; **transform**
  `prefix`, `suffix`, `concat`, `replace`, `case`; **logic** `startsWith`,
  `endsWith`, `contains`, `equals`, `not`, `and`, `or`, `select`; **output**
  `output`.
- `Engine.run(graph, ctx)` is **pull-based**: find the `output` node, resolve
  inputs backwards with a cycle guard. `ctx = { word, params, lexicon }`.
- To add a node: add a `DEFS` entry and list its type in `GROUPS`; the editor and
  evaluator pick it up automatically.

---

## 7. Similarity, font export, health (summaries)

- **Similarity:** `raster(glyph, N)` → N×N occupancy grid normalized to the
  glyph's own box (size-independent), samples dilated; `compareRasters(a,b)` =
  Dice coefficient. Used by the confusable-character meter and Health.
- **FontExport:** stroke glyphs are expanded to filled outlines (segment
  rectangles + join discs — an approximation, not a true offset), mapped to
  codepoints, packed into a TTF via opentype.js plus an SVG font.
- **Health:** runs checks over the language, scores it, reports whether it's
  "fully functional", and lists ranked recommendations with jump-to-fix actions.

---

## 8. Photo import (`PhotoImport`, offline tracing)

Goal: add dictionary words from photos, fully in-browser.

1. **Input**: `<input type="file" accept="image/*" capture="environment"
   multiple>` (the `capture` attr opens the camera on mobile). Read each file as a
   data URL → `Image`.
2. **Trace** (`P.trace(img, {detail, threshold, invert, mode})`):
   - Choose `cols/rows ≈ detail`, preserving image aspect.
   - `sampleLattice`: draw the image scaled to `(cols+1)×(rows+1)` with smoothing,
     read per-node luminance (`0.299r+0.587g+0.114b`, alpha-composited on white).
   - A lattice node is "on" if `luminance < threshold` (or `> 1-threshold` when
     inverted).
   - `mode="strokes"` (default): place a node at each on-node; connect
     orthogonally-adjacent on-nodes with `direct` lines; add a diagonal only when
     the two orthogonal cells are empty; drop stray unconnected nodes.
   - `mode="dots"`: place a `dot` shape in each mostly-dark cell.
   - Returns a glyph `{ grid, nodes, connections, shapes }`.
3. **Review menu**: one card per photo — source thumbnail, live glyph preview,
   sliders for detail/threshold, trace-style select, invert toggle; fields for
   word (headword, optional), meaning, and **category toggle chips**
   (`Lexicon.multiChips`); "also add a dictionary word" checkbox.
4. **Commit** (`commitItem`): push the traced glyph into `project.glyphs`; if
   "add word" is on, push a linked `Entry` with `glyphSeq=[glyph.id]`,
   `tags:["from-photo"]`, meaning → `translations[firstLang]`. "Add all" commits
   every pending card.

Tracing is deterministic and has **no dependencies** — reproduce it exactly and
the output is stable.

---

## 8b. Spreadsheet import (`SheetImport`)

Bulk-add dictionary words from a spreadsheet, opened from the Dictionary header
("⤓ Import sheet") which renders `SheetImport.open()` into `lexiconRoot`.

1. **Input**: a `.csv`/`.tsv` file **or** cells pasted from Excel/Google Sheets.
   `parseDelimited` is a quote-aware parser that auto-detects the delimiter (tab,
   else `;` or `,`). Excel `.xlsx` is a zip — not parsed in-browser; the UI tells
   the user to export as CSV or paste.
2. **Column mapping**: `guessMap` auto-maps by header keywords (word / meaning /
   part of speech / gender / tags); the user can override each with a select and
   toggle "first row is a header". `buildItems` derives one working item per data
   row, matching free-text pos/gender against the project's option lists
   (`matchOptions`).
3. **Review grid**: per row — include checkbox, editable word + meaning, **pos
   toggle chips** (`Lexicon.multiChips` with an `onChange` writing back to the
   item), and a **symbol slot** (`.sym-slot`). "✦ Auto-assign characters" spells
   each word from existing glyphs via `Compose.transliterate` ("imports the most
   characters" it can match).
4. **Symbol picker** (click a slot): a modal to toggle existing characters into
   the word's `glyphSeq`, auto-spell, or **make a new character** for the word
   (seeded with its romanization/meaning, pushed to `project.glyphs`).
5. **Import**: each included item becomes an `Entry` (headword falling back to
   `Lexicon.nameFromGlyphs` or the meaning), tagged `imported`.

**Two modes** (`S.mode`), auto-selected by `guessMap`: if a **symbol** column is
mapped it defaults to **"chars"** (build a language), else **"words"** (the flow
above). In chars mode the extra columns are **symbol** and **group**; each row
becomes a **character** — a glyph with `text` = the symbol, plus `meaning` and
`group` — and a linked dictionary word (`Lexicon.wordFromGlyph`). Optionally sets
`writingSystem = "logographic"`. So a sheet of *symbols + meanings + groups*
turns straight into a script + dictionary.

**Text glyphs.** A glyph may carry a literal `text` (emoji/character); `R.render`
draws it centered and scaled to the box (beneath any strokes). This is how
imported symbols display without being redrawn as strokes.

---

## 9. Styling / theme

- Design tokens live in `:root` and `body.light` (colors, `--grad-accent`,
  `--shadow*`, `--ring`, radii). Everything else references the tokens, so both
  themes and the "modern polish" layer at the bottom of `css/styles.css` come for
  free. Honor `prefers-reduced-motion`.
- Toggle theme by adding/removing `body.light`; persisted in
  `localStorage["language-builder:theme"]`.

---

## 10. Build order if starting from zero

1. `util.js`, `storage.js`, `templates.js` (schema + `normalize`).
2. `glyphRender.js`, then `glyphEditor.js` (needs render).
3. `lexicon.js` (needs render), `photoImport.js` (needs `Lexicon` + render).
4. `ruleEngine.js` → `nodeEditor.js`; `compose.js`, `translator.js`.
5. `similarity.js`, `fontExport.js`, `learn.js`, `health.js`, `share.js`.
6. `overview.js`, `app.js` (routing/boot). Wire tabs + views in `index.html`.

**Verification** (no test runner committed): serve with `node server.js`, open
the app, and drive it headless with Playwright (Chromium at
`/opt/pw-browsers/chromium`), asserting behavior + **zero console/page errors**.
Fast internal checks:
```js
Similarity.compare(gA, gB)                          // 0..1
Engine.run(rule.graph, { word, params, lexicon })
FontExport.buildFont(project).font.toArrayBuffer()  // valid TTF
Health.evaluate(project)                            // { score, label, ... }
PhotoImport.trace(img, { detail:8, threshold:.55 }) // { grid, nodes, connections, shapes }
Lexicon.combineMeaning(glyphSeq, parts)             // combined meaning string
```
