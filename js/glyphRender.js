/* glyphRender.js — pure rendering of a glyph object to an SVG element.
   Shared by the editor, dictionary preview and compose view. */
(function () {
  const R = {};

  // Map a grid coord (c,r) to pixel position inside the drawing box.
  function project(g, box) {
    const cols = Math.max(1, g.grid.cols), rows = Math.max(1, g.grid.rows);
    const cw = box.w / cols, ch = box.h / rows;
    return {
      cw, ch,
      pt(c, r) { return { x: box.x + c * cw, y: box.y + r * ch }; },
    };
  }

  // Build the SVG path 'd' string for a connection between two points.
  R.connectionPath = function (p1, p2, type, curve) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    if (type === "curved") {
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const len = Math.hypot(dx, dy) || 1;
      // perpendicular offset scaled by the curve amount
      const nx = -dy / len, ny = dx / len;
      const amt = (curve == null ? 0.4 : curve) * len * 0.5;
      const cx = mx + nx * amt, cy = my + ny * amt;
      return `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;
    }
    if (type === "diagonal") {
      // 45° diagonal for as long as possible, then a straight (axis-aligned) segment
      const sx = Math.sign(dx), sy = Math.sign(dy);
      const m = Math.min(Math.abs(dx), Math.abs(dy));
      const kx = p1.x + sx * m, ky = p1.y + sy * m;
      return `M ${p1.x} ${p1.y} L ${kx} ${ky} L ${p2.x} ${p2.y}`;
    }
    if (type === "ortho") {
      // right-angle elbow: horizontal then vertical
      return `M ${p1.x} ${p1.y} L ${p2.x} ${p1.y} L ${p2.x} ${p2.y}`;
    }
    // direct
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  };

  // Build an element for a shape defined by a grid-aligned bounding box
  // {c,r,w,h}: the shape is inscribed in the box, so dragging corner-to-corner
  // fits it neatly within the grid lines.
  R.shapeElement = function (shape, proj, stroke, sw) {
    const p0 = proj.pt(shape.c, shape.r), p1 = proj.pt(shape.c + (shape.w || 1), shape.r + (shape.h || 1));
    const x0 = Math.min(p0.x, p1.x), y0 = Math.min(p0.y, p1.y);
    const x1 = Math.max(p0.x, p1.x), y1 = Math.max(p0.y, p1.y);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.max(1, (x1 - x0) / 2), ry = Math.max(1, (y1 - y0) / 2);
    const rot = shape.rot || 0;
    const common = { class: "g-shape", stroke, "stroke-width": sw, transform: rot ? `rotate(${rot} ${cx} ${cy})` : null, "stroke-linejoin": "round", "data-shape": shape.id };
    switch (shape.type) {
      case "square":
        return U.svg("rect", Object.assign({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: "none" }, common));
      case "triangle": {
        const pts = [[cx, y0], [x0, y1], [x1, y1]];
        return U.svg("polygon", Object.assign({ points: pts.map((p) => p.join(",")).join(" "), fill: "none" }, common));
      }
      case "diamond": {
        const pts = [[cx, y0], [x1, cy], [cx, y1], [x0, cy]];
        return U.svg("polygon", Object.assign({ points: pts.map((p) => p.join(",")).join(" "), fill: "none" }, common));
      }
      case "ring":
        return U.svg("ellipse", Object.assign({ cx, cy, rx, ry, fill: "none" }, common));
      case "dot":
        return U.svg("ellipse", { cx, cy, rx, ry, fill: stroke });
      case "arc": {
        // half-ellipse open at the bottom, fitting the box
        const d = `M ${x0} ${cy} A ${rx} ${ry} 0 0 1 ${x1} ${cy}`;
        return U.svg("path", Object.assign({ d, fill: "none" }, common));
      }
      case "circle":
      default:
        return U.svg("ellipse", Object.assign({ cx, cy, rx, ry, fill: "none" }, common));
    }
  };

  // Render a glyph. opts: { size, padding, style, showGrid, background }
  R.render = function (glyph, opts) {
    opts = opts || {};
    const style = opts.style || {};
    const sw = opts.strokeWidth || style.strokeWidth || 6;
    const stroke = opts.strokeColor || style.strokeColor || "#e6edf3";
    const nodeR = style.nodeRadius || 5;
    const size = opts.size || 220;
    const cols = Math.max(1, glyph.grid.cols), rows = Math.max(1, glyph.grid.rows);
    const aspect = cols / rows;
    let w = size, h = size;
    if (aspect > 1) h = size / aspect; else w = size * aspect;
    const pad = opts.padding != null ? opts.padding : Math.max(sw, 12);
    const svgW = w + pad * 2, svgH = h + pad * 2;

    const svg = U.svg("svg", {
      class: "glyph-svg",
      width: opts.width || svgW,
      height: opts.height || svgH,
      viewBox: `0 0 ${svgW} ${svgH}`,
    });
    if (opts.background) svg.style.background = opts.background;

    const box = { x: pad, y: pad, w, h };
    const proj = project(glyph, box);

    // optional grid dots
    if (opts.showGrid) {
      for (let c = 0; c <= cols; c++) {
        for (let r = 0; r <= rows; r++) {
          const p = proj.pt(c, r);
          svg.appendChild(U.svg("circle", { class: "grid-dot", cx: p.x, cy: p.y, r: 2.2, "data-c": c, "data-r": r }));
        }
      }
    }

    // text/emoji symbol (e.g. imported from a spreadsheet) — drawn centered,
    // scaled to the box, beneath any strokes you add on top of it.
    if (glyph.text) {
      const fs = Math.min(w, h) * (glyph.text.length > 1 ? 0.55 : 0.82);
      svg.appendChild(U.svg("text", {
        x: box.x + w / 2, y: box.y + h / 2, "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": fs, fill: stroke, "font-family": "system-ui, 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",
      }, glyph.text));
    }

    // shapes (drawn beneath strokes)
    (glyph.shapes || []).forEach((s) => svg.appendChild(R.shapeElement(s, proj, stroke, sw)));

    // connections
    const nodeById = {};
    (glyph.nodes || []).forEach((n) => (nodeById[n.id] = n));
    (glyph.connections || []).forEach((conn) => {
      const a = nodeById[conn.from], b = nodeById[conn.to];
      if (!a || !b) return;
      const p1 = proj.pt(a.c, a.r), p2 = proj.pt(b.c, b.r);
      const path = U.svg("path", {
        class: "g-conn",
        d: R.connectionPath(p1, p2, conn.type, conn.curve),
        stroke, "stroke-width": sw, "data-conn": conn.id,
      });
      svg.appendChild(path);
    });

    // nodes (only when interactive/editing)
    if (opts.showNodes) {
      (glyph.nodes || []).forEach((n) => {
        const p = proj.pt(n.c, n.r);
        svg.appendChild(U.svg("circle", { class: "g-node", cx: p.x, cy: p.y, r: nodeR, "data-node": n.id }));
      });
    }

    svg._proj = proj;
    svg._box = box;
    return svg;
  };

  // Standalone SVG markup string for export/download.
  R.toSVGString = function (glyph, style) {
    const svg = R.render(glyph, { size: 300, style, showGrid: false, showNodes: false, background: "#ffffff" });
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML;
  };

  window.GlyphRender = R;
})();
