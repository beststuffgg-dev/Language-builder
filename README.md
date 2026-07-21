# Language Builder

Design your own constructed language (conlang) end‑to‑end — a grid‑based
**character/glyph designer**, a **dictionary** with definitions and grammar
features, and a **visual node system** for programming conjugation and grammar
rules. Built to be as adaptable as possible.

It is a **100% static web app** (plain HTML/CSS/JS, no build step, no
dependencies), so it runs locally by just opening a file, and it can be hosted
on any static server without changes.

---

## Running it

### 1. Locally — zero setup
Just open `index.html` in a browser. Everything works from `file://`
(no modules, no bundler). Your work is saved automatically in the browser's
`localStorage`.

### 2. Locally — with the bundled server
Some browsers restrict `file://`. If anything looks off, serve it:

```bash
node server.js
# → http://localhost:8080
```

No `npm install` needed — `server.js` uses only Node's standard library.

### 3. Web hosted
Because it's fully static, deploy the folder anywhere:

- **GitHub Pages / Netlify / Vercel / S3 / nginx / Apache** — drop the files in.
- Or run the included Node server behind your platform:
  ```bash
  PORT=3000 HOST=0.0.0.0 node server.js
  ```

Swapping browser storage for a real backend later is a one‑liner: set
`Store.backend = { load(){…}, save(data){…} }` in `js/storage.js` to point at
your API, and the rest of the app is unchanged.

---

## Features

### Characters (grid glyph designer)
- **Custom grid size per glyph** (columns × rows, up to 24×24).
- Place **nodes** on grid points; drag to move.
- Connect nodes with four **connection styles**:
  1. **Direct** – straight line
  2. **Curved** – adjustable bezier arc
  3. **Diagonal + straight** – 45° diagonal then an axis‑aligned segment
  4. **Straight (L)** – orthogonal right‑angle elbow

  *(Click any drawn line to cycle its style.)*
- **Basic shapes**: circle, ring, square, triangle, diamond, arc, dot — sized
  and placed on the grid.
- Per‑language style (stroke width, colors, grid visibility).
- **Export** any glyph as SVG.

### Dictionary
- Words with **definition, part of speech, gender/class, and tags**.
- **Spell** each word from your own glyphs.
- Search/filter and **export to CSV**.
- Parts of speech and genders are fully configurable per language.

### Rules — visual node programming
Build conjugation, grammar, and orthography rules as **node graphs**. Drag
nodes, wire outputs → inputs, and test live. Node types include:

- **Inputs**: Word In, Parameter (reads features like `gender`, `tense`,
  `number` that you set at run time), Text.
- **Transform**: Add Prefix, Add Suffix, Join, Replace, Change Case.
- **Logic**: Starts With?, Ends With?, Contains?, Equals?, Not, And, Or, and
  **If / Else** for conditional grammar (e.g. *append a gender symbol only when
  the word is feminine*, or *require a prefix at the start of a word*).
- **Output**: Result Out.

The engine evaluates by pulling from the output backwards, so node order never
matters and cycles are handled safely.

### Compose
- Write text and see it rendered in your script — dictionary words use their
  saved spelling; other words are **transliterated** from your glyph sounds by
  longest match.
- Run any rule over a word and see the inflected form written out.
- Export a whole composition as SVG.

### Templates
Start from **Blank**, **Runic / angular**, **Flowing script**, or
**Syllabary + gender** — each seeds sample glyphs, words, and rules you can
freely edit.

### Portability
- Autosaves to `localStorage`.
- **Export / Import** a single language or your whole archive as JSON to back up
  or move between devices.

---

## Project layout

```
index.html          markup + script load order
css/styles.css      styling (dark theme)
js/util.js          DOM/SVG helpers, modal, toast
js/storage.js       state + persistence (localStorage; swappable backend hook)
js/templates.js     project schema, normalize(), starter templates
js/glyphRender.js   pure glyph → SVG (connection styles, shapes)
js/glyphEditor.js   interactive grid character designer
js/ruleEngine.js    node definitions + graph evaluator
js/nodeEditor.js    visual node-graph editor + live test
js/lexicon.js       dictionary
js/compose.js       writing / transliteration / rule runner
js/overview.js      dashboard, settings, template picker
js/app.js           boot, tabs, project switching, import/export
server.js           optional zero-dependency static server
```

## License
MIT
