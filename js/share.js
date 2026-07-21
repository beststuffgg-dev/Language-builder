/* share.js — send a language to someone: as a link, a copy-paste code, or a
   file. Opening a share link (or pasting a code) imports the language. */
(function () {
  const S = {};

  function b64encode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64decode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return decodeURIComponent(escape(atob(s)));
  }

  S.encodeProject = function (project) {
    return b64encode(JSON.stringify({ format: "language-builder-project", schema: 1, project }));
  };

  S.shareLink = function (project) {
    const base = location.origin && location.origin !== "null" ? location.origin + location.pathname : location.href.split("#")[0];
    return base + "#lang=" + S.encodeProject(project);
  };

  function copy(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => U.toast(okMsg || "Copied")).catch(() => fallbackCopy(text, okMsg));
    } else fallbackCopy(text, okMsg);
  }
  function fallbackCopy(text, okMsg) {
    const ta = U.el("textarea", { value: text, style: { position: "fixed", opacity: "0" } });
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); U.toast(okMsg || "Copied"); } catch (e) { U.toast("Copy failed — select manually.", true); }
    ta.remove();
  }

  S.openDialog = function () {
    const p = Store.getActive();
    if (!p) { U.toast("No language to share.", true); return; }
    const link = S.shareLink(p);
    const code = S.encodeProject(p);
    const linkArea = U.el("input", { value: link, readonly: true, onclick: (e) => e.target.select() });
    const codeArea = U.el("textarea", { value: code, rows: 4, readonly: true, onclick: (e) => e.target.select() });
    const tooLong = link.length > 8000;

    const importCode = U.el("textarea", { rows: 3, placeholder: "paste a share code here to import a language" });

    U.modal({
      title: "Share “" + p.name + "”",
      body: [
        U.el("p.muted", { text: "Send this language to anyone. They can open the link, paste the code, or import the file." }),
        U.el("label.field", {}, ["Share link" + (tooLong ? " (large — the file is more reliable)" : ""), linkArea]),
        U.el("div.inline-actions", {}, [
          U.el("button.btn", { text: "Copy link", onClick: () => copy(link, "Link copied") }),
          U.el("button.btn", { text: "Copy code", onClick: () => copy(code, "Code copied") }),
          U.el("button.btn", { text: "Download file", onClick: () => { U.download((p.name || "language") + ".json", Store.exportProject(p)); U.toast("Downloaded " + p.name); } }),
        ]),
        U.el("label.field", {}, ["Share code", codeArea]),
        U.el("hr", { style: { border: "none", borderTop: "1px solid var(--line)", margin: "6px 0" } }),
        U.el("label.field", {}, ["Import from a code", importCode]),
      ],
      confirmText: "Import code",
      cancelText: "Close",
      onConfirm: () => {
        const val = importCode.value.trim();
        if (!val) return; // just close
        try {
          const json = b64decode(val);
          const res = Store.importJSON(json);
          U.toast("Imported " + (res.project ? res.project.name : "language"));
          App.switchTab("overview"); App.renderAll();
        } catch (e) { U.toast("That code isn't a valid language.", true); return false; }
      },
    });
  };

  // Called on boot: if the URL carries a shared language, import it.
  S.checkHash = function () {
    const m = /[#&]lang=([^&]+)/.exec(location.hash || "");
    if (!m) return;
    try {
      const json = b64decode(m[1]);
      const res = Store.importJSON(json);
      U.toast("Opened shared language: " + (res.project ? res.project.name : ""));
    } catch (e) { console.warn("Bad share link", e); U.toast("Shared link couldn't be read.", true); }
    // clear the hash so a refresh doesn't re-import
    history.replaceState(null, "", location.pathname + location.search);
  };

  window.Share = S;
})();
