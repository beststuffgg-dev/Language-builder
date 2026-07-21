/* storage.js — persistence + central app state.
   Works with localStorage locally, and is trivially swappable for a
   backend later (see Store.backend hook) so the same code can be web-hosted. */
(function () {
  const KEY = "language-builder:v1";
  const SCHEMA = 1;

  const Store = {
    data: { schema: SCHEMA, activeProjectId: null, projects: {} },
    backend: null, // set to an object { load(), save(data) } to override localStorage
    _dirty: false,
    _listeners: [],
  };

  Store.onChange = function (fn) { Store._listeners.push(fn); };
  Store.emit = function () { Store._listeners.forEach((f) => f(Store.data)); };

  Store.load = function () {
    try {
      let raw = null;
      if (Store.backend && Store.backend.load) raw = Store.backend.load();
      else raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && parsed.projects) Store.data = parsed;
      }
    } catch (e) {
      console.warn("Failed to load saved data:", e);
    }
    if (!Store.data.projects) Store.data.projects = {};
    return Store.data;
  };

  let saveTimer = null;
  Store.save = function (immediate) {
    Store.markDirty();
    clearTimeout(saveTimer);
    const doSave = () => {
      try {
        const json = JSON.stringify(Store.data);
        if (Store.backend && Store.backend.save) Store.backend.save(Store.data);
        else localStorage.setItem(KEY, json);
        Store._dirty = false;
        setSaveState("saved");
      } catch (e) {
        console.error("Save failed:", e);
        setSaveState("error");
      }
    };
    if (immediate) doSave();
    else saveTimer = setTimeout(doSave, 500);
  };

  Store.markDirty = function () {
    Store._dirty = true;
    setSaveState("saving…", true);
  };

  function setSaveState(text, dirty) {
    const eln = document.getElementById("saveState");
    if (!eln) return;
    eln.textContent = text;
    eln.classList.toggle("dirty", !!dirty);
  }

  /* ---- Project helpers ---- */
  Store.getActive = function () {
    return Store.data.projects[Store.data.activeProjectId] || null;
  };

  Store.setActive = function (id) {
    if (Store.data.projects[id]) {
      Store.data.activeProjectId = id;
      Store.save();
      Store.emit();
    }
  };

  Store.addProject = function (project) {
    Store.data.projects[project.id] = project;
    Store.data.activeProjectId = project.id;
    Store.save();
    Store.emit();
    return project;
  };

  Store.deleteProject = function (id) {
    delete Store.data.projects[id];
    if (Store.data.activeProjectId === id) {
      const ids = Object.keys(Store.data.projects);
      Store.data.activeProjectId = ids[0] || null;
    }
    Store.save();
    Store.emit();
  };

  Store.projectList = function () {
    return Object.values(Store.data.projects).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  };

  // Touch the active project's updatedAt then persist.
  Store.touch = function () {
    const p = Store.getActive();
    if (p) p.updatedAt = Date.now();
    Store.save();
  };

  Store.exportProject = function (project) {
    return JSON.stringify({ format: "language-builder-project", schema: SCHEMA, project }, null, 2);
  };

  Store.exportAll = function () {
    return JSON.stringify({ format: "language-builder-archive", schema: SCHEMA, data: Store.data }, null, 2);
  };

  Store.importJSON = function (text) {
    const parsed = JSON.parse(text);
    if (parsed.format === "language-builder-archive" && parsed.data) {
      // merge projects
      Object.assign(Store.data.projects, parsed.data.projects || {});
      const first = Object.keys(parsed.data.projects || {})[0];
      if (first) Store.data.activeProjectId = first;
      Store.save(true); Store.emit();
      return { count: Object.keys(parsed.data.projects || {}).length };
    }
    let project = parsed.project || parsed; // allow bare project too
    if (!project.id) project.id = U.uid("lang");
    // avoid collision
    if (Store.data.projects[project.id]) project.id = U.uid("lang");
    project.name = project.name || "Imported language";
    Store.data.projects[project.id] = window.Templates ? window.Templates.normalize(project) : project;
    Store.data.activeProjectId = project.id;
    Store.save(true); Store.emit();
    return { count: 1, project };
  };

  window.Store = Store;
})();
