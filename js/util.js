/* util.js — tiny helpers shared across the app. No dependencies. */
(function () {
  const U = {};

  U.uid = function (prefix) {
    return (prefix || "id") + "-" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  };

  U.clone = function (obj) {
    return JSON.parse(JSON.stringify(obj));
  };

  U.clamp = function (v, min, max) {
    return Math.max(min, Math.min(max, v));
  };

  // Minimal hyperscript. el('div.foo#bar', {attr}, [children|string])
  U.el = function (sel, attrs, children) {
    const parts = sel.split(/(?=[.#])/);
    const tag = parts[0].match(/^[a-z0-9]+/i) ? parts[0].replace(/[.#].*$/, "") : "div";
    const node = document.createElement(tag || "div");
    parts.forEach((p) => {
      if (p[0] === ".") node.classList.add(p.slice(1));
      else if (p[0] === "#") node.id = p.slice(1);
    });
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k in node && k !== "list") { try { node[k] = v; } catch (e) { node.setAttribute(k, v); } }
        else node.setAttribute(k, v);
      }
    }
    U.append(node, children);
    return node;
  };

  U.append = function (node, children) {
    if (children == null) return node;
    const list = Array.isArray(children) ? children : [children];
    list.forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  };

  U.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  // SVG element helper
  U.svg = function (tag, attrs, children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) for (const k in attrs) { if (attrs[k] != null) node.setAttribute(k, attrs[k]); }
    U.append(node, children);
    return node;
  };

  U.toast = function (msg, isErr) {
    const root = document.getElementById("toastRoot");
    const t = U.el("div.toast" + (isErr ? ".err" : ""), { text: msg });
    root.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, 2600);
  };

  U.escape = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  };

  U.download = function (filename, text, mime) {
    const blob = new Blob([text], { type: mime || "application/json" });
    const url = URL.createObjectURL(blob);
    const a = U.el("a", { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /* ---- Modal ---- */
  U.modal = function (opts) {
    // opts: { title, body(node), onConfirm()->bool, confirmText, cancelText, wide }
    const root = document.getElementById("modalRoot");
    U.clear(root);
    const box = U.el("div.modal" + (opts.wide ? ".wide" : ""));
    box.appendChild(U.el("h3", { text: opts.title || "" }));
    const bodyWrap = U.el("div.form-col");
    if (opts.body) U.append(bodyWrap, opts.body);
    box.appendChild(bodyWrap);
    const close = () => U.clear(root);
    if (opts.hideActions !== true) {
      const actions = U.el("div.actions");
      if (opts.cancelText !== null) {
        actions.appendChild(U.el("button.btn", { text: opts.cancelText || "Cancel", onClick: close }));
      }
      if (opts.onConfirm) {
        actions.appendChild(U.el("button.btn.primary", {
          text: opts.confirmText || "Save",
          onClick: () => { const ok = opts.onConfirm(); if (ok !== false) close(); },
        }));
      }
      box.appendChild(actions);
    }
    const back = U.el("div.modal-back", { onMousedown: (e) => { if (e.target === back && opts.dismissable !== false) close(); } }, [box]);
    root.appendChild(back);
    const firstInput = box.querySelector("input, textarea, select");
    if (firstInput) setTimeout(() => firstInput.focus(), 30);
    return { close };
  };

  U.confirm = function (title, message, onYes, yesText) {
    U.modal({
      title,
      body: [U.el("p", { text: message, style: { color: "var(--text-dim)", margin: "0" } })],
      confirmText: yesText || "Confirm",
      onConfirm: () => { onYes(); },
    });
  };

  window.U = U;
})();
