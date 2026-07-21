/* compose.js — write text in your script.
   Looks up words in the dictionary, or transliterates romanization into
   glyphs by longest-match. Also runs any rule over a word live. */
(function () {
  const C = { text: "", size: 64, applyRuleId: null, ruleWord: "", ruleParams: {} };
  function project() { return Store.getActive(); }

  // Longest-match transliteration of a romanized string into a glyph sequence.
  C.transliterate = function (word) {
    const p = project();
    // logographic scripts: a whole word maps to one character by meaning
    if (p.writingSystem === "logographic") {
      const lw = word.toLowerCase();
      const byMeaning = p.glyphs.find((g) => (g.meaning || "").toLowerCase() === lw);
      if (byMeaning) return [byMeaning.id];
    }
    const glyphs = p.glyphs.filter((g) => g.romanization).slice().sort((a, b) => b.romanization.length - a.romanization.length);
    const seq = [];
    let i = 0;
    const lower = word.toLowerCase();
    while (i < lower.length) {
      let matched = null;
      for (const g of glyphs) {
        const rom = g.romanization.toLowerCase();
        if (rom && lower.startsWith(rom, i)) { matched = g; break; }
      }
      if (matched) { seq.push(matched.id); i += matched.romanization.length; }
      else i += 1; // skip unknown char
    }
    return seq;
  };

  // Find a dictionary spelling, else transliterate.
  function spell(word) {
    const p = project();
    const entry = p.lexicon.find((e) => e.headword.toLowerCase() === word.toLowerCase());
    if (entry && entry.glyphSeq.length) return { seq: entry.glyphSeq, source: "dictionary" };
    return { seq: C.transliterate(word), source: "transliterated" };
  }

  C.render = function () {
    const root = document.getElementById("writeRoot");
    U.clear(root);
    const p = project();
    if (!p) return;

    // --- Writing card ---
    const input = U.el("textarea", { rows: 3, value: C.text, placeholder: "Type words (space separated). Dictionary words use their saved spelling; others are transliterated from your glyph sounds.", onInput: (e) => { C.text = e.target.value; renderOut(); } });
    const sizeSlider = U.el("input", { type: "range", min: "28", max: "140", value: String(C.size), onInput: (e) => { C.size = +e.target.value; renderOut(); } });
    const out = U.el("div.compose-out");

    const writeCard = U.el("div.card", {}, [
      U.el("h2", { text: "Compose" }),
      U.el("p.muted", { text: "Write in your constructed script." }),
      input,
      U.el("div.row", { style: { alignItems: "center", marginTop: "10px" } }, [
        U.el("label.field", { style: { flex: "1" } }, ["Glyph size", sizeSlider]),
        U.el("button.btn", { text: "Export as SVG", onClick: () => exportComposition(out) }),
      ]),
      out,
    ]);
    root.appendChild(writeCard);

    function renderOut() {
      U.clear(out);
      const words = C.text.split(/\s+/).filter(Boolean);
      if (!words.length) { out.appendChild(U.el("span.hint", { text: "Your writing will appear here." })); return; }
      words.forEach((w) => {
        const { seq, source } = spell(w);
        const block = U.el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }, title: source });
        const line = U.el("div", { style: { display: "flex", alignItems: "flex-end", gap: "2px" } });
        if (!seq.length) line.appendChild(U.el("span.hint", { text: "?" }));
        seq.forEach((gid) => {
          const g = p.glyphs.find((x) => x.id === gid);
          if (g) line.appendChild(GlyphRender.render(g, { size: C.size, style: p.style, strokeWidth: Math.max(2, p.style.strokeWidth * C.size / 220) }));
        });
        block.appendChild(line);
        block.appendChild(U.el("span", { text: w, style: { fontSize: "11px", color: source === "dictionary" ? "var(--accent-2)" : "var(--text-mute)" } }));
        out.appendChild(block);
      });
    }
    renderOut();

    // --- Rule runner card ---
    root.appendChild(buildRuleRunner(p));
  };

  function buildRuleRunner(p) {
    if (!p.rules.length) {
      return U.el("div.card", {}, [U.el("h2", { text: "Apply a rule" }), U.el("p.muted", { text: "Create conjugation/grammar rules in the Rules tab to use them here." })]);
    }
    if (!C.applyRuleId || !p.rules.find((r) => r.id === C.applyRuleId)) C.applyRuleId = p.rules[0].id;

    const sel = U.el("select", { onChange: (e) => { C.applyRuleId = e.target.value; render(); } });
    p.rules.forEach((r) => sel.appendChild(U.el("option", { value: r.id, text: r.name + " (" + r.category + ")", selected: r.id === C.applyRuleId })));
    const wordIn = U.el("input", { value: C.ruleWord, placeholder: "word", onInput: (e) => { C.ruleWord = e.target.value; render(); } });
    const resultEl = U.el("div.test-out");
    const glyphEl = U.el("div", { style: { display: "flex", gap: "2px", alignItems: "flex-end", marginTop: "8px", minHeight: "40px" } });
    const paramsWrap = U.el("div.test-row");

    const card = U.el("div.card", {}, [
      U.el("h2", { text: "Apply a rule" }),
      U.el("p.muted", { text: "Run a node rule over a word and see the inflected form written out." }),
      U.el("div.row", { style: { alignItems: "center" } }, [
        U.el("label.field", {}, ["Rule", sel]),
        U.el("label.field", {}, ["Word", wordIn]),
      ]),
      paramsWrap,
      U.el("div.row", { style: { alignItems: "center", marginTop: "8px" } }, [U.el("span.hint", { text: "result →" }), resultEl]),
      glyphEl,
    ]);

    function render() {
      const rule = p.rules.find((r) => r.id === C.applyRuleId);
      U.clear(paramsWrap);
      const keys = Array.from(new Set(rule.graph.nodes.filter((n) => n.type === "param").map((n) => (n.params || {}).key).filter(Boolean)));
      keys.forEach((k) => {
        paramsWrap.appendChild(U.el("label.field", { style: { flexDirection: "row", alignItems: "center", gap: "6px" } }, [
          U.el("span.pill", { text: k }),
          U.el("input", { value: C.ruleParams[k] || "", style: { maxWidth: "120px" }, onInput: (e) => { C.ruleParams[k] = e.target.value; render(); } }),
        ]));
      });
      const res = Engine.run(rule.graph, { word: C.ruleWord, params: C.ruleParams, lexicon: p.lexicon });
      U.clear(resultEl);
      resultEl.appendChild(U.el("span", { text: res.result || "∅" }));
      U.clear(glyphEl);
      const { seq } = spell(res.result || "");
      seq.forEach((gid) => { const g = p.glyphs.find((x) => x.id === gid); if (g) glyphEl.appendChild(GlyphRender.render(g, { size: 44, style: p.style, strokeWidth: 3 })); });
    }
    // defer to after mount for param inputs
    setTimeout(render, 0);
    // store render so select rebuild works
    card._render = render;
    sel.addEventListener("change", () => setTimeout(() => C.render(), 0));
    return card;
  }

  function exportComposition(out) {
    const svgs = out.querySelectorAll("svg");
    if (!svgs.length) { U.toast("Nothing to export.", true); return; }
    let x = 0; const gap = 10; let maxH = 0;
    const parts = [];
    svgs.forEach((s) => {
      const w = +s.getAttribute("width") || 60, h = +s.getAttribute("height") || 60;
      parts.push({ inner: s.innerHTML, x, h, w });
      x += w + gap; maxH = Math.max(maxH, h);
    });
    const placed = parts.map((pt) => `<g transform="translate(${pt.x},${maxH - pt.h})">${pt.inner}</g>`);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${maxH}" viewBox="0 0 ${x} ${maxH}"><rect width="100%" height="100%" fill="#ffffff"/>${placed.join("")}</svg>`;
    U.download("composition.svg", svg, "image/svg+xml");
    U.toast("Exported composition.svg");
  }

  window.Compose = C;
})();
