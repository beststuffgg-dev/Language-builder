/* lexicon.js — dictionary of words: definitions, part of speech, gender,
   tags, and a spelling built from your glyphs. */
(function () {
  const L = { filter: "" };
  function project() { return Store.getActive(); }

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
      rows = rows.filter((e) => (e.headword + " " + e.definition + " " + (e.tags || []).join(" ") + " " + e.pos).toLowerCase().includes(L.filter));
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
        U.el("td", { text: e.pos || "—" }),
        U.el("td", { text: e.gender || "—" }),
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
    const e = entry ? U.clone(entry) : { id: U.uid("word"), headword: "", translations: {}, definition: "", pos: p.partsOfSpeech[0] || "", gender: "", tags: [], glyphSeq: [], parts: [], notes: "" };
    e.translations = e.translations || {};

    const headIn = U.el("input", { value: e.headword, placeholder: "romanized spelling" });
    // one translation field per natural language on the project
    const transInputs = {};
    const langs = p.translationLanguages.length ? p.translationLanguages : ["English"];
    const transFields = langs.map((lang) => {
      const inp = U.el("input", { value: e.translations[lang] || "", placeholder: "meaning in " + lang });
      transInputs[lang] = inp;
      return U.el("label.field", {}, [lang, inp]);
    });
    const posSel = U.el("select");
    posSel.appendChild(U.el("option", { value: "", text: "—" }));
    p.partsOfSpeech.forEach((x) => posSel.appendChild(U.el("option", { value: x, text: x, selected: e.pos === x })));
    const genSel = U.el("select");
    p.genders.forEach((x) => genSel.appendChild(U.el("option", { value: x === "—" ? "" : x, text: x, selected: e.gender === (x === "—" ? "" : x) })));
    const tagsIn = U.el("input", { value: (e.tags || []).join(", "), placeholder: "comma, separated, tags" });

    // Glyph sequence builder
    const seqPreview = U.el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", minHeight: "44px", padding: "8px", background: "var(--bg-3)", border: "1px solid var(--line)", borderRadius: "6px", alignItems: "center" } });
    const renderSeq = () => {
      U.clear(seqPreview);
      if (!e.glyphSeq.length) seqPreview.appendChild(U.el("span.hint", { text: "click glyphs below to spell the word" }));
      e.glyphSeq.forEach((gid, i) => {
        const g = p.glyphs.find((x) => x.id === gid);
        if (!g) return;
        const chip = U.el("span", { style: { position: "relative", cursor: "pointer", border: "1px solid var(--line-2)", borderRadius: "5px", padding: "2px" }, title: "remove", onClick: () => { e.glyphSeq.splice(i, 1); renderSeq(); } }, [GlyphRender.render(g, { size: 34, style: p.style, strokeWidth: 3 })]);
        seqPreview.appendChild(chip);
      });
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

    U.modal({
      title: isNew ? "Add word" : "Edit word",
      body: [
        U.el("div.row", {}, [U.el("label.field", {}, ["Word", headIn]), U.el("label.field", {}, ["Part of speech", posSel]), U.el("label.field", {}, ["Gender", genSel])]),
        U.el("div.field", {}, [U.el("span", { text: "Translations", style: { fontSize: "12px", color: "var(--text-dim)" } }), U.el("div.row", {}, transFields)]),
        U.el("label.field", {}, ["Tags", tagsIn]),
        U.el("label.field", {}, ["Spelling (glyphs)", seqPreview]),
        U.el("div.field", {}, [U.el("span", { text: "Add glyphs:", style: { fontSize: "12px", color: "var(--text-dim)" } }), palette]),
        U.el("div.field", {}, [U.el("span", { text: "Word parts (compose from other words)", style: { fontSize: "12px", color: "var(--text-dim)" } }), partsPreview, U.el("div.row", { style: { alignItems: "center" } }, [partPicker, buildFromParts])]),
      ],
      confirmText: isNew ? "Add" : "Save",
      onConfirm: () => {
        e.headword = headIn.value.trim();
        if (!e.headword) { U.toast("Give the word a spelling.", true); return false; }
        langs.forEach((lang) => { const v = transInputs[lang].value.trim(); if (v) e.translations[lang] = v; else delete e.translations[lang]; });
        e.definition = e.translations[langs[0]] || e.translations.English || "";
        e.pos = posSel.value;
        e.gender = genSel.value;
        e.tags = tagsIn.value.split(",").map((s) => s.trim()).filter(Boolean);
        if (isNew) p.lexicon.push(e);
        else { const idx = p.lexicon.findIndex((x) => x.id === e.id); if (idx >= 0) p.lexicon[idx] = e; }
        Store.touch();
        L.renderTable();
      },
    });
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
    p.lexicon.forEach((e) => lines.push([e.headword, e.pos, e.gender].concat(langs.map((l) => (e.translations || {})[l] || "")).concat([(e.tags || []).join(" ")]).map(esc).join(",")));
    U.download((p.name || "language") + "-dictionary.csv", lines.join("\n"), "text/csv");
    U.toast("Exported dictionary CSV");
  }

  window.Lexicon = L;
})();
