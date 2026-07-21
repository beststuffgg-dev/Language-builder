/* nodeEditor.js — visual node-graph editor for conjugation & grammar rules.
   Drag nodes, wire output→input sockets, edit params, live-test the rule. */
(function () {
  const N = {
    ruleId: null,
    pan: { x: 20, y: 20 },
    selected: null,
    connecting: null, // { node, socket, dir }
    sockEls: {},
  };

  function project() { return Store.getActive(); }
  function currentRule() {
    const p = project();
    return p && p.rules.find((r) => r.id === N.ruleId);
  }

  /* ---------- Sidebar ---------- */
  N.renderList = function () {
    const p = project();
    const list = document.getElementById("ruleList");
    U.clear(list);
    if (!p) return;
    if (!p.rules.length) list.appendChild(U.el("div.empty-hint", { text: "No rules yet. Click “＋ New”." }));
    const groups = { conjugation: [], grammar: [], orthography: [] };
    p.rules.forEach((r) => (groups[r.category] || (groups[r.category] = [])).push(r));
    Object.keys(groups).forEach((cat) => {
      if (!groups[cat].length) return;
      list.appendChild(U.el("div.li-sub", { text: cat.toUpperCase(), style: { padding: "8px 10px 2px" } }));
      groups[cat].forEach((r) => {
        list.appendChild(U.el("div.list-item" + (r.id === N.ruleId ? ".active" : ""), { onClick: () => N.open(r.id) }, [
          U.el("div", { style: { flex: "1", overflow: "hidden" } }, [
            U.el("div.li-title", { text: r.name }),
            U.el("div.li-sub", { text: (r.graph.nodes || []).length + " nodes" }),
          ]),
        ]));
      });
    });
  };

  N.addRule = function () {
    const p = project();
    if (!p) return;
    const inNode = { id: U.uid("nd"), type: "input", x: 40, y: 120, params: {} };
    const outNode = { id: U.uid("nd"), type: "output", x: 360, y: 130, params: {} };
    const rule = {
      id: U.uid("rule"), name: "New rule", category: "conjugation", description: "",
      graph: { nodes: [inNode, outNode], connections: [{ id: U.uid("w"), from: { node: inNode.id, socket: "word" }, to: { node: outNode.id, socket: "in" } }] },
      test: { word: "example", params: {} },
    };
    p.rules.push(rule);
    Store.touch();
    N.open(rule.id);
  };

  N.open = function (id) {
    N.ruleId = id;
    N.pan = { x: 20, y: 20 };
    N.selected = null;
    N.renderList();
    N.renderWorkspace();
  };

  N.refresh = function () {
    const p = project();
    if (p && (!N.ruleId || !p.rules.find((r) => r.id === N.ruleId))) N.ruleId = p.rules[0] ? p.rules[0].id : null;
    N.renderList();
    N.renderWorkspace();
  };

  /* ---------- Workspace ---------- */
  N.renderWorkspace = function () {
    const ws = document.getElementById("ruleWorkspace");
    U.clear(ws);
    const p = project();
    const rule = currentRule();
    if (!rule) {
      ws.appendChild(U.el("div.empty-hint", { text: p && p.rules.length ? "Select a rule to edit." : "Create a rule to start node programming.", style: { margin: "auto" } }));
      return;
    }

    ws.appendChild(buildToolbar(rule, p));
    const wrap = U.el("div.node-canvas-wrap");
    const canvas = U.el("div.node-canvas");
    canvas.style.transform = `translate(${N.pan.x}px, ${N.pan.y}px)`;
    const wireLayer = U.svg("svg", { class: "wire-layer" });
    canvas.appendChild(wireLayer);
    wrap.appendChild(canvas);

    N.sockEls = {};
    (rule.graph.nodes || []).forEach((node) => canvas.appendChild(buildNode(node, rule)));

    // Add-node menu is a sibling strip (not inside the wrap) so the
    // absolutely-positioned canvas can't intercept its clicks.
    ws.appendChild(buildAddMenu(rule));
    ws.appendChild(wrap);
    ws.appendChild(buildTestPanel(rule));

    N._wrap = wrap; N._canvas = canvas; N._wireLayer = wireLayer; N._rule = rule;
    requestAnimationFrame(() => drawWires(rule));
    attachCanvasInteraction(wrap, canvas, rule);
  };

  function buildToolbar(rule, p) {
    const bar = U.el("div.rule-toolbar");
    bar.appendChild(U.el("input.title-input", { value: rule.name, onInput: (e) => { rule.name = e.target.value; Store.touch(); N.renderList(); } }));
    const cat = U.el("select", { onChange: (e) => { rule.category = e.target.value; Store.touch(); N.renderList(); } });
    ["conjugation", "grammar", "orthography"].forEach((c) => cat.appendChild(U.el("option", { value: c, text: c, selected: rule.category === c })));
    bar.appendChild(cat);
    bar.appendChild(U.el("input", { value: rule.description, placeholder: "description…", style: { flex: "1", minWidth: "160px" }, onInput: (e) => { rule.description = e.target.value; Store.touch(); } }));
    bar.appendChild(U.el("button.btn.small", { text: "Duplicate", onClick: () => duplicateRule(rule) }));
    bar.appendChild(U.el("button.btn.small.danger", { text: "Delete", onClick: () => deleteRule(rule) }));
    return bar;
  }

  function buildNode(node, rule) {
    const def = Engine.def(node.type);
    if (!def) return U.el("div");
    const elNode = U.el("div.node.cat-" + def.category + (N.selected === node.id ? ".sel" : ""), {
      style: { left: node.x + "px", top: node.y + "px" }, "data-node": node.id,
    });

    // Head (drag handle)
    const head = U.el("div.node-head", {}, [
      U.el("span.nh-title", { text: def.title }),
      U.el("span.nh-del", { text: "✕", title: "Delete node", onClick: (e) => { e.stopPropagation(); removeNode(rule, node.id); } }),
    ]);
    head.addEventListener("pointerdown", (e) => startNodeDrag(e, node));
    elNode.appendChild(head);

    const body = U.el("div.node-body");

    // Input sockets
    (def.sockets.in || []).forEach((s) => {
      const sock = U.el("div.socket.in" + (s.type === "bool" ? ".bool" : ""), { "data-node": node.id, "data-sock": s.name, "data-dir": "in", "data-type": s.type });
      N.sockEls[node.id + ":" + s.name + ":in"] = sock;
      body.appendChild(U.el("div.socket-row", {}, [sock, U.el("span.socket-label", { text: s.name })]));
    });

    // Params
    (def.params || []).forEach((prm) => body.appendChild(buildParam(node, prm, rule)));

    // help text
    if (def.help) body.appendChild(U.el("div.hint", { text: def.help, style: { padding: "0 8px" } }));

    // Output sockets
    (def.sockets.out || []).forEach((s) => {
      const sock = U.el("div.socket.out" + (s.type === "bool" ? ".bool" : ""), { "data-node": node.id, "data-sock": s.name, "data-dir": "out", "data-type": s.type });
      N.sockEls[node.id + ":" + s.name + ":out"] = sock;
      body.appendChild(U.el("div.socket-row.out", {}, [U.el("span.socket-label", { text: s.name }), sock]));
    });

    elNode.appendChild(body);

    // socket connect handlers
    elNode.querySelectorAll(".socket").forEach((sock) => {
      sock.addEventListener("pointerdown", (e) => { e.stopPropagation(); startConnect(e, sock, rule); });
      sock.addEventListener("pointerup", (e) => { e.stopPropagation(); endConnect(e, sock, rule); });
    });

    elNode.addEventListener("pointerdown", () => { N.selected = node.id; });
    return elNode;
  }

  function buildParam(node, prm, rule) {
    node.params = node.params || {};
    if (node.params[prm.key] === undefined) node.params[prm.key] = prm.default;
    const wrap = U.el("div.node-param");
    let input;
    if (prm.type === "select") {
      input = U.el("select", { onChange: (e) => { node.params[prm.key] = e.target.value; refreshLive(rule); } });
      (prm.options || []).forEach((o) => input.appendChild(U.el("option", { value: o, text: o, selected: node.params[prm.key] === o })));
    } else if (prm.type === "checkbox") {
      input = U.el("label", { style: { display: "flex", gap: "6px", alignItems: "center", color: "var(--text-dim)" } }, [
        U.el("input", { type: "checkbox", checked: !!node.params[prm.key], style: { width: "auto" }, onChange: (e) => { node.params[prm.key] = e.target.checked; refreshLive(rule); } }),
        prm.label,
      ]);
      wrap.appendChild(input);
      return wrap;
    } else {
      input = U.el("input", { value: node.params[prm.key], placeholder: prm.label, onInput: (e) => { node.params[prm.key] = e.target.value; refreshLive(rule); } });
    }
    wrap.appendChild(U.el("div.socket-label", { text: prm.label, style: { fontSize: "10px" } }));
    wrap.appendChild(input);
    return wrap;
  }

  /* ---------- Wires ---------- */
  function socketCenter(el) {
    const cr = N._canvas.getBoundingClientRect();
    const sr = el.getBoundingClientRect();
    return { x: sr.left + sr.width / 2 - cr.left, y: sr.top + sr.height / 2 - cr.top };
  }

  function wirePath(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  function drawWires(rule) {
    const layer = N._wireLayer;
    if (!layer) return;
    U.clear(layer);
    (rule.graph.connections || []).forEach((conn) => {
      const from = N.sockEls[conn.from.node + ":" + conn.from.socket + ":out"];
      const to = N.sockEls[conn.to.node + ":" + conn.to.socket + ":in"];
      if (!from || !to) return;
      const a = socketCenter(from), b = socketCenter(to);
      const isBool = from.classList.contains("bool");
      const path = U.svg("path", { class: "wire" + (isBool ? " bool" : ""), d: wirePath(a, b), "data-conn": conn.id, style: "pointer-events:stroke;cursor:pointer" });
      path.addEventListener("click", () => { removeConnection(rule, conn.id); });
      layer.appendChild(path);
    });
  }

  /* ---------- Interaction: node drag, pan, connect ---------- */
  function startNodeDrag(e, node) {
    e.stopPropagation();
    N.selected = node.id;
    const startX = e.clientX, startY = e.clientY, ox = node.x, oy = node.y;
    const move = (ev) => {
      node.x = ox + (ev.clientX - startX);
      node.y = oy + (ev.clientY - startY);
      const el = N._canvas.querySelector("[data-node='" + node.id + "']");
      if (el) { el.style.left = node.x + "px"; el.style.top = node.y + "px"; }
      drawWires(N._rule);
    };
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); Store.touch(); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  function attachCanvasInteraction(wrap, canvas, rule) {
    wrap.addEventListener("pointerdown", (e) => {
      if (e.target !== wrap && e.target !== canvas && e.target.tagName !== "svg") return;
      N.selected = null;
      const startX = e.clientX, startY = e.clientY, ox = N.pan.x, oy = N.pan.y;
      const move = (ev) => {
        N.pan.x = ox + (ev.clientX - startX);
        N.pan.y = oy + (ev.clientY - startY);
        canvas.style.transform = `translate(${N.pan.x}px, ${N.pan.y}px)`;
      };
      const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }

  function startConnect(e, sock, rule) {
    N.connecting = { node: sock.getAttribute("data-node"), socket: sock.getAttribute("data-sock"), dir: sock.getAttribute("data-dir"), bool: sock.classList.contains("bool") };
    const tmp = U.svg("path", { class: "wire wire-tmp" + (N.connecting.bool ? " bool" : "") });
    N._wireLayer.appendChild(tmp);
    const start = socketCenter(sock);
    const move = (ev) => {
      const cr = N._canvas.getBoundingClientRect();
      const p = { x: ev.clientX - cr.left, y: ev.clientY - cr.top };
      tmp.setAttribute("d", wirePath(start, p));
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      tmp.remove();
      setTimeout(() => { N.connecting = null; }, 0);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  function endConnect(e, sock, rule) {
    if (!N.connecting) return;
    const target = { node: sock.getAttribute("data-node"), socket: sock.getAttribute("data-sock"), dir: sock.getAttribute("data-dir") };
    const src = N.connecting;
    N.connecting = null;
    if (src.dir === target.dir) return; // must be out→in
    const out = src.dir === "out" ? src : target;
    const inp = src.dir === "in" ? src : target;
    if (out.node === inp.node) return;
    // one wire per input socket
    rule.graph.connections = (rule.graph.connections || []).filter((c) => !(c.to.node === inp.node && c.to.socket === inp.socket));
    rule.graph.connections.push({ id: U.uid("w"), from: { node: out.node, socket: out.socket }, to: { node: inp.node, socket: inp.socket } });
    Store.touch();
    N.renderWorkspace();
  }

  /* ---------- Model ops ---------- */
  function removeNode(rule, id) {
    const node = rule.graph.nodes.find((n) => n.id === id);
    if (node && node.type === "output" && rule.graph.nodes.filter((n) => n.type === "output").length === 1) {
      U.toast("Keep at least one Result Out node.", true); return;
    }
    rule.graph.nodes = rule.graph.nodes.filter((n) => n.id !== id);
    rule.graph.connections = rule.graph.connections.filter((c) => c.from.node !== id && c.to.node !== id);
    Store.touch();
    N.renderWorkspace();
  }
  function removeConnection(rule, id) {
    rule.graph.connections = rule.graph.connections.filter((c) => c.id !== id);
    Store.touch();
    N.renderWorkspace();
  }

  function buildAddMenu(rule) {
    const menu = U.el("div.node-add-menu");
    Engine.GROUPS.forEach((grp) => {
      menu.appendChild(U.el("span.grp-label", { text: grp.label }));
      grp.types.forEach((type) => {
        const def = Engine.def(type);
        menu.appendChild(U.el("button.btn.small", { text: def.title, onClick: () => addNode(rule, type) }));
      });
    });
    return menu;
  }

  function addNode(rule, type) {
    const node = { id: U.uid("nd"), type, x: -N.pan.x + 60 + Math.random() * 40, y: -N.pan.y + 60 + Math.random() * 40, params: {} };
    rule.graph.nodes.push(node);
    Store.touch();
    N.renderWorkspace();
  }

  function duplicateRule(rule) {
    const p = project();
    const copy = U.clone(rule);
    copy.id = U.uid("rule"); copy.name = rule.name + " copy";
    const map = {};
    copy.graph.nodes.forEach((n) => { const old = n.id; n.id = U.uid("nd"); map[old] = n.id; });
    copy.graph.connections.forEach((c) => { c.id = U.uid("w"); c.from.node = map[c.from.node]; c.to.node = map[c.to.node]; });
    p.rules.push(copy); Store.touch(); N.open(copy.id);
  }

  function deleteRule(rule) {
    U.confirm("Delete rule", `Delete “${rule.name}”?`, () => {
      const p = project();
      p.rules = p.rules.filter((r) => r.id !== rule.id);
      N.ruleId = p.rules[0] ? p.rules[0].id : null;
      Store.touch(); N.renderList(); N.renderWorkspace();
    }, "Delete");
  }

  /* ---------- Test panel ---------- */
  function buildTestPanel(rule) {
    const panel = U.el("div.test-panel");
    const outEl = U.el("div.test-out");

    const wordIn = U.el("input", { value: rule.test.word, placeholder: "test word", style: { maxWidth: "180px" },
      onInput: (e) => { rule.test.word = e.target.value; Store.touch(); run(); } });

    // gather param keys used by 'param' nodes
    const paramKeys = Array.from(new Set(rule.graph.nodes.filter((n) => n.type === "param").map((n) => (n.params || {}).key).filter(Boolean)));
    const paramWrap = U.el("div.test-row");
    rule.test.params = rule.test.params || {};
    paramKeys.forEach((k) => {
      paramWrap.appendChild(U.el("label.field", { style: { flexDirection: "row", alignItems: "center", gap: "6px" } }, [
        U.el("span.pill", { text: k }),
        U.el("input", { value: rule.test.params[k] || "", style: { maxWidth: "120px" }, placeholder: "value",
          onInput: (e) => { rule.test.params[k] = e.target.value; Store.touch(); run(); } }),
      ]));
    });

    function run() {
      const res = Engine.run(rule.graph, { word: rule.test.word, params: rule.test.params, lexicon: (project() || {}).lexicon || [] });
      U.clear(outEl);
      outEl.appendChild(U.el("span", { text: res.result || "∅" }));
      if (res.warning) outEl.appendChild(U.el("span.hint", { text: "  — " + res.warning, style: { fontSize: "12px" } }));
    }
    N._runTest = run;

    panel.appendChild(U.el("div.test-row", {}, [
      U.el("strong", { text: "Test:" }), wordIn,
      paramKeys.length ? paramWrap : U.el("span.hint", { text: "add Parameter nodes to test features like gender/tense" }),
    ]));
    panel.appendChild(U.el("div.test-row", {}, [U.el("span.hint", { text: "result →" }), outEl]));
    run();
    return panel;
  }

  function refreshLive(rule) {
    Store.touch();
    if (N._runTest) N._runTest();
  }

  window.NodeEditor = N;
})();
