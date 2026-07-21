/* app.js — boot, tab routing, project switching, import/export. */
(function () {
  const App = { currentTab: "overview" };

  App.switchTab = function (tab) {
    App.currentTab = tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === tab));
    App.renderTab(tab);
  };

  App.renderTab = function (tab) {
    switch (tab) {
      case "overview": Overview.render(); break;
      case "glyphs": GlyphEditor.refresh(); break;
      case "lexicon": Lexicon.render(); break;
      case "rules": NodeEditor.refresh(); break;
      case "write": Compose.render(); break;
    }
  };

  App.renderProjectSelect = function () {
    const sel = document.getElementById("projectSelect");
    U.clear(sel);
    const list = Store.projectList();
    if (!list.length) {
      sel.appendChild(U.el("option", { text: "— no language —", value: "" }));
    }
    list.forEach((p) => sel.appendChild(U.el("option", { value: p.id, text: p.name, selected: p.id === Store.data.activeProjectId })));
  };

  App.renderAll = function () {
    App.renderProjectSelect();
    App.renderTab(App.currentTab);
  };

  function newProject() {
    const nameIn = U.el("input", { value: "New language", placeholder: "language name" });
    U.modal({
      title: "New language",
      body: [
        U.el("label.field", {}, ["Name", nameIn]),
        U.el("p.hint", { text: "Starts blank. You can also pick a template from the Overview tab." }),
      ],
      confirmText: "Create",
      onConfirm: () => {
        const p = Templates.blankProject(nameIn.value.trim() || "New language");
        Store.addProject(p);
        App.switchTab("overview");
      },
    });
  }

  function renameProject() {
    const p = Store.getActive();
    if (!p) return;
    const nameIn = U.el("input", { value: p.name });
    U.modal({
      title: "Language settings",
      body: [U.el("label.field", {}, ["Name", nameIn]), U.el("p.hint", { text: "More settings are on the Overview tab." })],
      confirmText: "Save",
      onConfirm: () => { p.name = nameIn.value.trim() || p.name; Store.touch(); App.renderAll(); },
    });
  }

  function deleteProject() {
    const p = Store.getActive();
    if (!p) return;
    U.confirm("Delete language", `Permanently delete “${p.name}” and everything in it?`, () => {
      Store.deleteProject(p.id);
      App.renderAll();
    }, "Delete");
  }

  function exportProject() {
    const p = Store.getActive();
    if (!p) { U.toast("No language to export.", true); return; }
    U.modal({
      title: "Export",
      body: [
        U.el("p.muted", { text: "Download your work as JSON. Re-import it here or on another device — this is how you back up or move a language." }),
        U.el("div.inline-actions", {}, [
          U.el("button.btn.primary", { text: "This language (.json)", onClick: () => { U.download((p.name || "language") + ".json", Store.exportProject(p)); U.toast("Exported " + p.name); } }),
          U.el("button.btn", { text: "All languages (.json)", onClick: () => { U.download("language-builder-archive.json", Store.exportAll()); U.toast("Exported archive"); } }),
        ]),
      ],
      hideActions: true,
      cancelText: "Close",
    });
  }

  function importProject() {
    document.getElementById("importFile").click();
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const res = Store.importJSON(reader.result);
        U.toast("Imported " + res.count + " language" + (res.count === 1 ? "" : "s"));
        App.switchTab("overview");
        App.renderAll();
      } catch (err) {
        console.error(err);
        U.toast("Import failed: not a valid Language Builder file.", true);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function bind() {
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => App.switchTab(t.dataset.tab)));
    document.getElementById("projectSelect").addEventListener("change", (e) => { if (e.target.value) { Store.setActive(e.target.value); App.renderAll(); } });
    document.getElementById("newProjectBtn").addEventListener("click", newProject);
    document.getElementById("renameProjectBtn").addEventListener("click", renameProject);
    document.getElementById("deleteProjectBtn").addEventListener("click", deleteProject);
    document.getElementById("exportBtn").addEventListener("click", exportProject);
    document.getElementById("importBtn").addEventListener("click", importProject);
    document.getElementById("importFile").addEventListener("change", handleImportFile);
    document.getElementById("addGlyphBtn").addEventListener("click", () => GlyphEditor.addGlyph());
    document.getElementById("addRuleBtn").addEventListener("click", () => NodeEditor.addRule());
  }

  function firstRun() {
    // Seed a friendly starter language so the app isn't empty on first open.
    if (!Store.projectList().length) {
      const t = Templates.get("syllabary");
      Store.addProject(t.build());
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    Store.load();
    // normalize every project so older/imported data has all fields
    Object.keys(Store.data.projects).forEach((id) => { Store.data.projects[id] = Templates.normalize(Store.data.projects[id]); });
    firstRun();
    if (!Store.data.activeProjectId) { const first = Store.projectList()[0]; if (first) Store.data.activeProjectId = first.id; }
    bind();
    Store.onChange(() => App.renderProjectSelect());
    App.switchTab("overview");
    App.renderAll();
  });

  window.App = App;
})();
