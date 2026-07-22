/* templates.js — starter languages + the canonical project schema.
   Templates.normalize() guarantees every project has all fields, so old
   or imported projects keep working as the schema grows. */
(function () {
  const T = {};

  T.blankProject = function (name) {
    const now = Date.now();
    return {
      id: U.uid("lang"),
      name: name || "Untitled language",
      description: "",
      createdAt: now,
      updatedAt: now,
      style: { strokeWidth: 6, strokeColor: "#e6edf3", nodeRadius: 5, showGrid: true, bg: "#1a2029" },
      // alphabet | syllabary | logographic (logographic = character-per-word, e.g. hieroglyphs)
      writingSystem: "alphabet",
      // when on, every new character also becomes a dictionary word linked to it
      autoWordForNewGlyph: false,
      defaultGrid: { cols: 5, rows: 7 },
      glyphs: [],
      lexicon: [],
      rules: [],
      partsOfSpeech: ["noun", "verb", "adjective", "adverb", "pronoun", "particle"],
      genders: ["—", "masc", "fem", "neuter"],
      // Natural languages you can translate to/from. English is just a default
      // starting point — remove it for a truly blank slate; no grammar of any
      // natural language is assumed anywhere in the app.
      translationLanguages: ["English"],
      lessons: [],
      progress: {}, // wordId -> { box: <spaced-rep bucket>, seen, correct }
    };
  };

  // Ensure a project loaded from disk/old-version has every field.
  T.normalize = function (p) {
    const base = T.blankProject(p.name);
    const out = Object.assign({}, base, p);
    out.style = Object.assign({}, base.style, p.style || {});
    out.defaultGrid = Object.assign({}, base.defaultGrid, p.defaultGrid || {});
    out.glyphs = (p.glyphs || []).map(normGlyph);
    out.lexicon = (p.lexicon || []).map(normEntry);
    out.rules = (p.rules || []).map(normRule);
    out.partsOfSpeech = p.partsOfSpeech || base.partsOfSpeech;
    out.genders = p.genders || base.genders;
    out.translationLanguages = p.translationLanguages || base.translationLanguages;
    out.writingSystem = p.writingSystem || base.writingSystem;
    out.autoWordForNewGlyph = p.autoWordForNewGlyph || false;
    out.lessons = (p.lessons || []).map(normLesson);
    out.progress = p.progress || {};
    return out;
  };

  function normLesson(l) {
    return { id: l.id || U.uid("les"), title: l.title || "Lesson", notes: l.notes || "", wordIds: l.wordIds || [] };
  }

  function normGlyph(g) {
    return {
      id: g.id || U.uid("gly"),
      name: g.name || "glyph",
      romanization: g.romanization || "",
      sound: g.sound || "",
      meaning: g.meaning || "", // for logographic/hieroglyphic scripts: what this character means
      group: g.group || "",     // optional family name — characters that share a base/starting part
      text: g.text || "",       // optional literal symbol/emoji shown as the character (e.g. imported from a sheet)
      grid: g.grid || { cols: 5, rows: 7 },
      nodes: g.nodes || [],
      connections: (g.connections || []).map((c) => ({ id: c.id || U.uid("c"), from: c.from, to: c.to, type: c.type || "direct", curve: c.curve == null ? 0.4 : c.curve })),
      shapes: (g.shapes || []).map(normShape),
    };
  }

  // Shapes are stored as a grid-aligned bounding box {c,r,w,h} (top-left + span).
  // Old center+size shapes are migrated to an equivalent box.
  function normShape(s) {
    const out = Object.assign({ id: U.uid("s"), type: "circle", rot: 0 }, s);
    if (out.w == null || out.h == null) {
      const side = (s.size || 1) * 1.2;
      out.w = side; out.h = side;
      out.c = (s.c || 0) - side / 2;
      out.r = (s.r || 0) - side / 2;
    }
    delete out.size;
    return out;
  }

  function normEntry(e) {
    const translations = e.translations || {};
    // migrate the old single English gloss into the translations map
    if (e.definition && translations.English == null) translations.English = e.definition;
    // A word can be categorized as several parts of speech at once. posList is the
    // source of truth; the legacy single `pos` is kept in sync as the first entry.
    let posList = Array.isArray(e.posList) ? e.posList.slice() : (e.pos ? [e.pos] : []);
    posList = posList.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
    // Gender/class can likewise be multiple.
    let genderList = Array.isArray(e.genderList) ? e.genderList.slice() : (e.gender ? [e.gender] : []);
    genderList = genderList.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
    return {
      id: e.id || U.uid("word"),
      headword: e.headword || "",
      translations: translations, // { "English": "water", "Spanish": "agua", ... }
      definition: translations.English || e.definition || "", // kept for compatibility
      posList: posList,          // e.g. ["noun","verb"] — a word may be several at once
      pos: posList[0] || "",     // kept for compatibility (first category)
      genderList: genderList,
      gender: genderList[0] || "",
      // gender may be *variable*: inherited from another word (agreement).
      genderMode: e.genderMode === "variable" ? "variable" : "fixed",
      genderFrom: e.genderFrom || null, // wordId this word takes its gender from
      tags: e.tags || [],
      glyphSeq: e.glyphSeq || [],
      parts: e.parts || [], // other word ids this word is composed of (compounds/morphemes)
      // if this word is auto-linked to a single character, the glyph id it mirrors
      // (kept in sync when the character is renamed / re-glossed)
      fromGlyph: e.fromGlyph || null,
      notes: e.notes || "",
    };
  }

  function normRule(r) {
    return {
      id: r.id || U.uid("rule"),
      name: r.name || "rule",
      category: r.category || "conjugation",
      description: r.description || "",
      graph: r.graph || { nodes: [], connections: [] },
      test: r.test || { word: "example", params: {} },
    };
  }

  /* ---------- Glyph builder helpers used by templates ---------- */
  function gnode(c, r) { return { id: U.uid("n"), c, r }; }
  function conn(a, b, type, curve) { return { id: U.uid("c"), from: a.id, to: b.id, type: type || "direct", curve: curve == null ? 0.4 : curve }; }

  function makeGlyph(name, rom, cols, rows, build) {
    const g = { id: U.uid("gly"), name, romanization: rom, sound: rom, grid: { cols, rows }, nodes: [], connections: [], shapes: [] };
    build(g, (c, r) => { const n = gnode(c, r); g.nodes.push(n); return n; }, (a, b, t, cu) => g.connections.push(conn(a, b, t, cu)), (s) => g.shapes.push(Object.assign({ id: U.uid("s") }, s)));
    return g;
  }

  /* ---------- Templates ---------- */
  T.templates = [
    {
      key: "blank",
      name: "Blank canvas",
      desc: "Start from nothing. Full control over grid, glyphs, and rules.",
      build: () => {
        const p = T.blankProject("My language");
        return p;
      },
    },
    {
      key: "blank10",
      name: "Blank · high-res (10×10)",
      desc: "An empty language on a fine 10×10 grid for detailed characters. No example content at all.",
      build: () => {
        const p = T.blankProject("My language");
        p.defaultGrid = { cols: 10, rows: 10 };
        p.style.strokeWidth = 4;
        return p;
      },
    },
    {
      key: "hiero",
      name: "Logographic (hieroglyphs)",
      desc: "Character-per-word script on a 12×12 grid — each glyph is a whole word/idea. No phonetic grammar assumed.",
      build: () => {
        const p = T.blankProject("Renet");
        p.description = "A logographic script: every character stands for a whole word, like hieroglyphs.";
        p.writingSystem = "logographic";
        p.defaultGrid = { cols: 12, rows: 12 };
        p.style.strokeWidth = 5;
        const sun = makeGlyph("sun", "ra", 12, 12, (g, N, C, S) => {
          S({ type: "ring", c: 3, r: 3, w: 6, h: 6 });
          S({ type: "dot", c: 5.5, r: 5.5, w: 1, h: 1 });
          C(N(6, 0), N(6, 2), "direct"); C(N(6, 10), N(6, 12), "direct");
          C(N(0, 6), N(2, 6), "direct"); C(N(10, 6), N(12, 6), "direct");
        });
        sun.meaning = "sun";
        const water = makeGlyph("water", "nu", 12, 12, (g, N, C) => {
          [3, 6, 9].forEach((row) => { const a = N(1, row), b = N(6, row), c = N(11, row); C(a, b, "curved", 0.7); C(b, c, "curved", -0.7); });
        });
        water.meaning = "water";
        const house = makeGlyph("house", "per", 12, 12, (g, N, C, S) => {
          S({ type: "square", c: 3, r: 6, w: 6, h: 5 });
          S({ type: "triangle", c: 2, r: 2, w: 8, h: 4 });
        });
        house.meaning = "house";
        p.glyphs = [sun, water, house];
        p.lexicon = [
          { id: U.uid("word"), headword: "ra", translations: { English: "sun" }, definition: "sun", pos: "noun", glyphSeq: [sun.id] },
          { id: U.uid("word"), headword: "nu", translations: { English: "water" }, definition: "water", pos: "noun", glyphSeq: [water.id] },
          { id: U.uid("word"), headword: "per", translations: { English: "house" }, definition: "house", pos: "noun", glyphSeq: [house.id] },
        ];
        return T.normalize(p);
      },
    },
    {
      key: "runic",
      name: "Runic / angular",
      desc: "Sharp straight-line glyphs on a tall grid. Comes with sample runes & a prefix rule.",
      build: () => {
        const p = T.blankProject("Angarún");
        p.description = "An angular runic script written top-to-bottom with straight strokes.";
        p.defaultGrid = { cols: 4, rows: 8 };
        p.style.strokeWidth = 7;
        p.glyphs = [
          makeGlyph("ansuz", "a", 4, 8, (g, N, C) => {
            const a = N(2, 0), b = N(2, 8), c = N(0, 2), d = N(0, 4);
            C(a, b, "direct"); C(a, c, "direct"); C(a, d, "direct");
          }),
          makeGlyph("tiwaz", "t", 4, 8, (g, N, C) => {
            const top = N(2, 0), bot = N(2, 8), l = N(0, 2), r = N(4, 2);
            C(top, bot, "direct"); C(top, l, "direct"); C(top, r, "direct");
          }),
          makeGlyph("isaz", "i", 4, 8, (g, N, C) => { C(N(2, 0), N(2, 8), "direct"); }),
          makeGlyph("raidho", "r", 4, 8, (g, N, C) => {
            const a = N(0, 0), b = N(0, 8), c = N(3, 2), d = N(0, 4), e = N(3, 8);
            C(a, b, "direct"); C(a, c, "direct"); C(c, d, "direct"); C(d, e, "direct");
          }),
        ];
        p.rules = [makePrefixRule("Definite prefix", "prefix", "il", "conjugation")];
        p.lexicon = [
          { id: U.uid("word"), headword: "tar", definition: "stone, rock", pos: "noun", gender: "neuter", tags: ["earth"], glyphSeq: [p.glyphs[1].id, p.glyphs[0].id, p.glyphs[3].id], notes: "" },
        ];
        return T.normalize(p);
      },
    },
    {
      key: "flowing",
      name: "Flowing script",
      desc: "Curved, connected strokes on a wide grid — good for cursive-style conlangs.",
      build: () => {
        const p = T.blankProject("Elen…");
        p.description = "A flowing cursive script built from curved strokes.";
        p.defaultGrid = { cols: 7, rows: 5 };
        p.style.strokeWidth = 5;
        p.glyphs = [
          makeGlyph("lir", "l", 7, 5, (g, N, C) => {
            const a = N(0, 4), b = N(2, 1), c = N(4, 4), d = N(6, 1);
            C(a, b, "curved", 0.7); C(b, c, "curved", -0.7); C(c, d, "curved", 0.7);
          }),
          makeGlyph("nen", "n", 7, 5, (g, N, C, S) => {
            const a = N(1, 4), b = N(3, 1), c = N(5, 4);
            C(a, b, "curved", 0.6); C(b, c, "curved", 0.6);
            S({ type: "circle", c: 3, r: 4, size: 0.6 });
          }),
          makeGlyph("oma", "o", 7, 5, (g, N, C, S) => { S({ type: "circle", c: 3, r: 2, size: 2.2 }); }),
        ];
        p.rules = [makePrefixRule("Diminutive suffix", "suffix", "in", "conjugation")];
        return T.normalize(p);
      },
    },
    {
      key: "syllabary",
      name: "Syllabary + gender",
      desc: "Square syllable blocks plus a grammar rule adding gender symbols. Great starting point.",
      build: () => {
        const p = T.blankProject("Kavani");
        p.description = "A syllabary where each glyph is a consonant+vowel block; gender is marked with a symbol.";
        p.defaultGrid = { cols: 6, rows: 6 };
        p.glyphs = [
          makeGlyph("ka", "ka", 6, 6, (g, N, C, S) => {
            const a = N(1, 1), b = N(5, 1), c = N(1, 5), d = N(5, 5);
            C(a, b, "direct"); C(c, d, "direct"); C(a, c, "direct"); C(b, d, "direct");
            S({ type: "circle", c: 3, r: 3, size: 1 });
          }),
          makeGlyph("va", "va", 6, 6, (g, N, C) => {
            const a = N(1, 1), b = N(3, 5), c = N(5, 1);
            C(a, b, "diagonal"); C(b, c, "diagonal");
          }),
          makeGlyph("ni", "ni", 6, 6, (g, N, C, S) => {
            const a = N(1, 5), b = N(1, 1), c = N(5, 5);
            C(a, b, "direct"); C(b, c, "diagonal");
            S({ type: "ring", c: 4, r: 1, size: 0.8 });
          }),
        ];
        p.rules = [
          makePrefixRule("Plural prefix", "prefix", "sa", "grammar"),
          makeGenderRule(),
        ];
        p.lexicon = [
          { id: U.uid("word"), headword: "kava", definition: "water", pos: "noun", gender: "fem", tags: ["nature"], glyphSeq: [p.glyphs[0].id, p.glyphs[1].id], notes: "" },
          { id: U.uid("word"), headword: "vani", definition: "to flow", pos: "verb", gender: "", tags: [], glyphSeq: [p.glyphs[1].id, p.glyphs[2].id], notes: "" },
        ];
        return T.normalize(p);
      },
    },
  ];

  T.get = function (key) { return T.templates.find((t) => t.key === key); };

  /* ---------- Sample node-graph rules ---------- */
  // A simple affix rule: Input -> Prefix/Suffix(const) -> Output
  function makePrefixRule(name, mode, affix, category) {
    const inNode = { id: U.uid("nd"), type: "input", x: 60, y: 120, params: {} };
    const constNode = { id: U.uid("nd"), type: "const", x: 60, y: 240, params: { value: affix } };
    const opNode = { id: U.uid("nd"), type: mode, x: 320, y: 150, params: {} };
    const outNode = { id: U.uid("nd"), type: "output", x: 560, y: 160, params: {} };
    const graph = {
      nodes: [inNode, constNode, opNode, outNode],
      connections: [
        { id: U.uid("w"), from: { node: inNode.id, socket: "word" }, to: { node: opNode.id, socket: "base" } },
        { id: U.uid("w"), from: { node: constNode.id, socket: "out" }, to: { node: opNode.id, socket: "affix" } },
        { id: U.uid("w"), from: { node: opNode.id, socket: "out" }, to: { node: outNode.id, socket: "in" } },
      ],
    };
    return { id: U.uid("rule"), name, category: category || "conjugation", description: `Adds "${affix}" as a ${mode}.`, graph, test: { word: "tar", params: {} } };
  }

  // Gender rule: if param gender == fem, append symbol, else leave as is.
  function makeGenderRule() {
    const inNode = { id: U.uid("nd"), type: "input", x: 50, y: 60, params: {} };
    const paramNode = { id: U.uid("nd"), type: "param", x: 50, y: 200, params: { key: "gender" } };
    const femConst = { id: U.uid("nd"), type: "const", x: 50, y: 320, params: { value: "fem" } };
    const eqNode = { id: U.uid("nd"), type: "equals", x: 280, y: 240, params: {} };
    const symConst = { id: U.uid("nd"), type: "const", x: 280, y: 60, params: { value: "◦" } };
    const sfx = { id: U.uid("nd"), type: "suffix", x: 500, y: 90, params: {} };
    const sel = { id: U.uid("nd"), type: "select", x: 720, y: 140, params: {} };
    const out = { id: U.uid("nd"), type: "output", x: 940, y: 150, params: {} };
    const w = (from, fs, to, ts) => ({ id: U.uid("w"), from: { node: from, socket: fs }, to: { node: to, socket: ts } });
    return {
      id: U.uid("rule"),
      name: "Gender marker",
      category: "grammar",
      description: "Appends a ◦ symbol to feminine words. Set the 'gender' parameter when testing.",
      graph: {
        nodes: [inNode, paramNode, femConst, eqNode, symConst, sfx, sel, out],
        connections: [
          w(paramNode.id, "out", eqNode.id, "a"),
          w(femConst.id, "out", eqNode.id, "b"),
          w(inNode.id, "word", sfx.id, "base"),
          w(symConst.id, "out", sfx.id, "affix"),
          w(eqNode.id, "out", sel.id, "cond"),
          w(sfx.id, "out", sel.id, "ifTrue"),
          w(inNode.id, "word", sel.id, "ifFalse"),
          w(sel.id, "out", out.id, "in"),
        ],
      },
      test: { word: "kava", params: { gender: "fem" } },
    };
  }

  window.Templates = T;
})();
