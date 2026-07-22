/* lexicon.js — dictionary of words: definitions, part of speech, gender,
   tags, and a spelling built from your glyphs. */
(function () {
  const L = { filter: "" };
  function project() { return Store.getActive(); }

  // A word may belong to several categories at once. posList/genderList are the
  // source of truth; fall back to the legacy single field for old data.
  function posOf(e) { return (e.posList && e.posList.length ? e.posList : (e.pos ? [e.pos] : [])); }
  function genderOf(e) { return (e.genderList && e.genderList.length ? e.genderList : (e.gender ? [e.gender] : [])); }

  // Toggle-chip multi-select. Returns { el, get() }.
  function multiChips(options, selected, opts) {
    opts = opts || {};
    const chosen = new Set(selected);
    const wrap = U.el("div.chips");
    const draw = () => {
      U.clear(wrap);
      (options || []).forEach((o) => {
        const val = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        if (!val || val === "—") return;
        const on = chosen.has(val);
        wrap.appendChild(U.el("button.chip" + (on ? ".on" : ""), { type: "button", onClick: () => { on ? chosen.delete(val) : chosen.add(val); draw(); } }, [label]));
      });
      if (!wrap.childNodes.length) wrap.appendChild(U.el("span.hint", { text: opts.empty || "none defined" }));
    };
    draw();
    return { el: wrap, get: () => Array.from(chosen) };
  }
  L.multiChips = multiChips; // reused by the photo-import review menu

  // Combine the meanings of a word's characters (glyphSeq) — and any word parts —
  // into a suggested compound meaning. Used for logographic ("character-cased")
  // languages where a new word's sense is the sum of its characters' senses.
  L.combineMeaning = function (glyphSeq, parts, joiner) {
    const p = project();
    const bits = [];
    (glyphSeq || []).forEach((gid) => { const g = p.glyphs.find((x) => x.id === gid); if (g && g.meaning) bits.push(g.meaning); });
    (parts || []).forEach((wid) => { const w = p.lexicon.find((x) => x.id === wid); if (w) bits.push(w.definition || w.headword); });
    return bits.filter(Boolean).join(joiner == null ? " · " : joiner);
  };

  // A word's default headword when the user hasn't typed a romanization: name it
  // after its characters (their romanizations, else their meanings). This is what
  // lets a character *be* a word without requiring a separate romanization.
  L.nameFromGlyphs = function (glyphSeq) {
    const p = project();
    const roms = [], means = [];
    (glyphSeq || []).forEach((gid) => {
      const g = p.glyphs.find((x) => x.id === gid);
      if (!g) return;
      if (g.romanization) roms.push(g.romanization);
      if (g.meaning) means.push(g.meaning);
    });
    if (roms.length === (glyphSeq || []).length && roms.length) return roms.join("");
    if (roms.length) return roms.join("");
    return means.join("-");
  };

  // Create a dictionary word linked to a single character (idempotent per glyph).
  // A character can thus be a word on its own; edits to the character stay in sync.
  L.wordFromGlyph = function (glyph) {
    const p = project();
    if (!p || !glyph) return null;
    const existing = p.lexicon.find((w) => w.fromGlyph === glyph.id);
    if (existing) return existing;
    const langs = p.translationLanguages.length ? p.translationLanguages : ["English"];
    const meaning = glyph.meaning || "";
    const translations = {};
    if (meaning) translations[langs[0]] = meaning;
    const w = {
      id: U.uid("word"),
      headword: glyph.romanization || meaning || glyph.name || "word",
      translations, definition: meaning,
      posList: [], pos: "", genderList: [], gender: "",
      tags: ["character-word"], glyphSeq: [glyph.id], parts: [], fromGlyph: glyph.id,
      notes: "This word is a single character.",
    };
    p.lexicon.push(w);
    Store.touch();
    return w;
  };

  // Keep an auto-linked character-word in step with its character.
  L.syncWordFromGlyph = function (glyph) {
    const p = project();
    if (!p || !glyph) return;
    const w = p.lexicon.find((x) => x.fromGlyph === glyph.id);
    if (!w) return;
    const langs = p.translationLanguages.length ? p.translationLanguages : ["English"];
    const meaning = glyph.meaning || "";
    w.headword = glyph.romanization || meaning || glyph.name || w.headword;
    if (meaning) w.translations[langs[0]] = meaning; else delete w.translations[langs[0]];
    w.definition = w.translations[langs[0]] || meaning || "";
    Store.touch();
  };

  // If the project opts into it, make every new character a word automatically.
  L.autoWordForGlyph = function (glyph) {
    const p = project();
    if (p && p.autoWordForNewGlyph) return L.wordFromGlyph(glyph);
    return null;
  };

  // Render a word's glyph sequence inline (used here and in compose).
  L.renderGlyphSeq = function (seq, size) {
    const p = project();
    const wrap = U.el("span.glyph-inline");
    (seq || []).forEach((gid) => {
      const g = p.glyphs.find((x) => x.id === gid);
      if (!g) return;
      wrap.appendChild(GlyphRender.render(g, { size: size || 40, width: (size || 40) * (g.grid.cols / Math.max(g.grid.cols, g.grid.rows)) + 8, style: p.style, strokeWidth: Math.max(2, p.style.strokeWidth * (size || 40) / 220) }));
    });
    if (!wrap.childNodes.length) wrap.appendChild(U.el("span.hint", { text: "—" }));
    return wrap;
  };

  L.render = function () {
    const root = document.getElementById("lexiconRoot");
    U.clear(root);
    const p = project();
    if (!p) return;

    const header = U.el("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" } }, [
      U.el("h2", { text: "Dictionary", style: { margin: "0", flex: "0" } }),
      U.el("input", { placeholder: "search words / definitions / tags…", value: L.filter, style: { flex: "1", minWidth: "180px" }, onInput: (e) => { L.filter = e.target.value.toLowerCase(); L.renderTable(); } }),
      U.el("button.btn.primary", { text: "＋ Add word", onClick: () => L.editEntry(null) }),
      U.el("button.btn", { text: "Export CSV", onClick: exportCSV }),
    ]);
    root.appendChild(header);
    const tableWrap = U.el("div", { id: "lexTableWrap" });
    root.appendChild(tableWrap);
    L.renderTable();
  };

  L.renderTable = function () {
    const p = project();
    const wrap = document.getElementById("lexTableWrap");
    if (!wrap) return;
    U.clear(wrap);
    let rows = p.lexicon;
    if (L.filter) {
      rows = rows.filter((e) => (e.headword + " " + e.definition + " " + (e.tags || []).join(" ") + " " + posOf(e).join(" ")).toLowerCase().includes(L.filter));
    }
    if (!rows.length) {
      wrap.appendChild(U.el("div.empty-hint", { text: p.lexicon.length ? "No matches." : "No words yet. Add your first word to build the dictionary." }));
      return;
    }
    const table = U.el("table.lex");
    table.appendChild(U.el("thead", {}, [U.el("tr", {}, [
      th("Word"), th("Spelling"), th("Part of speech"), th("Gender"), th("Meaning"), th("Tags"), th(""),
    ])]));
    const tbody = U.el("tbody");
    rows.forEach((e) => {
      tbody.appendChild(U.el("tr", {}, [
        U.el("td", {}, [U.el("strong", { text: e.headword })]),
        U.el("td", {}, [L.renderGlyphSeq(e.glyphSeq, 34)]),
        U.el("td", {}, posOf(e).length ? posOf(e).map((x) => U.el("span.tag", { text: x })) : [U.el("span", { text: "—" })]),
        U.el("td", {}, genderOf(e).length ? genderOf(e).map((x) => U.el("span.tag", { text: x })) : [U.el("span", { text: "—" })]),
        U.el("td", { text: e.definition || "" }),
        U.el("td", {}, (e.tags || []).map((t) => U.el("span.tag", { text: t }))),
        U.el("td", {}, [U.el("div.inline-actions", {}, [
          U.el("button.btn.small", { text: "Edit", onClick: () => L.editEntry(e) }),
          U.el("button.btn.small.danger", { text: "✕", onClick: () => deleteEntry(e) }),
        ])]),
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  };

  function th(t) { return U.el("th", { text: t }); }

  L.editEntry = function (entry) {
    const p = project();
    const isNew = !entry;
    const e = entry ? U.clone(entry) : { id: U.uid("word"), headword: "", translations: {}, definition: "", posList: [], pos: "", genderList: [], gender: "", tags: [], glyphSeq: [], parts: [], notes: "" };
    e.translations = e.translations || {};
    e.glyphSeq = e.glyphSeq || [];
    const logographic = p.writingSystem === "logographic";

    const headIn = U.el("input", { value: e.headword, placeholder: "optional — leave blank to name it after its characters" });
    const nameFromChars = U.el("button.btn.small", { type: "button", text: "Name from characters", title: "Use the characters (their sounds, else meanings) as this word", onClick: () => {
      const n = L.nameFromGlyphs(e.glyphSeq);
      if (n) headIn.value = n; else U.toast("Add characters first.", true);
    } });
    // one translation field per natural language on the project
    const transInputs = {};
    const langs = p.translationLanguages.length ? p.translationLanguages : ["English"];
    const transFields = langs.map((lang) => {
      const inp = U.el("input", { value: e.translations[lang] || "", placeholder: "meaning in " + lang });
      transInputs[lang] = inp;
      return U.el("label.field", {}, [lang, inp]);
    });
    // Multi-category pickers: a word can be several parts of speech / classes at once.
    const posChips = multiChips(p.partsOfSpeech, posOf(e), { empty: "no parts of speech defined" });
    const genChips = multiChips(p.genders, genderOf(e), { empty: "no genders/classes defined" });
    const tagsIn = U.el("input", { value: (e.tags || []).join(", "), placeholder: "comma, separated, tags" });

    // Glyph sequence builder
    const seqPreview = U.el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", minHeight: "44px", padding: "8px", background: "var(--bg-3)", border: "1px solid var(--line)", borderRadius: "6px", alignItems: "center" } });
    const renderSeq = () => {
      U.clear(seqPreview);
      if (!e.glyphSeq.length) seqPreview.appendChild(U.el("span.hint", { text: "click glyphs below to spell the word" }));
      e.glyphSeq.forEach((gid, i) => {
        const g = p.glyphs.find((x) => x.id === gid);
        if (!g) return;
        const chip = U.el("span", { style: { position: "relative", cursor: "pointer", border: "1px solid var(--line-2)", borderRadius: "5px", padding: "2px" }, title: (g.meaning ? g.meaning + " — " : "") + "remove", onClick: () => { e.glyphSeq.splice(i, 1); renderSeq(); } }, [GlyphRender.render(g, { size: 34, style: p.style, strokeWidth: 3 })]);
        seqPreview.appendChild(chip);
      });
      if (e._refreshCombineHint) e._refreshCombineHint();
    };
    renderSeq();
    const palette = U.el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", maxHeight: "140px", overflow: "auto" } });
    if (!p.glyphs.length) palette.appendChild(U.el("span.hint", { text: "No characters yet — create some in the Characters tab." }));
    p.glyphs.forEach((g) => {
      palette.appendChild(U.el("button.btn.small", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", padding: "4px" }, onClick: () => { e.glyphSeq.push(g.id); renderSeq(); } }, [
        GlyphRender.render(g, { size: 30, style: p.style, strokeWidth: 3 }),
        U.el("span", { text: g.romanization || g.name, style: { fontSize: "10px" } }),
      ]));
    });

    // Word parts: compose this word from other words. Every part is itself a
    // word, so any part can be swapped for a different word later.
    e.parts = e.parts || [];
    const partsPreview = U.el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", minHeight: "34px", padding: "6px", background: "var(--bg-3)", border: "1px solid var(--line)", borderRadius: "6px", alignItems: "center" } });
    const renderParts = () => {
      U.clear(partsPreview);
      if (!e.parts.length) partsPreview.appendChild(U.el("span.hint", { text: "optional — pick words below to build a compound" }));
      e.parts.forEach((wid, i) => {
        const w = p.lexicon.find((x) => x.id === wid);
        partsPreview.appendChild(U.el("span.tag", { style: { cursor: "pointer" }, title: "remove", text: (w ? w.headword : "?") + " ✕", onClick: () => { e.parts.splice(i, 1); renderParts(); } }));
      });
      if (e._refreshCombineHint) e._refreshCombineHint();
    };
    renderParts();
    const partPicker = U.el("select");
    partPicker.appendChild(U.el("option", { value: "", text: "add a word part…" }));
    p.lexicon.filter((x) => x.id !== e.id).forEach((w) => partPicker.appendChild(U.el("option", { value: w.id, text: w.headword + (w.definition ? " (" + w.definition + ")" : "") })));
    partPicker.addEventListener("change", () => { if (partPicker.value) { e.parts.push(partPicker.value); partPicker.value = ""; renderParts(); } });
    const buildFromParts = U.el("button.btn.small", { text: "Build spelling from parts →", onClick: () => {
      const seq = [];
      let head = "";
      e.parts.forEach((wid) => { const w = p.lexicon.find((x) => x.id === wid); if (w) { seq.push.apply(seq, w.glyphSeq); head += w.headword; } });
      if (seq.length) { e.glyphSeq = seq; renderSeq(); }
      if (head && !headIn.value.trim()) headIn.value = head;
    } });

    // Combine character (and word-part) meanings into this word's meaning.
    const combineHint = U.el("span.hint", { text: "" });
    const refreshCombineHint = () => {
      const m = L.combineMeaning(e.glyphSeq, e.parts);
      combineHint.textContent = m ? "characters mean: " + m : (logographic ? "give characters a meaning to combine them" : "");
    };
    const combineBtn = U.el("button.btn.small", { type: "button", text: "Combine character meanings →", title: "Fill the meaning from the characters that spell this word", onClick: () => {
      const m = L.combineMeaning(e.glyphSeq, e.parts);
      if (!m) { U.toast("None of these characters have a meaning yet.", true); return; }
      const primary = transInputs[langs[0]];
      if (primary) primary.value = m;
    } });
    const combineRow = U.el("div.field", {}, [
      U.el("div.row", { style: { alignItems: "center" } }, [combineBtn, U.el("span", { style: { flex: "1" } }, [combineHint])]),
    ]);

    U.modal({
      title: isNew ? "Add word" : "Edit word",
      wide: true,
      body: [
        U.el("div.row", { style: { alignItems: "flex-end" } }, [U.el("label.field", { style: { flex: "1" } }, ["Word", headIn]), nameFromChars]),
        U.el("div.field", {}, [U.el("span", { text: "Part of speech (choose any that apply)", style: { fontSize: "12px", color: "var(--text-dim)" } }), posChips.el]),
        U.el("div.field", {}, [U.el("span", { text: "Gender / class (choose any that apply)", style: { fontSize: "12px", color: "var(--text-dim)" } }), genChips.el]),
        U.el("div.field", {}, [U.el("span", { text: "Translations / meaning", style: { fontSize: "12px", color: "var(--text-dim)" } }), U.el("div.row", {}, transFields)]),
        combineRow,
        U.el("label.field", {}, ["Tags", tagsIn]),
        U.el("label.field", {}, [logographic ? "Characters (each a logogram)" : "Spelling (glyphs)", seqPreview]),
        U.el("div.field", {}, [U.el("span", { text: "Add characters:", style: { fontSize: "12px", color: "var(--text-dim)" } }), palette]),
        U.el("div.field", {}, [U.el("span", { text: "Word parts (compose from other words)", style: { fontSize: "12px", color: "var(--text-dim)" } }), partsPreview, U.el("div.row", { style: { alignItems: "center" } }, [partPicker, buildFromParts])]),
      ],
      confirmText: isNew ? "Add" : "Save",
      onConfirm: () => {
        langs.forEach((lang) => { const v = transInputs[lang].value.trim(); if (v) e.translations[lang] = v; else delete e.translations[lang]; });
        e.definition = e.translations[langs[0]] || e.translations.English || "";
        // A word can be its own characters: if no romanization is given, name it
        // after the characters that spell it, else after its meaning.
        e.headword = headIn.value.trim() || L.nameFromGlyphs(e.glyphSeq) || e.definition;
        if (!e.headword) { U.toast("Add a word, a meaning, or some characters.", true); return false; }
        e.posList = posChips.get(); e.pos = e.posList[0] || "";
        e.genderList = genChips.get(); e.gender = e.genderList[0] || "";
        e.tags = tagsIn.value.split(",").map((s) => s.trim()).filter(Boolean);
        if (isNew) p.lexicon.push(e);
        else { const idx = p.lexicon.findIndex((x) => x.id === e.id); if (idx >= 0) p.lexicon[idx] = e; }
        Store.touch();
        L.renderTable();
      },
    });
    refreshCombineHint();
    e._refreshCombineHint = refreshCombineHint;
  };

  function deleteEntry(e) {
    const p = project();
    p.lexicon = p.lexicon.filter((x) => x.id !== e.id);
    Store.touch();
    L.renderTable();
  }

  function exportCSV() {
    const p = project();
    const esc = (s) => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
    const langs = p.translationLanguages.length ? p.translationLanguages : ["English"];
    const lines = [["word", "pos", "gender"].concat(langs).concat(["tags"]).map(esc).join(",")];
    p.lexicon.forEach((e) => lines.push([e.headword, posOf(e).join("; "), genderOf(e).join("; ")].concat(langs.map((l) => (e.translations || {})[l] || "")).concat([(e.tags || []).join(" ")]).map(esc).join(",")));
    U.download((p.name || "language") + "-dictionary.csv", lines.join("\n"), "text/csv");
    U.toast("Exported dictionary CSV");
  }

  window.Lexicon = L;
})();
