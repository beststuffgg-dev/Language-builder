/* translator.js — translate between your language and any natural language
   you add. Purely word-by-word: no natural-language grammar or word order is
   assumed — structure comes only from the rules you build. */
(function () {
  const Tr = { text: "", from: null, to: null, size: 40 };
  function project() { return Store.getActive(); }

  function langOptions(p) {
    return [{ id: "__conlang__", label: p.name || "This language", conlang: true }]
      .concat((p.translationLanguages || []).map((l) => ({ id: l, label: l, conlang: false })));
  }

  // Split into words + separators, keeping punctuation/spacing intact.
  function tokenize(text) {
    const re = /[A-Za-zÀ-ɏ0-9'’\-]+|[^A-Za-zÀ-ɏ0-9'’\-]+/g;
    const out = []; let m;
    while ((m = re.exec(text)) !== null) {
      const tok = m[0];
      out.push({ text: tok, isWord: /[A-Za-zÀ-ɏ0-9]/.test(tok) });
    }
    return out;
  }

  // Translate a single source word to the target language.
  function translateWord(word, p, from, to) {
    const lw = word.toLowerCase();
    let entry = null;
    if (from.conlang) {
      entry = p.lexicon.find((e) => (e.headword || "").toLowerCase() === lw);
    } else {
      entry = p.lexicon.find((e) => {
        const t = (e.translations || {})[from.id];
        if (!t) return false;
        // whole-word match within the translation string
        return t.toLowerCase().split(/[^a-zÀ-ɏ0-9]+/).indexOf(lw) >= 0;
      });
    }
    if (!entry) return { found: false };
    if (to.conlang) return { found: true, entry, out: entry.headword };
    return { found: true, entry, out: (entry.translations || {})[to.id] || entry.definition || "" };
  }

  Tr.render = function () {
    const root = document.getElementById("translatorRoot");
    U.clear(root);
    const p = project();
    if (!p) return;
    const opts = langOptions(p);
    if (!Tr.from || !opts.find((o) => o.id === Tr.from)) Tr.from = opts[0].id;
    if (!Tr.to || !opts.find((o) => o.id === Tr.to)) Tr.to = (opts[1] || opts[0]).id;

    const fromSel = U.el("select", { onChange: (e) => { Tr.from = e.target.value; render(); } });
    const toSel = U.el("select", { onChange: (e) => { Tr.to = e.target.value; render(); } });
    opts.forEach((o) => { fromSel.appendChild(U.el("option", { value: o.id, text: o.label, selected: o.id === Tr.from })); toSel.appendChild(U.el("option", { value: o.id, text: o.label, selected: o.id === Tr.to })); });

    const swap = U.el("button.btn", { text: "⇄", title: "Swap directions", onClick: () => { const a = Tr.from; Tr.from = Tr.to; Tr.to = a; render(); } });
    const input = U.el("textarea", { rows: 5, value: Tr.text, placeholder: "Type text to translate…", onInput: (e) => { Tr.text = e.target.value; renderOut(); } });
    const outBox = U.el("div", { style: { minHeight: "120px", padding: "12px", background: "var(--bg-3)", border: "1px solid var(--line)", borderRadius: "6px", display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "flex-end" } });

    const card = U.el("div.card", {}, [
      U.el("h2", { text: "Translator" }),
      U.el("p.muted", { text: "Word-by-word translation in either direction. No natural-language grammar is applied — word order and inflection come only from the rules you define." }),
      U.el("div.row", { style: { alignItems: "flex-end" } }, [
        U.el("label.field", {}, ["From", fromSel]),
        U.el("div", { style: { flex: "0" } }, [swap]),
        U.el("label.field", {}, ["To", toSel]),
        U.el("label.field", { style: { flex: "0" } }, ["Add language", U.el("button.btn", { text: "＋", title: "Add a natural language", onClick: addLanguage })]),
      ]),
      input,
      U.el("div.row", { style: { alignItems: "center", marginTop: "10px" } }, [U.el("strong", { text: "Translation" }), U.el("span.hint", { style: { flex: "1" }, text: "unknown words shown as [word]" })]),
      outBox,
    ]);
    root.appendChild(card);

    // Manage languages card
    root.appendChild(buildLanguageManager(p));

    function render() { Tr.render(); }
    function renderOut() {
      U.clear(outBox);
      const from = opts.find((o) => o.id === Tr.from), to = opts.find((o) => o.id === Tr.to);
      if (!Tr.text.trim()) { outBox.appendChild(U.el("span.hint", { text: "Translation appears here." })); return; }
      tokenize(Tr.text).forEach((tok) => {
        if (!tok.isWord) { outBox.appendChild(U.el("span", { text: tok.text, style: { whiteSpace: "pre" } })); return; }
        const res = translateWord(tok.text, p, from, to);
        if (!res.found) { outBox.appendChild(U.el("span", { text: "[" + tok.text + "]", style: { color: "var(--text-mute)" } })); return; }
        if (to.conlang) {
          const block = U.el("span", { style: { display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "2px" }, title: res.out });
          const line = U.el("span.glyph-inline");
          const seq = res.entry.glyphSeq && res.entry.glyphSeq.length ? res.entry.glyphSeq : (window.Compose ? Compose.transliterate(res.out) : []);
          seq.forEach((gid) => { const g = p.glyphs.find((x) => x.id === gid); if (g) line.appendChild(GlyphRender.render(g, { size: Tr.size, style: p.style, strokeWidth: Math.max(2, p.style.strokeWidth * Tr.size / 220) })); });
          block.appendChild(seq.length ? line : U.el("span", { text: res.out }));
          block.appendChild(U.el("span", { text: res.out, style: { fontSize: "10px", color: "var(--accent-2)" } }));
          outBox.appendChild(block);
        } else {
          outBox.appendChild(U.el("span", { text: res.out || "∅", style: { padding: "2px 4px" } }));
        }
      });
    }
    renderOut();
  };

  function buildLanguageManager(p) {
    const list = U.el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } });
    (p.translationLanguages || []).forEach((lang) => {
      list.appendChild(U.el("span.tag", { style: { cursor: "pointer" }, title: "remove", text: lang + "  ✕", onClick: () => {
        U.confirm("Remove language", `Remove “${lang}”? Its translations stay stored on words but are hidden.`, () => {
          p.translationLanguages = p.translationLanguages.filter((l) => l !== lang);
          Store.touch(); Tr.render();
        }, "Remove");
      } }));
    });
    if (!(p.translationLanguages || []).length) list.appendChild(U.el("span.hint", { text: "No natural languages — this is a blank slate. Add one to translate." }));
    return U.el("div.card", {}, [
      U.el("h2", { text: "Translation languages" }),
      U.el("p.muted", { text: "Add any natural language to translate to/from. Each word gets a field per language in the dictionary." }),
      list,
      U.el("div", { style: { marginTop: "10px" } }, [U.el("button.btn", { text: "＋ Add language", onClick: addLanguage })]),
    ]);
  }

  function addLanguage() {
    const p = project();
    const nameIn = U.el("input", { placeholder: "e.g. Spanish, French, Japanese" });
    U.modal({
      title: "Add a language",
      body: [U.el("label.field", {}, ["Language name", nameIn])],
      confirmText: "Add",
      onConfirm: () => {
        const name = nameIn.value.trim();
        if (!name) return false;
        if (!p.translationLanguages.includes(name)) p.translationLanguages.push(name);
        Store.touch(); Tr.render();
      },
    });
  }

  Tr.refresh = Tr.render;
  window.Translator = Tr;
})();
