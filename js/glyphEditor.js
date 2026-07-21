/* glyphEditor.js — interactive grid character designer.
   Place nodes on a grid, connect them (direct/curved/diagonal/ortho),
   drop basic shapes, tune grid size & stroke. */
(function () {
  const E = {
    glyphId: null,
    mode: "node", // node | connect | shape | erase
    connType: "direct",
    shapeType: "circle",
    shapeSize: 1,
    selectedNode: null,
    pendingConnect: null,
    dragNode: null,
    dragged: false,
  };

  function project() { return Store.getActive(); }
  function currentGlyph() {
    const p = project();
    return p && p.glyphs.find((g) => g.id === E.glyphId);
  }

  /* ---------- Sidebar list ---------- */
  E.renderList = function () {
    const p = project();
    const list = document.getElementById("glyphList");
    U.clear(list);
    if (!p) return;
    if (!p.glyphs.length) {
      list.appendChild(U.el("div.empty-hint", { text: "No characters yet. Click “＋ New”." }));
    }
    p.glyphs.forEach((g) => {
      const thumb = GlyphRender.render(g, { size: 30, width: 30, height: 30, padding: 4, style: p.style, strokeWidth: 3 });
      const item = U.el("div.list-item" + (g.id === E.glyphId ? ".active" : ""), { onClick: () => E.open(g.id) }, [
        U.el("span.li-thumb", { style: { display: "flex", alignItems: "center", justifyContent: "center" } }, [thumb]),
        U.el("div", { style: { flex: "1", overflow: "hidden" } }, [
          U.el("div.li-title", { text: g.name || "glyph" }),
          U.el("div.li-sub", { text: (g.romanization ? "/" + g.romanization + "/  " : "") + g.grid.cols + "×" + g.grid.rows }),
        ]),
      ]);
      list.appendChild(item);
    });
  };

  E.open = function (id) {
    E.glyphId = id;
    E.selectedNode = null;
    E.pendingConnect = null;
    E.renderList();
    E.renderWorkspace();
  };

  E.addGlyph = function () {
    const p = project();
    if (!p) return;
    const g = {
      id: U.uid("gly"), name: "glyph " + (p.glyphs.length + 1), romanization: "", sound: "",
      grid: U.clone(p.defaultGrid), nodes: [], connections: [], shapes: [],
    };
    p.glyphs.push(g);
    Store.touch();
    E.open(g.id);
  };

  /* ---------- Workspace ---------- */
  E.renderWorkspace = function () {
    const ws = document.getElementById("glyphWorkspace");
    U.clear(ws);
    const p = project();
    const g = currentGlyph();
    if (!g) {
      ws.appendChild(U.el("div.glyph-canvas-wrap", {}, [
        U.el("div.empty-hint", { text: p && p.glyphs.length ? "Select a character to edit." : "Create a character to begin designing." }),
      ]));
      return;
    }

    const canvasWrap = U.el("div.glyph-canvas-wrap");
    const svg = buildEditorSVG(g, p);
    canvasWrap.appendChild(svg);

    ws.appendChild(canvasWrap);
    ws.appendChild(buildTools(g, p));
  };

  function buildEditorSVG(g, p) {
    const size = 380; // keep the designer compact so it doesn't dominate the screen
    const svg = GlyphRender.render(g, { size, style: p.style, showGrid: p.style.showGrid !== false, showNodes: true, background: p.style.bg });
    const proj = svg._proj, box = svg._box;
    const cols = g.grid.cols, rows = g.grid.rows;

    // Transparent hit targets over grid points for easy, snappy clicking.
    for (let c = 0; c <= cols; c++) {
      for (let r = 0; r <= rows; r++) {
        const pt = proj.pt(c, r);
        svg.appendChild(U.svg("circle", { cx: pt.x, cy: pt.y, r: Math.max(7, Math.min(proj.cw, proj.ch) * 0.42), fill: "transparent", "data-c": c, "data-r": r, style: "cursor:pointer" }));
      }
    }
    if (E.selectedNode) svg.querySelectorAll("[data-node='" + E.selectedNode + "']").forEach((e) => e.classList.add("sel"));
    if (E.pendingConnect) svg.querySelectorAll("[data-node='" + E.pendingConnect + "']").forEach((e) => e.classList.add("sel"));

    // keep references so drag handlers survive re-renders
    E._svg = svg; E._proj = proj; E._box = box; E._cols = cols; E._rows = rows; E._g = g;

    svg.addEventListener("pointerdown", (evt) => onDown(evt, g));
    return svg;
  }

  // Map a pointer event to the nearest grid coordinate (snaps to grid lines).
  function toModelEvt(evt) {
    const svg = E._svg;
    const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    return {
      c: U.clamp(Math.round((loc.x - E._box.x) / E._proj.cw), 0, E._cols),
      r: U.clamp(Math.round((loc.y - E._box.y) / E._proj.ch), 0, E._rows),
    };
  }

  function onDown(evt, g) {
    const t = evt.target;
    const connId = t.getAttribute("data-conn");
    if (connId) {
      if (E.mode === "erase") removeConnection(g, connId);
      else cycleConnType(g, connId);
      commit(); return;
    }
    const shapeId = t.getAttribute("data-shape");
    if (shapeId && E.mode !== "shape") {
      if (E.mode === "erase") { g.shapes = g.shapes.filter((s) => s.id !== shapeId); commit(); }
      return; // ignore shape clicks in other modes (don't drop stray nodes)
    }

    // Everything else is resolved by grid coordinate.
    let c, r;
    if (t.hasAttribute("data-c")) { c = +t.getAttribute("data-c"); r = +t.getAttribute("data-r"); }
    else { const m = toModelEvt(evt); c = m.c; r = m.r; }
    const nodeAt = g.nodes.find((n) => n.c === c && n.r === r);

    if (E.mode === "erase") { if (nodeAt) { removeNode(g, nodeAt.id); commit(); } return; }
    if (E.mode === "shape") { startShapeDrag(c, r); return; }
    if (E.mode === "connect") { if (nodeAt) startConnectDrag(nodeAt.id, c, r); return; }

    // node mode (default): drag existing node, or add one and drag it into place
    let id;
    if (nodeAt) { E.selectedNode = nodeAt.id; id = nodeAt.id; }
    else { const n = addNode(g, c, r); id = n.id; }
    startNodeDrag(id);
    commit();
  }

  function startNodeDrag(nodeId) {
    const g = E._g; E.dragged = false;
    const move = (ev) => { const { c, r } = toModelEvt(ev); const n = g.nodes.find((x) => x.id === nodeId); if (n && (n.c !== c || n.r !== r)) { n.c = c; n.r = r; E.dragged = true; commit(); } };
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); if (E.dragged) Store.touch(); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // Drag from one corner to the opposite corner; the shape fits the grid box.
  function startShapeDrag(c0, r0) {
    const g = E._g;
    const id = U.uid("s");
    g.shapes.push({ id, type: E.shapeType, c: c0, r: r0, w: 0, h: 0, rot: 0 });
    commit();
    const move = (ev) => {
      const m = toModelEvt(ev);
      const s = g.shapes.find((x) => x.id === id); if (!s) return;
      s.c = Math.min(c0, m.c); s.r = Math.min(r0, m.r); s.w = Math.abs(m.c - c0); s.h = Math.abs(m.r - r0);
      commit();
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      const s = g.shapes.find((x) => x.id === id);
      if (s && s.w < 0.5 && s.h < 0.5) { // a plain click → a default 2×2 shape at the point
        s.w = 2; s.h = 2; s.c = U.clamp(c0 - 1, 0, E._cols); s.r = U.clamp(r0 - 1, 0, E._rows);
      }
      Store.touch(); commit();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // Drag node→node to connect; a plain click uses the multi-click flow instead.
  function startConnectDrag(nodeId, c0, r0) {
    const g = E._g; let moved = false;
    const move = (ev) => { const m = toModelEvt(ev); if (m.c !== c0 || m.r !== r0) moved = true; };
    const up = (ev) => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      const m = toModelEvt(ev);
      const target = g.nodes.find((n) => n.c === m.c && n.r === m.r);
      if (target && target.id !== nodeId) {
        const dup = g.connections.find((cc) => (cc.from === nodeId && cc.to === target.id) || (cc.from === target.id && cc.to === nodeId));
        if (!dup) g.connections.push({ id: U.uid("c"), from: nodeId, to: target.id, type: E.connType, curve: 0.4 });
        E.pendingConnect = null; commit();
      } else if (!moved) { handleConnectClick(g, nodeId); commit(); }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  function commit() {
    Store.touch();
    // re-render workspace and list thumbnail
    E.renderWorkspace();
    E.renderList();
  }

  /* ---------- Model ops ---------- */
  function addNode(g, c, r) {
    const existing = g.nodes.find((n) => n.c === c && n.r === r);
    if (existing) { E.selectedNode = existing.id; return existing; }
    const n = { id: U.uid("n"), c, r };
    g.nodes.push(n);
    E.selectedNode = n.id;
    return n;
  }
  function removeNode(g, id) {
    g.nodes = g.nodes.filter((n) => n.id !== id);
    g.connections = g.connections.filter((c) => c.from !== id && c.to !== id);
    if (E.selectedNode === id) E.selectedNode = null;
    if (E.pendingConnect === id) E.pendingConnect = null;
  }
  function removeConnection(g, id) { g.connections = g.connections.filter((c) => c.id !== id); }
  function cycleConnType(g, id) {
    const order = ["direct", "curved", "diagonal", "ortho"];
    const c = g.connections.find((x) => x.id === id);
    if (!c) return;
    c.type = order[(order.indexOf(c.type) + 1) % order.length];
    U.toast("Connection → " + connLabel(c.type));
  }
  function handleConnectClick(g, nodeId) {
    if (!E.pendingConnect) { E.pendingConnect = nodeId; return; }
    if (E.pendingConnect === nodeId) { E.pendingConnect = null; return; }
    // avoid duplicate
    const dup = g.connections.find((c) => (c.from === E.pendingConnect && c.to === nodeId) || (c.from === nodeId && c.to === E.pendingConnect));
    if (!dup) g.connections.push({ id: U.uid("c"), from: E.pendingConnect, to: nodeId, type: E.connType, curve: 0.4 });
    E.pendingConnect = null;
  }

  function connLabel(t) {
    return { direct: "Direct", curved: "Curved", diagonal: "Diagonal+straight", ortho: "Straight (L)" }[t] || t;
  }

  /* ---------- Tools panel ---------- */
  function buildTools(g, p) {
    const panel = U.el("div.glyph-tools");

    // Glyph identity
    const logographic = p.writingSystem === "logographic";
    const idGroup = U.el("div.tool-group", {}, [
      U.el("h4", { text: "Character" }),
      field("Name", U.el("input", { value: g.name, onInput: (e) => { g.name = e.target.value; Store.touch(); E.renderList(); } })),
      field(logographic ? "Meaning (word)" : "Meaning", U.el("input", { value: g.meaning, placeholder: logographic ? "e.g. sun" : "optional — for logograms", onInput: (e) => { g.meaning = e.target.value; Store.touch(); E.renderList(); } })),
      field("Romanization", U.el("input", { value: g.romanization, placeholder: "e.g. ka", onInput: (e) => { g.romanization = e.target.value; Store.touch(); E.renderList(); } })),
      field("Sound / IPA", U.el("input", { value: g.sound, placeholder: "optional", onInput: (e) => { g.sound = e.target.value; Store.touch(); } })),
    ]);
    panel.appendChild(idGroup);

    // Similarity meter — warns about confusable characters
    panel.appendChild(buildSimilarity(g, p));

    // Mode buttons
    const modes = [["node", "Nodes"], ["connect", "Connect"], ["shape", "Shapes"], ["erase", "Erase"]];
    const modeBtns = U.el("div.tool-btns");
    modes.forEach(([m, label]) => {
      modeBtns.appendChild(U.el("button.btn.small" + (E.mode === m ? ".active" : ""), {
        text: label, onClick: () => { E.mode = m; E.pendingConnect = null; E.renderWorkspace(); },
      }));
    });
    panel.appendChild(U.el("div.tool-group", {}, [U.el("h4", { text: "Tool" }), modeBtns,
      U.el("div.hint", { text: modeHint() })]));

    // Connection type
    const connBtns = U.el("div.tool-btns");
    ["direct", "curved", "diagonal", "ortho"].forEach((t) => {
      connBtns.appendChild(U.el("button.btn.small" + (E.connType === t ? ".active" : ""), {
        text: connLabel(t), onClick: () => { E.connType = t; E.renderWorkspace(); },
      }));
    });
    panel.appendChild(U.el("div.tool-group", {}, [U.el("h4", { text: "Connection style" }), connBtns,
      U.el("div.hint", { text: "Tip: click any drawn line to cycle its style." })]));

    // Shapes
    const shapeBtns = U.el("div.tool-btns");
    ["circle", "ring", "square", "triangle", "diamond", "arc", "dot"].forEach((s) => {
      shapeBtns.appendChild(U.el("button.btn.small" + (E.shapeType === s ? ".active" : ""), {
        text: s, onClick: () => { E.shapeType = s; E.mode = "shape"; E.renderWorkspace(); },
      }));
    });
    panel.appendChild(U.el("div.tool-group", {}, [U.el("h4", { text: "Basic shapes" }), shapeBtns,
      U.el("div.hint", { text: "Drag from one grid corner to the opposite corner — the shape fits inside the box." })]));

    // Grid size (supports high-res grids up to 32×32)
    const colsIn = U.el("input", { type: "number", min: "1", max: "32", value: g.grid.cols, onChange: (e) => { g.grid.cols = U.clamp(+e.target.value || 1, 1, 32); clampNodes(g); commit(); } });
    const rowsIn = U.el("input", { type: "number", min: "1", max: "32", value: g.grid.rows, onChange: (e) => { g.grid.rows = U.clamp(+e.target.value || 1, 1, 32); clampNodes(g); commit(); } });
    panel.appendChild(U.el("div.tool-group", {}, [U.el("h4", { text: "Grid size" }),
      U.el("div.mini-grid2", {}, [U.el("label.field", {}, ["Columns", colsIn]), U.el("label.field", {}, ["Rows", rowsIn])])]));

    // Style
    const sw = U.el("input", { type: "range", min: "1", max: "18", step: "0.5", value: g._sw || p.style.strokeWidth, onInput: (e) => { p.style.strokeWidth = +e.target.value; commit(); } });
    const showGrid = U.el("input", { type: "checkbox", checked: p.style.showGrid !== false, onChange: (e) => { p.style.showGrid = e.target.checked; E.renderWorkspace(); } });
    panel.appendChild(U.el("div.tool-group", {}, [U.el("h4", { text: "Style (language-wide)" }),
      U.el("label.field", {}, ["Stroke width", sw]),
      U.el("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "12px" } }, [showGrid, "Show grid dots"])]));

    // Actions
    const actions = U.el("div.tool-group", {}, [
      U.el("div.tool-btns", {}, [
        U.el("button.btn.small", { text: "Clear strokes", onClick: () => { g.nodes = []; g.connections = []; g.shapes = []; commit(); } }),
        U.el("button.btn.small", { text: "Duplicate", onClick: () => duplicateGlyph(g) }),
        U.el("button.btn.small", { text: "Export SVG", onClick: () => exportGlyphSVG(g, p) }),
        U.el("button.btn.small.danger", { text: "Delete", onClick: () => deleteGlyph(g) }),
      ]),
    ]);
    panel.appendChild(actions);

    return panel;
  }

  function buildSimilarity(g, p) {
    const group = U.el("div.tool-group", {}, [U.el("h4", { text: "Similarity check" })]);
    const ranks = window.Similarity ? Similarity.rankAgainstOthers(g, p.glyphs) : [];
    const empty = !(g.connections && g.connections.length) && !(g.shapes && g.shapes.length);
    if (empty) { group.appendChild(U.el("div.hint", { text: "Draw the character to compare it to others." })); return group; }
    if (!ranks.length) { group.appendChild(U.el("div.hint", { text: "No other characters to compare with yet." })); return group; }

    const top = ranks[0];
    const band = Similarity.band(top.score);
    const pct = Math.round(top.score * 100);

    // meter bar
    const bar = U.el("div", { style: { height: "8px", borderRadius: "4px", background: "var(--bg-3)", overflow: "hidden", border: "1px solid var(--line)" } }, [
      U.el("div", { style: { height: "100%", width: pct + "%", background: band.color, transition: "width .2s" } }),
    ]);
    group.appendChild(U.el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "12px" } }, [
      U.el("span", { text: "Closest match", style: { color: "var(--text-dim)" } }),
      U.el("span", { text: pct + "% · " + band.label, style: { color: band.color, fontWeight: "600" } }),
    ]));
    group.appendChild(bar);
    if (band.level === "high") group.appendChild(U.el("div.hint", { text: "⚠ Very close to “" + top.glyph.name + "”. Consider making it more distinct to avoid confusion.", style: { color: "var(--danger)" } }));

    // top few matches with thumbnails
    const listWrap = U.el("div", { style: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" } });
    ranks.slice(0, 3).forEach((r) => {
      const b = Similarity.band(r.score);
      listWrap.appendChild(U.el("div", { style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }, title: "open", onClick: () => E.open(r.glyph.id) }, [
        U.el("span.li-thumb", { style: { width: "26px", height: "26px", display: "flex", alignItems: "center", justifyContent: "center" } }, [GlyphRender.render(r.glyph, { size: 24, width: 24, height: 24, padding: 3, style: p.style, strokeWidth: 3 })]),
        U.el("span", { text: r.glyph.name, style: { flex: "1", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }),
        U.el("span", { text: Math.round(r.score * 100) + "%", style: { fontSize: "12px", color: b.color } }),
      ]));
    });
    group.appendChild(listWrap);
    return group;
  }

  function modeHint() {
    return {
      node: "Click a grid point to add a node; drag to move it.",
      connect: "Drag from one node to another to connect — or click two nodes in turn.",
      shape: "Drag corner-to-corner to fit a shape inside the grid.",
      erase: "Click a node, line, or shape to remove it.",
    }[E.mode];
  }

  function field(label, input) { return U.el("label.field", {}, [label, input]); }

  function clampNodes(g) {
    g.nodes.forEach((n) => { n.c = U.clamp(n.c, 0, g.grid.cols); n.r = U.clamp(n.r, 0, g.grid.rows); });
    g.shapes.forEach((s) => { s.c = U.clamp(s.c, 0, g.grid.cols); s.r = U.clamp(s.r, 0, g.grid.rows); });
  }

  function duplicateGlyph(g) {
    const p = project();
    const copy = U.clone(g);
    copy.id = U.uid("gly"); copy.name = g.name + " copy";
    copy.nodes.forEach((n) => { const old = n.id; n.id = U.uid("n"); copy.connections.forEach((c) => { if (c.from === old) c.from = n.id; if (c.to === old) c.to = n.id; }); });
    copy.connections.forEach((c) => (c.id = U.uid("c")));
    copy.shapes.forEach((s) => (s.id = U.uid("s")));
    p.glyphs.push(copy); Store.touch(); E.open(copy.id);
  }

  function deleteGlyph(g) {
    U.confirm("Delete character", `Delete “${g.name}”? Words using it will lose the glyph.`, () => {
      const p = project();
      p.glyphs = p.glyphs.filter((x) => x.id !== g.id);
      p.lexicon.forEach((e) => (e.glyphSeq = e.glyphSeq.filter((id) => id !== g.id)));
      E.glyphId = p.glyphs[0] ? p.glyphs[0].id : null;
      Store.touch(); E.renderList(); E.renderWorkspace();
    }, "Delete");
  }

  function exportGlyphSVG(g, p) {
    const str = GlyphRender.toSVGString(g, p.style);
    U.download((g.name || "glyph") + ".svg", str, "image/svg+xml");
    U.toast("Exported " + g.name + ".svg");
  }

  E.refresh = function () {
    const p = project();
    if (p && (!E.glyphId || !p.glyphs.find((g) => g.id === E.glyphId))) E.glyphId = p.glyphs[0] ? p.glyphs[0].id : null;
    E.renderList();
    E.renderWorkspace();
  };

  window.GlyphEditor = E;
})();
