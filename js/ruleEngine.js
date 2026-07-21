/* ruleEngine.js — the node "programming" model + evaluator.
   A rule is a graph of nodes; the engine pulls values from the Output
   node backwards, so order doesn't matter and cycles are guarded. */
(function () {
  const str = (v) => (v == null ? "" : String(v));
  const bool = (v) => v === true || v === "true" || (typeof v === "string" && v.length > 0 && v !== "false") || v === 1;

  // Each def: category, title, sockets {in:[{name,type}], out:[{name,type}]},
  // params:[{key,label,type,default,options}], eval(input, params, ctx) -> {socket: value}
  const DEFS = {
    input: {
      category: "input", title: "Word In",
      sockets: { in: [], out: [{ name: "word", type: "string" }] },
      params: [],
      eval: (input, p, ctx) => ({ word: str(ctx.word) }),
    },
    param: {
      category: "input", title: "Parameter",
      help: "Reads a grammatical feature you set when testing (e.g. gender, tense, number).",
      sockets: { in: [], out: [{ name: "out", type: "string" }] },
      params: [{ key: "key", label: "Feature", type: "text", default: "gender" }],
      eval: (input, p, ctx) => ({ out: str((ctx.params || {})[p.key]) }),
    },
    const: {
      category: "string", title: "Text",
      sockets: { in: [], out: [{ name: "out", type: "string" }] },
      params: [{ key: "value", label: "Value", type: "text", default: "" }],
      eval: (input, p) => ({ out: str(p.value) }),
    },
    prefix: {
      category: "string", title: "Add Prefix",
      sockets: { in: [{ name: "affix", type: "string" }, { name: "base", type: "string" }], out: [{ name: "out", type: "string" }] },
      params: [{ key: "sep", label: "Separator", type: "text", default: "" }],
      eval: (input, p) => ({ out: str(input("affix")) + str(p.sep) + str(input("base")) }),
    },
    suffix: {
      category: "string", title: "Add Suffix",
      sockets: { in: [{ name: "base", type: "string" }, { name: "affix", type: "string" }], out: [{ name: "out", type: "string" }] },
      params: [{ key: "sep", label: "Separator", type: "text", default: "" }],
      eval: (input, p) => ({ out: str(input("base")) + str(p.sep) + str(input("affix")) }),
    },
    concat: {
      category: "string", title: "Join",
      sockets: { in: [{ name: "a", type: "string" }, { name: "b", type: "string" }], out: [{ name: "out", type: "string" }] },
      params: [],
      eval: (input) => ({ out: str(input("a")) + str(input("b")) }),
    },
    replace: {
      category: "string", title: "Replace",
      sockets: { in: [{ name: "base", type: "string" }], out: [{ name: "out", type: "string" }] },
      params: [
        { key: "find", label: "Find", type: "text", default: "" },
        { key: "repl", label: "Replace with", type: "text", default: "" },
        { key: "regex", label: "Regex", type: "checkbox", default: false },
      ],
      eval: (input, p) => {
        const base = str(input("base"));
        if (!p.find) return { out: base };
        try {
          if (p.regex) return { out: base.replace(new RegExp(p.find, "g"), p.repl || "") };
          return { out: base.split(p.find).join(p.repl || "") };
        } catch (e) { return { out: base }; }
      },
    },
    case: {
      category: "string", title: "Change Case",
      sockets: { in: [{ name: "base", type: "string" }], out: [{ name: "out", type: "string" }] },
      params: [{ key: "mode", label: "Mode", type: "select", default: "lower", options: ["lower", "upper", "capitalize"] }],
      eval: (input, p) => {
        const s = str(input("base"));
        if (p.mode === "upper") return { out: s.toUpperCase() };
        if (p.mode === "capitalize") return { out: s ? s[0].toUpperCase() + s.slice(1) : s };
        return { out: s.toLowerCase() };
      },
    },
    startsWith: {
      category: "logic", title: "Starts With?",
      sockets: { in: [{ name: "base", type: "string" }, { name: "test", type: "string" }], out: [{ name: "out", type: "bool" }] },
      params: [],
      eval: (input) => ({ out: str(input("base")).startsWith(str(input("test"))) }),
    },
    endsWith: {
      category: "logic", title: "Ends With?",
      sockets: { in: [{ name: "base", type: "string" }, { name: "test", type: "string" }], out: [{ name: "out", type: "bool" }] },
      params: [],
      eval: (input) => ({ out: str(input("base")).endsWith(str(input("test"))) }),
    },
    contains: {
      category: "logic", title: "Contains?",
      sockets: { in: [{ name: "base", type: "string" }, { name: "test", type: "string" }], out: [{ name: "out", type: "bool" }] },
      params: [],
      eval: (input) => ({ out: str(input("base")).indexOf(str(input("test"))) >= 0 }),
    },
    equals: {
      category: "logic", title: "Equals?",
      sockets: { in: [{ name: "a", type: "string" }, { name: "b", type: "string" }], out: [{ name: "out", type: "bool" }] },
      params: [],
      eval: (input) => ({ out: str(input("a")) === str(input("b")) }),
    },
    not: {
      category: "logic", title: "Not",
      sockets: { in: [{ name: "a", type: "bool" }], out: [{ name: "out", type: "bool" }] },
      params: [],
      eval: (input) => ({ out: !bool(input("a")) }),
    },
    and: {
      category: "logic", title: "And",
      sockets: { in: [{ name: "a", type: "bool" }, { name: "b", type: "bool" }], out: [{ name: "out", type: "bool" }] },
      params: [],
      eval: (input) => ({ out: bool(input("a")) && bool(input("b")) }),
    },
    or: {
      category: "logic", title: "Or",
      sockets: { in: [{ name: "a", type: "bool" }, { name: "b", type: "bool" }], out: [{ name: "out", type: "bool" }] },
      params: [],
      eval: (input) => ({ out: bool(input("a")) || bool(input("b")) }),
    },
    select: {
      category: "logic", title: "If / Else",
      help: "Outputs ifTrue when the condition is true, otherwise ifFalse.",
      sockets: { in: [{ name: "cond", type: "bool" }, { name: "ifTrue", type: "string" }, { name: "ifFalse", type: "string" }], out: [{ name: "out", type: "string" }] },
      params: [],
      eval: (input) => ({ out: bool(input("cond")) ? str(input("ifTrue")) : str(input("ifFalse")) }),
    },
    output: {
      category: "output", title: "Result Out",
      sockets: { in: [{ name: "in", type: "string" }], out: [] },
      params: [],
      eval: (input) => ({ __result: str(input("in")) }),
    },
  };

  // Grouped list for the "add node" menu.
  const GROUPS = [
    { label: "Inputs", types: ["input", "param", "const"] },
    { label: "Transform", types: ["prefix", "suffix", "concat", "replace", "case"] },
    { label: "Logic", types: ["startsWith", "endsWith", "contains", "equals", "not", "and", "or", "select"] },
    { label: "Output", types: ["output"] },
  ];

  const Engine = {
    DEFS, GROUPS, str, bool,
    def: (type) => DEFS[type],

    // Run a graph. ctx = { word, params }
    run(graph, ctx) {
      ctx = ctx || {};
      const nodeById = {};
      (graph.nodes || []).forEach((n) => (nodeById[n.id] = n));
      const cache = {}, visiting = {};

      function outputsOf(nodeId) {
        if (cache[nodeId]) return cache[nodeId];
        if (visiting[nodeId]) return {}; // cycle guard
        const node = nodeById[nodeId];
        if (!node) return {};
        const def = DEFS[node.type];
        if (!def) return {};
        visiting[nodeId] = true;
        const input = (socket) => {
          const conn = (graph.connections || []).find((c) => c.to.node === nodeId && c.to.socket === socket);
          if (!conn) return undefined;
          const up = outputsOf(conn.from.node);
          return up ? up[conn.from.socket] : undefined;
        };
        let out;
        try { out = def.eval(input, node.params || {}, ctx) || {}; }
        catch (e) { out = {}; }
        visiting[nodeId] = false;
        cache[nodeId] = out;
        return out;
      }

      const outNode = (graph.nodes || []).find((n) => n.type === "output");
      if (!outNode) return { result: str(ctx.word), warning: "Add a “Result Out” node to finish the rule." };
      const o = outputsOf(outNode.id);
      return { result: o.__result != null ? o.__result : "" };
    },
  };

  window.Engine = Engine;
})();
