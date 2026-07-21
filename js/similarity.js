/* similarity.js — measure how visually alike two glyphs are, so you can catch
   confusable characters. Each glyph is rasterized into a size-normalized
   occupancy grid, then compared with the Dice coefficient (forgiving of small
   offsets because samples are dilated). */
(function () {
  const S = { N: 24 };

  function markInto(grid, N, nx, ny) {
    const cx = Math.round(U.clamp(nx, 0, 1) * (N - 1));
    const cy = Math.round(U.clamp(ny, 0, 1) * (N - 1));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && x < N && y >= 0 && y < N) grid[y * N + x] = 1;
    }
  }

  function samplePolyline(grid, N, pts, closed, steps) {
    steps = steps || 14;
    const n = pts.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      for (let s = 0; s <= steps; s++) { const t = s / steps; markInto(grid, N, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
    }
  }

  // Rasterize a glyph into an N×N occupancy grid, normalized to its own grid box.
  S.raster = function (glyph, N) {
    N = N || S.N;
    const grid = new Uint8Array(N * N);
    const cols = Math.max(1, glyph.grid.cols), rows = Math.max(1, glyph.grid.rows);
    const nn = (c, r) => ({ x: c / cols, y: r / rows });
    const nodeById = {};
    (glyph.nodes || []).forEach((n) => (nodeById[n.id] = n));

    (glyph.connections || []).forEach((conn) => {
      const a = nodeById[conn.from], b = nodeById[conn.to];
      if (!a || !b) return;
      const p1 = nn(a.c, a.r), p2 = nn(b.c, b.r);
      if (conn.type === "curved") {
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1;
        const amt = (conn.curve == null ? 0.4 : conn.curve) * len * 0.5;
        const ctrl = { x: (p1.x + p2.x) / 2 + (-dy / len) * amt, y: (p1.y + p2.y) / 2 + (dx / len) * amt };
        const pts = [];
        for (let t = 0; t <= 1.0001; t += 1 / 14) { const u = 1 - t; pts.push({ x: u * u * p1.x + 2 * u * t * ctrl.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * ctrl.y + t * t * p2.y }); }
        samplePolyline(grid, N, pts, false);
      } else if (conn.type === "diagonal") {
        const sx = Math.sign(p2.x - p1.x), sy = Math.sign(p2.y - p1.y);
        const m = Math.min(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
        samplePolyline(grid, N, [p1, { x: p1.x + sx * m, y: p1.y + sy * m }, p2], false);
      } else if (conn.type === "ortho") {
        samplePolyline(grid, N, [p1, { x: p2.x, y: p1.y }, p2], false);
      } else {
        samplePolyline(grid, N, [p1, p2], false);
      }
    });

    (glyph.shapes || []).forEach((s) => {
      const b0 = nn(s.c, s.r), b1 = nn(s.c + (s.w || 1), s.r + (s.h || 1));
      const x0 = Math.min(b0.x, b1.x), y0 = Math.min(b0.y, b1.y), x1 = Math.max(b0.x, b1.x), y1 = Math.max(b0.y, b1.y);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
      const rot = (s.rot || 0) * Math.PI / 180;
      const rotate = (p) => ({ x: cx + (p.x - cx) * Math.cos(rot) - (p.y - cy) * Math.sin(rot), y: cy + (p.x - cx) * Math.sin(rot) + (p.y - cy) * Math.cos(rot) });
      let pts;
      if (s.type === "square") pts = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      else if (s.type === "triangle") pts = [{ x: cx, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }];
      else if (s.type === "diamond") pts = [{ x: cx, y: y0 }, { x: x1, y: cy }, { x: cx, y: y1 }, { x: x0, y: cy }];
      else if (s.type === "dot") { markInto(grid, N, cx, cy); return; }
      else { pts = []; const seg = s.type === "arc" ? 12 : 24; const span = s.type === "arc" ? Math.PI : Math.PI * 2; const off = s.type === "arc" ? Math.PI : 0; for (let i = 0; i <= seg; i++) { const a = off + span * (i / seg); pts.push({ x: cx + Math.cos(a) * rx, y: cy - Math.sin(a) * ry }); } samplePolyline(grid, N, pts.map(rotate), s.type !== "arc"); return; }
      samplePolyline(grid, N, pts.map(rotate), true);
    });

    return grid;
  };

  function count(grid) { let n = 0; for (let i = 0; i < grid.length; i++) n += grid[i]; return n; }

  // Dice coefficient of two rasters: 2|A∩B| / (|A|+|B|) → 0..1
  S.compareRasters = function (a, b) {
    let inter = 0, ca = 0, cb = 0;
    for (let i = 0; i < a.length; i++) { if (a[i]) ca++; if (b[i]) cb++; if (a[i] && b[i]) inter++; }
    if (ca + cb === 0) return 0;
    return (2 * inter) / (ca + cb);
  };

  S.compare = function (g1, g2) { return S.compareRasters(S.raster(g1), S.raster(g2)); };

  function isEmpty(glyph) { return !(glyph.connections && glyph.connections.length) && !(glyph.shapes && glyph.shapes.length); }

  // Rank other glyphs by similarity to `glyph` (descending).
  S.rankAgainstOthers = function (glyph, others) {
    if (isEmpty(glyph)) return [];
    const base = S.raster(glyph);
    return others.filter((g) => g.id !== glyph.id && !isEmpty(g))
      .map((g) => ({ glyph: g, score: S.compareRasters(base, S.raster(g)) }))
      .sort((a, b) => b.score - a.score);
  };

  // All confusable pairs across a set of glyphs above a threshold.
  S.confusablePairs = function (glyphs, threshold) {
    threshold = threshold == null ? 0.75 : threshold;
    const drawn = glyphs.filter((g) => !isEmpty(g));
    const rasters = drawn.map((g) => S.raster(g));
    const pairs = [];
    for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
      const score = S.compareRasters(rasters[i], rasters[j]);
      if (score >= threshold) pairs.push({ a: drawn[i], b: drawn[j], score });
    }
    return pairs.sort((x, y) => y.score - x.score);
  };

  // Label + color band for a similarity score.
  S.band = function (score) {
    if (score >= 0.75) return { level: "high", label: "Very similar", color: "var(--danger)" };
    if (score >= 0.55) return { level: "med", label: "Somewhat similar", color: "var(--warn)" };
    return { level: "low", label: "Distinct", color: "var(--accent-2)" };
  };

  window.Similarity = S;
})();
