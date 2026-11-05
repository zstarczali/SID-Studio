(function () {
  "use strict";
  // window.__TAURI__ needs withGlobalTauri: true in tauri.conf.json. The editor code calls window.electronAPI.
  if (!window.__TAURI__) return;
  const invoke = window.__TAURI__.core.invoke;
  window.electronAPI = {
    saveBin: (payload) => invoke("save_bin", { payload }),
    onHvscProgress: (cb) => window.__TAURI__.event.listen("hvsc-download-progress", e => cb(e.payload)),
    openExternal: (url) => invoke("open_external", { url }),
    openManual: () => invoke("open_manual"),
    getVmaVersion: () => invoke("get_vma_version"),
    hvscCatalog: (refresh) => invoke("hvsc_catalog", { refresh: !!refresh }),
    hvscStatus: () => invoke("hvsc_status"),
    hvscFetch: (path) => invoke("hvsc_fetch", { path }),
    hvscClearFolder: () => invoke("hvsc_clear_folder"),
    hvscChooseFolder: () => invoke("hvsc_choose_folder"),
    hvscDownloadAll: () => invoke("hvsc_download_all"),
    hvscCancelDownload: () => invoke("hvsc_cancel_download"),
    modlandCatalog: (refresh) => invoke("modland_catalog", { refresh: !!refresh }),
    modlandFetch: (path) => invoke("modland_fetch", { path }),
    releaseSidFile: (sessionId) => invoke("release_sid_file", { sessionId }),
    renderSidFile: (payload) => invoke("render_sid_file", { payload }),
    sidFileInfo: (sessionId) => invoke("sid_file_info", { sessionId }),
    releaseSidPreview: (sessionId) => invoke("release_sid_preview", { sessionId }),
    renderSidPreview: (payload) => invoke("render_sid_preview", { payload }),
    sidRegisterDump: (payload) => invoke("sid_register_dump", { payload }),
    onSidDumpProgress: (cb) => window.__TAURI__.event.listen("sid-dump-progress", e => cb(e.payload)),
    vmaBuildRaw: (source) => invoke("vma_build_raw", { source }),
  };
})();
