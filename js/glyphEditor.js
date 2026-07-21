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
    const size = 460;
    const svg = GlyphRender.render(g, { size, style: p.style, showGrid: p.style.showGrid !== false, showNodes: true, background: p.style.bg });
    const proj = svg._proj, box = svg._box;
    const cols = g.grid.cols, rows = g.grid.rows;

    // Larger transparent hit targets over grid points for easy clicking.
    for (let c = 0; c <= cols; c++) {
      for (let r = 0; r <= rows; r++) {
        const pt = proj.pt(c, r);
        const hit = U.svg("circle", {
          cx: pt.x, cy: pt.y, r: Math.max(7, Math.min(proj.cw, proj.ch) * 0.42),
          fill: "transparent", "data-c": c, "data-r": r, style: "cursor:pointer",
        });
        svg.appendChild(hit);
      }
    }
    // highlight selected node
    if (E.selectedNode) {
      const n = g.nodes.find((x) => x.id === E.selectedNode);
      if (n) { const pt = proj.pt(n.c, n.r); svg.querySelectorAll("[data-node='" + n.id + "']").forEach((e) => e.classList.add("sel")); }
    }
    if (E.pendingConnect) {
      svg.querySelectorAll("[data-node='" + E.pendingConnect + "']").forEach((e) => e.classList.add("sel"));
    }

    // Interaction
    const toModel = (evt) => {
      const ptScreen = svg.createSVGPoint();
      ptScreen.x = evt.clientX; ptScreen.y = evt.clientY;
      const ctm = svg.getScreenCTM();
      const loc = ptScreen.matrixTransform(ctm.inverse());
      const c = U.clamp(Math.round((loc.x - box.x) / proj.cw), 0, cols);
      const r = U.clamp(Math.round((loc.y - box.y) / proj.ch), 0, rows);
      return { c, r };
    };

    svg.addEventListener("pointerdown", (evt) => {
      const t = evt.target;
      const nodeId = t.getAttribute("data-node");
      const connId = t.getAttribute("data-conn");
      if (connId && E.mode === "erase") { removeConnection(g, connId); commit(); return; }
      if (connId && (E.mode === "node" || E.mode === "connect")) { cycleConnType(g, connId); commit(); return; }

      if (nodeId) {
        if (E.mode === "erase") { removeNode(g, nodeId); commit(); return; }
        if (E.mode === "connect") { handleConnectClick(g, nodeId); commit(); return; }
        // select + start drag
        E.selectedNode = nodeId;
        E.dragNode = nodeId; E.dragged = false;
        svg.setPointerCapture(evt.pointerId);
        commit();
        return;
      }

      // clicked a grid hit (or blank)
      const hasGrid = t.hasAttribute("data-c");
      if (!hasGrid) return;
      const c = +t.getAttribute("data-c"), r = +t.getAttribute("data-r");
      if (E.mode === "node") {
        addNode(g, c, r); commit();
      } else if (E.mode === "shape") {
        g.shapes.push({ id: U.uid("s"), type: E.shapeType, c, r, size: E.shapeSize, rot: 0 });
        commit();
      }
    });

    svg.addEventListener("pointermove", (evt) => {
      if (!E.dragNode) return;
      const { c, r } = toModel(evt);
      const n = g.nodes.find((x) => x.id === E.dragNode);
      if (n && (n.c !== c || n.r !== r)) { n.c = c; n.r = r; E.dragged = true; commit(); }
    });

    svg.addEventListener("pointerup", (evt) => {
      if (E.dragNode) { try { svg.releasePointerCapture(evt.pointerId); } catch (e) {} }
      E.dragNode = null;
      if (E.dragged) { Store.touch(); E.dragged = false; }
    });

    return svg;
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
    const idGroup = U.el("div.tool-group", {}, [
      U.el("h4", { text: "Character" }),
      field("Name", U.el("input", { value: g.name, onInput: (e) => { g.name = e.target.value; Store.touch(); E.renderList(); } })),
      field("Romanization", U.el("input", { value: g.romanization, placeholder: "e.g. ka", onInput: (e) => { g.romanization = e.target.value; Store.touch(); E.renderList(); } })),
      field("Sound / IPA", U.el("input", { value: g.sound, placeholder: "optional", onInput: (e) => { g.sound = e.target.value; Store.touch(); } })),
    ]);
    panel.appendChild(idGroup);

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
    const sizeInput = U.el("input", { type: "range", min: "0.3", max: "4", step: "0.1", value: String(E.shapeSize), onInput: (e) => { E.shapeSize = +e.target.value; } });
    panel.appendChild(U.el("div.tool-group", {}, [U.el("h4", { text: "Basic shapes" }), shapeBtns,
      U.el("label.field", {}, ["Shape size", sizeInput])]));

    // Grid size
    const colsIn = U.el("input", { type: "number", min: "1", max: "24", value: g.grid.cols, onChange: (e) => { g.grid.cols = U.clamp(+e.target.value || 1, 1, 24); clampNodes(g); commit(); } });
    const rowsIn = U.el("input", { type: "number", min: "1", max: "24", value: g.grid.rows, onChange: (e) => { g.grid.rows = U.clamp(+e.target.value || 1, 1, 24); clampNodes(g); commit(); } });
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

  function modeHint() {
    return {
      node: "Click a grid point to add a node. Drag a node to move it.",
      connect: "Click two nodes to connect them with the chosen style.",
      shape: "Click a grid point to drop the selected shape.",
      erase: "Click a node or line to remove it.",
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
