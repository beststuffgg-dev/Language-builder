/* learn.js — framework for a language-learning section:
   lessons (grouped vocab), flashcards with Leitner spaced-repetition boxes,
   and a multiple-choice quiz. Built to extend. */
(function () {
  const Le = { mode: "lessons", session: null };
  function project() { return Store.getActive(); }

  function prog(p, wid) {
    p.progress = p.progress || {};
    if (!p.progress[wid]) p.progress[wid] = { box: 0, seen: 0, correct: 0 };
    return p.progress[wid];
  }
  function primaryMeaning(p, e) {
    const langs = p.translationLanguages || [];
    for (const l of langs) if (e.translations && e.translations[l]) return e.translations[l];
    return e.definition || "";
  }

  Le.render = function () {
    const root = document.getElementById("learnRoot");
    U.clear(root);
    const p = project();
    if (!p) return;

    const tabs = U.el("div.row", { style: { flex: "0", marginBottom: "14px" } }, [
      modeBtn("lessons", "Lessons"), modeBtn("flashcards", "Flashcards"), modeBtn("quiz", "Quiz"),
    ]);
    // keep the toggle compact
    tabs.style.maxWidth = "360px";
    root.appendChild(tabs);

    if (Le.mode === "lessons") renderLessons(p, root);
    else if (Le.mode === "flashcards") renderFlashcards(p, root);
    else renderQuiz(p, root);
  };

  function modeBtn(mode, label) {
    return U.el("button.btn" + (Le.mode === mode ? ".active" : ""), { text: label, onClick: () => { Le.mode = mode; Le.session = null; Le.render(); } });
  }

  /* ---------- Lessons ---------- */
  function renderLessons(p, root) {
    const totalSeen = Object.values(p.progress || {}).filter((x) => x.seen).length;
    const learned = Object.values(p.progress || {}).filter((x) => x.box >= 3).length;
    root.appendChild(U.el("div.card", {}, [
      U.el("h2", { text: "Progress" }),
      U.el("div.stat-grid", {}, [
        statBox(p.lexicon.length, "Total words"),
        statBox(totalSeen, "Words studied"),
        statBox(learned, "Words learned"),
        statBox(p.lessons.length, "Lessons"),
      ]),
    ]));

    const listCard = U.el("div.card");
    listCard.appendChild(U.el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, [
      U.el("h2", { text: "Lessons", style: { margin: "0" } }),
      U.el("button.btn.primary", { text: "＋ New lesson", onClick: () => editLesson(null) }),
    ]));
    if (!p.lessons.length) listCard.appendChild(U.el("p.muted", { text: "Group vocabulary into lessons to study them together. Or use Flashcards / Quiz on your whole dictionary." }));
    p.lessons.forEach((les) => {
      listCard.appendChild(U.el("div", { style: { display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderTop: "1px solid var(--line)" } }, [
        U.el("div", { style: { flex: "1" } }, [
          U.el("strong", { text: les.title }),
          U.el("div.hint", { text: les.wordIds.length + " words" + (les.notes ? " · " + les.notes : "") }),
        ]),
        U.el("button.btn.small", { text: "Flashcards", onClick: () => { Le.mode = "flashcards"; Le.session = null; Le._lesson = les.id; Le.render(); } }),
        U.el("button.btn.small", { text: "Quiz", onClick: () => { Le.mode = "quiz"; Le.session = null; Le._lesson = les.id; Le.render(); } }),
        U.el("button.btn.small", { text: "Edit", onClick: () => editLesson(les) }),
        U.el("button.btn.small.danger", { text: "✕", onClick: () => { U.confirm("Delete lesson", `Delete “${les.title}”?`, () => { p.lessons = p.lessons.filter((l) => l.id !== les.id); Store.touch(); Le.render(); }, "Delete"); } }),
      ]));
    });
    root.appendChild(listCard);
  }

  function statBox(n, l) { return U.el("div.stat", {}, [U.el("div.n", { text: String(n) }), U.el("div.l", { text: l })]); }

  function editLesson(lesson) {
    const p = project();
    const isNew = !lesson;
    const l = lesson ? U.clone(lesson) : { id: U.uid("les"), title: "Lesson " + (p.lessons.length + 1), notes: "", wordIds: [] };
    const titleIn = U.el("input", { value: l.title });
    const notesIn = U.el("input", { value: l.notes, placeholder: "optional note" });
    const chosen = U.el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", minHeight: "34px", padding: "6px", background: "var(--bg-3)", border: "1px solid var(--line)", borderRadius: "6px" } });
    const renderChosen = () => {
      U.clear(chosen);
      if (!l.wordIds.length) chosen.appendChild(U.el("span.hint", { text: "pick words below" }));
      l.wordIds.forEach((wid, i) => { const w = p.lexicon.find((x) => x.id === wid); chosen.appendChild(U.el("span.tag", { style: { cursor: "pointer" }, text: (w ? w.headword : "?") + " ✕", onClick: () => { l.wordIds.splice(i, 1); renderChosen(); } })); });
    };
    renderChosen();
    const picker = U.el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", maxHeight: "160px", overflow: "auto" } });
    p.lexicon.forEach((w) => picker.appendChild(U.el("button.btn.small", { text: w.headword, title: primaryMeaning(p, w), onClick: () => { if (!l.wordIds.includes(w.id)) { l.wordIds.push(w.id); renderChosen(); } } })));

    U.modal({
      title: isNew ? "New lesson" : "Edit lesson",
      body: [
        U.el("label.field", {}, ["Title", titleIn]),
        U.el("label.field", {}, ["Note", notesIn]),
        U.el("label.field", {}, ["Words", chosen]),
        U.el("div.field", {}, [U.el("span.hint", { text: "Add words:" }), picker]),
      ],
      confirmText: isNew ? "Create" : "Save",
      onConfirm: () => {
        l.title = titleIn.value.trim() || l.title; l.notes = notesIn.value.trim();
        if (isNew) p.lessons.push(l); else { const i = p.lessons.findIndex((x) => x.id === l.id); if (i >= 0) p.lessons[i] = l; }
        Store.touch(); Le.render();
      },
    });
  }

  function vocabFor(p, lessonId) {
    if (lessonId) { const les = p.lessons.find((l) => l.id === lessonId); if (les) return les.wordIds.map((id) => p.lexicon.find((w) => w.id === id)).filter(Boolean); }
    return p.lexicon.slice();
  }

  /* ---------- Flashcards ---------- */
  function renderFlashcards(p, root) {
    const source = Le._lesson || "";
    const words = vocabFor(p, source).filter((w) => w.headword);
    root.appendChild(sourcePicker(p, source, (v) => { Le._lesson = v; Le.session = null; Le.render(); }));
    if (!words.length) { root.appendChild(U.el("div.card", {}, [U.el("p.muted", { text: "No words to study. Add words in the Dictionary." })])); return; }

    if (!Le.session) {
      // order by Leitner box (unseen/low first)
      const order = words.slice().sort((a, b) => prog(p, a.id).box - prog(p, b.id).box);
      Le.session = { order, i: 0, revealed: false, done: 0 };
    }
    const s = Le.session;
    if (s.i >= s.order.length) {
      root.appendChild(U.el("div.card", {}, [U.el("h2", { text: "Session complete 🎉" }), U.el("p.muted", { text: "Reviewed " + s.order.length + " cards." }), U.el("button.btn.primary", { text: "Study again", onClick: () => { Le.session = null; Le.render(); } })]));
      return;
    }
    const w = s.order[s.i];
    const card = U.el("div.card", { style: { textAlign: "center" } });
    card.appendChild(U.el("div.hint", { text: "Card " + (s.i + 1) + " / " + s.order.length + "   ·   box " + prog(p, w.id).box }));
    const face = U.el("div", { style: { padding: "24px", minHeight: "120px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px" } });
    // front: glyphs + headword
    const line = U.el("div", { style: { display: "flex", gap: "3px", alignItems: "flex-end" } });
    (w.glyphSeq || []).forEach((gid) => { const g = p.glyphs.find((x) => x.id === gid); if (g) line.appendChild(GlyphRender.render(g, { size: 70, style: p.style, strokeWidth: 3 })); });
    if (line.childNodes.length) face.appendChild(line);
    face.appendChild(U.el("div", { text: w.headword, style: { fontSize: "26px", fontWeight: "700" } }));
    if (s.revealed) {
      face.appendChild(U.el("div", { style: { borderTop: "1px solid var(--line)", paddingTop: "10px", width: "80%" } }, [
        U.el("div", { text: primaryMeaning(p, w) || "(no translation)", style: { fontSize: "18px", color: "var(--accent-2)" } }),
        (function () {
          const pos = (w.posList && w.posList.length ? w.posList : (w.pos ? [w.pos] : []));
          const gen = (w.genderList && w.genderList.length ? w.genderList : (w.gender ? [w.gender] : []));
          const bits = pos.concat(gen);
          return bits.length ? U.el("div.hint", { text: bits.join(" · ") }) : null;
        })(),
      ]));
    }
    card.appendChild(face);
    if (!s.revealed) {
      card.appendChild(U.el("button.btn.primary", { text: "Show answer", onClick: () => { s.revealed = true; Le.render(); } }));
    } else {
      card.appendChild(U.el("div.inline-actions", { style: { justifyContent: "center" } }, [
        U.el("button.btn", { text: "✗ Review", onClick: () => grade(p, w, false, s) }),
        U.el("button.btn.primary", { text: "✓ Got it", onClick: () => grade(p, w, true, s) }),
      ]));
    }
    root.appendChild(card);
  }

  function grade(p, w, correct, s) {
    const pr = prog(p, w.id);
    pr.seen++; if (correct) { pr.correct++; pr.box = Math.min(5, pr.box + 1); } else { pr.box = 0; }
    Store.touch();
    s.i++; s.revealed = false;
    Le.render();
  }

  /* ---------- Quiz ---------- */
  function renderQuiz(p, root) {
    const source = Le._lesson || "";
    const words = vocabFor(p, source).filter((w) => w.headword && primaryMeaning(p, w));
    root.appendChild(sourcePicker(p, source, (v) => { Le._lesson = v; Le.session = null; Le.render(); }));
    if (words.length < 2) { root.appendChild(U.el("div.card", {}, [U.el("p.muted", { text: "Need at least 2 words with meanings to run a quiz." })])); return; }

    if (!Le.session || Le.session.kind !== "quiz") {
      Le.session = { kind: "quiz", pool: shuffle(words.slice()), i: 0, score: 0, answered: false, pick: null };
    }
    const s = Le.session;
    if (s.i >= s.pool.length) {
      root.appendChild(U.el("div.card", {}, [U.el("h2", { text: "Quiz done" }), U.el("p.muted", { text: "Score: " + s.score + " / " + s.pool.length }), U.el("button.btn.primary", { text: "Retake", onClick: () => { Le.session = null; Le.render(); } })]));
      return;
    }
    const w = s.pool[s.i];
    const distractors = shuffle(words.filter((x) => x.id !== w.id)).slice(0, 3);
    if (!s.options) s.options = shuffle([w].concat(distractors));
    const card = U.el("div.card");
    card.appendChild(U.el("div.hint", { text: "Question " + (s.i + 1) + " / " + s.pool.length + "   ·   score " + s.score }));
    card.appendChild(U.el("h2", { text: "What does this mean?" }));
    const line = U.el("div", { style: { display: "flex", gap: "3px", alignItems: "flex-end", margin: "6px 0" } });
    (w.glyphSeq || []).forEach((gid) => { const g = p.glyphs.find((x) => x.id === gid); if (g) line.appendChild(GlyphRender.render(g, { size: 48, style: p.style, strokeWidth: 3 })); });
    if (line.childNodes.length) card.appendChild(line);
    card.appendChild(U.el("div", { text: w.headword, style: { fontSize: "22px", fontWeight: "700", marginBottom: "10px" } }));
    s.options.forEach((opt) => {
      const correct = opt.id === w.id;
      let cls = ".btn";
      if (s.answered) { if (correct) cls = ".btn.primary"; else if (opt.id === s.pick) cls = ".btn.danger"; }
      card.appendChild(U.el("button" + cls, { text: primaryMeaning(p, opt), style: { display: "block", width: "100%", textAlign: "left", marginBottom: "6px" }, onClick: () => {
        if (s.answered) return;
        s.answered = true; s.pick = opt.id;
        const pr = prog(p, w.id); pr.seen++; if (correct) { s.score++; pr.correct++; pr.box = Math.min(5, pr.box + 1); } else pr.box = Math.max(0, pr.box - 1);
        Store.touch(); Le.render();
      } }));
    });
    if (s.answered) card.appendChild(U.el("button.btn.primary", { text: s.i + 1 >= s.pool.length ? "Finish" : "Next →", onClick: () => { s.i++; s.answered = false; s.pick = null; s.options = null; Le.render(); } }));
    root.appendChild(card);
  }

  function sourcePicker(p, source, onChange) {
    const sel = U.el("select", { onChange: (e) => onChange(e.target.value) });
    sel.appendChild(U.el("option", { value: "", text: "All dictionary words", selected: source === "" }));
    p.lessons.forEach((l) => sel.appendChild(U.el("option", { value: l.id, text: l.title, selected: source === l.id })));
    return U.el("div.card", { style: { padding: "10px 16px" } }, [U.el("label.field", { style: { flexDirection: "row", alignItems: "center", gap: "8px" } }, ["Studying", sel])]);
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  Le.refresh = Le.render;
  window.Learn = Le;
})();
