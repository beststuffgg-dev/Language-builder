/* photoImport.js — "Snap": add words to the dictionary from photos.
   Take/upload a photo; the app auto-traces it into a grid glyph (offline, no
   network), then a review menu lets you tune the trace, set the meaning and
   categories, and add it as a character + dictionary word. */
(function () {
  const P = { items: [] };
  function project() { return Store.getActive(); }

  /* ---------- Image → glyph tracing (pure, offline) ---------- */
  // Sample the image on a (cols+1)×(rows+1) lattice of luminance values.
  function sampleLattice(img, cols, rows) {
    const cv = document.createElement("canvas");
    cv.width = cols + 1; cv.height = rows + 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, cols + 1, rows + 1);
    const data = ctx.getImageData(0, 0, cols + 1, rows + 1).data;
    const lum = [];
    for (let r = 0; r <= rows; r++) {
      lum[r] = [];
      for (let c = 0; c <= cols; c++) {
        const i = (r * (cols + 1) + c) * 4;
        const a = data[i + 3] / 255;
        // transparent pixels read as "light" (blank paper)
        const l = a === 0 ? 1 : (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
        lum[r][c] = a === 0 ? 1 : l * a + (1 - a);
      }
    }
    return lum;
  }

  // Turn a photo into a glyph model. opts: {detail, threshold, invert, mode}.
  P.trace = function (img, opts) {
    opts = opts || {};
    const detail = U.clamp(Math.round(opts.detail || 8), 2, 16);
    const ar = (img.naturalWidth || img.width || 1) / (img.naturalHeight || img.height || 1);
    let cols = detail, rows = detail;
    if (ar >= 1) rows = U.clamp(Math.round(detail / ar), 2, 16);
    else cols = U.clamp(Math.round(detail * ar), 2, 16);

    const lum = sampleLattice(img, cols, rows);
    const thr = opts.threshold == null ? 0.55 : opts.threshold;
    const on = (c, r) => {
      const l = lum[r][c];
      return opts.invert ? l > (1 - thr) : l < thr; // dark ink on light paper by default
    };

    const g = { grid: { cols, rows }, nodes: [], connections: [], shapes: [] };

    if (opts.mode === "dots") {
      // one filled dot per occupied *cell* (cell center = c+.5, r+.5)
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        // a cell is occupied if its four corners lean dark
        const dark = [on(c, r), on(c + 1, r), on(c, r + 1), on(c + 1, r + 1)].filter(Boolean).length;
        if (dark >= 2) g.shapes.push({ id: U.uid("s"), type: "dot", c: c + 0.25, r: r + 0.25, w: 0.5, h: 0.5, rot: 0 });
      }
      return g;
    }

    // default "strokes": node per occupied lattice point, connect neighbours.
    const nodeAt = {};
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      if (on(c, r)) { const n = { id: U.uid("n"), c, r }; g.nodes.push(n); nodeAt[c + "," + r] = n; }
    }
    const link = (a, b) => {
      const na = nodeAt[a], nb = nodeAt[b];
      if (na && nb) g.connections.push({ id: U.uid("c"), from: na.id, to: nb.id, type: "direct", curve: 0.4 });
    };
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      if (!nodeAt[c + "," + r]) continue;
      if (c < cols) link(c + "," + r, (c + 1) + "," + r);         // right
      if (r < rows) link(c + "," + r, c + "," + (r + 1));         // down
    }
    // diagonals only where there's no orthogonal fill (traces slanted strokes)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const tl = nodeAt[c + "," + r], br = nodeAt[(c + 1) + "," + (r + 1)];
      const tr = nodeAt[(c + 1) + "," + r], bl = nodeAt[c + "," + (r + 1)];
      if (tl && br && !tr && !bl) link(c + "," + r, (c + 1) + "," + (r + 1));
      if (tr && bl && !tl && !br) link((c + 1) + "," + r, c + "," + (r + 1));
    }
    // drop stray single nodes with no connection to keep the glyph tidy
    const used = new Set();
    g.connections.forEach((cn) => { used.add(cn.from); used.add(cn.to); });
    if (g.connections.length) g.nodes = g.nodes.filter((n) => used.has(n.id));
    return g;
  };

  /* ---------- Load files ---------- */
  function loadFiles(files) {
    const p = project();
    if (!p) { U.toast("Create or open a language first.", true); return; }
    Array.prototype.forEach.call(files, (file) => {
      if (!/^image\//.test(file.type)) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const item = {
            id: U.uid("snap"), src: reader.result, img,
            name: (file.name || "symbol").replace(/\.[^.]+$/, ""),
            settings: { detail: 8, threshold: 0.55, invert: false, mode: "strokes" },
            headword: "", meaning: "", posList: [], addWord: true, done: false,
          };
          retrace(item);
          P.items.push(item);
          P.render();
        };
        img.onerror = () => U.toast("Couldn't read " + file.name, true);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function retrace(item) { item.glyph = P.trace(item.img, item.settings); }

  /* ---------- Split a grid photo into many characters ---------- */
  // Crop cell k (reading order) out of an image into a canvas (usable as a trace
  // source and as an <img> via toDataURL). bottomFrac trims the written label.
  function cropCell(img, cols, rows, k, bottomFrac) {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const cw = W / cols, ch = H / rows;
    const col = k % cols, row = Math.floor(k / cols);
    const bot = U.clamp(bottomFrac || 0, 0, 0.8), pad = 0.05;
    const sx = col * cw + cw * pad, sw = cw * (1 - 2 * pad);
    const sy = row * ch + ch * pad, sh = ch * (1 - bot - pad);
    const outW = Math.max(8, Math.round(sw)), outH = Math.max(8, Math.round(sh));
    const cv = document.createElement("canvas"); cv.width = outW; cv.height = outH;
    cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    return cv;
  }
  // Replace one grid photo with one card per cell (each traced independently).
  function splitGrid(item, cols, rows, bottom) {
    cols = U.clamp(Math.round(cols) || 1, 1, 20); rows = U.clamp(Math.round(rows) || 1, 1, 20);
    const cells = [];
    for (let k = 0; k < cols * rows; k++) {
      const cv = cropCell(item.img, cols, rows, k, bottom);
      const cell = {
        id: U.uid("snap"), src: cv.toDataURL(), img: cv, name: item.name + " " + (k + 1),
        settings: Object.assign({}, item.settings), headword: "", meaning: "", posList: [], addWord: true, done: false,
      };
      retrace(cell);
      cells.push(cell);
    }
    const idx = P.items.indexOf(item);
    if (idx >= 0) P.items.splice(idx, 1, ...cells); else P.items.push(...cells);
    U.toast("Split into " + cells.length + " characters");
    P.render();
  }

  /* ---------- Render ---------- */
  P.render = function () {
    const root = document.getElementById("snapRoot");
    if (!root) return;
    U.clear(root);
    const p = project();
    if (!p) { root.appendChild(U.el("div.empty-hint", { text: "Create or open a language first." })); return; }

    const fileIn = U.el("input", { type: "file", accept: "image/*", capture: "environment", multiple: true, hidden: true, onChange: (e) => { loadFiles(e.target.files); e.target.value = ""; } });

    const header = U.el("div.card", {}, [
      U.el("h2", { text: "Add words from a photo" }),
      U.el("p.muted", { text: "Snap or upload a photo of an object, a symbol, or handwriting. Each photo is traced into a character you can fine‑tune, name and give a meaning — then added to your dictionary. Got a whole grid/page of symbols? Use “Split a grid of symbols” on the card to turn one photo into many characters. Everything runs on your device; no photo leaves the browser." }),
      U.el("div.inline-actions", {}, [
        U.el("button.btn.primary", { text: "📷  Take / choose photos", onClick: () => fileIn.click() }),
        P.items.length ? U.el("button.btn", { text: "Add all", onClick: addAll }) : null,
        P.items.length ? U.el("button.btn.ghost", { text: "Clear", onClick: () => { P.items = []; P.render(); } }) : null,
      ]),
      fileIn,
    ]);
    root.appendChild(header);

    const pending = P.items.filter((it) => !it.done);
    if (!pending.length) {
      root.appendChild(U.el("div.empty-hint", { text: "No photos yet. Take or choose a photo to generate your first symbol." }));
      return;
    }
    const grid = U.el("div.snap-grid");
    pending.forEach((item) => grid.appendChild(buildCard(item, p)));
    root.appendChild(grid);
  };

  function buildCard(item, p) {
    const logographic = p.writingSystem === "logographic";
    const card = U.el("div.snap-card");

    // previews: photo + generated glyph
    const glyphPrev = U.el("div.snap-glyph");
    const drawGlyph = () => {
      U.clear(glyphPrev);
      const g = Object.assign({ nodes: [], connections: [], shapes: [] }, item.glyph);
      glyphPrev.appendChild(GlyphRender.render(g, { size: 150, style: p.style, showGrid: false, strokeWidth: p.style.strokeWidth, background: p.style.bg }));
    };
    drawGlyph();
    card.appendChild(U.el("div.snap-previews", {}, [
      U.el("div.snap-photo", {}, [U.el("img", { src: item.src, alt: item.name })]),
      U.el("div.snap-arrow", { text: "→" }),
      glyphPrev,
    ]));

    // trace controls
    const redo = () => { retrace(item); drawGlyph(); };
    const detail = U.el("input", { type: "range", min: "3", max: "16", step: "1", value: item.settings.detail, onInput: (e) => { item.settings.detail = +e.target.value; redo(); } });
    const thresh = U.el("input", { type: "range", min: "0.15", max: "0.9", step: "0.02", value: item.settings.threshold, onInput: (e) => { item.settings.threshold = +e.target.value; redo(); } });
    const invert = U.el("input", { type: "checkbox", checked: item.settings.invert, onChange: (e) => { item.settings.invert = e.target.checked; redo(); } });
    const modeSel = U.el("select", { onChange: (e) => { item.settings.mode = e.target.value; redo(); } });
    [["strokes", "Line trace"], ["dots", "Dot trace"]].forEach(([v, l]) => modeSel.appendChild(U.el("option", { value: v, text: l, selected: item.settings.mode === v })));

    card.appendChild(U.el("div.snap-controls", {}, [
      U.el("label.field", {}, ["Detail", detail]),
      U.el("label.field", {}, ["Ink threshold", thresh]),
      U.el("label.field", {}, ["Trace style", modeSel]),
      U.el("label", { style: { display: "flex", gap: "6px", alignItems: "center", fontSize: "12px" } }, [invert, "Invert (light ink on dark)"]),
    ]));

    // Split a whole grid/page of symbols into one character per cell.
    const gCols = U.el("input", { type: "number", min: "1", max: "20", value: 5 });
    const gRows = U.el("input", { type: "number", min: "1", max: "20", value: 7 });
    const gBot = U.el("input", { type: "range", min: "0", max: "0.6", step: "0.02", value: 0.26 });
    card.appendChild(U.el("details.mini-details", {}, [
      U.el("summary", { text: "Split a grid of symbols → many characters" }),
      U.el("div.snap-controls", {}, [
        U.el("label.field", {}, ["Columns", gCols]),
        U.el("label.field", {}, ["Rows", gRows]),
        U.el("label.field", {}, ["Ignore bottom label", gBot]),
      ]),
      U.el("div.hint", { text: "For a photo of a grid/table of symbols: each cell becomes its own character card (label band trimmed)." }),
      U.el("button.btn.small.primary", { text: "Split into cells", onClick: () => splitGrid(item, +gCols.value, +gRows.value, +gBot.value) }),
    ]));

    // word fields
    const headIn = U.el("input", { value: item.headword, placeholder: logographic ? "romanization (optional)" : "romanized spelling", onInput: (e) => { item.headword = e.target.value; } });
    const meanIn = U.el("input", { value: item.meaning, placeholder: "what it means (e.g. water)", onInput: (e) => { item.meaning = e.target.value; } });
    const posChips = Lexicon.multiChips(p.partsOfSpeech, item.posList, { empty: "no parts of speech defined" });
    item._posChips = posChips;
    const addWord = U.el("input", { type: "checkbox", checked: item.addWord, onChange: (e) => { item.addWord = e.target.checked; } });

    card.appendChild(U.el("div.snap-fields", {}, [
      U.el("label.field", {}, ["Word", headIn]),
      U.el("label.field", {}, ["Meaning", meanIn]),
      U.el("div.field", {}, [U.el("span", { text: "Categories (any that apply)", style: { fontSize: "12px", color: "var(--text-dim)" } }), posChips.el]),
      U.el("label", { style: { display: "flex", gap: "6px", alignItems: "center", fontSize: "12px" } }, [addWord, "Also add a dictionary word (not just a character)"]),
    ]));

    card.appendChild(U.el("div.inline-actions", { style: { marginTop: "4px" } }, [
      U.el("button.btn.primary", { text: "Add", onClick: () => commitItem(item) }),
      U.el("button.btn.ghost", { text: "Skip", onClick: () => { P.items = P.items.filter((x) => x !== item); P.render(); } }),
    ]));
    return card;
  }

  /* ---------- Commit ---------- */
  function commitItem(item) {
    const p = project();
    if (!p) return;
    const logographic = p.writingSystem === "logographic";
    const posList = item._posChips ? item._posChips.get() : item.posList;
    const meaning = (item.meaning || "").trim();
    const rom = (item.headword || "").trim();

    const glyph = {
      id: U.uid("gly"),
      name: item.name || rom || meaning || "symbol",
      romanization: rom,
      sound: "",
      meaning: meaning, // logograms carry their meaning
      grid: U.clone(item.glyph.grid),
      nodes: U.clone(item.glyph.nodes),
      connections: U.clone(item.glyph.connections),
      shapes: U.clone(item.glyph.shapes),
    };
    if (!glyph.nodes.length && !glyph.connections.length && !glyph.shapes.length) {
      U.toast("Trace looks empty — adjust detail/threshold first.", true); return;
    }
    p.glyphs.push(glyph);

    if (item.addWord) {
      const headword = rom || meaning || glyph.name;
      const langs = p.translationLanguages.length ? p.translationLanguages : ["English"];
      const translations = {};
      if (meaning) translations[langs[0]] = meaning;
      p.lexicon.push({
        id: U.uid("word"), headword,
        translations, definition: meaning,
        posList: posList, pos: posList[0] || "",
        genderList: [], gender: "",
        tags: ["from-photo"], glyphSeq: [glyph.id], parts: [], notes: "Imported from a photo.",
      });
    }
    Store.touch();
    item.done = true;
    P.items = P.items.filter((x) => x !== item);
    U.toast("Added " + (glyph.romanization || glyph.meaning || glyph.name));
    P.render();
  }

  function addAll() {
    const snapshot = P.items.slice();
    snapshot.forEach((it) => { if (!it.done) commitItem(it); });
  }

  window.PhotoImport = P;
})();
