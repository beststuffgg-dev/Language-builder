/* health.js — "is my language functional?" A battery of tests that scores the
   language, tells you whether it actually works, and recommends next steps. */
(function () {
  const H = {};
  function project() { return Store.getActive(); }
  const pct = (num, den) => (den ? num / den : 0);

  // Run one rule and decide whether it works.
  function ruleWorks(p, rule) {
    try {
      const word = (rule.test && rule.test.word) || "test";
      const res = Engine.run(rule.graph, { word, params: (rule.test && rule.test.params) || {}, lexicon: p.lexicon });
      if (res.warning) return false; // e.g. no Output node connected
      return res.result != null && String(res.result).length > 0;
    } catch (e) { return false; }
  }

  H.evaluate = function (p) {
    const checks = [];
    const add = (c) => checks.push(c);

    const drawn = p.glyphs.filter((g) => (g.nodes && g.nodes.length) || (g.shapes && g.shapes.length));

    // 1. Characters
    add({
      weight: 2, tab: "glyphs", title: "Characters",
      level: drawn.length === 0 ? "fail" : drawn.length < 4 ? "warn" : "pass",
      detail: drawn.length + " character" + (drawn.length === 1 ? "" : "s") + " drawn.",
      fix: drawn.length === 0 ? "Draw some characters in the Characters tab." : drawn.length < 4 ? "Add a few more characters so words have variety." : "Good coverage.",
    });

    // 2. Romanization coverage (needed to type/transliterate/build fonts)
    if (drawn.length) {
      const rom = drawn.filter((g) => (g.romanization || "").trim()).length;
      const r = pct(rom, drawn.length);
      add({
        weight: 1, tab: "glyphs", title: "Character sounds",
        level: r >= 0.6 ? "pass" : rom > 0 ? "warn" : "fail",
        detail: rom + " of " + drawn.length + " characters have a romanization.",
        fix: r >= 0.6 ? "Enough to type and transliterate." : "Give characters a romanization so you can type them and export a font.",
      });
    }

    // 3. Confusable characters
    if (window.Similarity && drawn.length > 1) {
      const pairs = Similarity.confusablePairs(p.glyphs, 0.75);
      add({
        weight: 1, tab: "glyphs", title: "Distinct characters",
        level: pairs.length === 0 ? "pass" : "warn",
        detail: pairs.length === 0 ? "No confusably-similar characters found." : pairs.length + " look-alike pair(s): " + pairs.slice(0, 4).map((x) => `“${x.a.name}”≈“${x.b.name}” (${Math.round(x.score * 100)}%)`).join(", "),
        fix: pairs.length === 0 ? "Characters are visually distinct." : "Redesign one of each pair so readers don't confuse them (the similarity meter in the Characters tab helps).",
      });
    }

    // 4. Dictionary size
    add({
      weight: 2, tab: "lexicon", title: "Vocabulary",
      level: p.lexicon.length === 0 ? "fail" : p.lexicon.length < 8 ? "warn" : "pass",
      detail: p.lexicon.length + " word" + (p.lexicon.length === 1 ? "" : "s") + " in the dictionary.",
      fix: p.lexicon.length === 0 ? "Add words in the Dictionary tab." : p.lexicon.length < 8 ? "Build out core vocabulary (pronouns, common verbs, numbers)." : "Healthy vocabulary.",
    });

    // 5. Words spelled with glyphs
    if (p.lexicon.length) {
      const spelled = p.lexicon.filter((e) => e.glyphSeq && e.glyphSeq.length).length;
      const r = pct(spelled, p.lexicon.length);
      add({
        weight: 1, tab: "lexicon", title: "Words are written",
        level: r >= 0.7 ? "pass" : spelled > 0 ? "warn" : "fail",
        detail: spelled + " of " + p.lexicon.length + " words have a glyph spelling.",
        fix: r >= 0.7 ? "Most words can be written in your script." : "Give words a spelling (glyph sequence) so they can be written and read.",
      });

      // 6. Words have meanings
      const meaning = p.lexicon.filter((e) => (e.definition || "").trim() || (e.translations && Object.keys(e.translations).length)).length;
      const rm = pct(meaning, p.lexicon.length);
      add({
        weight: 1, tab: "lexicon", title: "Words have meanings",
        level: rm >= 0.8 ? "pass" : "warn",
        detail: meaning + " of " + p.lexicon.length + " words have a translation.",
        fix: rm >= 0.8 ? "Words are documented." : "Add translations so the dictionary and translator are useful.",
      });

      // 7. Duplicate headwords
      const seen = {}; const dups = [];
      p.lexicon.forEach((e) => { const k = (e.headword || "").toLowerCase(); if (!k) return; if (seen[k]) { if (dups.indexOf(k) < 0) dups.push(k); } seen[k] = true; });
      add({
        weight: 0.5, tab: "lexicon", title: "No duplicate words",
        level: dups.length ? "warn" : "pass",
        detail: dups.length ? "Repeated spellings: " + dups.slice(0, 5).join(", ") : "All headwords are unique.",
        fix: dups.length ? "Rename or merge duplicates so translation is unambiguous." : "",
      });
    }

    // 8. Grammar / conjugation rules
    add({
      weight: 1, tab: "rules", title: "Grammar rules",
      level: p.rules.length ? "pass" : "warn",
      detail: p.rules.length + " rule(s) defined.",
      fix: p.rules.length ? "You have programmable grammar." : "Optional, but adding rules (plurals, tenses, gender markers) makes the language feel alive.",
    });

    // 9. Rules actually work
    if (p.rules.length) {
      const broken = p.rules.filter((r) => !ruleWorks(p, r));
      add({
        weight: 1.5, tab: "rules", title: "Rules produce output",
        level: broken.length === 0 ? "pass" : "fail",
        detail: broken.length === 0 ? "All " + p.rules.length + " rules run and return a result." : broken.length + " rule(s) don't produce output: " + broken.map((r) => "“" + r.name + "”").join(", "),
        fix: broken.length === 0 ? "Your grammar is functional." : "Open each and connect the graph through to a “Result Out” node.",
      });
    }

    // Info-only observations (not scored)
    if (drawn.length && p.lexicon.length) {
      const used = new Set();
      p.lexicon.forEach((e) => (e.glyphSeq || []).forEach((id) => used.add(id)));
      const orphans = drawn.filter((g) => !used.has(g.id)).length;
      if (orphans) add({ weight: 0, level: "info", tab: "lexicon", title: "Unused characters", detail: orphans + " character(s) aren't used in any word yet.", fix: "That's fine — or add words that use them." });
    }
    add({ weight: 0, level: "info", tab: "translate", title: "Translation languages", detail: (p.translationLanguages || []).length ? "Translating with: " + p.translationLanguages.join(", ") + "." : "No natural languages added (blank slate).", fix: "" });

    // Score (info checks excluded)
    let wsum = 0, val = 0;
    checks.forEach((c) => { if (!c.weight) return; wsum += c.weight; val += c.weight * (c.level === "pass" ? 1 : c.level === "warn" ? 0.5 : 0); });
    const score = wsum ? Math.round((val / wsum) * 100) : 0;
    const hasFail = checks.some((c) => c.level === "fail");
    const fullyFunctional = !hasFail && p.glyphs.length > 0 && p.lexicon.length > 0;

    let label = "Blank slate";
    if (score >= 92) label = "Polished"; else if (score >= 75) label = "Well-developed"; else if (score >= 55) label = "Functional"; else if (score >= 35) label = "Developing"; else if (score >= 15) label = "Sketch";

    let summary;
    if (!p.glyphs.length && !p.lexicon.length) summary = "Empty so far — start by drawing characters and adding words.";
    else if (fullyFunctional && score >= 55) summary = "This language works: it can be written, read, and translated" + (p.rules.some((r) => true) ? ", and its grammar rules run." : ".");
    else if (fullyFunctional) summary = "The basics are in place — keep building vocabulary and characters.";
    else summary = "Not fully functional yet — see the recommendations below.";

    return { score, label, summary, fullyFunctional, checks };
  };

  H.render = function () {
    const root = document.getElementById("healthRoot");
    U.clear(root);
    const p = project();
    if (!p) return;
    const r = H.evaluate(p);

    const color = r.score >= 75 ? "var(--accent-2)" : r.score >= 45 ? "var(--warn)" : "var(--danger)";
    // Banner
    root.appendChild(U.el("div.card", {}, [
      U.el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px" } }, [
        U.el("h2", { text: "Language health", style: { margin: "0" } }),
        U.el("button.btn.small", { text: "↻ Re-run tests", onClick: () => H.render() }),
      ]),
      U.el("div", { style: { display: "flex", alignItems: "center", gap: "14px", marginTop: "10px", flexWrap: "wrap" } }, [
        U.el("div", { style: { fontSize: "34px", fontWeight: "800", color } }, [String(r.score) + "%"]),
        U.el("div", { style: { flex: "1", minWidth: "200px" } }, [
          U.el("div", { style: { fontSize: "16px", fontWeight: "700" } }, [r.label, U.el("span", { text: r.fullyFunctional ? "  ·  functional ✓" : "  ·  not fully functional", style: { color: r.fullyFunctional ? "var(--accent-2)" : "var(--text-mute)", fontWeight: "500", fontSize: "13px" } })]),
          U.el("div.hint", { text: r.summary, style: { marginTop: "2px" } }),
          U.el("div", { style: { height: "10px", borderRadius: "5px", background: "var(--bg-3)", border: "1px solid var(--line)", overflow: "hidden", marginTop: "8px" } }, [
            U.el("div", { style: { height: "100%", width: r.score + "%", background: color, transition: "width .3s" } }),
          ]),
        ]),
      ]),
    ]));

    // Recommendations (fails, then warns)
    const todo = r.checks.filter((c) => c.level === "fail" || c.level === "warn").sort((a, b) => (a.level === "fail" ? -1 : 1) - (b.level === "fail" ? -1 : 1));
    const recCard = U.el("div.card", {}, [U.el("h2", { text: "Recommendations" })]);
    if (!todo.length) recCard.appendChild(U.el("p.muted", { text: "Nothing pressing — every test passed. 🎉" }));
    todo.forEach((c) => recCard.appendChild(checkRow(c)));
    root.appendChild(recCard);

    // Passing / info
    const okCard = U.el("div.card", {}, [U.el("h2", { text: "Test results" })]);
    r.checks.forEach((c) => okCard.appendChild(checkRow(c, true)));
    root.appendChild(okCard);
  };

  function checkRow(c, compact) {
    const icon = { pass: "✓", warn: "▲", fail: "✕", info: "•" }[c.level];
    const col = { pass: "var(--accent-2)", warn: "var(--warn)", fail: "var(--danger)", info: "var(--text-mute)" }[c.level];
    const kids = [
      U.el("span", { text: icon, style: { color: col, fontWeight: "700", width: "16px", flex: "none" } }),
      U.el("div", { style: { flex: "1" } }, [
        U.el("div", { style: { fontWeight: "600", fontSize: "13px" } }, [c.title, U.el("span", { text: "  " + c.detail, style: { fontWeight: "400", color: "var(--text-dim)" } })]),
        (!compact && c.fix) ? U.el("div.hint", { text: "→ " + c.fix }) : null,
      ]),
    ];
    if (!compact && c.tab && c.level !== "pass") kids.push(U.el("button.btn.small", { text: "Fix →", onClick: () => App.switchTab(c.tab) }));
    return U.el("div", { style: { display: "flex", gap: "8px", alignItems: "flex-start", padding: "8px 0", borderTop: "1px solid var(--line)" } }, kids);
  }

  H.refresh = H.render;
  window.Health = H;
})();
