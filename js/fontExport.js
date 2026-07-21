/* fontExport.js — turn your glyphs into an installable font.
   Stroke-based glyphs are expanded into filled outlines, then packed into a
   real TrueType font with the vendored opentype.js. Also offers an SVG font. */
(function () {
  const F = {};
  const EM = 1000, GB = 700; // units per em, glyph box height

  function project() { return Store.getActive(); }

  /* ---- geometry helpers (font units, y-up) ---- */
  function disc(cx, cy, rad, sides) {
    sides = sides || 10;
    const pts = [];
    for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad }); }
    return pts;
  }
  function segRect(a, b, w) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (w / 2), ny = (dx / len) * (w / 2);
    return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
  }
  function signedArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p.x * q.y - q.x * p.y; }
    return s / 2;
  }
  function forceCW(pts) { return signedArea(pts) > 0 ? pts.slice().reverse() : pts; } // clockwise in y-up

  // Expand a polyline into filled contours (rects per segment + round joins/caps).
  function strokePoly(points, w, closed) {
    const contours = [];
    const n = points.length;
    for (let i = 0; i < n - 1; i++) contours.push(segRect(points[i], points[i + 1], w));
    if (closed && n > 2) contours.push(segRect(points[n - 1], points[0], w));
    points.forEach((p) => contours.push(disc(p.x, p.y, w / 2, 8)));
    return contours;
  }

  // Build all filled contours for a glyph in font units.
  F.glyphContours = function (glyph, strokeWidth) {
    const cols = Math.max(1, glyph.grid.cols), rows = Math.max(1, glyph.grid.rows);
    const cell = GB / Math.max(cols, rows);
    const boxW = cell * cols, boxH = cell * rows;
    const w = Math.max(12, strokeWidth * (GB / 220));
    const LB = w; // left side bearing
    const pt = (c, r) => ({ x: LB + c * cell, y: (boxH - r * cell) }); // y-up, glyph bottom at 0

    const raw = [];
    const nodeById = {};
    (glyph.nodes || []).forEach((n) => (nodeById[n.id] = n));

    (glyph.connections || []).forEach((conn) => {
      const a = nodeById[conn.from], b = nodeById[conn.to];
      if (!a || !b) return;
      const p1 = pt(a.c, a.r), p2 = pt(b.c, b.r);
      if (conn.type === "curved") {
        const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1;
        const amt = (conn.curve == null ? 0.4 : conn.curve) * len * 0.5;
        const ctrl = { x: cx + (-dy / len) * amt, y: cy + (dx / len) * amt };
        const pts = [];
        for (let t = 0; t <= 1.0001; t += 1 / 12) { const u = 1 - t; pts.push({ x: u * u * p1.x + 2 * u * t * ctrl.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * ctrl.y + t * t * p2.y }); }
        raw.push({ pts, closed: false });
      } else if (conn.type === "diagonal") {
        const sx = Math.sign(p2.x - p1.x), sy = Math.sign(p2.y - p1.y);
        const m = Math.min(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
        raw.push({ pts: [p1, { x: p1.x + sx * m, y: p1.y + sy * m }, p2], closed: false });
      } else if (conn.type === "ortho") {
        raw.push({ pts: [p1, { x: p2.x, y: p1.y }, p2], closed: false });
      } else {
        raw.push({ pts: [p1, p2], closed: false });
      }
    });

    (glyph.shapes || []).forEach((s) => {
      const center = pt(s.c, s.r);
      const rad = Math.max(6, (s.size || 1) * cell * 0.6);
      const rot = (s.rot || 0) * Math.PI / 180;
      const rotate = (p) => ({ x: center.x + (p.x - center.x) * Math.cos(rot) - (p.y - center.y) * Math.sin(rot), y: center.y + (p.x - center.x) * Math.sin(rot) + (p.y - center.y) * Math.cos(rot) });
      if (s.type === "dot") { raw.push({ pts: disc(center.x, center.y, Math.max(8, rad * 0.35), 14), filled: true }); return; }
      let pts;
      if (s.type === "square") pts = [{ x: center.x - rad, y: center.y - rad }, { x: center.x + rad, y: center.y - rad }, { x: center.x + rad, y: center.y + rad }, { x: center.x - rad, y: center.y + rad }];
      else if (s.type === "triangle") pts = [{ x: center.x, y: center.y + rad * 1.2 }, { x: center.x - rad, y: center.y - rad * 0.7 }, { x: center.x + rad, y: center.y - rad * 0.7 }];
      else if (s.type === "diamond") pts = [{ x: center.x, y: center.y + rad }, { x: center.x + rad, y: center.y }, { x: center.x, y: center.y - rad }, { x: center.x - rad, y: center.y }];
      else if (s.type === "arc") { pts = []; for (let i = 0; i <= 12; i++) { const a = Math.PI * (i / 12); pts.push({ x: center.x - Math.cos(a) * rad, y: center.y + Math.sin(a) * rad }); } raw.push({ pts: pts.map(rotate), closed: false }); return; }
      else { pts = disc(center.x, center.y, rad, 24); } // circle / ring
      const closed = s.type !== "arc";
      raw.push({ pts: pts.map(rotate), closed: closed });
    });

    const contours = [];
    raw.forEach((r) => {
      if (r.filled) contours.push(forceCW(r.pts));
      else strokePoly(r.pts, w, r.closed).forEach((c) => contours.push(forceCW(c)));
    });
    return { contours, advance: boxW + w * 2 };
  };

  function contoursToPath(contours) {
    const path = new window.opentype.Path();
    contours.forEach((c) => {
      if (!c.length) return;
      path.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < c.length; i++) path.lineTo(c[i].x, c[i].y);
      path.close();
    });
    return path;
  }

  // Assign a unicode codepoint to each glyph (romanization char if single, else PUA).
  function assignCodepoints(glyphs) {
    const used = new Set([0x20]);
    let pua = 0xE000;
    return glyphs.map((g) => {
      const rom = (g.romanization || "").trim();
      let cp;
      if ([...rom].length === 1 && rom.codePointAt(0) > 0x20 && !used.has(rom.codePointAt(0))) cp = rom.codePointAt(0);
      else { while (used.has(pua)) pua++; cp = pua++; }
      used.add(cp);
      return { glyph: g, cp };
    });
  }

  F.buildFont = function (p) {
    if (!window.opentype) throw new Error("Font library not loaded.");
    const mapping = assignCodepoints(p.glyphs.filter((g) => (g.nodes && g.nodes.length) || (g.shapes && g.shapes.length)));
    const notdef = new window.opentype.Glyph({ name: ".notdef", unicode: 0, advanceWidth: 400, path: new window.opentype.Path() });
    const spacePath = new window.opentype.Path();
    const space = new window.opentype.Glyph({ name: "space", unicode: 0x20, advanceWidth: 300, path: spacePath });
    const glyphs = [notdef, space];
    mapping.forEach(({ glyph, cp }) => {
      const { contours, advance } = F.glyphContours(glyph, p.style.strokeWidth);
      glyphs.push(new window.opentype.Glyph({ name: (glyph.romanization || glyph.name || "g").replace(/\s+/g, "_"), unicode: cp, advanceWidth: Math.round(advance), path: contoursToPath(contours) }));
    });
    const font = new window.opentype.Font({ familyName: (p.name || "Conlang").replace(/[^\w]/g, "") || "Conlang", styleName: "Regular", unitsPerEm: EM, ascender: 800, descender: -200, glyphs });
    return { font, mapping };
  };

  function downloadBinary(name, arrayBuffer, mime) {
    const blob = new Blob([arrayBuffer], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = U.el("a", { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // SVG font (simple, converter-friendly alternative).
  F.buildSVGFont = function (p) {
    const mapping = assignCodepoints(p.glyphs.filter((g) => (g.nodes && g.nodes.length) || (g.shapes && g.shapes.length)));
    let glyphsXml = "";
    mapping.forEach(({ glyph, cp }) => {
      const { contours, advance } = F.glyphContours(glyph, p.style.strokeWidth);
      let d = "";
      contours.forEach((c) => { if (!c.length) return; d += "M" + c.map((pt) => Math.round(pt.x) + " " + Math.round(pt.y)).join(" L") + "Z"; });
      glyphsXml += `<glyph unicode="&#${cp};" glyph-name="${U.escape(glyph.name)}" horiz-adv-x="${Math.round(advance)}" d="${d}"/>\n`;
    });
    const fam = (p.name || "Conlang").replace(/[^\w]/g, "") || "Conlang";
    return `<?xml version="1.0" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg"><defs><font id="${fam}" horiz-adv-x="600"><font-face font-family="${fam}" units-per-em="${EM}" ascent="800" descent="-200"/><missing-glyph horiz-adv-x="400"/>\n${glyphsXml}</font></defs></svg>`;
  };

  /* ---- Export dialog ---- */
  F.openDialog = function () {
    const p = project();
    if (!p) return;
    const drawable = p.glyphs.filter((g) => (g.nodes && g.nodes.length) || (g.shapes && g.shapes.length));
    if (!drawable.length) { U.toast("Draw some characters first.", true); return; }

    let built;
    try { built = F.buildFont(p); } catch (e) { console.error(e); U.toast("Font build failed: " + e.message, true); return; }

    // mapping table
    const table = U.el("table.lex");
    table.appendChild(U.el("thead", {}, [U.el("tr", {}, [U.el("th", { text: "Glyph" }), U.el("th", { text: "Name" }), U.el("th", { text: "Types as" }), U.el("th", { text: "Codepoint" })])]));
    const tb = U.el("tbody");
    built.mapping.forEach(({ glyph, cp }) => {
      const isPua = cp >= 0xE000 && cp <= 0xF8FF;
      tb.appendChild(U.el("tr", {}, [
        U.el("td", {}, [GlyphRender.render(glyph, { size: 30, style: p.style, strokeWidth: 3 })]),
        U.el("td", { text: glyph.name }),
        U.el("td", {}, [isPua ? U.el("span.hint", { text: "(private-use)" }) : U.el("span.kbd", { text: String.fromCodePoint(cp) })]),
        U.el("td", {}, [U.el("span.kbd", { text: "U+" + cp.toString(16).toUpperCase().padStart(4, "0") })]),
      ]));
    });
    table.appendChild(tb);

    // live preview via FontFace
    const previewText = U.el("input", { value: drawable.map((g) => g.romanization).filter((r) => [...(r || "")].length === 1).join("") || "abc", placeholder: "type to preview" });
    const previewBox = U.el("div", { style: { fontSize: "44px", padding: "10px", background: "var(--bg-3)", border: "1px solid var(--line)", borderRadius: "6px", minHeight: "60px", wordBreak: "break-word" } });
    let famName = "cf_" + Math.random().toString(36).slice(2, 8);
    try {
      const ab = built.font.toArrayBuffer();
      const face = new FontFace(famName, ab);
      face.load().then((f) => { document.fonts.add(f); previewBox.style.fontFamily = famName; U.append(U.clear(previewBox), previewText.value); }).catch(() => { previewBox.textContent = "(preview unavailable)"; });
    } catch (e) { previewBox.textContent = "(preview unavailable)"; }
    const updatePreview = () => { U.clear(previewBox); previewBox.textContent = previewText.value; };
    previewText.addEventListener("input", updatePreview);

    U.modal({
      title: "Export font",
      body: [
        U.el("p.muted", { text: "Your characters become a real font. Glyphs whose romanization is a single letter map to that key; others use the private-use area (copy/paste from the table)." }),
        U.el("label.field", {}, ["Preview", previewText]),
        previewBox,
        U.el("div.inline-actions", { style: { margin: "12px 0" } }, [
          U.el("button.btn.primary", { text: "Download .ttf", onClick: () => { try { downloadBinary((p.name || "conlang") + ".ttf", built.font.toArrayBuffer(), "font/ttf"); U.toast("Exported .ttf"); } catch (e) { U.toast("TTF export failed.", true); } } }),
          U.el("button.btn", { text: "Download .svg font", onClick: () => { U.download((p.name || "conlang") + "-font.svg", F.buildSVGFont(p), "image/svg+xml"); U.toast("Exported SVG font"); } }),
        ]),
        U.el("div", { style: { maxHeight: "220px", overflow: "auto" } }, [table]),
      ],
      hideActions: true,
    });
  };

  window.FontExport = F;
})();
