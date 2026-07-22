/* sheetImport.js — import a spreadsheet into the dictionary.
   Upload a CSV/TSV (or paste cells copied from Excel / Google Sheets), map the
   columns, then review each word: toggle its categories, let it auto-assign the
   characters that spell it, and click the little symbol box to pick or make a
   character for it. Runs entirely in the browser. */
(function () {
  const S = { rows: [], headers: [], hasHeader: true, map: {}, items: [], ready: false };
  function project() { return Store.getActive(); }

  /* ---------- Parsing (CSV / TSV, quote-aware) ---------- */
  function parseDelimited(text) {
    text = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const first = text.split("\n")[0] || "";
    const delim = first.indexOf("\t") >= 0 ? "\t" : (first.indexOf(";") >= 0 && first.indexOf(",") < 0 ? ";" : ",");
    const rows = []; let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  }

  function loadText(text) {
    const rows = parseDelimited(text);
    if (!rows.length) { U.toast("Nothing to import — is the sheet empty?", true); return; }
    S.rows = rows;
    S.hasHeader = looksLikeHeader(rows[0]);
    S.headers = S.hasHeader ? rows[0].map((h) => String(h).trim()) : rows[0].map((_, i) => "Column " + (i + 1));
    guessMap();
    buildItems();
    S.ready = true;
    S.render();
  }
  function looksLikeHeader(r) { return r.every((c) => String(c).trim() !== "" && isNaN(+c)); }

  /* ---------- Column mapping ---------- */
  function guessMap() {
    const H = S.headers.map((h) => (h || "").toLowerCase());
    const find = (keys) => { for (let i = 0; i < H.length; i++) if (keys.some((k) => H[i].includes(k))) return i; return -1; };
    S.map = {
      symbol: find(["symbol", "character", "glyph", "char", "sign", "logogram", "emoji", "picture"]),
      word: find(["word", "headword", "term", "spelling", "conlang", "native", "romaniz"]),
      meaning: find(["meaning", "definition", "translation", "english", "gloss", "sense"]),
      group: find(["group", "family", "category", "set", "type", "class"]),
      pos: find(["part of speech", "part-of-speech", "pos", "word class", "wordclass"]),
      gender: find(["gender", "declension"]),
      tags: find(["tag", "note"]),
    };
    if (S.map.word < 0 && S.map.symbol < 0) S.map.word = 0;
    if (S.map.meaning < 0) { for (let i = 0; i < S.headers.length; i++) if (i !== S.map.word && i !== S.map.symbol && i !== S.map.group) { S.map.meaning = i; break; } }
    // If there's a symbol column, default to building a language of characters.
    S.mode = S.map.symbol >= 0 ? "chars" : "words";
  }

  function dataRows() { return S.hasHeader ? S.rows.slice(1) : S.rows; }
  function cell(r, idx) { return idx != null && idx >= 0 && r[idx] != null ? String(r[idx]).trim() : ""; }
  function matchOptions(raw, opts) {
    if (!raw) return [];
    const parts = raw.toLowerCase().split(/[;,/|]/).map((s) => s.trim()).filter(Boolean);
    return opts.filter((o) => o !== "—" && parts.some((pp) => pp === o.toLowerCase() || o.toLowerCase().startsWith(pp) || pp.startsWith(o.toLowerCase())));
  }
  function buildItems() {
    const p = project();
    S.items = dataRows().map((r) => {
      const headword = cell(r, S.map.word), meaning = cell(r, S.map.meaning);
      const tagsRaw = cell(r, S.map.tags);
      const symbol = cell(r, S.map.symbol), group = cell(r, S.map.group);
      return {
        include: !!(headword || meaning || symbol),
        headword, meaning, symbol, group,
        posList: matchOptions(cell(r, S.map.pos), p.partsOfSpeech),
        genderList: matchOptions(cell(r, S.map.gender), p.genders),
        tags: tagsRaw ? tagsRaw.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : [],
        glyphSeq: [],
      };
    });
  }

  /* ---------- Auto-assign characters (transliterate from your glyphs) ---------- */
  function autoSpell(item) {
    if (!window.Compose || !Compose.transliterate) return;
    const seq = Compose.transliterate(item.headword || item.meaning || "");
    if (seq && seq.length) item.glyphSeq = seq;
  }
  function autoSpellAll() {
    let n = 0;
    S.items.forEach((it) => { if (it.include) { autoSpell(it); if (it.glyphSeq.length) n++; } });
    U.toast(n ? "Auto-assigned characters for " + n + " word" + (n === 1 ? "" : "s") : "No characters matched — add symbols with the boxes.");
    S.render();
  }

  /* ---------- Render ---------- */
  S.open = function () {
    S.ready = false; S.rows = []; S.items = [];
    S.render();
  };

  S.render = function () {
    const root = document.getElementById("lexiconRoot");
    if (!root) return;
    U.clear(root);
    const p = project();
    if (!p) { root.appendChild(U.el("div.empty-hint", { text: "Create or open a language first." })); return; }

    root.appendChild(U.el("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", flexWrap: "wrap" } }, [
      U.el("h2", { text: "Import spreadsheet", style: { margin: "0" } }),
      U.el("span.hint", { text: "→ dictionary", style: { flex: "1" } }),
      U.el("button.btn.ghost", { text: "← Back to dictionary", onClick: () => Lexicon.render() }),
    ]));

    if (!S.ready) { renderInput(root); return; }
    renderMapping(root);
    if (S.mode === "chars") renderCharsReview(root);
    else renderReview(root);
  };

  function renderInput(root) {
    const fileIn = U.el("input", { type: "file", accept: ".csv,.tsv,.txt", hidden: true, onChange: (e) => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      if (/\.xlsx?$/i.test(f.name)) { U.toast("Excel file: open it and “Save as CSV”, or copy the cells and paste below.", true); }
      const rd = new FileReader(); rd.onload = () => loadText(rd.result); rd.readAsText(f);
    } });
    const paste = U.el("textarea", { rows: 8, placeholder: "…or paste rows copied straight from Excel / Google Sheets here (tabs or commas both work).", style: { width: "100%" } });
    root.appendChild(U.el("div.card", {}, [
      U.el("p.muted", { text: "Import in bulk. Upload a .csv / .tsv file, or paste cells copied from a spreadsheet. If a column holds the symbols (emoji, characters, signs), each row becomes a character in your language — with its meaning and group — so a sheet of symbols + meanings + groups turns straight into a working script and dictionary. Otherwise each row is added as a word. You map the columns and review everything first." }),
      U.el("div.inline-actions", {}, [
        U.el("button.btn.primary", { text: "📄  Choose CSV / TSV file", onClick: () => fileIn.click() }),
        fileIn,
      ]),
      U.el("div.flabel", { text: "Or paste:", style: { marginTop: "10px" } }),
      paste,
      U.el("div.inline-actions", { style: { marginTop: "8px" } }, [
        U.el("button.btn", { text: "Parse pasted rows", onClick: () => { if (paste.value.trim()) loadText(paste.value); else U.toast("Paste some rows first.", true); } }),
      ]),
    ]));
  }

  function colSelect(key, allowNone) {
    const sel = U.el("select", { onChange: (e) => { S.map[key] = +e.target.value; buildItems(); S.render(); } });
    if (allowNone) sel.appendChild(U.el("option", { value: "-1", text: "— none —", selected: S.map[key] === -1 }));
    S.headers.forEach((h, i) => sel.appendChild(U.el("option", { value: String(i), text: h, selected: S.map[key] === i })));
    return sel;
  }

  function renderMapping(root) {
    const hdrChk = U.el("input", { type: "checkbox", checked: S.hasHeader, onChange: (e) => {
      S.hasHeader = e.target.checked;
      S.headers = S.hasHeader ? S.rows[0].map((h) => String(h).trim()) : S.rows[0].map((_, i) => "Column " + (i + 1));
      buildItems(); S.render();
    } });
    const modeSeg = U.el("div.seg", {}, [
      U.el("button.btn.small" + (S.mode === "chars" ? ".active" : ""), { type: "button", text: "Build characters (a language)", onClick: () => { S.mode = "chars"; S.render(); } }),
      U.el("button.btn.small" + (S.mode === "words" ? ".active" : ""), { type: "button", text: "Add words", onClick: () => { S.mode = "words"; S.render(); } }),
    ]);
    root.appendChild(U.el("div.card", {}, [
      U.el("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "10px" } }, [
        U.el("span.flabel", { text: "Each row is a…" }), modeSeg,
        U.el("span.hint", { text: S.mode === "chars" ? "→ a character (symbol + meaning + group) becomes part of your language" : "→ a dictionary word spelled from existing characters" }),
      ]),
      U.el("div.sheet-map", {}, [
        S.mode === "chars" ? U.el("label.field", {}, ["Symbol", colSelect("symbol", true)]) : U.el("label.field", {}, ["Word", colSelect("word", false)]),
        U.el("label.field", {}, ["Meaning", colSelect("meaning", true)]),
        U.el("label.field", {}, ["Group / family", colSelect("group", true)]),
        U.el("label.field", {}, ["Part of speech", colSelect("pos", true)]),
        U.el("label.field", {}, [S.mode === "chars" ? "Word (romanization)" : "Gender / class", colSelect(S.mode === "chars" ? "word" : "gender", true)]),
        U.el("label.field", {}, ["Tags", colSelect("tags", true)]),
      ]),
      U.el("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", marginTop: "8px" } }, [hdrChk, "First row is a header"]),
    ]));
  }

  function renderReview(root) {
    const p = project();
    const count = () => S.items.filter((it) => it.include).length;

    const bar = U.el("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" } }, [
      U.el("span.hint", { text: S.items.length + " rows · " + count() + " selected", style: { flex: "1" } }),
      U.el("button.btn", { text: "✦ Auto-assign characters", title: "Spell each word using your existing characters (longest match)", onClick: autoSpellAll }),
      U.el("button.btn.primary", { text: "Import " + count() + " words", onClick: doImport }),
    ]);
    root.appendChild(bar);

    const table = U.el("table.lex.sheet-table");
    table.appendChild(U.el("thead", {}, [U.el("tr", {}, [
      U.el("th", { text: "" }), U.el("th", { text: "Word" }), U.el("th", { text: "Meaning" }),
      U.el("th", { text: "Part of speech" }), U.el("th", { text: "Symbol" }),
    ])]));
    const tbody = U.el("tbody");
    S.items.forEach((item) => {
      const inc = U.el("input", { type: "checkbox", checked: item.include, onChange: (e) => { item.include = e.target.checked; } });
      const wordIn = U.el("input", { value: item.headword, style: { minWidth: "110px" }, onInput: (e) => { item.headword = e.target.value; } });
      const meanIn = U.el("input", { value: item.meaning, style: { minWidth: "120px" }, onInput: (e) => { item.meaning = e.target.value; } });
      const chips = Lexicon.multiChips(p.partsOfSpeech, item.posList, { onChange: (v) => (item.posList = v), empty: "—" });
      const slot = U.el("div.sym-slot", { title: "add / choose a symbol", onClick: () => openSymbolPicker(item, slot) });
      drawSlot(slot, item);
      tbody.appendChild(U.el("tr", {}, [
        U.el("td", {}, [inc]),
        U.el("td", {}, [wordIn]),
        U.el("td", {}, [meanIn]),
        U.el("td", {}, [chips.el]),
        U.el("td", {}, [slot]),
      ]));
    });
    table.appendChild(tbody);
    root.appendChild(table);
  }

  /* ---------- Characters mode: build a language from symbol+meaning+group ---------- */
  function renderCharsReview(root) {
    const p = project();
    const count = () => S.items.filter((it) => it.include).length;
    const logoChk = U.el("input", { type: "checkbox", checked: S.logographic !== false, onChange: (e) => { S.logographic = e.target.checked; } });

    const bar = U.el("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" } }, [
      U.el("span.hint", { text: S.items.length + " rows · " + count() + " characters", style: { flex: "1" } }),
      U.el("label", { style: { display: "flex", gap: "6px", alignItems: "center", fontSize: "12px" } }, [logoChk, "Logographic (1 character = 1 word)"]),
      U.el("button.btn.primary", { text: "Build language (" + count() + ")", onClick: doImportChars }),
    ]);
    root.appendChild(bar);

    const groupsSeen = Array.from(new Set(S.items.map((it) => it.group).filter(Boolean)));
    const dl = U.el("datalist", { id: "sheetGroups" }, groupsSeen.map((g) => U.el("option", { value: g })));
    root.appendChild(dl);

    const table = U.el("table.lex.sheet-table");
    table.appendChild(U.el("thead", {}, [U.el("tr", {}, [
      U.el("th", { text: "" }), U.el("th", { text: "Symbol" }), U.el("th", { text: "Meaning" }), U.el("th", { text: "Word" }), U.el("th", { text: "Group" }),
    ])]));
    const tbody = U.el("tbody");
    S.items.forEach((item) => {
      const inc = U.el("input", { type: "checkbox", checked: item.include, onChange: (e) => { item.include = e.target.checked; } });
      const preview = U.el("div.sym-slot", { style: { cursor: "default" } });
      const drawPrev = () => { U.clear(preview); preview.appendChild(GlyphRender.render({ grid: p.defaultGrid, nodes: [], connections: [], shapes: [], text: item.symbol || "" }, { size: 34, style: p.style, strokeWidth: 3 })); };
      drawPrev();
      const symIn = U.el("input", { value: item.symbol, style: { width: "64px" }, title: "the symbol shown for this character", onInput: (e) => { item.symbol = e.target.value; drawPrev(); } });
      const meanIn = U.el("input", { value: item.meaning, style: { minWidth: "120px" }, onInput: (e) => { item.meaning = e.target.value; } });
      const wordIn = U.el("input", { value: item.headword, placeholder: "optional", style: { minWidth: "90px" }, onInput: (e) => { item.headword = e.target.value; } });
      const groupIn = U.el("input", { value: item.group, list: "sheetGroups", placeholder: "optional", style: { minWidth: "100px" }, onInput: (e) => { item.group = e.target.value; } });
      tbody.appendChild(U.el("tr", {}, [
        U.el("td", {}, [inc]),
        U.el("td", {}, [U.el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [preview, symIn])]),
        U.el("td", {}, [meanIn]),
        U.el("td", {}, [wordIn]),
        U.el("td", {}, [groupIn]),
      ]));
    });
    table.appendChild(tbody);
    root.appendChild(table);
  }

  function doImportChars() {
    const p = project();
    let n = 0;
    S.items.forEach((item) => {
      if (!item.include) return;
      const meaning = (item.meaning || "").trim();
      const symbol = (item.symbol || "").trim();
      if (!meaning && !symbol) return;
      const g = {
        id: U.uid("gly"),
        name: meaning || symbol || "symbol",
        romanization: (item.headword || "").trim(),
        sound: "", meaning, group: (item.group || "").trim(), text: symbol,
        grid: U.clone(p.defaultGrid), nodes: [], connections: [], shapes: [],
      };
      p.glyphs.push(g);
      if (window.Lexicon) Lexicon.wordFromGlyph(g); // each character is also a word
      n++;
    });
    if (S.logographic !== false && n) p.writingSystem = "logographic";
    Store.touch();
    U.toast("Built " + n + " character" + (n === 1 ? "" : "s") + " into your language");
    App.switchTab("glyphs");
  }

  function drawSlot(slot, item) {
    U.clear(slot);
    if (!item.glyphSeq.length) { slot.appendChild(U.el("span.sym-plus", { text: "＋" })); return; }
    item.glyphSeq.forEach((gid) => {
      const g = project().glyphs.find((x) => x.id === gid);
      if (g) slot.appendChild(GlyphRender.render(g, { size: 30, style: project().style, strokeWidth: 3 }));
    });
  }

  /* ---------- Symbol picker ---------- */
  function openSymbolPicker(item, slot) {
    const p = project();
    const preview = U.el("div.sym-current");
    const drawPreview = () => {
      U.clear(preview);
      if (!item.glyphSeq.length) { preview.appendChild(U.el("span.hint", { text: "no symbol yet — pick characters below or make a new one" })); return; }
      item.glyphSeq.forEach((gid, i) => {
        const g = p.glyphs.find((x) => x.id === gid);
        if (!g) return;
        preview.appendChild(U.el("span", { style: { position: "relative", cursor: "pointer", border: "1px solid var(--line-2)", borderRadius: "5px", padding: "2px" }, title: "remove", onClick: () => { item.glyphSeq.splice(i, 1); drawPreview(); } }, [GlyphRender.render(g, { size: 34, style: p.style, strokeWidth: 3 })]));
      });
    };
    drawPreview();

    const palette = U.el("div.sym-picker-grid");
    if (!p.glyphs.length) palette.appendChild(U.el("span.hint", { text: "No characters yet — make a new one below." }));
    p.glyphs.forEach((g) => {
      palette.appendChild(U.el("button.btn.small", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", padding: "4px" }, onClick: () => { item.glyphSeq.push(g.id); drawPreview(); } }, [
        GlyphRender.render(g, { size: 30, style: p.style, strokeWidth: 3 }),
        U.el("span", { text: g.romanization || g.meaning || g.name, style: { fontSize: "10px" } }),
      ]));
    });

    const makeNew = U.el("button.btn.small.primary", { text: "＋ New character for this word", onClick: () => {
      const g = {
        id: U.uid("gly"), name: item.headword || item.meaning || "symbol",
        romanization: item.headword || "", sound: "", meaning: item.meaning || "",
        grid: U.clone(p.defaultGrid), nodes: [], connections: [], shapes: [],
      };
      p.glyphs.push(g);
      if (window.Lexicon) Lexicon.autoWordForGlyph(g);
      item.glyphSeq.push(g.id);
      Store.touch();
      drawPreview();
      U.toast("Created “" + g.name + "” — design it in the Characters tab");
    } });
    const autoBtn = U.el("button.btn.small", { text: "✦ Auto from characters", onClick: () => { autoSpell(item); drawPreview(); } });

    U.modal({
      title: "Symbol for “" + (item.headword || item.meaning || "word") + "”",
      wide: true,
      body: [
        U.el("div.field", {}, [U.el("span.flabel", { text: "Current symbol" }), preview]),
        U.el("div.inline-actions", {}, [makeNew, autoBtn]),
        U.el("div.field", {}, [U.el("span.flabel", { text: "Pick existing characters" }), palette]),
      ],
      confirmText: "Done",
      onConfirm: () => { drawSlot(slot, item); },
      cancelText: null,
    });
  }

  /* ---------- Commit ---------- */
  function doImport() {
    const p = project();
    const langs = p.translationLanguages.length ? p.translationLanguages : ["English"];
    let n = 0;
    S.items.forEach((item) => {
      if (!item.include) return;
      const headword = (item.headword || "").trim() || (window.Lexicon ? Lexicon.nameFromGlyphs(item.glyphSeq) : "") || (item.meaning || "").trim();
      if (!headword && !item.glyphSeq.length) return;
      const translations = {};
      if (item.meaning) translations[langs[0]] = item.meaning.trim();
      p.lexicon.push({
        id: U.uid("word"), headword: headword || "(unnamed)",
        translations, definition: (item.meaning || "").trim(),
        posList: item.posList || [], pos: (item.posList || [])[0] || "",
        genderList: item.genderList || [], gender: (item.genderList || [])[0] || "",
        genderMode: "fixed", genderFrom: null,
        tags: (item.tags || []).concat(["imported"]).filter((v, i, a) => a.indexOf(v) === i),
        glyphSeq: item.glyphSeq.slice(), parts: [], fromGlyph: null, notes: "Imported from a spreadsheet.",
      });
      n++;
    });
    Store.touch();
    U.toast("Imported " + n + " word" + (n === 1 ? "" : "s"));
    Lexicon.render();
  }

  window.SheetImport = S;
})();
