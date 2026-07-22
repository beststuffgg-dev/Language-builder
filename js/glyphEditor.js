/* glyphEditor.js — interactive grid character designer.
   Place nodes on a grid, connect them (direct/curved/diagonal/ortho),
   drop basic shapes, tune grid size & stroke. */
(function () {
  const E = {
    glyphId: null,
    mode: "node", // node | connect | shape | select | erase
    connType: "direct",
    shapeType: "circle",
    shapeSize: 1,
    selectedNode: null,
    pendingConnect: null,
    dragNode: null,
    dragged: false,
    sel: { nodes: [], conns: [], shapes: [] }, // multi-selection (select mode)
  };

  /* ---------- Selection helpers ---------- */
  function selCount() { return E.sel.nodes.length + E.sel.conns.length + E.sel.shapes.length; }
  function clearSel() { E.sel = { nodes: [], conns: [], shapes: [] }; }
  function inSel(kind, id) { return E.sel[kind].indexOf(id) !== -1; }
  function toggleSel(kind, id) {
    const i = E.sel[kind].indexOf(id);
    if (i === -1) E.sel[kind].push(id); else E.sel[kind].splice(i, 1);
  }
  // Nodes that move/rotate: explicitly selected nodes + endpoints of selected connections.
  function effectiveNodes(g) {
    const ids = new Set(E.sel.nodes);
    E.sel.conns.forEach((cid) => {
      const c = g.connections.find((x) => x.id === cid);
      if (c) { ids.add(c.from); ids.add(c.to); }
    });
    return g.nodes.filter((n) => ids.has(n.id));
  }
  function selShapes(g) { return g.shapes.filter((s) => inSel("shapes", s.id)); }

  /* ---------- Inline pictograms (24×24, currentColor) ---------- */
  // Each entry is a list of {tag, ...attrs}; geometry only — stroke/fill inherited.
  const ICONS = {
    // tools
    "mode-node": [{ tag: "circle", cx: 12, cy: 12, r: 7 }, { tag: "circle", cx: 12, cy: 12, r: 3, fill: "currentColor" }],
    "mode-connect": [{ tag: "circle", cx: 6, cy: 18, r: 2.6, fill: "currentColor", stroke: "none" }, { tag: "circle", cx: 18, cy: 6, r: 2.6, fill: "currentColor", stroke: "none" }, { d: "M7.7 16.3 L16.3 7.7" }],
    "mode-shape": [{ tag: "rect", x: 4.5, y: 4.5, width: 15, height: 15, rx: 2 }],
    "mode-select": [{ tag: "rect", x: 3.5, y: 3.5, width: 17, height: 17, rx: 2, "stroke-dasharray": "3.5 3" }],
    "mode-erase": [{ d: "M15.5 3.5 L20.5 8.5 L10.5 18.5 H5.5 L3.5 16.5 Z" }, { d: "M3.5 20.5 H20.5" }],
    // connection styles (the 2×2 "split square")
    "conn-direct": [{ d: "M4.5 19.5 L19.5 4.5" }, dot(4.5, 19.5), dot(19.5, 4.5)],
    "conn-curved": [{ d: "M4.5 19.5 Q4.5 4.5 19.5 4.5" }, dot(4.5, 19.5), dot(19.5, 4.5)],
    "conn-diagonal": [{ d: "M4.5 19.5 L12 12 L19.5 12" }, dot(4.5, 19.5), dot(19.5, 12)],
    "conn-ortho": [{ d: "M5 19 L19 19 L19 5" }, dot(5, 19), dot(19, 5)],
    // shapes
    "sh-circle": [{ tag: "circle", cx: 12, cy: 12, r: 8 }],
    "sh-ring": [{ tag: "circle", cx: 12, cy: 12, r: 8 }, { tag: "circle", cx: 12, cy: 12, r: 3 }],
    "sh-square": [{ tag: "rect", x: 4, y: 4, width: 16, height: 16, rx: 1.5 }],
    "sh-triangle": [{ tag: "polygon", points: "12,4 20,20 4,20" }],
    "sh-diamond": [{ tag: "polygon", points: "12,3 21,12 12,21 3,12" }],
    "sh-arc": [{ d: "M4 16 A8 8 0 0 1 20 16" }],
    "sh-dot": [{ tag: "circle", cx: 12, cy: 12, r: 5, fill: "currentColor" }],
    // selection actions
    "rot-ccw": [{ tag: "polyline", points: "3 5 3 11 9 11" }, { d: "M5.5 10 A8 8 0 1 1 5 15" }],
    "rot-cw": [{ tag: "polyline", points: "21 5 21 11 15 11" }, { d: "M18.5 10 A8 8 0 1 0 19 15" }],
    "flip-h": [{ d: "M12 3.5 V20.5", "stroke-dasharray": "3 2.5" }, { tag: "polygon", points: "9,7 4,12 9,17", fill: "currentColor", stroke: "none" }, { tag: "polygon", points: "15,7 20,12 15,17", fill: "currentColor", stroke: "none" }],
    "flip-v": [{ d: "M3.5 12 H20.5", "stroke-dasharray": "3 2.5" }, { tag: "polygon", points: "7,9 12,4 17,9", fill: "currentColor", stroke: "none" }, { tag: "polygon", points: "7,15 12,20 17,15", fill: "currentColor", stroke: "none" }],
    "trash": [{ d: "M4 6.5 H20" }, { d: "M9 6.5 V4.5 H15 V6.5" }, { d: "M6 6.5 L7 20.5 H17 L18 6.5" }, { d: "M10 10 V17" }, { d: "M14 10 V17" }],
  };
  function dot(x, y) { return { tag: "circle", cx: x, cy: y, r: 2.1, fill: "currentColor", stroke: "none" }; }
  function icon(name, size) {
    const svg = U.svg("svg", { class: "ico", width: size || 22, height: size || 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" });
    (ICONS[name] || []).forEach((spec) => {
      const a = Object.assign({}, spec); const tag = a.tag || "path"; delete a.tag;
      svg.appendChild(U.svg(tag, a));
    });
    return svg;
  }
  // A labelled icon button.
  function iconBtn(iconName, label, active, onClick, opts) {
    opts = opts || {};
    return U.el("button.iconbtn" + (active ? ".active" : "") + (opts.cls ? "." + opts.cls : ""), { title: opts.title || label, onClick }, [
      icon(iconName, opts.size), label ? U.el("span.lbl", { text: label }) : null,
    ]);
  }

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
    clearSel();
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
    // optionally make every new character a dictionary word too
    if (window.Lexicon) Lexicon.autoWordForGlyph(g);
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
    // multi-selection highlight (nodes / connections / shapes)
    E.sel.nodes.forEach((id) => svg.querySelectorAll("[data-node='" + id + "']").forEach((e) => e.classList.add("sel")));
    E.sel.conns.forEach((id) => svg.querySelectorAll("[data-conn='" + id + "']").forEach((e) => e.classList.add("sel")));
    E.sel.shapes.forEach((id) => svg.querySelectorAll("[data-shape='" + id + "']").forEach((e) => e.classList.add("sel")));

    // keep references so drag handlers survive re-renders
    E._svg = svg; E._proj = proj; E._box = box; E._cols = cols; E._rows = rows; E._g = g;

    bindKeys();
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

  // Raw (unsnapped, unclamped) grid coordinate — used for marquee bounds & group drag.
  function toModelRaw(evt) {
    const svg = E._svg;
    const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { c: (loc.x - E._box.x) / E._proj.cw, r: (loc.y - E._box.y) / E._proj.ch };
  }

  function onDown(evt, g) {
    if (E.mode === "select") { onSelectDown(evt, g); return; }
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

  /* ---------- Select mode: marquee, move, rotate, delete ---------- */
  function onSelectDown(evt, g) {
    const t = evt.target;
    const add = evt.shiftKey; // shift = add / toggle
    const connId = t.getAttribute("data-conn");
    const shapeId = t.getAttribute("data-shape");
    let hitNode = null;
    if (t.hasAttribute("data-c")) {
      const c = +t.getAttribute("data-c"), r = +t.getAttribute("data-r");
      hitNode = g.nodes.find((n) => n.c === c && n.r === r) || null;
    }
    const nodeId = t.getAttribute("data-node") || (hitNode && hitNode.id);

    if (nodeId) {
      if (add) { toggleSel("nodes", nodeId); commit(); return; }
      if (!inSel("nodes", nodeId)) { clearSel(); E.sel.nodes.push(nodeId); }
      startSelectionDrag(g, evt); return;
    }
    if (connId) {
      if (add) { toggleSel("conns", connId); commit(); return; }
      if (!inSel("conns", connId)) { clearSel(); E.sel.conns.push(connId); }
      startSelectionDrag(g, evt); return;
    }
    if (shapeId) {
      if (add) { toggleSel("shapes", shapeId); commit(); return; }
      if (!inSel("shapes", shapeId)) { clearSel(); E.sel.shapes.push(shapeId); }
      startSelectionDrag(g, evt); return;
    }
    // empty space → rubber-band marquee
    startMarquee(g, evt, add);
  }

  function startMarquee(g, evt, add) {
    const start = toModelRaw(evt);
    if (!add) clearSel();
    const rect = U.svg("rect", { class: "marquee", x: 0, y: 0, width: 0, height: 0 });
    E._svg.appendChild(rect);
    const move = (ev) => {
      const m = toModelRaw(ev);
      const c0 = Math.min(start.c, m.c), r0 = Math.min(start.r, m.r);
      const c1 = Math.max(start.c, m.c), r1 = Math.max(start.r, m.r);
      const a = E._proj.pt(c0, r0), b = E._proj.pt(c1, r1);
      rect.setAttribute("x", a.x); rect.setAttribute("y", a.y);
      rect.setAttribute("width", b.x - a.x); rect.setAttribute("height", b.y - a.y);
    };
    const up = (ev) => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      const m = toModelRaw(ev);
      const c0 = Math.min(start.c, m.c), r0 = Math.min(start.r, m.r);
      const c1 = Math.max(start.c, m.c), r1 = Math.max(start.r, m.r);
      const tiny = Math.abs(c1 - c0) < 0.15 && Math.abs(r1 - r0) < 0.15;
      if (!tiny) {
        g.nodes.forEach((n) => { if (n.c >= c0 && n.c <= c1 && n.r >= r0 && n.r <= r1 && !inSel("nodes", n.id)) E.sel.nodes.push(n.id); });
        g.connections.forEach((cc) => {
          const a = g.nodes.find((n) => n.id === cc.from), b = g.nodes.find((n) => n.id === cc.to);
          if (a && b) { const mc = (a.c + b.c) / 2, mr = (a.r + b.r) / 2; if (mc >= c0 && mc <= c1 && mr >= r0 && mr <= r1 && !inSel("conns", cc.id)) E.sel.conns.push(cc.id); }
        });
        g.shapes.forEach((s) => { const mc = s.c + (s.w || 1) / 2, mr = s.r + (s.h || 1) / 2; if (mc >= c0 && mc <= c1 && mr >= r0 && mr <= r1 && !inSel("shapes", s.id)) E.sel.shapes.push(s.id); });
      }
      commit();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // Drag the whole current selection (grid-snapped, relative to the drag start).
  function startSelectionDrag(g, evt) {
    commit(); // reflect selection immediately
    const start = toModelRaw(evt);
    const nodes = effectiveNodes(g).map((n) => ({ n, c: n.c, r: n.r }));
    const shapes = selShapes(g).map((s) => ({ s, c: s.c, r: s.r }));
    let moved = false;
    const move = (ev) => {
      const m = toModelRaw(ev);
      const dc = Math.round(m.c - start.c), dr = Math.round(m.r - start.r);
      if (dc === 0 && dr === 0 && !moved) return;
      moved = true;
      nodes.forEach((o) => { o.n.c = U.clamp(o.c + dc, 0, E._cols); o.n.r = U.clamp(o.r + dr, 0, E._rows); });
      shapes.forEach((o) => { o.s.c = U.clamp(o.c + dc, 0, E._cols); o.s.r = U.clamp(o.r + dr, 0, E._rows); });
      redrawCanvas();
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      if (moved) commit();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  function selCentroid(g) {
    const ns = effectiveNodes(g), ss = selShapes(g);
    let sx = 0, sy = 0, n = 0;
    ns.forEach((nd) => { sx += nd.c; sy += nd.r; n++; });
    ss.forEach((s) => { sx += s.c + (s.w || 1) / 2; sy += s.r + (s.h || 1) / 2; n++; });
    return n ? { c: sx / n, r: sy / n } : { c: E._cols / 2, r: E._rows / 2 };
  }
  const round3 = (v) => Math.round(v * 1000) / 1000;

  // Model-only rotation about the selection centroid (no render).
  function applyRotation(g, deg) {
    if (!selCount()) return;
    const ctr = selCentroid(g), rad = (deg * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const rot = (c, r) => ({ c: round3(ctr.c + (c - ctr.c) * cos - (r - ctr.r) * sin), r: round3(ctr.r + (c - ctr.c) * sin + (r - ctr.r) * cos) });
    effectiveNodes(g).forEach((n) => { const p = rot(n.c, n.r); n.c = U.clamp(p.c, 0, E._cols); n.r = U.clamp(p.r, 0, E._rows); });
    selShapes(g).forEach((s) => {
      const cx = s.c + (s.w || 1) / 2, cy = s.r + (s.h || 1) / 2, p = rot(cx, cy);
      s.c = U.clamp(round3(p.c - (s.w || 1) / 2), 0, E._cols); s.r = U.clamp(round3(p.r - (s.h || 1) / 2), 0, E._rows);
      s.rot = Math.round((((s.rot || 0) + deg) % 360 + 360) % 360);
    });
  }
  function rotateSelection(g, deg) { applyRotation(g, deg); commit(); }

  function flipSelection(g, axis) { // axis: "h" mirrors left↔right, "v" mirrors top↔bottom
    if (!selCount()) return;
    const ctr = selCentroid(g);
    effectiveNodes(g).forEach((n) => {
      if (axis === "h") n.c = U.clamp(round3(2 * ctr.c - n.c), 0, E._cols);
      else n.r = U.clamp(round3(2 * ctr.r - n.r), 0, E._rows);
    });
    selShapes(g).forEach((s) => {
      const cx = s.c + (s.w || 1) / 2, cy = s.r + (s.h || 1) / 2;
      if (axis === "h") s.c = U.clamp(round3(2 * ctr.c - cx - (s.w || 1) / 2), 0, E._cols);
      else s.r = U.clamp(round3(2 * ctr.r - cy - (s.h || 1) / 2), 0, E._rows);
    });
    commit();
  }

  // Rebuild only the canvas SVG in place — keeps the tools panel (and any slider
  // being dragged) alive, so live sliders stay smooth.
  function redrawCanvas() {
    const g = currentGlyph(), p = project();
    const wrap = E._svg && E._svg.parentNode;
    if (!g || !wrap) { commit(); return; }
    U.clear(wrap);
    wrap.appendChild(buildEditorSVG(g, p));
    Store.touch();
  }

  function deleteSelection(g) {
    if (!selCount()) return;
    E.sel.shapes.forEach((id) => { g.shapes = g.shapes.filter((s) => s.id !== id); });
    E.sel.conns.forEach((id) => { g.connections = g.connections.filter((c) => c.id !== id); });
    E.sel.nodes.forEach((id) => removeNode(g, id));
    clearSel();
    commit();
  }

  let keysBound = false;
  function bindKeys() {
    if (keysBound) return;
    keysBound = true;
    document.addEventListener("keydown", (e) => {
      const g = currentGlyph();
      const view = document.querySelector('.view[data-view="glyphs"]');
      if (!g || !view || !view.classList.contains("active")) return;
      const tag = (e.target && e.target.tagName) || "";
      if (/input|textarea|select/i.test(tag) || e.target.isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selCount()) { e.preventDefault(); deleteSelection(g); }
      else if (e.key === "Escape" && selCount()) { clearSel(); commit(); }
      else if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey) && E.mode === "select") {
        e.preventDefault();
        E.sel.nodes = g.nodes.map((n) => n.id);
        E.sel.conns = g.connections.map((c) => c.id);
        E.sel.shapes = g.shapes.map((s) => s.id);
        commit();
      }
    });
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
    const syncWord = () => { if (window.Lexicon) Lexicon.syncWordFromGlyph(g); };
    const idGroup = U.el("div.tool-group", {}, [
      U.el("h4", { text: "Character" }),
      field("Name", U.el("input", { value: g.name, onInput: (e) => { g.name = e.target.value; syncWord(); Store.touch(); E.renderList(); } })),
      field(logographic ? "Meaning (word)" : "Meaning", U.el("input", { value: g.meaning, placeholder: logographic ? "e.g. sun" : "optional — for logograms", onInput: (e) => { g.meaning = e.target.value; syncWord(); Store.touch(); E.renderList(); } })),
      field("Romanization", U.el("input", { value: g.romanization, placeholder: "optional — a character can be a word on its own", onInput: (e) => { g.romanization = e.target.value; syncWord(); Store.touch(); E.renderList(); } })),
      field("Sound / IPA", U.el("input", { value: g.sound, placeholder: "optional", onInput: (e) => { g.sound = e.target.value; Store.touch(); } })),
    ]);
    panel.appendChild(idGroup);

    // Words: turn this character into a dictionary word, and auto-word new ones.
    const isWord = window.Lexicon && p.lexicon.some((w) => w.fromGlyph === g.id);
    const autoWordChk = U.el("input", { type: "checkbox", checked: !!p.autoWordForNewGlyph, onChange: (e) => { p.autoWordForNewGlyph = e.target.checked; Store.touch(); } });
    const wordGroup = U.el("div.tool-group", {}, [
      U.el("h4", { text: "Words" }),
      isWord
        ? U.el("div.hint", { text: "✓ This character is a word in your dictionary (kept in sync)." })
        : U.el("button.btn.small", { text: "＋ Make this character a word", onClick: () => { const w = Lexicon.wordFromGlyph(g); if (w) { U.toast("Added “" + w.headword + "” to the dictionary"); E.renderWorkspace(); } } }),
      U.el("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "12px" } }, [autoWordChk, "New characters auto-become words"]),
    ]);
    panel.appendChild(wordGroup);

    // Similarity meter — warns about confusable characters
    panel.appendChild(buildSimilarity(g, p));

    // Mode buttons
    const modes = [["node", "Nodes", "mode-node"], ["connect", "Connect", "mode-connect"], ["shape", "Shapes", "mode-shape"], ["select", "Select", "mode-select"], ["erase", "Erase", "mode-erase"]];
    const modeBtns = U.el("div.iconbtn-row");
    modes.forEach(([m, label, ic]) => {
      modeBtns.appendChild(iconBtn(ic, label, E.mode === m, () => { E.mode = m; E.pendingConnect = null; if (m !== "select") clearSel(); E.renderWorkspace(); }));
    });
    panel.appendChild(U.el("div.tool-group", {}, [U.el("h4", { text: "Tool" }), modeBtns,
      U.el("div.hint", { text: modeHint() })]));

    // Selection inspector (move / rotate / delete + per-item customization)
    if (E.mode === "select") panel.appendChild(buildSelectionInspector(g, p));

    // Connection type — one square split into four labelled quadrants.
    const quad = U.el("div.quad");
    [["direct", "conn-direct"], ["curved", "conn-curved"], ["diagonal", "conn-diagonal"], ["ortho", "conn-ortho"]].forEach(([t, ic]) => {
      quad.appendChild(U.el("button.quad-cell" + (E.connType === t ? ".active" : ""), { title: connLabel(t), onClick: () => { E.connType = t; E.renderWorkspace(); } }, [
        icon(ic, 30), U.el("span.lbl", { text: connLabel(t) }),
      ]));
    });
    panel.appendChild(U.el("div.tool-group", {}, [U.el("h4", { text: "Connection style" }), quad,
      U.el("div.hint", { text: "Click a line to cycle its style, or select one to fine-tune its curve." })]));

    // Shapes
    const shapeBtns = U.el("div.iconbtn-grid");
    [["circle", "sh-circle"], ["ring", "sh-ring"], ["square", "sh-square"], ["triangle", "sh-triangle"], ["diamond", "sh-diamond"], ["arc", "sh-arc"], ["dot", "sh-dot"]].forEach(([s, ic]) => {
      shapeBtns.appendChild(iconBtn(ic, s, E.mode === "shape" && E.shapeType === s, () => { E.shapeType = s; E.mode = "shape"; E.renderWorkspace(); }));
    });
    panel.appendChild(U.el("div.tool-group", {}, [U.el("h4", { text: "Basic shapes" }), shapeBtns,
      U.el("div.hint", { text: "Drag corner-to-corner to fit a shape; switch to Select to resize or spin it later." })]));

    // Grid size (supports high-res grids up to 32×32)
    const colsIn = U.el("input", { type: "number", min: "1", max: "32", value: g.grid.cols, onChange: (e) => { g.grid.cols = U.clamp(+e.target.value || 1, 1, 32); clampNodes(g); commit(); } });
    const rowsIn = U.el("input", { type: "number", min: "1", max: "32", value: g.grid.rows, onChange: (e) => { g.grid.rows = U.clamp(+e.target.value || 1, 1, 32); clampNodes(g); commit(); } });
    panel.appendChild(U.el("div.tool-group", {}, [U.el("h4", { text: "Grid size" }),
      U.el("div.mini-grid2", {}, [U.el("label.field", {}, ["Columns", colsIn]), U.el("label.field", {}, ["Rows", rowsIn])])]));

    // Style
    const sw = U.el("input", { type: "range", min: "1", max: "18", step: "0.5", value: g._sw || p.style.strokeWidth, onInput: (e) => { p.style.strokeWidth = +e.target.value; redrawCanvas(); }, onChange: () => commit() });
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

  /* ---------- Selection inspector ---------- */
  function buildSelectionInspector(g, p) {
    const group = U.el("div.tool-group", {}, [U.el("h4", { text: "Selection" })]);
    const n = selCount();
    if (!n) {
      group.appendChild(U.el("div.hint", { text: "Drag a box over the grid to select, or click items (Shift-click to add). Then move, rotate or delete them." }));
      return group;
    }

    const parts = [];
    if (E.sel.nodes.length) parts.push(E.sel.nodes.length + " node" + (E.sel.nodes.length > 1 ? "s" : ""));
    if (E.sel.conns.length) parts.push(E.sel.conns.length + " line" + (E.sel.conns.length > 1 ? "s" : ""));
    if (E.sel.shapes.length) parts.push(E.sel.shapes.length + " shape" + (E.sel.shapes.length > 1 ? "s" : ""));
    group.appendChild(U.el("div.sel-count", { text: parts.join(" · ") + " selected" }));

    // transform actions
    const row = U.el("div.iconbtn-row");
    row.appendChild(iconBtn("rot-ccw", "-90°", false, () => rotateSelection(g, -90), { title: "Rotate left 90°" }));
    row.appendChild(iconBtn("rot-cw", "+90°", false, () => rotateSelection(g, 90), { title: "Rotate right 90°" }));
    row.appendChild(iconBtn("flip-h", "Flip H", false, () => flipSelection(g, "h"), { title: "Flip horizontally" }));
    row.appendChild(iconBtn("flip-v", "Flip V", false, () => flipSelection(g, "v"), { title: "Flip vertically" }));
    row.appendChild(iconBtn("trash", "Delete", false, () => deleteSelection(g), { title: "Delete selection (Del)", cls: "danger" }));
    group.appendChild(row);

    // fine rotation slider (applies incrementally around the centroid)
    let lastAngle = 0;
    const rotRange = U.el("input", { type: "range", min: "-180", max: "180", step: "1", value: "0",
      onInput: (e) => { const a = +e.target.value; const d = a - lastAngle; lastAngle = a; if (d) { applyRotation(g, d); redrawCanvas(); } },
      onChange: (e) => { lastAngle = 0; e.target.value = "0"; commit(); } });
    group.appendChild(U.el("label.field", {}, ["Fine rotate", rotRange]));

    // Per-item customization
    if (E.sel.conns.length === 1 && !E.sel.nodes.length && !E.sel.shapes.length) {
      group.appendChild(buildConnInspector(g, E.sel.conns[0]));
    } else if (E.sel.shapes.length === 1 && !E.sel.nodes.length && !E.sel.conns.length) {
      group.appendChild(buildShapeInspector(g, E.sel.shapes[0]));
    }

    group.appendChild(U.el("button.btn.small.ghost", { text: "Clear selection", onClick: () => { clearSel(); commit(); } }));
    return group;
  }

  // Customize a single connection (style + curve amount) after it's drawn.
  function buildConnInspector(g, connId) {
    const c = g.connections.find((x) => x.id === connId);
    if (!c) return U.el("div");
    const wrap = U.el("div.sub-inspector", {}, [U.el("h4", { text: "Line" })]);
    const quad = U.el("div.quad.mini");
    [["direct", "conn-direct"], ["curved", "conn-curved"], ["diagonal", "conn-diagonal"], ["ortho", "conn-ortho"]].forEach(([t, ic]) => {
      quad.appendChild(U.el("button.quad-cell" + (c.type === t ? ".active" : ""), { title: connLabel(t), onClick: () => { c.type = t; commit(); } }, [icon(ic, 26)]));
    });
    wrap.appendChild(quad);
    if (c.type === "curved") {
      const cur = U.el("input", { type: "range", min: "-1.5", max: "1.5", step: "0.05", value: c.curve == null ? 0.4 : c.curve,
        onInput: (e) => { c.curve = +e.target.value; redrawCanvas(); }, onChange: () => commit() });
      wrap.appendChild(U.el("label.field", {}, ["Curve amount", cur]));
      wrap.appendChild(U.el("div.hint", { text: "Negative bows the line the other way; 0 is straight." }));
    } else {
      wrap.appendChild(U.el("div.hint", { text: "Switch this line to “Curved” to bend it." }));
    }
    return wrap;
  }

  // Customize a single shape (type + size + rotation) after it's drawn.
  function buildShapeInspector(g, shapeId) {
    const s = g.shapes.find((x) => x.id === shapeId);
    if (!s) return U.el("div");
    const wrap = U.el("div.sub-inspector", {}, [U.el("h4", { text: "Shape" })]);
    const grid = U.el("div.iconbtn-grid");
    [["circle", "sh-circle"], ["ring", "sh-ring"], ["square", "sh-square"], ["triangle", "sh-triangle"], ["diamond", "sh-diamond"], ["arc", "sh-arc"], ["dot", "sh-dot"]].forEach(([t, ic]) => {
      grid.appendChild(iconBtn(ic, t, s.type === t, () => { s.type = t; commit(); }));
    });
    wrap.appendChild(grid);

    const wIn = U.el("input", { type: "number", min: "0.5", max: "32", step: "0.5", value: round3(s.w || 1), onChange: (e) => { s.w = U.clamp(+e.target.value || 1, 0.5, E._cols); commit(); } });
    const hIn = U.el("input", { type: "number", min: "0.5", max: "32", step: "0.5", value: round3(s.h || 1), onChange: (e) => { s.h = U.clamp(+e.target.value || 1, 0.5, E._rows); commit(); } });
    wrap.appendChild(U.el("div.mini-grid2", {}, [U.el("label.field", {}, ["Width", wIn]), U.el("label.field", {}, ["Height", hIn])]));

    const rotLabel = U.el("span", { text: "Rotation " + (s.rot || 0) + "°" });
    const rot = U.el("input", { type: "range", min: "0", max: "360", step: "1", value: s.rot || 0,
      onInput: (e) => { s.rot = +e.target.value; rotLabel.textContent = "Rotation " + s.rot + "°"; redrawCanvas(); }, onChange: () => commit() });
    wrap.appendChild(U.el("label.field", {}, [rotLabel, rot]));
    return wrap;
  }

  function modeHint() {
    return {
      node: "Click a grid point to add a node; drag to move it.",
      connect: "Drag from one node to another to connect — or click two nodes in turn.",
      shape: "Drag corner-to-corner to fit a shape inside the grid.",
      select: "Drag a box to select many; move, rotate, flip or delete them together.",
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
