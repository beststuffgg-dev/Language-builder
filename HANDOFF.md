# Language Builder — Handoff

A tool for designing constructed languages (conlangs): a grid‑based glyph
designer, a dictionary, a visual node system for grammar rules, a translator,
font export, sharing, a learning section, and a health/diagnostics view.

- **Repo:** `beststuffgg-dev/language-builder`
- **Working branch:** `claude/language-creator-node-grid-ixmgyg` (all work lives here)
- **Latest commit at handoff:** `50d282f`
- **Stack:** plain HTML/CSS/vanilla JS, **no build step, no framework, no npm
  install required.** One vendored library (`opentype.js`) for font export.

---

## 1. Status at a glance

Everything requested so far is implemented, pushed, and smoke‑tested in a
headless browser with **zero console errors**. The app is fully usable.

**Open items (need a decision, no code blocked):**

1. **No PR yet.** The repository was created empty, so it has **no base branch**
   (`main` doesn't exist) to open a pull request against. Options: create `main`
   and open a PR into it; push this branch as `main` directly; or leave it on the
   feature branch. Creating another branch needs the owner's go‑ahead.
2. Nothing else is pending. Enhancement ideas are listed in §8.

---

## 2. Running it

**Locally (zero setup):** open `index.html` in a browser. Works from `file://`
because there are no ES modules — scripts load via classic `<script>` tags.
State autosaves to `localStorage`.

**Locally (server, if `file://` is restricted):**
```bash
node server.js         # → http://localhost:8080  (Node stdlib only, no install)
```

**Hosted:** it's 100% static — deploy the folder to GitHub Pages / Netlify /
Vercel / S3 / nginx, or run `PORT=3000 HOST=0.0.0.0 node server.js`.

**Swap storage for a backend later:** set `Store.backend = { load(), save(data) }`
in `js/storage.js`; nothing else changes.

---

## 3. Architecture / file map

Load order matters (globals, no modules) and is defined in `index.html`:

```
index.html            markup, tab shell, <script> load order
css/styles.css        dark theme + `body.light` overrides (light mode)
vendor/opentype.min.js  vendored TTF writer (offline), UMD global `opentype`

js/util.js            U.*  — DOM/SVG builders (U.el, U.svg), modal, toast, download
js/storage.js         Store.* — state + localStorage persistence, import/export,
                      swappable `Store.backend` hook
js/templates.js       Templates.* — canonical project schema, normalize(),
                      starter templates. **normalize() is the migration layer.**
js/glyphRender.js     GlyphRender.* — pure glyph → SVG (connection styles, shapes)
js/glyphEditor.js     GlyphEditor.* — interactive grid designer (drag-based)
js/similarity.js      Similarity.* — rasterize glyph → occupancy grid → Dice score
js/ruleEngine.js      Engine.* — node definitions (DEFS) + pull-based evaluator
js/nodeEditor.js      NodeEditor.* — visual node-graph editor + live test
js/lexicon.js         Lexicon.* — dictionary (translations, word parts)
js/compose.js         Compose.* — writing / transliteration / rule runner
js/translator.js      Translator.* — two-way translator + language management
js/fontExport.js      FontExport.* — glyph → filled outline → TTF/SVG font
js/learn.js           Learn.* — lessons, flashcards (Leitner), quiz
js/health.js          Health.* — diagnostics: score, "functional?", recommendations
js/share.js           Share.* — share link/code/file + boot-time import
js/overview.js        Overview.* — dashboard, settings, template picker
js/app.js             App.* — boot, tab routing, project switch, theme, import/export
server.js             optional zero-dependency static server
```

Each `js/*` file is an IIFE that attaches one global (`U`, `Store`, `App`, …).
There is no bundler; add a new file by adding a `<script>` in `index.html` at the
right point in the load order.

### Tabs → renderers (in `App.renderTab`)
`overview → Overview.render` · `glyphs → GlyphEditor.refresh` ·
`lexicon → Lexicon.render` · `rules → NodeEditor.refresh` ·
`write → Compose.render` · `translate → Translator.render` ·
`learn → Learn.render` · `health → Health.render`.

---

## 4. Data model

`localStorage["language-builder:v1"]` holds `{ schema, activeProjectId, projects }`.
Theme is stored separately at `localStorage["language-builder:theme"]`.

**Project** (see `Templates.blankProject`):
```js
{
  id, name, description, createdAt, updatedAt,
  style: { strokeWidth, strokeColor, nodeRadius, showGrid, bg },
  writingSystem: "alphabet" | "syllabary" | "logographic",
  defaultGrid: { cols, rows },              // grids allowed 1..32
  glyphs: [Glyph], lexicon: [Entry], rules: [Rule],
  partsOfSpeech: [string], genders: [string],
  translationLanguages: [string],           // e.g. ["English","Spanish"]
  lessons: [Lesson], progress: { [wordId]: { box, seen, correct } }
}
```

**Glyph:**
```js
{ id, name, romanization, sound, meaning,   // meaning = logographic gloss
  grid: { cols, rows },
  nodes: [{ id, c, r }],                     // c,r are grid coordinates
  connections: [{ id, from, to, type, curve }],  // type: direct|curved|diagonal|ortho
  shapes: [{ id, type, c, r, w, h, rot }] }  // BOUNDING BOX: (c,r)=top-left, w,h=span
```
Shape `type`: circle, ring, square, triangle, diamond, arc, dot. Shapes are
inscribed in the (c,r,w,h) grid box — that's what makes "drag corner-to-corner
fits in the grid" work. Legacy `{c,r,size}` shapes are migrated in `normShape()`.

**Entry (dictionary word):**
```js
{ id, headword, translations: { [lang]: string }, definition,  // definition = primary translation, kept for compat
  pos, gender, tags: [string], glyphSeq: [glyphId],
  parts: [wordId],                           // compose a word from other words
  notes }
```

**Rule (node graph):**
```js
{ id, name, category: "conjugation"|"grammar"|"orthography", description,
  graph: {
    nodes: [{ id, type, x, y, params }],
    connections: [{ id, from:{node,socket}, to:{node,socket} }]
  },
  test: { word, params } }
```

---

## 5. Two subsystems worth understanding

### Node rule engine (`ruleEngine.js`)
- `Engine.DEFS` maps a node `type` → `{ category, title, sockets:{in,out}, params,
  eval(input, params, ctx) }`. Sockets are typed `string` or `bool` (wire color).
- Node types: **inputs** `input` (the word), `param` (a runtime feature like
  gender/tense), `const`, `lookup` (another dictionary word — lets any part of a
  word be another word); **transform** `prefix`, `suffix`, `concat`, `replace`,
  `case`; **logic** `startsWith`, `endsWith`, `contains`, `equals`, `not`, `and`,
  `or`, `select` (if/else); **output** `output`.
- `Engine.run(graph, ctx)` is **pull-based**: it finds the `output` node and
  resolves inputs backwards, with a cycle guard. Callers pass
  `ctx = { word, params, lexicon }` (lexicon is needed by `lookup`).
- To add a node: add an entry to `DEFS` and list its type in `GROUPS`. The editor
  and evaluator pick it up automatically.

### Glyph similarity (`similarity.js`)
- `Similarity.raster(glyph, N)` rasterizes strokes+shapes into an N×N occupancy
  grid, **normalized to the glyph's own grid box** (so size-independent), with
  samples dilated so near-misses still overlap.
- `Similarity.compareRasters(a,b)` = Dice coefficient (0..1).
- Used live in the Characters tab (confusable-character meter) and by the Health
  tab (`confusablePairs`).

---

## 6. Feature checklist (all implemented)

- **Characters:** custom grid up to 32×32; nodes; four connection styles
  (direct / curved / diagonal+straight / orthogonal); shapes drag‑to‑fit inside
  the grid; per‑language style; **similarity meter**; SVG export.
- **Editing model:** drag a node to move; **drag node→node to connect** (or
  multi‑click); drag corner‑to‑corner for shapes. (Note: the grid hit‑layer sits
  above nodes, so all interaction is routed by grid coordinate in
  `glyphEditor.onDown` — keep that invariant if you refactor.)
- **Writing systems:** alphabet / syllabary / **logographic (hieroglyphs)**;
  per‑glyph `meaning`; write by meaning in Compose/Translator.
- **Dictionary:** translations in any number of natural languages; part of
  speech; gender/class; tags; glyph spelling; **word parts** (compose a word from
  other words); CSV export.
- **Rules (node programming):** see §5; live test panel per rule.
- **Compose:** dictionary lookup + longest‑match transliteration; run a rule over
  a word; composition SVG export.
- **Translator:** two‑way between the conlang and any natural language you add;
  strictly word‑by‑word (no natural‑language grammar imposed → a blank language
  is a real blank slate).
- **Font export:** stroke glyphs are expanded to filled outlines and packed into a
  real `.ttf` (via vendored opentype.js) plus an SVG font; codepoint‑mapping table
  and live preview.
- **Sharing:** share link (`#lang=<base64>`), copy‑paste code, or file; opening a
  link / pasting a code imports the language (`Share.checkHash` runs on boot).
- **Learn:** lessons (grouped vocab), flashcards with Leitner boxes, quiz;
  per‑word progress.
- **Health:** runs tests over the language, scores it, says whether it's fully
  functional, and lists ranked recommendations with jump‑to‑fix buttons.
- **Light/dark mode:** top‑bar toggle, remembered per browser.
- **Templates:** Blank, Blank high‑res (10×10), Logographic (hieroglyphs),
  Runic, Flowing, Syllabary+gender. No example language is auto‑seeded — an empty
  app shows the template picker.

---

## 7. Testing

- No committed test suite. Verification was done with **Playwright smoke scripts**
  driving the app at `http://127.0.0.1:8080` and asserting behavior + zero
  console/page errors. Chromium is available at `/opt/pw-browsers/chromium` and
  `playwright` resolves from the global modules path.
- A quick manual pass: `node server.js`, open the app, try each tab.
- Fast internal checks used during development:
  ```js
  Similarity.compare(gA, gB)                    // 0..1
  Engine.run(rule.graph, { word, params, lexicon })
  FontExport.buildFont(project).font.toArrayBuffer()   // → valid TTF
  Health.evaluate(project)                      // { score, label, fullyFunctional, checks }
  ```
- If you add tests, a `tests/` folder with the Playwright scripts + a
  `package.json` script would be the natural next step.

---

## 8. Suggested next steps / known limitations

- **Open the PR** once a base branch exists (see §1).
- **Font outlines** use rounded stroke expansion (segment rectangles + join
  discs), which looks faithful but isn't a true mathematical stroke offset —
  corners can be slightly rounded. A proper offset/union would sharpen joins.
- **Rules apply one at a time** — there's no morphology *pipeline* chaining
  several rules into one derivation yet. A rule‑ordering/pipeline UI is the
  obvious extension.
- **Transliteration** is longest‑prefix match, not full phonological rules.
- **Share links** embed the whole language as base64 in the URL; very large
  languages make long links (the dialog nudges toward the file for those).
- **No multi‑user/cloud sync** — everything is local until you wire up
  `Store.backend`.

---

## 9. Git / operational notes

- Develop on `claude/language-creator-node-grid-ixmgyg`; push with
  `git push -u origin claude/language-creator-node-grid-ixmgyg`.
- `vendor/opentype.min.js` is committed intentionally (offline font export). It's
  the only third‑party file; everything else is first‑party and dependency‑free.
- `.gitignore` covers `node_modules/`, logs, editor dirs.
