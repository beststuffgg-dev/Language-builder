/* overview.js — dashboard: project summary, settings, and template picker. */
(function () {
  const O = {};
  function project() { return Store.getActive(); }

  O.render = function () {
    const root = document.getElementById("overviewRoot");
    U.clear(root);
    const p = project();

    if (!p) {
      root.appendChild(U.el("div.card", {}, [
        U.el("h2", { text: "Welcome to Language Builder" }),
        U.el("p.muted", { text: "Design a constructed language: draw glyphs on a custom grid, build a dictionary, and program conjugation & grammar rules with a visual node system. Everything is saved in your browser and can be exported as JSON." }),
      ]));
      root.appendChild(templateSection("Create your first language"));
      return;
    }

    // Header / identity
    const nameIn = U.el("input", { value: p.name, style: { fontSize: "18px", fontWeight: "600" }, onInput: (e) => { p.name = e.target.value; Store.touch(); App.renderProjectSelect(); } });
    const descIn = U.el("textarea", { value: p.description, rows: 2, placeholder: "Describe the language, its speakers, its feel…", onInput: (e) => { p.description = e.target.value; Store.touch(); } });
    root.appendChild(U.el("div.card", {}, [
      U.el("label.field", {}, ["Language name", nameIn]),
      U.el("label.field", { style: { marginTop: "10px" } }, ["Description", descIn]),
    ]));

    // Stats
    root.appendChild(U.el("div.card", {}, [
      U.el("h2", { text: "At a glance" }),
      U.el("div.stat-grid", {}, [
        stat(p.glyphs.length, "Characters", () => App.switchTab("glyphs")),
        stat(p.lexicon.length, "Dictionary words", () => App.switchTab("lexicon")),
        stat(p.rules.length, "Rules", () => App.switchTab("rules")),
        stat(p.defaultGrid.cols + "×" + p.defaultGrid.rows, "Default grid", null),
      ]),
    ]));

    // Fonts & sharing
    root.appendChild(U.el("div.card", {}, [
      U.el("h2", { text: "Export & share" }),
      U.el("p.muted", { text: "Turn your characters into an installable font, or send the whole language to someone." }),
      U.el("div.inline-actions", {}, [
        U.el("button.btn.primary", { text: "⤓ Export font", onClick: () => FontExport.openDialog() }),
        U.el("button.btn", { text: "↗ Share language", onClick: () => Share.openDialog() }),
        U.el("button.btn", { text: "Export JSON", onClick: () => { U.download((p.name || "language") + ".json", Store.exportProject(p)); U.toast("Exported " + p.name); } }),
      ]),
    ]));

    // Settings
    root.appendChild(buildSettings(p));

    // Templates (create additional languages)
    root.appendChild(templateSection("Start another language"));
  };

  function stat(n, label, onClick) {
    return U.el("div.stat", { style: onClick ? { cursor: "pointer" } : {}, onClick: onClick || null }, [
      U.el("div.n", { text: String(n) }),
      U.el("div.l", { text: label }),
    ]);
  }

  function buildSettings(p) {
    const colsIn = U.el("input", { type: "number", min: "1", max: "32", value: p.defaultGrid.cols, onChange: (e) => { p.defaultGrid.cols = U.clamp(+e.target.value || 1, 1, 32); Store.touch(); } });
    const rowsIn = U.el("input", { type: "number", min: "1", max: "32", value: p.defaultGrid.rows, onChange: (e) => { p.defaultGrid.rows = U.clamp(+e.target.value || 1, 1, 32); Store.touch(); } });
    const swIn = U.el("input", { type: "range", min: "1", max: "18", step: "0.5", value: p.style.strokeWidth, onInput: (e) => { p.style.strokeWidth = +e.target.value; Store.touch(); } });
    const strokeColor = U.el("input", { type: "color", value: p.style.strokeColor, onInput: (e) => { p.style.strokeColor = e.target.value; Store.touch(); } });
    const bgColor = U.el("input", { type: "color", value: p.style.bg, onInput: (e) => { p.style.bg = e.target.value; Store.touch(); } });
    const wsSel = U.el("select", { onChange: (e) => { p.writingSystem = e.target.value; Store.touch(); } });
    [["alphabet", "Alphabet (letters)"], ["syllabary", "Syllabary (syllable blocks)"], ["logographic", "Logographic (character-per-word, e.g. hieroglyphs)"]].forEach(([v, l]) => wsSel.appendChild(U.el("option", { value: v, text: l, selected: p.writingSystem === v })));
    const posIn = U.el("input", { value: p.partsOfSpeech.join(", "), onChange: (e) => { p.partsOfSpeech = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); Store.touch(); } });
    const genIn = U.el("input", { value: p.genders.join(", "), onChange: (e) => { p.genders = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); Store.touch(); } });

    return U.el("div.card", {}, [
      U.el("h2", { text: "Language settings" }),
      U.el("p.muted", { text: "These defaults apply across the language and can be overridden per glyph." }),
      U.el("div.row", {}, [
        U.el("label.field", {}, ["Default columns", colsIn]),
        U.el("label.field", {}, ["Default rows", rowsIn]),
        U.el("label.field", {}, ["Stroke width", swIn]),
      ]),
      U.el("div.row", {}, [
        U.el("label.field", {}, ["Stroke color", strokeColor]),
        U.el("label.field", {}, ["Canvas background", bgColor]),
      ]),
      U.el("label.field", { style: { marginTop: "10px" } }, ["Writing system", wsSel]),
      U.el("label.field", { style: { marginTop: "10px" } }, ["Parts of speech (comma separated)", posIn]),
      U.el("label.field", { style: { marginTop: "10px" } }, ["Genders / classes (comma separated)", genIn]),
      U.el("div.hint", { style: { marginTop: "10px" } }, ["Use “—” as the first gender to mean “none”."]),
    ]);
  }

  function templateSection(title) {
    const grid = U.el("div.template-grid");
    Templates.templates.forEach((t) => {
      grid.appendChild(U.el("div.template", { onClick: () => createFromTemplate(t) }, [
        U.el("h3", { text: t.name }),
        U.el("p", { text: t.desc }),
      ]));
    });
    return U.el("div.card", {}, [U.el("h2", { text: title }), U.el("p.muted", { text: "Pick a starting point — each comes with sample glyphs and rules you can freely edit." }), grid]);
  }

  function createFromTemplate(t) {
    const proj = t.build();
    Store.addProject(proj);
    U.toast('Created "' + proj.name + '"');
    App.switchTab("overview");
  }

  window.Overview = O;
})();
