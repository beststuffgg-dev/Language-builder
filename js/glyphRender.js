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

  // Build path/element for a basic shape centred at grid point (c,r).
  R.shapeElement = function (shape, proj, stroke, sw) {
    const center = proj.pt(shape.c, shape.r);
    const unit = (proj.cw + proj.ch) / 2;
    const rad = Math.max(2, (shape.size || 1) * unit * 0.6);
    const rot = shape.rot || 0;
    const common = { class: "g-shape", stroke, "stroke-width": sw, transform: `rotate(${rot} ${center.x} ${center.y})` };
    switch (shape.type) {
      case "square":
        return U.svg("rect", Object.assign({ x: center.x - rad, y: center.y - rad, width: rad * 2, height: rad * 2 }, common));
      case "triangle": {
        const h = rad * 1.2;
        const pts = [[center.x, center.y - h], [center.x - rad, center.y + rad * 0.7], [center.x + rad, center.y + rad * 0.7]];
        return U.svg("polygon", Object.assign({ points: pts.map((p) => p.join(",")).join(" ") }, common));
      }
      case "diamond": {
        const pts = [[center.x, center.y - rad], [center.x + rad, center.y], [center.x, center.y + rad], [center.x - rad, center.y]];
        return U.svg("polygon", Object.assign({ points: pts.map((p) => p.join(",")).join(" ") }, common));
      }
      case "ring":
        return U.svg("circle", Object.assign({ cx: center.x, cy: center.y, r: rad }, common, { fill: "none" }));
      case "dot":
        return U.svg("circle", { cx: center.x, cy: center.y, r: Math.max(2, rad * 0.35), fill: stroke });
      case "arc": {
        // half-circle open at bottom
        const d = `M ${center.x - rad} ${center.y} A ${rad} ${rad} 0 0 1 ${center.x + rad} ${center.y}`;
        return U.svg("path", Object.assign({ d }, common, { fill: "none" }));
      }
      case "circle":
      default:
        return U.svg("circle", Object.assign({ cx: center.x, cy: center.y, r: rad }, common, { fill: "none" }));
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
