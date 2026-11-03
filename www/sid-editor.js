// VA SID Studio. Extracted from C64 Visual Assembler (www/app.js); the sound engine, tracker and exports are the same code.


let _sidPlayMode = "all";

let _editorDialogDrag = null;

let currentLanguage = "en";

let _editorDialogPositions = (function() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("va-sid-editor-positions") || "{}") || {}; } catch (_) {}
  // under the toolbar at the first start: the HVSC panel and the playlist need the room below it
  if (!saved["websid-play-dialog"]) saved["websid-play-dialog"] = { left: 24, top: 56 };
  return saved;
})();

// translations object is defined in i18n.js (loaded before app.js)
function t(key) {
  return translations[currentLanguage]?.[key] ?? translations.en[key] ?? translations.hu[key] ?? key;
}

function tf(key, values = {}) {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    t(key)
  );
}

function setupDraggableEditorDialogs() {
  const dialogs = [
    ["websid-play-dialog", ".websid-play-header"],
    ["sid-editor-dialog", ".sid-hdr"],
    ["sid-viz-dialog", ".sid-viz-hdr"]
  ];
  dialogs.forEach(function(entry) {
    const dialogId = entry[0];
    const dialog = document.getElementById(dialogId);
    const header = dialog?.querySelector(entry[1]);
    if (!dialog || !header || header.dataset.dragBound === "1") return;
    header.dataset.dragBound = "1";
    header.classList.add("editor-drag-handle");
    const applyPosition = function() {
      const saved = _editorDialogPositions?.[dialogId];
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        dialog.style.position = "fixed";
        dialog.style.margin = "0";
        dialog.style.transform = "none";
        // offsetWidth/Height read 0 before the dialog is actually open and
        // laid out — e.g. when a dialog's own open function calls this via
        // dialog._applyPosition() right before showModal() to avoid a
        // flash at the top-left default. Skip clamping in that case and
        // use the saved coordinates verbatim; the "toggle" listener below
        // re-runs this once real dimensions exist and clamps then.
        if (dialog.offsetWidth > 0 && dialog.offsetHeight > 0) {
          const maxX = Math.max(8, window.innerWidth - dialog.offsetWidth - 8);
          const maxY = Math.max(8, window.innerHeight - dialog.offsetHeight - 8);
          dialog.style.left = Math.max(8, Math.min(saved.left, maxX)) + "px";
          dialog.style.top = Math.max(8, Math.min(saved.top, maxY)) + "px";
        } else {
          dialog.style.left = saved.left + "px";
          dialog.style.top = saved.top + "px";
        }
      } else {
        dialog.style.position = "fixed";
        dialog.style.margin = "0";
        dialog.style.left = "50%";
        dialog.style.top = "50%";
        dialog.style.transform = "translate(-50%, -50%)";
      }
    };
    // Exposed so a dialog's own custom open function (e.g. the Block
    // Editor, opened from inside the D64 Editor rather than a plain
    // toolbar button) can position it synchronously before showModal().
    dialog._applyPosition = applyPosition;
    const persistPosition = function() {
      const rect = dialog.getBoundingClientRect();
      _editorDialogPositions[dialogId] = { left: Math.round(rect.left), top: Math.round(rect.top) };
      localStorage.setItem("va-sid-editor-positions", JSON.stringify(_editorDialogPositions));
    };
    dialog.addEventListener("toggle", function() {
      if (!dialog.open) return;
      requestAnimationFrame(function() {
        requestAnimationFrame(applyPosition);
      });
    });
    header.addEventListener("pointerdown", function(e) {
      if (e.target.closest("button, input, select, textarea, label, .ed-file-menu")) return;
      const rect = dialog.getBoundingClientRect();
      dialog.style.position = "fixed";
      dialog.style.margin = "0";
      dialog.style.transform = "none";
      dialog.style.left = rect.left + "px";
      dialog.style.top = rect.top + "px";
      // Measured once: reading the size on every move forced a layout after each
      // position write. The move itself is a GPU transform (no layout, no repaint
      // of the big dialog), committed to left / top on release. A transform on the
      // dialog would carry its fixed floating panels (tracker / VA-VK / roll) along,
      // so with those open only the card moves: they are its siblings.
      const floats = dialog.querySelector(".sid-trk-float:not([hidden]), .sid-vkbd-dialog:not([hidden])");
      _editorDialogDrag = {
        dialog,
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        x0: rect.left, y0: rect.top, x: rect.left, y: rect.top,
        maxX: Math.max(8, window.innerWidth - rect.width - 8),
        maxY: Math.max(8, window.innerHeight - rect.height - 8),
        moving: floats ? dialog.firstElementChild : dialog, raf: 0
      };
      _editorDialogDrag.moving.style.willChange = "transform";
      try { header.setPointerCapture(e.pointerId); } catch(_) {}
      e.preventDefault();
    });
    header.addEventListener("pointermove", function(e) {
      const d = _editorDialogDrag;
      if (!d || d.dialog !== dialog) return;
      d.x = Math.max(8, Math.min(e.clientX - d.dx, d.maxX));
      d.y = Math.max(8, Math.min(e.clientY - d.dy, d.maxY));
      if (d.raf) return;
      d.raf = requestAnimationFrame(function() {
        d.raf = 0;
        d.moving.style.transform = "translate3d(" + (d.x - d.x0) + "px, " + (d.y - d.y0) + "px, 0)";
      });
    });
    const endDrag = function(e) {
      const d = _editorDialogDrag;
      if (!d || d.dialog !== dialog) return;
      _editorDialogDrag = null;
      if (d.raf) cancelAnimationFrame(d.raf);
      dialog.style.left = d.x + "px";
      dialog.style.top = d.y + "px";
      dialog.style.transform = "none";
      d.moving.style.willChange = "";
      if (d.moving !== dialog) d.moving.style.transform = "";
      if (e && e.pointerId != null) { try { header.releasePointerCapture(e.pointerId); } catch(_) {} }
      persistPosition();
    };
    header.addEventListener("pointerup", endDrag);
    header.addEventListener("pointercancel", endDrag);
  });
}

// ── Shared right-click menu of the visual editors (Copy / Paste …) ──────────
// items: [{ iconFrom, label, disabled, run }]. iconFrom is the selector of a
// toolbar button whose icon the entry reuses. The menu is moved into `host`
// (the editor's <dialog>): a modal dialog covers everything outside itself.
// Puts a position:fixed menu at a viewport point, kept inside the window.
// A centred editor dialog has `transform: translate(-50%, -50%)`, which makes
// "fixed" relative to the dialog instead of the viewport; so the menu's real
// origin is measured first and subtracted. (A dragged dialog has no transform.)
function _ctxMenuPlaceAt(menu, clientX, clientY) {
  const pad = 8;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const origin = menu.getBoundingClientRect();
  const x = Math.max(pad, Math.min(clientX, window.innerWidth - origin.width - pad));
  const y = Math.max(pad, Math.min(clientY, window.innerHeight - origin.height - pad));
  menu.style.left = (x - origin.left) + "px";
  menu.style.top = (y - origin.top) + "px";
}

let _confirmResolve = null;

const _confirmDialog = document.getElementById("app-confirm-dialog");

const _confirmMsg    = document.getElementById("app-confirm-msg");

const _confirmYes    = document.getElementById("app-confirm-yes");

const _confirmNo     = document.getElementById("app-confirm-no");

function _showConfirm(msg) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    if (_confirmMsg) _confirmMsg.textContent = msg;
    _confirmDialog?.showModal();
  });
}

let _viceToastTimer = null;

function showViceToast(message, isError = false) {
  const toast = document.getElementById("vice-toast");
  const text = document.getElementById("vice-toast-text");
  if (!toast || !text) return;
  const icon = toast.querySelector(".vice-toast-icon");
  if (icon) icon.textContent = isError ? "✕" : "✓";
  text.textContent = message;
  toast.dataset.error = isError ? "1" : "";
  toast.hidden = false;
  // Top layer: the modal editor would cover it otherwise. Reopening puts it above the newest dialog.
  if (toast.matches?.(":popover-open")) toast.hidePopover();
  toast.showPopover?.();
  if (_viceToastTimer) clearTimeout(_viceToastTimer);
  _viceToastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 4000 : 3000);
}

// Settings setup runs inside initPalette, before the SID editor code below.
var _VA_SID_CORE_VERSION = "1.2";

var _sidPreviewEngine = "resid";

var _sidPreviewModel = "8580";

/* Save raw bytes to a file. Uses the native save dialog in the desktop app
   (the <a download> trick does not work inside the Tauri webview), with a
   browser blob-download fallback for dev. */
async function _saveBinFile(bytes, fileName) {
  const arr = Array.from(bytes);
  const api = window.electronAPI;
  if (api?.saveBin) {
    try { return await api.saveBin({ bytes: arr, fileName: fileName }); } catch (_) {}
  }
  if (api?.savePrg) {
    try { return await api.savePrg({ bytes: arr }); } catch (_) {}
  }
  const blob = new Blob([new Uint8Array(arr)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function setupSidPlayer() {
  const dialog = document.getElementById("websid-play-dialog");
  if (!dialog) return;
  const on = function(id, ev, fn) { document.getElementById(id)?.addEventListener(ev, fn); };
  on("sid-player-btn", "click", _sidPlayerToggle);
  on("websid-play-play", "click", _sidExtPlay);
  on("websid-play-pause", "click", _sidExtPause);
  on("websid-play-stop", "click", _sidExtStop);
  on("websid-play-prev", "click", _sidPlayerPrev);
  on("websid-play-next", "click", _sidPlayerNext);
  on("websid-play-shuffle", "click", function() { _sidPlayerSetShuffle(!_sidShuffle); });
  on("websid-play-song-prev", "click", function() { _sidPlayerSong(-1); });
  on("websid-play-song-next", "click", function() { _sidPlayerSong(1); });
  on("websid-play-rew", "click", function() { _sidExtSeek(_sidExtElapsedMs() - 10000); });
  on("websid-play-fwd", "click", function() { _sidExtSeek(_sidExtElapsedMs() + 10000); });
  on("websid-play-close", "click", function() { dialog.close(); });
  const fileInput = document.getElementById("websid-play-files");
  on("websid-play-add", "click", function() { fileInput?.click(); });
  fileInput?.addEventListener("change", async function() {
    await _sidPlayerAddFiles(fileInput.files, false);
    fileInput.value = "";
  });
  on("websid-play-clear", "click", _sidPlayerClear);
  on("websid-play-hvsc", "click", function() { _hvscSetOpen(!_hvscOpen()); });
  on("websid-hvsc-random", "click", _hvscShowRandom);
  on("websid-hvsc-add-all", "click", _hvscAddAll);
  on("websid-hvsc-refresh", "click", function() { _hvscLoad(true); });
  on("websid-hvsc-folder", "click", _hvscToggleFolder);
  on("websid-hvsc-download", "click", _hvscDownloadAll);
  window.electronAPI?.onHvscProgress?.(function(p) {
    if (!_hvscDownload || !p) return;
    _hvscDownload = { phase: p.phase, done: Number(p.done) || 0, total: Number(p.total) || 0 };
    _hvscRender();
  });
  on("websid-hvsc-link", "click", function() { window.electronAPI?.openExternal("https://www.hvsc.c64.org/"); });
  let hvscSearchTimer = null;
  on("websid-hvsc-search", "input", function() {
    clearTimeout(hvscSearchTimer);
    hvscSearchTimer = setTimeout(_hvscRunSearch, 150);
  });
  on("websid-hvsc-field", "change", function() {
    _hvscFieldSync();
    _hvscRunSearch();
    document.getElementById("websid-hvsc-search")?.focus();
  });
  on("websid-hvsc-search", "keydown", function(e) {
    if (e.key === "Enter" && _hvscResults.length) { e.preventDefault(); _hvscAddEntry(_hvscResults[0], true); }
  });
  document.getElementById("websid-hvsc-list")?.addEventListener("click", function(e) {
    const li = e.target.closest(".websid-hvsc-item");
    const entry = li && _hvscResults[Number(li.dataset.index)];
    if (!entry) return;
    if (e.target.closest(".websid-hvsc-item-save")) _hvscSaveEntry(entry);
    else _hvscAddEntry(entry, !e.target.closest(".websid-hvsc-item-add"));
  });
  _sidKnobBind(document.getElementById("websid-play-vol"),
    function() { return Math.round(_sidMasterVol * 100); },
    function(pct) { _sidSetMasterVolume(pct); });
  on("websid-play-save-list", "click", _sidPlayerSavePlaylist);
  const listInput = document.getElementById("websid-play-list-file");
  on("websid-play-open-list", "click", function() { listInput?.click(); });
  listInput?.addEventListener("change", async function() {
    const file = listInput.files?.[0];
    listInput.value = "";
    if (file) await _sidPlayerAddFiles([file], false);
  });
  const seek = document.getElementById("websid-play-seek");
  seek?.addEventListener("input", function() {
    _sidSeekDragging = true;
    const time = document.getElementById("websid-play-time");
    if (time) time.textContent = _sidExtFormatTime(Number(seek.value) * 1000);
  });
  seek?.addEventListener("change", function() {
    _sidSeekDragging = false;
    _sidExtSeek(Number(seek.value) * 1000);
  });
  document.getElementById("websid-play-list")?.addEventListener("click", function(e) {
    const li = e.target.closest(".websid-play-item");
    if (!li) return;
    if (e.target.closest(".websid-play-item-del")) { _sidPlayerRemove(li.dataset.id); return; }
    if (e.target.closest(".websid-play-item-fav")) {
      const item = _sidPlaylist.find(function(it) { return it.id === li.dataset.id; });
      if (item) { item.fav = !item.fav; _sidPlayerRenderList(); _sidPlayerPersist(); }
      return;
    }
    _sidPlayerPlayIndex(_sidPlaylist.findIndex(function(item) { return item.id === li.dataset.id; }));
  });
  // dragover must be prevented on the whole card or the WebView opens the file
  const card = dialog.querySelector(".websid-play-card");
  const body = dialog.querySelector(".websid-play-body");
  let dragDepth = 0;
  card?.addEventListener("dragenter", function(e) { e.preventDefault(); dragDepth++; body?.classList.add("websid-play-dragover"); });
  card?.addEventListener("dragover", function(e) { e.preventDefault(); });
  card?.addEventListener("dragleave", function() {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) body?.classList.remove("websid-play-dragover");
  });
  card?.addEventListener("drop", function(e) {
    e.preventDefault();
    dragDepth = 0;
    body?.classList.remove("websid-play-dragover");
    _sidPlayerAddFiles(e.dataTransfer?.files, false);
  });
  // a non-modal dialog gets no "cancel" from Esc
  dialog.addEventListener("keydown", function(e) {
    if (e.key === "Escape") { e.preventDefault(); dialog.close(); }
  });
  // Every way of closing (×, Esc, the toolbar button) ends the playback.
  dialog.addEventListener("close", function() {
    // the event is queued: the window may have been reopened since
    if (dialog.open) return;
    if (_sidExtStatus !== "stopped") _sidExtStop();
    _sidPlayerSyncButton();
    _sidPlayerPersist();
    // the spectrum window belongs to the player: it closes with it and comes
    // back with it (on top, so the player does not cover its header)
    const viz = document.getElementById("sid-viz-dialog");
    if (viz?.open) { _sidVizWithPlayer = true; viz.close(); }
  });
  // runs before the _sidPlaylist state is declared (TDZ), so restore after the script has loaded
  setTimeout(function() {
    _sidLoadMasterVolume();
    _sidPlayerRestore();
    _hvscRestore();
    setupSidVisualizer();
  }, 0);
}

/* Generic open/close wiring for all editor File menus (.ed-file). The menu
   items keep their original ids/data-attrs so existing handlers stay bound. */
function _setupFileMenus() {
  const allMenus = function() { return document.querySelectorAll(".ed-file-menu"); };
  document.querySelectorAll(".ed-file").forEach(function(wrap) {
    const btn = wrap.querySelector(".ed-file-btn");
    const menu = wrap.querySelector(".ed-file-menu");
    if (!btn || !menu) return;
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      const willOpen = menu.hidden;
      allMenus().forEach(function(m) { m.hidden = true; });
      menu.hidden = !willOpen;
    });
    menu.addEventListener("click", function(e) { e.stopPropagation(); });
    menu.querySelectorAll("button").forEach(function(b) {
      b.addEventListener("click", function() { menu.hidden = true; });
    });
  });
  document.addEventListener("click", function() {
    allMenus().forEach(function(m) { m.hidden = true; });
  });
}

/* =======================================================
   SID EDITOR / PLAYER (3 or 6 voice tracker, Web Audio preview)
   ======================================================= */
const _SID_ROWS = 32;

let _sidInsts = null;

// instruments
let _sidPatterns = null;

// [pattern][voice 0..2, or 0..5 with a second SID][row 0..31] = {note, inst}
let _sidInst = 0, _sidPat = 0, _sidSpeed = 6;

let _sidMetronomeEnabled = false;

let _sidMetroCtx = null;

const _SID_ROWS_PER_BEAT = 4;

const _SID_BEATS_PER_BAR = 4;

let _sidMasterVol = 0.6;

// 0..1
function _sidLoadPreviewSettings() {
  try {
    const savedEngine = localStorage.getItem("c64va-sid-preview-engine");
    // a saved "websid" (no longer in the app) gets the default
    if (savedEngine === "resid" || savedEngine === "va-core") _sidPreviewEngine = savedEngine;
    const savedModel = localStorage.getItem("c64va-sid-preview-model");
    if (savedModel === "6581" || savedModel === "8580") _sidPreviewModel = savedModel;
  } catch (_) {}
  const engineEl = document.getElementById("sid-preview-engine");
  if (engineEl) engineEl.value = _sidPreviewEngine;
  const modelEl = document.getElementById("sid-preview-model");
  if (modelEl) modelEl.value = _sidPreviewModel;
  _sidEditorEngineSync();
  _sidLcdApplyColor();
}

let _sidMasterGain = null;

// shared GainNode injected between _sidPlayInst output and destination
let _sidSel = { voice: 0, row: 0 };

let _sidSelAnchor = null;

// { voice, row } anchor for rectangular range selection
let _sidClipboard = null;

// copied voice column: array of 32 {note, inst}
let _sidCellClip = null;

// cell-range clipboard: [{note,inst},...] from Ctrl+C
let _sidAudio = null;
// The SID Player's own context: its Pause suspends it, and nothing else may wake it up.
// On the shared one every editor note and every rendered chunk undid the pause.
let _sidExtAudio = null, _sidExtGain = null, _sidVizExt = null;

var _sidTimer = null, _sidRow = 0, _sidPlayPat = 0;
// "Play: All" follows the song in the tracker; Stop returns to what was open before it
var _sidPlayReturn = null;

// AudioBufferSourceNodes of the rendered preview (note previews and the
// Web Audio pattern playback) — _sidStop stops them all.
var _sidPreviewSources = new Set();

// The SID Player's (VA SID Core) scheduled buffers: kept apart, so stopping the
// editor preview (e.g. closing the SID Editor) does not silence the player.
var _sidExtSources = new Set();

// Web Audio pattern playback: engine kept across pattern passes + scheduling state
var _sidWaPlay = null;

// Song/order list: the arrangement layer on top of the raw pattern bank
// (_sidPatterns). Playback and export walk THIS list, not _sidPatterns
// directly, so a pattern can repeat and the song can be longer than the
// pattern bank. _sidSong holds pattern indices; _sidSongPos is the
// order-slot currently selected for editing (+/-/move act on it);
// _sidSongPlayPos is the order-slot currently sounding during "Play All"
// (only meaningful while playing — drives the chip highlight).
let _sidSong = [0];

let _sidSongPos = 0;

let _sidSongPlayPos = 0;

let _sidInited = false;

let _sidOctave = 4;

var _sidPaused = false;


let _sidVkbdDrag = null;

let _sidVkbdInsertMode = true;

let _sidMidiAccess = null;

let _sidMidiInputId = "";

let _sidMidiHeld = new Set();
var _sidMidiPoly; // no initializer: setupSidEditor loads it before this line runs

let _sidRecording = null;

// SID attack / decay-release time tables (ms) — approximate
const _SID_ATK = [2,8,16,24,38,56,68,80,100,250,500,800,1000,3000,5000,8000];

const _SID_DCR = [6,24,48,72,114,168,204,240,300,750,1500,2400,3000,9000,15000,24000];

function _sidNewInst(name) {
  return { name: name || t("sidNewInstrumentName"), tri:false, saw:false, pul:true, noi:false, ring:false, sync:false,
           pw:2048, a:2, d:8, s:6, r:4, lp:false, bp:false, hp:false, cut:1400, res:0, vol:15, songVol:true,
           // filter: route this voice, voice 3 off, cutoff sweep toward cutEnd (cutSpeed/frame, 0 = static)
           filt:false, off3:false, cutEnd:1400, cutSpeed:0, cutPing:false,
           // instrument vibrato (LFO) and pulse width modulation, both per frame
           vibDelay:0, vibSpeed:0, vibDepth:0, pwmSpeed:0, pwmMin:512, pwmMax:3584,
           // gate timer / hard restart before the next note, waveform of the note's first frame
           gateTimer:0, hr:false, firstWave:0,
           // wave / arpeggio table: steps {w: waveform (0 = keep), n: note offset, abs: absolute note}
           table:[], tableLoop:-1, tableSpeed:1 };
}

/* Fills in missing fields (older saves / exports) and clamps every value to
   what the player can store. Instruments from before the filter routing flag
   routed through the filter whenever a filter mode was set. */
function _sidInstNorm(ins) {
  const src = ins || {};
  const o = Object.assign(_sidNewInst(src.name), src);
  // a partial waveform spec means "only these": no default pulse added
  if (["tri", "saw", "pul", "noi"].some(function(k){ return src[k] !== undefined; })) {
    ["tri", "saw", "pul", "noi"].forEach(function(k){ o[k] = !!src[k]; });
  }
  if (src.filt === undefined) o.filt = !!(o.lp || o.bp || o.hp);
  if (src.cutEnd === undefined) o.cutEnd = o.cut;
  // instruments from before the song volume set the chip's volume themselves
  if (src.songVol === undefined) o.songVol = false;
  const cl = function(v, lo, hi) { v = Number(v) | 0; return v < lo ? lo : v > hi ? hi : v; };
  ["tri","saw","pul","noi","ring","sync","lp","bp","hp","filt","off3","cutPing","hr","songVol"].forEach(function(k){ o[k] = !!o[k]; });
  o.pw = cl(o.pw, 0, 4095); o.a = cl(o.a, 0, 15); o.d = cl(o.d, 0, 15); o.s = cl(o.s, 0, 15); o.r = cl(o.r, 0, 15);
  o.cut = cl(o.cut, 0, 2047); o.cutEnd = cl(o.cutEnd, 0, 2047); o.cutSpeed = cl(o.cutSpeed, 0, 127);
  o.res = cl(o.res, 0, 15); o.vol = cl(o.vol, 0, 15);
  o.vibDelay = cl(o.vibDelay, 0, 255); o.vibSpeed = cl(o.vibSpeed, 0, 15); o.vibDepth = cl(o.vibDepth, 0, 15);
  o.pwmSpeed = cl(o.pwmSpeed, 0, 255); o.pwmMin = cl(o.pwmMin, 0, 4095); o.pwmMax = cl(o.pwmMax, 0, 4095);
  o.gateTimer = cl(o.gateTimer, 0, 15); o.firstWave = cl(o.firstWave, 0, 255);
  o.tableSpeed = cl(o.tableSpeed, 1, 15);
  o.table = (Array.isArray(o.table) ? o.table : []).slice(0, 32).map(function(s) {
    const abs = !!(s && s.abs);
    return { w: cl(s && s.w, 0, 255), n: abs ? cl(s && s.n, 0, 95) : cl(s && s.n, -96, 95), abs: abs };
  });
  o.tableLoop = cl(o.tableLoop, -1, o.table.length - 1);
  return o;
}

/* Control register without the gate bit: waveform, ring mod, sync. */
function _sidInstCtrl(ins) {
  return (ins.tri?0x10:0) | (ins.saw?0x20:0) | (ins.pul?0x40:0) | (ins.noi?0x80:0) | (ins.ring?0x04:0) | (ins.sync?0x02:0);
}

// Address of the second SID: what a PSID v3 header can state ($D420-$D7E0, $DE00-$DFE0).
var _sidSid2Addr = 0xD420;

function _sidSid2Addrs() {
  const out = [];
  for (let a = 0xD420; a <= 0xD7E0; a += 0x20) out.push(a);
  for (let a = 0xDE00; a <= 0xDFE0; a += 0x20) out.push(a);
  return out;
}

// A tune has 3 voices, or 6 with a second SID: the width of its patterns tells which.
function _sidVoiceCount() {
  return _sidPatterns && _sidPatterns[0] ? _sidPatterns[0].length : 3;
}

function _sidNewPattern(voices = _sidVoiceCount()) {
  const p = [];
  for (let v = 0; v < voices; v++) { const col = []; for (let r = 0; r < _SID_ROWS; r++) col.push({ note:null, inst:0, fx:null, fxval:0 }); p.push(col); }
  return p;
}

// Switches the tune between one and two SIDs; dropping the second one loses its voices.
async function _sidSetSidCount(count) {
  const voices = count * 3;
  if (voices === _sidVoiceCount()) return;
  const used = voices < _sidVoiceCount() && _sidPatterns.some(function(pat) {
    return pat.slice(voices).some(function(col) { return col.some(function(c) { return c.note != null || c.fx; }); });
  });
  if (used && !(await _showConfirm(t("sidChipsDropConfirm")))) { _sidBuildTracker(); return; }
  _sidStop();
  _sidPatterns.forEach(function(pat) {
    pat.length = Math.min(pat.length, voices);
    while (pat.length < voices) pat.push(_sidNewPattern(1)[0]);
  });
  _sidBuildTracker();
}

function _sidCurInst() { return _sidInsts[_sidInst]; }

function _sidCurPat() { return _sidPatterns[_sidPat]; }

function _sidSyncPlayModeSel() {
  const sel = document.getElementById("sid-play-mode");
  if (sel) sel.value = _sidPlayMode;
}

function _sidSetPattern(index, rebuildTracker) {
  if (!_sidPatterns || !_sidPatterns.length) return;
  _sidPat = Math.max(0, Math.min(_sidPatterns.length - 1, index|0));
  const sel = document.getElementById("sid-pat-sel");
  if (sel) sel.value = _sidPat;
  if (rebuildTracker) _sidBuildTracker();
}

// ---- Song / order list -----------------------------------------------
// _sidSong is the arrangement: an array of pattern indices, played back in
// order (and looping). A pattern can appear more than once, so a song can
// reuse a verse/chorus pattern instead of needing a full copy per repeat.
function _sidBuildSongList() {
  const wrap = document.getElementById("sid-song-list");
  if (!wrap || !_sidSong) return;
  wrap.innerHTML = "";
  const playing = !!_sidTimer && !_sidPaused;
  _sidSong.forEach(function(patIdx, pos) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "sid-song-chip" +
      (pos === _sidSongPos ? " sid-song-chip--selected" : "") +
      (playing && pos === _sidSongPlayPos ? " sid-song-chip--playing" : "");
    chip.textContent = (patIdx < 10 ? "0" : "") + patIdx;
    chip.setAttribute("aria-label", tf("sidSongSlot", { pos: pos, pat: patIdx }));
    chip.addEventListener("click", function() {
      _sidSongPos = pos;
      _sidSetPattern(patIdx, true);
      _sidBuildSongList();
    });
    wrap.appendChild(chip);
  });
}

// Inserts the pattern currently open in the editor (_sidPat) right after
// the selected order slot — "add to song" rather than "create a pattern"
// (that's still the separate Pat +  button), so building an arrangement
// never disturbs the pattern bank.
function _sidSongInsert() {
  if (!_sidSong) _sidSong = [];
  const at = Math.min(_sidSong.length, _sidSongPos + 1);
  _sidSong.splice(at, 0, _sidPat);
  _sidSongPos = at;
  _sidBuildSongList();
}

// Az aktuális pattern törlése a bankból; a song hivatkozásai átszámozódnak, legalább egy pattern marad
async function _sidPatternDelete() {
  if (!_sidPatterns || _sidPatterns.length <= 1) return;
  const del = _sidPat;
  const used = _sidPatterns[del].some(function(col){ return col.some(function(c){ return c.note != null || c.fx; }); });
  if (used && !await _showConfirm(tf("sidDeletePatternConfirm", { pat: (del < 10 ? "0" : "") + del }))) return;
  if (_sidRecording) _sidRecordStop();
  _sidStop();
  _sidPatterns.splice(del, 1);
  const song = [];
  _sidSong.forEach(function(idx, pos) {
    if (idx === del) { if (pos < _sidSongPos) _sidSongPos--; return; }
    song.push(idx > del ? idx - 1 : idx);
  });
  _sidSong = song.length ? song : [0];
  _sidSongPos = Math.max(0, Math.min(_sidSongPos, _sidSong.length - 1));
  _sidBuildPatSel();
  _sidSetPattern(Math.min(del, _sidPatterns.length - 1), true);
  _sidBuildSongList();
}

function _sidSongRemove() {
  if (!_sidSong || _sidSong.length <= 1) return; // always keep at least one slot
  _sidSong.splice(_sidSongPos, 1);
  _sidSongPos = Math.max(0, Math.min(_sidSongPos, _sidSong.length - 1));
  _sidBuildSongList();
}

function _sidSongMove(delta) {
  if (!_sidSong) return;
  const to = _sidSongPos + delta;
  if (to < 0 || to >= _sidSong.length) return;
  const tmp = _sidSong[_sidSongPos];
  _sidSong[_sidSongPos] = _sidSong[to];
  _sidSong[to] = tmp;
  _sidSongPos = to;
  _sidBuildSongList();
}

const _SID_NOTE_NAMES = ["C-","C#","D-","D#","E-","F-","F#","G-","G#","A-","A#","B-"];

const _SID_CHORD_INTERVALS = {
  major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6], augmented: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], dominant7: [0, 4, 10], major7: [0, 4, 11], minor7: [0, 3, 10],
  sixth: [0, 4, 7, 9], minor6: [0, 3, 7, 9], ninth: [0, 4, 7, 10, 14], flat9: [0, 4, 7, 10, 13],
  sharp9: [0, 4, 7, 10, 15], dim7: [0, 3, 6, 9], sus47: [0, 5, 7, 10]
};

function _sidNoteName(n) {
  if (n == null) return "...";
  return _SID_NOTE_NAMES[n % 12] + Math.floor(n / 12);
}

function _sidNoteFreq(n) { return 440 * Math.pow(2, (n - 57) / 12); }

// The tune's volume (0-15) and timing (NTSC = 60 Hz frames, the NTSC clock). No initializer:
// setupSidEditor runs before these lines; undefined reads as the default.
var _sidSongVol;
var _sidSongVol2;
var _sidNtsc;
function _sidVol() { return typeof _sidSongVol === "number" ? _sidSongVol : 15; }
// the second SID's volume (two-SID tunes); unset = the first one's
function _sidVol2() { return typeof _sidSongVol2 === "number" ? _sidSongVol2 : _sidVol(); }
function _sidIsNtsc() { return typeof _sidNtsc !== "undefined" && !!_sidNtsc; }
function _sidFps() { return _sidIsNtsc() ? 60 : 50; }
function _sidClockHz() { return _sidIsNtsc() ? 1022730 : 985248; }

// n: 0 = C-0
function _sidMidiRefreshInputs() {
  const select = document.getElementById("sid-midi-input");
  if (!select || !_sidMidiAccess) return;
  const old = _sidMidiInputId || select.value;
  select.innerHTML = '<option value="">' + t("sidMidiNone") + '</option>';
  _sidMidiAccess.inputs.forEach(function(input) {
    const option = document.createElement("option");
    option.value = input.id;
    option.textContent = input.name || input.manufacturer || input.id;
    select.appendChild(option);
  });
  const wanted = _sidMidiAccess.inputs.has(old) ? old : (_sidMidiAccess.inputs.keys().next().value || "");
  select.value = wanted;
  _sidMidiSetInput(wanted);
}

function _sidMidiSetInput(id) {
  if (_sidMidiAccess) _sidMidiAccess.inputs.forEach(function(input) { input.onmidimessage = null; });
  _sidMidiInputId = id || "";
  const input = _sidMidiAccess?.inputs.get(_sidMidiInputId);
  if (input) input.onmidimessage = _sidMidiMessage;
  try { localStorage.setItem("c64va-sid-midi-input", _sidMidiInputId); } catch (_) {}
}

let _sidMidiLedTimer = null;

function _sidMidiFlash() {
  const led = document.getElementById("sid-midi-led");
  if (!led) return;
  led.classList.add("sid-midi-led--on");
  clearTimeout(_sidMidiLedTimer);
  _sidMidiLedTimer = setTimeout(function(){ led.classList.remove("sid-midi-led--on"); }, 80);
}

function _sidMidiMessage(event) {
  const data = event.data || [];
  // Clock / active sensing (real-time üzenetek) nem villantja a lámpát
  if (data.length && data[0] < 0xF8) _sidMidiFlash();
  const command = data[0] & 0xf0;
  const midiNote = data[1];
  const velocity = data[2] || 0;
  if (!Number.isFinite(midiNote)) return;
  const note = Math.max(0, Math.min(95, midiNote - 12)); // MIDI C-1 = SID C-0
  if (command === 0x80 || (command === 0x90 && velocity === 0)) {
    _sidMidiHeld.delete(midiNote);
    _sidRecordPolyRelease(midiNote);
    return;
  }
  if (command !== 0x90 || _sidMidiHeld.has(midiNote)) return;
  _sidMidiHeld.add(midiNote);
  const dialog = document.getElementById("sid-editor-dialog");
  if (!dialog?.open || !_sidInited) return;
  if (_sidRecording && _sidMidiPoly) _sidRecordPolyNote(note, midiNote);
  else if (_sidRecording || _sidVkbdInsertMode) {
    _sidInsertNoteAtSelection(note, true);
    if (typeof _sidHistSchedule === "function") _sidHistSchedule();
  } else {
    _sidEnsureAudio();
    _sidPlayInst(_sidCurInst(), _sidNoteFreq(note), _sidAudio.currentTime + 0.01, 0.7);
    _sidFlashVirtualKeyboardNotes([note]);
  }
}

async function _sidMidiConnect() {
  if (!navigator.requestMIDIAccess) {
    showViceToast(t("sidMidiUnavailable"), true);
    return;
  }
  try {
    _sidMidiAccess = await navigator.requestMIDIAccess();
    try { _sidMidiInputId = localStorage.getItem("c64va-sid-midi-input") || ""; } catch (_) {}
    _sidMidiAccess.onstatechange = _sidMidiRefreshInputs;
    _sidMidiRefreshInputs();
    if (!_sidMidiInputId) showViceToast(t("sidMidiNone"), true);
  } catch (error) {
    showViceToast(t("sidMidiDenied") + ": " + (error?.message || error), true);
  }
}

function _sidInsertNoteAtSelection(note, advanceRow) {
  if (_sidRecordNote(note)) return;
  if (!_sidPatterns) return;
  const row = _sidSel.row, voice = _sidSel.voice;
  _sidSelAnchor = null;
  _sidCurPat()[voice][row] = { note: note, inst: _sidInst, fx: null, fxval: 0 };
  _sidSetCellText(voice, row);
  _sidEnsureAudio();
  _sidPlayInst(_sidCurInst(), _sidNoteFreq(note), _sidAudio.currentTime + 0.01, 0.25);
  if (advanceRow) _sidSel.row = (_sidSel.row + 1) % _SID_ROWS;
  _sidRefreshSel();
}

function _sidRenderVirtualKeyboard() {
  const board = document.getElementById("sid-vkbd-board");
  const octVal = document.getElementById("sid-vkbd-octave-val");
  const insertToggle = document.getElementById("sid-vkbd-insert");
  if (!board) return;
  if (octVal) octVal.textContent = _sidOctave;
  if (insertToggle) insertToggle.checked = _sidVkbdInsertMode;
  let octaves = 2;
  try { octaves = Number(localStorage.getItem("c64va-sid-vkbd-octaves")) || 2; } catch (_) {}
  octaves = Math.max(2, Math.min(4, octaves));
  const octSel = document.getElementById("sid-vkbd-octaves");
  if (octSel) octSel.value = String(octaves);
  // same key size for every range: more octaves make a wider instrument
  const W = 48, B = 30, label = true;
  const whites = [], blacks = [];
  for (let o = 0; o < octaves; o++) {
    [0, 2, 4, 5, 7, 9, 11].forEach(function(semi){ whites.push(o * 12 + semi); });
    [1, 3, 6, 8, 10].forEach(function(semi){ blacks.push(o * 12 + semi); });
  }
  // keep the whole range inside C-0..B-7; the closing C (like a real keyboard) only if it exists
  const baseOct = Math.max(0, Math.min(_sidOctave, 8 - octaves));
  if ((baseOct + octaves) * 12 < 96) whites.push(octaves * 12);
  let html = "";
  whites.forEach(function(semi, index) {
    const note = baseOct * 12 + semi;
    const name = label || semi % 12 === 0 ? _sidNoteName(note) : "";
    html += '<button type="button" class="sid-vkbd-key sid-vkbd-key--white" data-note="' + note + '" style="left:' + (index * W) + 'px;width:' + W + 'px">'
      + '<span class="sid-vkbd-note">' + name + '</span></button>';
  });
  blacks.forEach(function(semi) {
    const note = baseOct * 12 + semi;
    // a black key sits on the boundary after the white key below it
    const whiteBelow = whites.indexOf(semi - 1);
    html += '<button type="button" class="sid-vkbd-key sid-vkbd-key--black" data-note="' + note + '" style="left:' + ((whiteBelow + 1) * W - B / 2) + 'px;width:' + B + 'px">'
      + '<span class="sid-vkbd-note">' + (label ? _sidNoteName(note) : "") + '</span></button>';
  });
  board.innerHTML = html;
  board.style.width = (whites.length * W + 2) + "px";
  board.querySelectorAll(".sid-vkbd-key").forEach(function(btn) {
    btn.addEventListener("click", function() {
      const note = parseInt(btn.dataset.note, 10);
      if (!Number.isFinite(note)) return;
      if (_sidRecording || _sidVkbdInsertMode) _sidInsertNoteAtSelection(note, true);
      else {
        _sidEnsureAudio();
        _sidPlayInst(_sidCurInst(), _sidNoteFreq(note), _sidAudio.currentTime + 0.01, 0.25);
      }
      btn.classList.add("sid-vkbd-key--active");
      setTimeout(function(){ btn.classList.remove("sid-vkbd-key--active"); }, 120);
    });
  });
  _sidVkbdRenderPlay();
}

/* Detachable tracker: the song / tracker / harmony rows and the grid move into
   a floating, resizable panel (and back), so a long wave table leaves room. */
function _sidTrackerFloatState() {
  try { return JSON.parse(localStorage.getItem("c64va-sid-tracker-float") || "{}") || {}; } catch (_) { return {}; }
}

function _sidSaveTrackerFloat(patch) {
  const st = Object.assign(_sidTrackerFloatState(), patch);
  try { localStorage.setItem("c64va-sid-tracker-float", JSON.stringify(st)); } catch (_) {}
}

function _sidSetTrackerDetached(on) {
  const section = document.getElementById("sid-tracker-section");
  const dock = document.getElementById("sid-tracker-dock");
  const float = document.getElementById("sid-tracker-float");
  const body = document.getElementById("sid-trk-float-body");
  if (!section || !dock || !float || !body) return;
  document.getElementById("sid-editor-dialog")?.classList.toggle("sid-dialog--trk-detached", !!on);
  if (on) {
    const st = _sidTrackerFloatState();
    if (Number.isFinite(st.width)) float.style.width = st.width + "px";
    if (Number.isFinite(st.height)) float.style.height = st.height + "px";
    body.appendChild(section);
    float.hidden = false;
    const x = Number.isFinite(st.left) ? st.left : 60, y = Number.isFinite(st.top) ? st.top : 60;
    _sidPlaceTrackerFloat(x, y);
    // the editor shrinks once laid out (and moves when centered): place it again
    requestAnimationFrame(function() { _sidPlaceTrackerFloat(x, y); });
  } else {
    dock.appendChild(section);
    float.hidden = true;
  }
  _sidSyncDetachBtn();
  _sidSaveTrackerFloat({ detached: !!on });
}

function _sidTrackerIsDetached() {
  const float = document.getElementById("sid-tracker-float");
  return !!float && !float.hidden;
}

// One toolbar button, both directions: it stays in the tracker when that floats.
function _sidSyncDetachBtn() {
  const btn = document.getElementById("sid-tracker-detach");
  if (!btn) return;
  if (!btn._detachIcon) btn._detachIcon = btn.innerHTML;
  const on = _sidTrackerIsDetached();
  btn.innerHTML = on ? document.getElementById("sid-tracker-attach").innerHTML : btn._detachIcon;
  btn.setAttribute("aria-label", t(on ? "sidTrackerAttach" : "sidTrackerDetach"));
}

/* x / y are viewport coordinates. The SID dialog is centered with a transform,
   so it is the containing block of this fixed panel: subtract its origin. */
function _sidPlaceTrackerFloat(x, y) {
  return _sidPlaceFixed(document.getElementById("sid-tracker-float"), x, y);
}

// A drag moves a floating panel with a GPU transform (measured once: no layout per move);
// _sidDragFlush commits the last position to left / top when the drag ends.
function _sidDragTo(state, el, x, y) {
  if (!state.box) {
    const r = el.getBoundingClientRect();
    state.box = { x: r.left, y: r.top, maxX: window.innerWidth - r.width - 8, maxY: window.innerHeight - r.height - 8 };
    el.style.willChange = "transform";
  }
  state.tx = Math.max(8, Math.min(x, state.box.maxX));
  state.ty = Math.max(8, Math.min(y, state.box.maxY));
  if (state.raf) return;
  state.raf = requestAnimationFrame(function() {
    state.raf = 0;
    el.style.transform = "translate3d(" + (state.tx - state.box.x) + "px, " + (state.ty - state.box.y) + "px, 0)";
  });
}

function _sidDragFlush(state, el) {
  if (!state || !state.box) return;
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  el.style.transform = "";
  el.style.willChange = "";
  state.at = _sidPlaceFixed(el, state.tx, state.ty);
  state.box = null;
}

function _sidPlaceFixed(float, x, y) {
  // a closed dialog has no layout to measure; the open handler places it
  if (!float || float.hidden || !document.getElementById("sid-editor-dialog")?.open) return;
  const cs = getComputedStyle(float), r = float.getBoundingClientRect();
  const ox = r.left - (parseFloat(cs.left) || 0), oy = r.top - (parseFloat(cs.top) || 0);
  const vx = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
  const vy = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
  float.style.left = (vx - ox) + "px";
  float.style.top = (vy - oy) + "px";
  return { x: vx, y: vy };
}

function _sidRestoreTrackerFloat() {
  const float = document.getElementById("sid-tracker-float");
  if (!float || float.hidden) return;
  const st = _sidTrackerFloatState();
  _sidPlaceTrackerFloat(Number.isFinite(st.left) ? st.left : 60, Number.isFinite(st.top) ? st.top : 60);
}

function _sidClampTrackerFloat() {
  const float = document.getElementById("sid-tracker-float");
  if (!float || float.hidden) return;
  const r = float.getBoundingClientRect();
  _sidPlaceTrackerFloat(r.left, r.top);
}

function _sidSetupTrackerFloat() {
  const float = document.getElementById("sid-tracker-float");
  const hdr = float && float.querySelector(".sid-trk-float-hdr");
  if (!float || !hdr) return;
  let drag = null;
  hdr.addEventListener("pointerdown", function(e) {
    if (e.target.closest("button")) return;
    const rect = float.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    try { hdr.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  hdr.addEventListener("pointermove", function(e) {
    if (!drag) return;
    _sidDragTo(drag, float, e.clientX - drag.dx, e.clientY - drag.dy);
  });
  const end = function(e) {
    if (!drag) return;
    _sidDragFlush(drag, float);
    const at = drag.at;
    drag = null;
    if (e && e.pointerId != null) { try { hdr.releasePointerCapture(e.pointerId); } catch (_) {} }
    if (at) _sidSaveTrackerFloat({ left: at.x, top: at.y });
  };
  hdr.addEventListener("pointerup", end);
  hdr.addEventListener("pointercancel", end);
  // the CSS resize handle: save the size the user dragged to when the pointer is
  // released (not on every layout change — a closed dialog would report 0 × 0)
  let sizeAtDown = null;
  float.addEventListener("pointerdown", function() {
    sizeAtDown = { w: float.offsetWidth, h: float.offsetHeight };
  });
  window.addEventListener("pointerup", function() {
    if (!sizeAtDown) return;
    const w = float.offsetWidth, h = float.offsetHeight;
    if (w > 0 && h > 0 && (w !== sizeAtDown.w || h !== sizeAtDown.h)) _sidSaveTrackerFloat({ width: w, height: h });
    sizeAtDown = null;
  });
  window.addEventListener("resize", _sidClampTrackerFloat);
}

/* VA-VK settings (position, open, octave, insert mode) live in
   c64va-sid-vkbd; the number of octaves in c64va-sid-vkbd-octaves. */
function _sidVkbdState() {
  try { return JSON.parse(localStorage.getItem("c64va-sid-vkbd") || "{}") || {}; } catch (_) { return {}; }
}

function _sidSaveVkbdState(patch) {
  try { localStorage.setItem("c64va-sid-vkbd", JSON.stringify(Object.assign(_sidVkbdState(), patch))); } catch (_) {}
}

function _sidOpenVirtualKeyboard(remember = true) {
  const dlg = document.getElementById("sid-virtual-keyboard-dialog");
  if (!dlg) return;
  _sidRenderVirtualKeyboard();
  dlg.hidden = false;
  const st = _sidVkbdState();
  if (Number.isFinite(st.left) && Number.isFinite(st.top)) _sidPlaceFixed(dlg, st.left, st.top);
  if (remember) _sidSaveVkbdState({ open: true });
}

/* remember = false: the SID editor closes, the keyboard reopens with it */
function _sidCloseVirtualKeyboard(remember = true) {
  const dlg = document.getElementById("sid-virtual-keyboard-dialog");
  if (!dlg) return;
  dlg.hidden = true;
  if (remember) _sidSaveVkbdState({ open: false });
}

// VA-VK "Show playback": the note sounding on each voice of the playing song is
// marked on its key (one colour per voice). Fed by the playback row events.
var _sidVkbdShowPlay = true;

var _sidVkbdPlayNotes = [null, null, null];

function _sidVkbdTrackRow(ev) {
  const pat = _sidPatterns && _sidPatterns[ev.pat != null ? ev.pat : _sidPlayPat];
  if (!pat) return;
  for (let v = 0; v < pat.length; v++) {
    const c = pat[v] && pat[v][ev.row];
    if (!c) continue;
    if (c.note != null) _sidVkbdPlayNotes[v] = c.note;
    else if (c.fx === "C") _sidVkbdPlayNotes[v] = null;
  }
  _sidVkbdRenderPlay();
}

function _sidVkbdRenderPlay() {
  const dlg = document.getElementById("sid-virtual-keyboard-dialog");
  if (!dlg) return;
  dlg.querySelectorAll(".sid-vkbd-key--v1, .sid-vkbd-key--v2, .sid-vkbd-key--v3").forEach(function(k) {
    k.classList.remove("sid-vkbd-key--v1", "sid-vkbd-key--v2", "sid-vkbd-key--v3");
  });
  if (!_sidVkbdShowPlay) return;
  _sidVkbdPlayNotes.forEach(function(note, v) {
    if (note == null) return;
    const key = dlg.querySelector('.sid-vkbd-key[data-note="' + note + '"]');
    if (key) key.classList.add("sid-vkbd-key--v" + (v % 3 + 1));
  });
}

function _sidVkbdClearPlay() {
  _sidVkbdPlayNotes = [null, null, null];
  _sidVkbdRenderPlay();
}

function _sidFlashVirtualKeyboardNotes(notes) {
  const dlg = document.getElementById("sid-virtual-keyboard-dialog");
  if (!dlg || dlg.hidden || !Array.isArray(notes)) return;
  notes.forEach(function(note) {
    const key = dlg.querySelector('.sid-vkbd-key[data-note="' + note + '"]');
    if (!key) return;
    key.classList.add("sid-vkbd-key--active");
    setTimeout(function(){ key.classList.remove("sid-vkbd-key--active"); }, 280);
  });
}

function _sidGetChordNotes() {
  const root = parseInt(document.getElementById("sid-chord-root")?.value, 10) || 0;
  const octave = parseInt(document.getElementById("sid-chord-octave")?.value, 10) || 0;
  const type = document.getElementById("sid-chord-type")?.value || "major";
  const intervals = _SID_CHORD_INTERVALS[type] || _SID_CHORD_INTERVALS.major;
  const notes = intervals.map(function(interval) { return octave * 12 + root + interval; });
  return notes.some(function(note) { return note >= 96; }) ? null : notes;
}

function _sidPreviewChord() {
  const notes = _sidGetChordNotes();
  if (!notes) return;
  _sidEnsureAudio();
  const when = _sidAudio.currentTime + 0.02;
  notes.forEach(function(note) { _sidPlayInst(_sidCurInst(), _sidNoteFreq(note), when, 0.7); });
  _sidFlashVirtualKeyboardNotes(notes);
}

function _sidPreviewArpeggio() {
  const notes = _sidGetChordNotes();
  if (!notes) return;
  const direction = document.getElementById("sid-arp-direction")?.value || "up";
  const length = parseInt(document.getElementById("sid-arp-length")?.value, 10) || 8;
  const order = direction === "down" ? [2, 1, 0] : (direction === "updown" ? [0, 1, 2, 1] : [0, 1, 2]);
  _sidEnsureAudio();
  const startTime = _sidAudio.currentTime;
  const baseWhen = startTime + 0.02;
  const stepDur = 0.12;
  if (_sidUsesNativeCore()) {
    const td = _sidTuneData({ insts: [_sidCurInst()], patterns: [], song: [0], speed: 255 });
    const engine = _sidEngineNew(td);
    const stepFrames = Math.round(stepDur * _sidFps());
    const tail = Math.min(150, Math.ceil(_SID_DCR[td.insts[0].r] / 20) + 6);
    // Egyetlen voice és puffer: az IPC késése nem tolhatja egymásra a hangokat.
    _sidRenderNative(engine, length * stepFrames + tail, _sidAudio.sampleRate, function(eng, frame) {
      if (frame < length * stepFrames && frame % stepFrames === 0) {
        const step = Math.floor(frame / stepFrames);
        _sidEngNoteOn(eng, 0, notes[order[step % order.length]], 0);
      }
      if (frame % stepFrames === stepFrames - 1 || frame >= length * stepFrames) eng.v[0].gate = 0;
    }).then(function(data) {
      const when = _sidAudio.currentTime + 0.02;
      _sidPlayBuffer(data, when);
      for (let step = 0; step < length; step++) {
        const note = notes[order[step % order.length]];
        setTimeout(function() { _sidFlashVirtualKeyboardNotes([note]); }, Math.round((0.02 + step * stepDur) * 1000));
      }
    }).catch(function(error) { console.warn("VA SID Core arpeggio failed:", error); });
    return;
  }
  for (let step = 0; step < length; step++) {
    const note = notes[order[step % order.length]];
    const when = baseWhen + (step * stepDur);
    _sidPlayInst(_sidCurInst(), _sidNoteFreq(note), when, Math.max(0.08, stepDur * 0.9));
    setTimeout(function() { _sidFlashVirtualKeyboardNotes([note]); }, Math.max(0, Math.round((when - startTime) * 1000)));
  }
}

function _sidInsertChord() {
  const notes = _sidGetChordNotes();
  if (!notes) return;
  const pat = _sidCurPat();
  for (let voice = 0; voice < 3; voice++) pat[voice][_sidSel.row] = { note: notes[voice], inst: _sidInst };
  _sidSelAnchor = null;
  _sidBuildTracker();
  document.getElementById("sid-tracker-wrap")?.focus({ preventScroll: true });
}

function _sidInsertArpeggio() {
  const notes = _sidGetChordNotes();
  if (!notes) return;
  const direction = document.getElementById("sid-arp-direction")?.value || "up";
  const length = parseInt(document.getElementById("sid-arp-length")?.value, 10) || 8;
  const order = direction === "down" ? [2, 1, 0] : (direction === "updown" ? [0, 1, 2, 1] : [0, 1, 2]);
  const pat = _sidCurPat();
  const available = Math.min(length, _SID_ROWS - _sidSel.row);
  for (let step = 0; step < available; step++) {
    pat[_sidSel.voice][_sidSel.row + step] = { note: notes[order[step % order.length]], inst: _sidInst };
  }
  _sidSelAnchor = null;
  _sidBuildTracker();
  document.getElementById("sid-tracker-wrap")?.focus({ preventScroll: true });
}

/* ── Instrument panel binding ── */
// instrument field ↔ control: [element id, property, kind ("check" | "range"), value label id]
function _sidInstFields() { return [
  ["sid-tri", "tri", "check"], ["sid-saw", "saw", "check"], ["sid-pul", "pul", "check"], ["sid-noi", "noi", "check"],
  ["sid-ring", "ring", "check"], ["sid-sync", "sync", "check"],
  ["sid-pw", "pw", "range", "sid-pw-val"],
  ["sid-a", "a", "range", "sid-a-val"], ["sid-d", "d", "range", "sid-d-val"], ["sid-s", "s", "range", "sid-s-val"], ["sid-r", "r", "range", "sid-r-val"],
  ["sid-filt", "filt", "check"], ["sid-lp", "lp", "check"], ["sid-bp", "bp", "check"], ["sid-hp", "hp", "check"], ["sid-off3", "off3", "check"],
  ["sid-cut", "cut", "range", "sid-cut-val"], ["sid-cut-end", "cutEnd", "range", "sid-cut-end-val"],
  ["sid-cut-speed", "cutSpeed", "range", "sid-cut-speed-val"], ["sid-cut-ping", "cutPing", "check"],
  ["sid-res", "res", "range", "sid-res-val"],
  ["sid-vib-delay", "vibDelay", "range", "sid-vib-delay-val"], ["sid-vib-speed", "vibSpeed", "range", "sid-vib-speed-val"],
  ["sid-vib-depth", "vibDepth", "range", "sid-vib-depth-val"],
  ["sid-pwm-speed", "pwmSpeed", "range", "sid-pwm-speed-val"], ["sid-pwm-min", "pwmMin", "range", "sid-pwm-min-val"],
  ["sid-pwm-max", "pwmMax", "range", "sid-pwm-max-val"],
  ["sid-gate-timer", "gateTimer", "range", "sid-gate-timer-val"], ["sid-hr", "hr", "check"]
]; }

function _sidParamKnobSync(input) {
  const knob = document.getElementById(input.id + "-knob");
  if (!knob) return;
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  _sidKnobRender(knob, (Number(input.value) - min) * 100 / Math.max(1, max - min));
  knob.setAttribute("aria-valuenow", input.value);
  knob.setAttribute("aria-valuetext", input.value);
}

function _sidInitParamKnobs() {
  _sidInstFields().forEach(function(field) {
    if (field[2] === "range") _sidMakeParamKnob(document.getElementById(field[0]));
  });
  // the tune's volume in the tracker toolbar
  _sidMakeParamKnob(document.getElementById("sid-song-vol"));
  _sidMakeParamKnob(document.getElementById("sid-song-vol2"));
}

// A knob in front of a range input: the input stays the value, hidden.
function _sidMakeParamKnob(input) {
  if (!input || document.getElementById(input.id + "-knob")) return;
  const knob = document.createElement("div");
  knob.id = input.id + "-knob";
  knob.className = "websid-play-knob sid-param-knob";
  knob.tabIndex = 0;
  knob.setAttribute("role", "slider");
  knob.setAttribute("aria-label", input.getAttribute("aria-label") || input.closest(".sid-slider-row")?.querySelector(".sid-sl-lbl")?.textContent || input.closest(".sid-wave-row")?.querySelector(".sid-mini-lbl")?.textContent || input.id);
  knob.setAttribute("aria-valuemin", input.min);
  knob.setAttribute("aria-valuemax", input.max);
  knob.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path class="websid-play-knob-track" d=""/><path class="websid-play-knob-value" d=""/><circle class="websid-play-knob-body" cx="20" cy="20" r="11.5"/><line class="websid-play-knob-pointer" x1="20" y1="20" x2="20" y2="11"/></svg>';
  input.classList.add("sid-range--knob-source");
  input.after(knob);
  const set = function(pct) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    input.value = String(Math.round(min + Math.max(0, Math.min(100, pct)) * (max - min) / 100));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    _sidParamKnobSync(input);
  };
  _sidKnobBind(knob, function() {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    return (Number(input.value) - min) * 100 / Math.max(1, max - min);
  }, set);
  _sidParamKnobSync(input);
}

function _sidLoadInstUI() {
  const inst = _sidCurInst();
  Object.assign(inst, _sidInstNorm(inst));
  document.getElementById("sid-inst-name").value = inst.name;
  if (typeof _sidVkbdInstSync === "function") _sidVkbdInstSync();
  _sidInstFields().forEach(function(f) {
    const el = document.getElementById(f[0]); if (!el) return;
    if (f[2] === "check") el.checked = !!inst[f[1]]; else el.value = inst[f[1]];
    const v = f[3] && document.getElementById(f[3]); if (v) v.textContent = inst[f[1]];
    if (f[2] === "range") _sidParamKnobSync(el);
  });
  const fw = document.getElementById("sid-first-wave");
  if (fw) {
    if (![...fw.options].some(function(o){ return Number(o.value) === inst.firstWave; })) {
      const o = document.createElement("option");
      o.value = String(inst.firstWave); o.textContent = "$" + inst.firstWave.toString(16).toUpperCase().padStart(2, "0");
      fw.appendChild(o);
    }
    fw.value = String(inst.firstWave);
  }
  const ts = document.getElementById("sid-table-speed"); if (ts) ts.value = inst.tableSpeed;
  _sidRenderTable();
  _sidDrawADSR();
}

/* Deletes instruments (a Set of indices; one always stays). The notes of a deleted one
   play the nearest kept instrument before it, the later numbers move down. */
function _sidInstRemove(drop) {
  const keep = _sidInsts.map(function(_, i) { return i; }).filter(function(i) { return !drop.has(i); });
  if (!keep.length) keep.push(0);
  const remap = _sidInsts.map(function(_, i) {
    let k = keep.length - 1;
    while (k > 0 && keep[k] > i) k--;
    return k;
  });
  _sidPatterns.forEach(function(pat) {
    pat.forEach(function(col) { col.forEach(function(c) { c.inst = remap[c.inst] != null ? remap[c.inst] : 0; }); });
  });
  _sidInsts = keep.map(function(i) { return _sidInsts[i]; });
  _sidInst = Math.min(remap[_sidInst] != null ? remap[_sidInst] : 0, _sidInsts.length - 1);
  _sidBuildInstSel(); _sidLoadInstUI(); _sidBuildTracker();
  if (typeof _sidRollDraw === "function") _sidRollDraw();
  _sidHistSchedule();
  return _sidInsts.length;
}
// How many notes play each instrument.
function _sidInstUse() {
  const use = _sidInsts.map(function() { return 0; });
  _sidPatterns.forEach(function(pat) {
    pat.forEach(function(col) { col.forEach(function(c) { if (c.note != null && use[c.inst] != null) use[c.inst]++; }); });
  });
  return use;
}
async function _sidInstDeleteCurrent() {
  if (_sidInsts.length < 2) return;
  const n = _sidInstUse()[_sidInst];
  if (n) {
    const into = _sidInsts[_sidInst ? _sidInst - 1 : 1];
    if (!(await _showConfirm(tf("sidDeleteInstrumentUsed", { n: n, name: into.name })))) return;
  }
  _sidInstRemove(new Set([_sidInst]));
}
function _sidInstRemoveUnused() {
  const use = _sidInstUse();
  const drop = new Set(use.map(function(n, i) { return n ? -1 : i; }).filter(function(i) { return i >= 0; }));
  if (drop.size === _sidInsts.length) drop.delete(0);
  if (drop.size) _sidInstRemove(drop);
  return drop.size;
}

/* ── Wave / arpeggio table editor ── */
const _SID_TABLE_WAVES = [[0, "—"], [0x10, "TRI"], [0x20, "SAW"], [0x40, "PUL"], [0x80, "NOI"], [0x14, "TRI+RING"],
  [0x42, "PUL+SYNC"], [0x50, "TRI+PUL"], [0x60, "SAW+PUL"], [0x30, "TRI+SAW"], [0x08, "TEST"]];

// steps: [waveform (0 = keep), note offset or absolute note, 1 = absolute]
const _SID_TABLE_PRESETS = {
  major: { group: "arp", key: "sidTpMajor", steps: [[0, 0], [0, 4], [0, 7]], loop: 0, speed: 2 },
  minor: { group: "arp", key: "sidTpMinor", steps: [[0, 0], [0, 3], [0, 7]], loop: 0, speed: 2 },
  major7: { group: "arp", key: "sidTpMajor7", steps: [[0, 0], [0, 4], [0, 7], [0, 11]], loop: 0, speed: 2 },
  minor7: { group: "arp", key: "sidTpMinor7", steps: [[0, 0], [0, 3], [0, 7], [0, 10]], loop: 0, speed: 2 },
  dom7: { group: "arp", key: "sidTpDom7", steps: [[0, 0], [0, 4], [0, 7], [0, 10]], loop: 0, speed: 2 },
  sus4: { group: "arp", key: "sidTpSus4", steps: [[0, 0], [0, 5], [0, 7]], loop: 0, speed: 2 },
  dim: { group: "arp", key: "sidTpDim", steps: [[0, 0], [0, 3], [0, 6]], loop: 0, speed: 2 },
  aug: { group: "arp", key: "sidTpAug", steps: [[0, 0], [0, 4], [0, 8]], loop: 0, speed: 2 },
  power: { group: "arp", key: "sidTpPower", steps: [[0, 0], [0, 7], [0, 12]], loop: 0, speed: 2 },
  octave: { group: "arp", key: "sidTpOctave", steps: [[0, 0], [0, 12]], loop: 0, speed: 2 },
  fastmajor: { group: "arp", key: "sidTpFastMajor", steps: [[0, 0], [0, 4], [0, 7]], loop: 0, speed: 1 },
  trill: { group: "arp", key: "sidTpTrill", steps: [[0, 0], [0, 1]], loop: 0, speed: 3 },
  kick: { group: "drum", key: "sidTpKick", steps: [[0x80, 44, 1], [0x40, 30, 1], [0x40, 24, 1], [0x40, 20, 1], [0x40, 17, 1]], loop: -1, speed: 1 },
  snare: { group: "drum", key: "sidTpSnare", steps: [[0x80, 72, 1], [0x40, 38, 1], [0x80, 68, 1], [0x80, 66, 1]], loop: -1, speed: 1 },
  tom: { group: "drum", key: "sidTpTom", steps: [[0x80, 52, 1], [0x40, 38, 1], [0x40, 35, 1], [0x40, 33, 1], [0x40, 31, 1], [0x40, 30, 1]], loop: -1, speed: 1 },
  clap: { group: "drum", key: "sidTpClap", steps: [[0x80, 80, 1], [0x80, 76, 1], [0x80, 80, 1], [0x80, 77, 1], [0x80, 74, 1]], loop: -1, speed: 1 },
  hihat: { group: "drum", key: "sidTpHihat", steps: [[0x80, 92, 1]], loop: -1, speed: 1 },
  openhat: { group: "drum", key: "sidTpOpenHat", steps: [[0x80, 93, 1], [0x80, 92, 1], [0x80, 91, 1], [0x80, 90, 1]], loop: -1, speed: 2 },
  leadclick: { group: "lead", key: "sidTpLeadClick", steps: [[0x80, 0], [0x40, 0]], loop: -1, speed: 1 },
  bite: { group: "lead", key: "sidTpBite", steps: [[0x20, 0], [0x40, 0]], loop: -1, speed: 3 },
  pluck: { group: "lead", key: "sidTpPluck", steps: [[0, 12], [0, 0]], loop: -1, speed: 2 },
  laser: { group: "fx", key: "sidTpLaser", steps: [[0x40, 24], [0x40, 20], [0x40, 16], [0x40, 12], [0x40, 8], [0x40, 4], [0x40, 0], [0x40, -4], [0x40, -8], [0x40, -12]], loop: -1, speed: 1 },
  pickup: { group: "fx", key: "sidTpPickup", steps: [[0x40, 0], [0x40, 7], [0x40, 12], [0x40, 19], [0x40, 24]], loop: -1, speed: 3 },
  explosion: { group: "fx", key: "sidTpExplosion", steps: [[0x80, 60, 1], [0x80, 56, 1], [0x80, 52, 1], [0x80, 48, 1], [0x80, 44, 1], [0x80, 40, 1], [0x80, 36, 1], [0x80, 32, 1]], loop: -1, speed: 2 },
  clear: { group: "", key: "sidPresetClear", steps: [], loop: -1, speed: 1 }
};

function _sidBuildPresetSelect() {
  const sel = document.getElementById("sid-table-preset");
  if (!sel) return;
  sel.innerHTML = "";
  const first = document.createElement("option");
  first.value = ""; first.textContent = t("sidTablePresets");
  sel.appendChild(first);
  [["arp", "sidTpGroupArp"], ["drum", "sidTpGroupDrums"], ["lead", "sidTpGroupLead"], ["fx", "sidTpGroupFx"], ["", ""]].forEach(function(g) {
    const parent = g[0] ? document.createElement("optgroup") : sel;
    if (g[0]) parent.label = t(g[1]);
    Object.keys(_SID_TABLE_PRESETS).forEach(function(id) {
      const p = _SID_TABLE_PRESETS[id];
      if (p.group !== g[0]) return;
      const o = document.createElement("option");
      o.value = id; o.textContent = t(p.key);
      parent.appendChild(o);
    });
    if (g[0]) sel.appendChild(parent);
  });
}

function _sidRenderTable() {
  const inst = _sidCurInst();
  const box = document.getElementById("sid-table-steps");
  const loopSel = document.getElementById("sid-table-loop");
  if (!box || !inst) return;
  const table = inst.table || (inst.table = []);
  if (loopSel) {
    loopSel.innerHTML = "";
    const none = document.createElement("option");
    none.value = "-1"; none.textContent = t("sidTableNoLoop");
    loopSel.appendChild(none);
    table.forEach(function(_, k) {
      const o = document.createElement("option");
      o.value = String(k); o.textContent = tf("sidTableLoopTo", { n: k + 1 });
      loopSel.appendChild(o);
    });
    loopSel.value = String(inst.tableLoop >= 0 && inst.tableLoop < table.length ? inst.tableLoop : -1);
  }
  box.innerHTML = "";
  if (!table.length) {
    const p = document.createElement("div");
    p.className = "sid-table-empty"; p.textContent = t("sidTableEmpty");
    box.appendChild(p);
  }
  table.forEach(function(step, k) {
    const row = document.createElement("div");
    row.className = "sid-tstep" + (k === inst.tableLoop ? " sid-tstep--loop" : "");
    const idx = document.createElement("span");
    idx.className = "sid-tstep-idx"; idx.textContent = String(k + 1);
    const wave = document.createElement("select");
    wave.className = "sid-select";
    wave.setAttribute("aria-label", t("sidTableWave"));
    const waves = _SID_TABLE_WAVES.slice();
    if (!waves.some(function(w){ return w[0] === step.w; })) waves.push([step.w, "$" + step.w.toString(16).toUpperCase().padStart(2, "0")]);
    waves.forEach(function(w) {
      const o = document.createElement("option");
      o.value = String(w[0]); o.textContent = w[0] ? w[1] : t("sidTableKeepWave");
      wave.appendChild(o);
    });
    wave.value = String(step.w);
    wave.addEventListener("change", function(){ step.w = Number(wave.value) | 0; _sidTableEdited(); });
    const note = document.createElement("input");
    note.type = "number"; note.className = "sid-input";
    note.min = step.abs ? "0" : "-96"; note.max = "95"; note.value = String(step.n);
    note.setAttribute("aria-label", step.abs ? t("sidTableAbsNote") : t("sidTableNoteOffset"));
    note.addEventListener("input", function(){
      const v = Number.parseInt(note.value, 10);
      if (Number.isFinite(v)) step.n = step.abs ? Math.max(0, Math.min(95, v)) : Math.max(-96, Math.min(95, v));
      _sidTableEdited();
    });
    const absLbl = document.createElement("label");
    absLbl.className = "sid-check";
    const abs = document.createElement("input");
    abs.type = "checkbox"; abs.checked = !!step.abs;
    abs.addEventListener("change", function(){
      step.abs = abs.checked;
      step.n = step.abs ? Math.max(0, Math.min(95, step.n + 48)) : 0;
      _sidTableEdited();
      _sidRenderTable();
    });
    const absTxt = document.createElement("span");
    absTxt.textContent = t("sidTableAbs");
    absLbl.append(abs, absTxt);
    const del = document.createElement("button");
    del.type = "button"; del.className = "sid-mini-btn sid-tstep-del"; del.textContent = "×";
    del.setAttribute("aria-label", t("sidTableDelStep"));
    del.addEventListener("click", function(){
      table.splice(k, 1);
      if (inst.tableLoop >= table.length) inst.tableLoop = table.length - 1;
      _sidTableEdited();
      _sidRenderTable();
    });
    row.append(idx, wave, note, absLbl, del);
    box.appendChild(row);
  });
  const add = document.getElementById("sid-table-add");
  if (add) add.disabled = table.length >= 32;
  const presetSel = document.getElementById("sid-table-preset");
  if (presetSel) presetSel.value = inst._tablePreset || "";
}

function _sidApplyTablePreset(key) {
  const p = _SID_TABLE_PRESETS[key];
  if (!p) return;
  const inst = _sidCurInst();
  inst.table = p.steps.map(function(s){ return { w: s[0], n: s[1], abs: !!s[2] }; });
  inst.tableLoop = p.loop;
  inst.tableSpeed = p.speed;
  // the preset name stays shown until the table is edited by hand (not saved)
  inst._tablePreset = key === "clear" ? "" : key;
  const ts = document.getElementById("sid-table-speed"); if (ts) ts.value = p.speed;
  _sidRenderTable();
}

function _sidTableEdited() {
  const inst = _sidCurInst();
  if (inst) inst._tablePreset = "";
  const sel = document.getElementById("sid-table-preset");
  if (sel) sel.value = "";
}

function _sidBuildInstSel() {
  const sel = document.getElementById("sid-inst-sel"); if (!sel) return;
  sel.innerHTML = "";
  _sidInsts.forEach(function(ins, i) {
    const o = document.createElement("option");
    o.value = i; o.textContent = (i<16?"0":"") + i.toString(16).toUpperCase() + ": " + ins.name;
    sel.appendChild(o);
  });
  sel.value = _sidInst;
  if (typeof _sidVkbdInstSync === "function") _sidVkbdInstSync();
}

/* VA-VK instrument knob + LCD: the knob steps through the instruments (drag, wheel,
   arrow keys), the LCD shows the number and name; both follow #sid-inst-sel. */
function _sidVkbdInstSync() {
  const n = (_sidInsts && _sidInsts.length) || 0;
  const i = Math.max(0, Math.min(n - 1, _sidInst | 0));
  const knob = document.getElementById("sid-vkbd-inst-knob");
  if (knob) {
    _sidKnobRender(knob, n > 1 ? i * 100 / (n - 1) : 0);
    knob.setAttribute("aria-valuemin", "1");
    knob.setAttribute("aria-valuemax", String(Math.max(1, n)));
    knob.setAttribute("aria-valuenow", String(i + 1));
    knob.setAttribute("aria-valuetext", n ? (_sidInsts[i].name || "") : "");
  }
  const hex = function(v) { return v.toString(16).toUpperCase().padStart(2, "0"); };
  const num = document.getElementById("sid-vkbd-lcd-num");
  if (num) num.textContent = n ? t("sidVkbdInstrument") + " " + hex(i) + "/" + hex(n - 1) : "";
  const name = document.getElementById("sid-vkbd-lcd-name");
  if (name) name.textContent = n ? (_sidInsts[i].name || "—") : "—";
}

function _sidVkbdSelectInst(i) {
  const n = (_sidInsts && _sidInsts.length) || 0;
  if (!n) return;
  i = Math.max(0, Math.min(n - 1, i | 0));
  if (i === _sidInst) return;
  const sel = document.getElementById("sid-inst-sel");
  if (sel) { sel.value = String(i); sel.dispatchEvent(new Event("change", { bubbles: true })); }
  else { _sidInst = i; _sidLoadInstUI(); }
}

function _sidVkbdInstKnobBind() {
  const knob = document.getElementById("sid-vkbd-inst-knob");
  if (!knob || knob._bound) return;
  knob._bound = true;
  let drag = null;
  knob.addEventListener("pointerdown", function(e) {
    drag = { x: e.clientX, y: e.clientY, index: _sidInst | 0 };
    try { knob.setPointerCapture(e.pointerId); } catch (_) {}
    knob.focus();
    e.preventDefault();
  });
  knob.addEventListener("pointermove", function(e) {
    if (!drag) return;
    // one instrument per 16 px up / right
    _sidVkbdSelectInst(drag.index + Math.round(((drag.y - e.clientY) + (e.clientX - drag.x)) / 16));
  });
  const end = function(e) { drag = null; try { knob.releasePointerCapture(e.pointerId); } catch (_) {} };
  knob.addEventListener("pointerup", end);
  knob.addEventListener("pointercancel", end);
  knob.addEventListener("wheel", function(e) {
    e.preventDefault();
    _sidVkbdSelectInst((_sidInst | 0) + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });
  knob.addEventListener("keydown", function(e) {
    const n = (_sidInsts && _sidInsts.length) || 0;
    const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 4, PageDown: -4 }[e.key];
    if (delta !== undefined) _sidVkbdSelectInst((_sidInst | 0) + delta);
    else if (e.key === "Home") _sidVkbdSelectInst(0);
    else if (e.key === "End") _sidVkbdSelectInst(n - 1);
    else return;
    e.preventDefault();
  });
}

/* ── ADSR graph ── */
let _sidAdsrGeom = null;

function _sidDrawADSR() {
  const c = document.getElementById("sid-adsr-canvas"); if (!c) return;
  const ctx = c.getContext("2d"), W = c.width, H = c.height;
  ctx.clearRect(0,0,W,H);
  const inst = _sidCurInst();
  const x0 = 10, x1 = W - 10, yTop = 10, y0 = H - 18, span = x1 - x0, q = span / 4;
  // grid (4 horizontal levels + 3 segment dividers)
  ctx.strokeStyle = "rgba(120,140,200,0.12)"; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) { const y = yTop + (y0-yTop)*g/4; ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1,y); ctx.stroke(); }
  for (let g = 1; g < 4; g++) { const x = x0 + q*g; ctx.beginPath(); ctx.moveTo(x,yTop); ctx.lineTo(x,y0); ctx.stroke(); }
  // handle positions: A in 1st quarter, D in 2nd, sustain-hold 3rd, R in 4th
  const susY = y0 - (y0 - yTop) * (inst.s / 15);
  const ax = x0 + q * (inst.a / 15);
  const dx = x0 + q + q * (inst.d / 15);
  const sx = x0 + 3 * q;
  const rx = x0 + 3 * q + q * (inst.r / 15);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ax, yTop); ctx.lineTo(dx, susY); ctx.lineTo(sx, susY); ctx.lineTo(rx, y0);
  ctx.strokeStyle = "#5ec8ff"; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(x0, y0); ctx.closePath(); ctx.fillStyle = "rgba(94,200,255,0.12)"; ctx.fill();
  const handles = [{id:"a",x:ax,y:yTop},{id:"d",x:dx,y:susY},{id:"s",x:sx,y:susY},{id:"r",x:rx,y:y0}];
  ctx.fillStyle = "#5ec8ff";
  handles.forEach(function(p){ ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill(); });
  ctx.fillStyle = "#6a7a9a"; ctx.font = "10px monospace";
  ctx.fillText("A", ax-3, H-4); ctx.fillText("D", dx-3, H-4); ctx.fillText("S", sx-3, H-4); ctx.fillText("R", rx-3, H-4);
  _sidAdsrGeom = { x0:x0, x1:x1, yTop:yTop, y0:y0, q:q, handles:handles };
}

/* ── Tracker grid ── */
// Effect column codes: V=vibrato, U=slide/portamento up, D=slide down,
// C=note cut (release without a new note), F=speed change (frames/row).
const _SID_FX_CODES = { V: 1, U: 2, D: 3, C: 4, F: 5 };

const _SID_FX_NAMES = [null, "V", "U", "D", "C", "F"];

function _sidFxText(cell) {
  if (!cell.fx) return "...";
  return cell.fx + (cell.fxval < 16 ? "0" : "") + (cell.fxval & 0xFF).toString(16).toUpperCase();
}

/* A row with only the C effect is a note-off (gate off, the release runs), the
   way trackers show a key-off: "===" in the note column. Display only — the
   UB export and the saved data keep the C effect. */
function _sidIsNoteOff(cell) {
  return !!cell && cell.note == null && cell.fx === "C";
}

function _sidGridCellText(cell) {
  return _sidIsNoteOff(cell) ? "=== .. ..." : _sidCellText(cell);
}

function _sidCellText(cell) {
  const notePart = cell.note == null ? "... .." : _sidNoteName(cell.note) + " " + (cell.inst<16?"0":"") + cell.inst.toString(16).toUpperCase();
  return notePart + " " + _sidFxText(cell);
}

function _sidNormalizeSelection() {
  const anchor = _sidSelAnchor || _sidSel;
  return {
    voiceLo: Math.min(anchor.voice, _sidSel.voice),
    voiceHi: Math.max(anchor.voice, _sidSel.voice),
    rowLo: Math.min(anchor.row, _sidSel.row),
    rowHi: Math.max(anchor.row, _sidSel.row)
  };
}

function _sidSelectionContains(voice, row) {
  const sel = _sidNormalizeSelection();
  return voice >= sel.voiceLo && voice <= sel.voiceHi && row >= sel.rowLo && row <= sel.rowHi;
}

function _sidPasteVoice() {
  if (!_sidClipboard || !_sidPatterns) return;
  const col = _sidCurPat()[_sidSel.voice];
  for (var r = 0; r < _sidClipboard.length; r++) {
    col[r] = { ..._sidClipboard[r] };
  }
  _sidBuildTracker();
}

function _sidCopyCells() {
  if (!_sidPatterns) return;
  const pat = _sidCurPat();
  const sel = _sidNormalizeSelection();
  const voiceLo = sel.voiceLo;
  const voiceHi = sel.voiceHi;
  const rowLo = sel.rowLo;
  const rowHi = sel.rowHi;
  _sidCellClip = { voices: voiceHi - voiceLo + 1, rows: rowHi - rowLo + 1, cells: [] };
  for (let v = voiceLo; v <= voiceHi; v++) {
    const voice = [];
    for (let r = rowLo; r <= rowHi; r++) voice.push({ ...pat[v][r] });
    _sidCellClip.cells.push(voice);
  }
  /* Keep the clipboard independent from the source pattern. */
  _sidCellClip.startVoice = voiceLo;
  _sidCellClip.startRow = rowLo;
  _sidClipboard = null;
  const btn = document.getElementById("sid-voice-copy");
  if (btn) { const o = btn.title; btn.title = "Copied!"; setTimeout(function(){ btn.title = o; }, 1000); }
}

function _sidCopySelection() {
  _sidCopyCells();
}

function _sidPasteCells() {
  if (!_sidCellClip || !_sidPatterns) return;
  const pat = _sidCurPat();
  const targetStartVoice = _sidSelAnchor === null ? _sidSel.voice : Math.min(_sidSelAnchor.voice, _sidSel.voice);
  const targetStartRow = _sidSelAnchor === null ? _sidSel.row : Math.min(_sidSelAnchor.row, _sidSel.row);
  for (let v = 0; v < _sidCellClip.voices; v++) {
    const targetVoice = targetStartVoice + v;
    if (targetVoice >= pat.length) break;
    for (let r = 0; r < _sidCellClip.rows; r++) {
      const targetRow = targetStartRow + r;
      if (targetRow >= _SID_ROWS) break;
      const cell = _sidCellClip.cells[v][r];
      pat[targetVoice][targetRow] = { ...cell };
    }
  }
  _sidBuildTracker();
}

function _sidPasteSelection() {
  if (_sidCellClip) _sidPasteCells();
  else _sidPasteVoice();
}

function _sidClearSelection() {
  if (!_sidPatterns) return;
  const pat = _sidCurPat();
  const sel = _sidNormalizeSelection();
  for (let voice = sel.voiceLo; voice <= sel.voiceHi; voice++) {
    for (let row = sel.rowLo; row <= sel.rowHi; row++) {
      pat[voice][row] = { note: null, inst: 0, fx: null, fxval: 0 };
    }
  }
  _sidBuildTracker();
  _sidRefreshSel();
}

function _sidCutSelection() {
  _sidCopySelection();
  _sidClearSelection();
}

function _sidHideCtxMenu() {
  const menu = document.getElementById("sid-ctx-menu");
  if (menu) menu.hidden = true;
}

function _sidShowCtxMenu(e, voice, row) {
  let menu = document.getElementById("sid-ctx-menu");
  if (!menu) {
    const dialog = document.getElementById("sid-editor-dialog");
    menu = document.createElement("div");
    menu.id = "sid-ctx-menu";
    menu.className = "block-ctx-menu sid-ctx-menu";
    menu.hidden = true;
    menu.innerHTML = ''
      + '<button type="button" class="block-ctx-item sid-ctx-item sid-ctx-copy" data-action="copy">'
      +   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="8" height="10" rx="1"/><path d="M3 5H2a1 1 0 00-1 1v7a1 1 0 001 1h8a1 1 0 001-1v-1"/></svg>'
      +   '<span class="sid-ctx-label"></span>'
      + '</button>'
      + '<button type="button" class="block-ctx-item sid-ctx-item sid-ctx-cut" data-action="cut">'
      +   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4.25" cy="11.75" r="1.75"/><circle cx="11.75" cy="11.75" r="1.75"/><path d="M6 10.5L12.5 3.5"/><path d="M9.4 7l3.1 3.5"/><path d="M6.2 10.1 3.5 7"/></svg>'
      +   '<span class="sid-ctx-label"></span>'
      + '</button>'
      + '<button type="button" class="block-ctx-item sid-ctx-item sid-ctx-paste" data-action="paste">'
      +   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="10" height="11" rx="1"/><path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M5 8h6M5 11h4"/></svg>'
      +   '<span class="sid-ctx-label"></span>'
      + '</button>'
      + '<button type="button" class="block-ctx-item sid-ctx-item sid-ctx-clear" data-action="clear">'
      +   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10"/><path d="M6 4.5V3.4c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v1.1"/><path d="M5 6.5v5.2"/><path d="M8 6.5v5.2"/><path d="M11 6.5v5.2"/><path d="M4.2 4.5l.5 8c0 .6.5 1 1.1 1h4.4c.6 0 1.1-.4 1.1-1l.5-8"/></svg>'
      +   '<span class="sid-ctx-label"></span>'
      + '</button>';
    menu.addEventListener("click", function(evt) {
      const btn = evt.target.closest("[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "copy") _sidCopySelection();
      else if (btn.dataset.action === "cut") _sidCutSelection();
      else if (btn.dataset.action === "paste") _sidPasteSelection();
      else if (btn.dataset.action === "clear") _sidClearSelection();
      _sidHideCtxMenu();
      document.getElementById("sid-tracker-wrap")?.focus({ preventScroll: true });
    });
    (dialog || document.body).appendChild(menu);
  }
  if (!_sidSelectionContains(voice, row)) {
    _sidSel = { voice, row };
    _sidSelAnchor = null;
    _sidRefreshSel();
  }
  const copyBtn = menu.querySelector(".sid-ctx-copy");
  const cutBtn = menu.querySelector(".sid-ctx-cut");
  const pasteBtn = menu.querySelector(".sid-ctx-paste");
  const clearBtn = menu.querySelector(".sid-ctx-clear");
  if (copyBtn) {
    const label = copyBtn.querySelector(".sid-ctx-label");
    if (label) label.textContent = t("sidContextCopy");
  }
  if (cutBtn) {
    const label = cutBtn.querySelector(".sid-ctx-label");
    if (label) label.textContent = t("sidContextCut");
  }
  if (pasteBtn) {
    const label = pasteBtn.querySelector(".sid-ctx-label");
    if (label) label.textContent = t("sidContextPaste");
    pasteBtn.disabled = !_sidCellClip && !_sidClipboard;
  }
  if (clearBtn) {
    const label = clearBtn.querySelector(".sid-ctx-label");
    if (label) label.textContent = t("sidContextClear");
  }
  menu.hidden = false;
  _ctxMenuPlaceAt(menu, e.clientX, e.clientY);
}

function _sidBuildTracker() {
  const t = document.getElementById("sid-tracker"); if (!t) return;
  const pat = _sidCurPat();
  if (_sidSel.voice >= pat.length) { _sidSel.voice = pat.length - 1; _sidSelAnchor = null; }
  const chips = document.getElementById("sid-chip-count");
  if (chips) chips.value = String(pat.length / 3);
  const addr = document.getElementById("sid-chip-addr");
  if (addr) { addr.value = String(_sidSid2Addr); addr.hidden = pat.length <= 3; }
  _sidSongVolSync(pat.length > 3);
  _sidRollSyncHeader();
  let html = "<thead><tr><th></th>";
  for (let v = 0; v < pat.length; v++) {
    html += '<th' + (v === 3 ? ' class="sid-col-sid2"' : '') + '>' + (pat.length > 3 ? "S" + ((v / 3 | 0) + 1) + " V" + (v % 3 + 1) : "VOICE " + (v + 1)) + "</th>";
  }
  html += "</tr></thead><tbody>";
  for (let r = 0; r < _SID_ROWS; r++) {
    const beat = (r % 4 === 0) ? " sid-beat" : "";
    html += '<tr class="sid-trow'+beat+'" data-row="'+r+'">';
    html += '<td class="sid-rownum">' + (r<10?"0":"") + r + '</td>';
    const rangeRowLo = _sidSelAnchor !== null ? Math.min(_sidSelAnchor.row, _sidSel.row) : _sidSel.row;
    const rangeRowHi = _sidSelAnchor !== null ? Math.max(_sidSelAnchor.row, _sidSel.row) : _sidSel.row;
    const rangeVoiceLo = _sidSelAnchor !== null ? Math.min(_sidSelAnchor.voice, _sidSel.voice) : _sidSel.voice;
    const rangeVoiceHi = _sidSelAnchor !== null ? Math.max(_sidSelAnchor.voice, _sidSel.voice) : _sidSel.voice;
    for (let v = 0; v < pat.length; v++) {
      const isCursor = _sidSel.voice === v && _sidSel.row === r;
      const inRange  = v >= rangeVoiceLo && v <= rangeVoiceHi && r >= rangeRowLo && r <= rangeRowHi && !isCursor;
      const selCls = isCursor ? " sid-cell--sel" : (inRange ? " sid-cell--sel-range" : "");
      html += '<td class="sid-cell'+selCls+(v === 3 ? " sid-col-sid2" : "")+'" data-v="'+v+'" data-r="'+r+'">' + _sidGridCellText(pat[v][r]) + '</td>';
    }
    html += "</tr>";
  }
  html += "</tbody>";
  t.innerHTML = html;
  t.querySelectorAll("td.sid-cell").forEach(function(td) {
    td.addEventListener("mousedown", function(e) {
      if (e.button !== 0 || e.target.closest("input")) return;
      e.preventDefault();
    });
    td.addEventListener("click", function(e) {
      const v = +td.dataset.v, r = +td.dataset.r;
      if (e.shiftKey) {
        if (_sidSelAnchor === null) _sidSelAnchor = { voice: _sidSel.voice, row: _sidSel.row };
        _sidSel.voice = v;
        _sidSel.row = r;
      } else {
        _sidSelAnchor = null;
        _sidSel = { voice: v, row: r };
      }
      _sidRefreshSel();
      document.getElementById("sid-tracker-wrap").focus();
    });
    td.addEventListener("contextmenu", function(e) {
      e.preventDefault();
      e.stopPropagation();
      _sidShowCtxMenu(e, +td.dataset.v, +td.dataset.r);
    });
    td.addEventListener("dblclick", function(e) {
      e.preventDefault();
      _sidBeginManualEdit(+td.dataset.v, +td.dataset.r, td);
    });
  });
}

/* Parse a manual cell entry like "C-4 01", "C#4", "c4 a 01", "F06", "C", "..."
 * into { note, inst, fx, fxval } (note is 0-based, C-0 = 0; fx is one of the
 * _SID_FX_CODES letters). Tokens after the first are recognized by shape
 * rather than position, so the instrument and/or effect may be omitted:
 *   "C-4 01"     → note + instrument, no effect
 *   "C-4 01 V24" → note + instrument + vibrato (speed 2, depth 4)
 *   "C-4 V24"    → note + vibrato, instrument left as it already was
 *   "F06"        → speed-change effect only, no note
 *   "C"          → note-cut effect only (bare letter, no hex value needed)
 * Empty input or "..." clears the whole cell (note, instrument and effect). */
function _sidParseCellEntry(text) {
  const s = (text || "").trim();
  if (!s || s === "..." || s === "... .." || s === "... .. ...") return { clear: true };
  if (/^(===|off)$/i.test(s.split(/\s+/)[0])) return { note: null, fx: "C", fxval: 0 };
  const tokens = s.split(/\s+/);
  const noteLetters = { c:0, d:2, e:4, f:5, g:7, a:9, b:11 };
  let note = undefined, inst = undefined, fx = null, fxval = 0;
  let i = 0;
  const noteMatch = tokens[0].match(/^([a-gA-G])([#b\-]?)(\d)$/);
  if (noteMatch) {
    const letter = noteMatch[1].toLowerCase();
    let semi = noteLetters[letter];
    if (noteMatch[2] === "#") semi += 1;
    else if (noteMatch[2] === "b") semi -= 1;
    const oct = parseInt(noteMatch[3], 10);
    note = oct * 12 + ((semi + 12) % 12);
    if (note < 0 || note >= 96) return { error: true };
    i = 1;
  } else if (tokens[0] === "...") {
    note = null;
    i = 1;
  }
  for (; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === ".." || tok === "...") continue; // explicit "leave unset" placeholder
    const fxMatch = tok.match(/^([VUDCF])([0-9a-fA-F]{0,2})$/);
    const instMatch = tok.match(/^[0-9a-fA-F]{1,2}$/);
    if (instMatch && !fxMatch) {
      inst = Math.max(0, Math.min(255, parseInt(tok, 16)));
    } else if (fxMatch) {
      fx = fxMatch[1];
      fxval = fxMatch[2] ? Math.max(0, Math.min(255, parseInt(fxMatch[2], 16))) : 0;
    } else {
      return { error: true };
    }
  }
  if (note === undefined && inst === undefined && fx === null) return { error: true };
  return { note: note === undefined ? null : note, inst, fx, fxval };
}

/* Turn a cell into a temporary text input for manual editing. */
function _sidBeginManualEdit(v, r, td) {
  if (!td || td.querySelector("input")) return;
  _sidSelAnchor = null;
  _sidSel = { voice: v, row: r };
  const pat = _sidCurPat();
  const cell = pat[v][r];
  const notePart = _sidIsNoteOff(cell) ? "==="
    : cell.note == null
    ? ""
    : _sidNoteName(cell.note) + " " + (cell.inst < 16 ? "0" : "") + cell.inst.toString(16).toUpperCase();
  const fxPart = cell.fx && !_sidIsNoteOff(cell) ? " " + _sidFxText(cell) : "";
  const initial = notePart + fxPart;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "sid-cell-edit";
  input.value = initial;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("maxlength", "12");
  input.placeholder = "C-4 01 V24";
  input.title = "Format: note [instrument] [effect] (e.g. C-4 01, C#5, D3 0A V24). Effects: V=vibrato U/D=slide up/down C=note cut F=speed. \"F06\" or \"C\" alone applies an effect with no new note; \"===\" (or OFF, key 1) = note-off. Empty = clear.";
  const original = td.innerHTML;
  td.innerHTML = "";
  td.appendChild(input);
  input.addEventListener("mousedown", function(e) {
    e.stopPropagation();
  });
  input.addEventListener("click", function(e) {
    e.stopPropagation();
  });
  const commit = function() {
    const parsed = _sidParseCellEntry(input.value);
    if (parsed.error) {
      input.classList.add("sid-cell-edit--err");
      input.focus();
      input.select();
      return false;
    }
    if (parsed.clear) {
      pat[v][r] = { note: null, inst: cell.inst, fx: null, fxval: 0 };
    } else {
      pat[v][r] = {
        note: parsed.note,
        inst: parsed.inst != null ? parsed.inst : cell.inst,
        fx: parsed.fx,
        fxval: parsed.fxval || 0
      };
    }
    _sidBuildTracker();
    _sidRefreshSel();
    return true;
  };
  const cancel = function() { td.innerHTML = original; };
  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      if (commit()) {
        e.preventDefault();
        // advance to next row so consecutive edits feel like typing
        _sidSel.row = Math.min(_SID_ROWS - 1, r + 1);
        _sidRefreshSel();
        document.getElementById("sid-tracker-wrap").focus();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      document.getElementById("sid-tracker-wrap").focus();
    }
  });
  input.addEventListener("blur", function() {
    // Blur commits like Enter, but silently keeps the cell if parse fails.
    if (!commit()) cancel();
  });
  input.focus();
  input.select();
}

function _sidRefreshSel() {
  const t = document.getElementById("sid-tracker"); if (!t) return;
  t.querySelectorAll("td.sid-cell--sel, td.sid-cell--sel-range").forEach(function(td){
    td.classList.remove("sid-cell--sel");
    td.classList.remove("sid-cell--sel-range");
  });
  const v = _sidSel.voice, r = _sidSel.row;
  const cursor = t.querySelector('td.sid-cell[data-v="'+v+'"][data-r="'+r+'"]');
  if (cursor) cursor.classList.add("sid-cell--sel");
  if (_sidSelAnchor !== null) {
    const rowLo = Math.min(_sidSelAnchor.row, r), rowHi = Math.max(_sidSelAnchor.row, r);
    const voiceLo = Math.min(_sidSelAnchor.voice, v), voiceHi = Math.max(_sidSelAnchor.voice, v);
    for (let voice = voiceLo; voice <= voiceHi; voice++) {
      for (let row = rowLo; row <= rowHi; row++) {
        if (voice === v && row === r) continue;
        const rc = t.querySelector('td.sid-cell[data-v="'+voice+'"][data-r="'+row+'"]');
        if (rc) rc.classList.add("sid-cell--sel-range");
      }
    }
  }
}

function _sidSetCellText(v, r) {
  const t = document.getElementById("sid-tracker"); if (!t) return;
  const td = t.querySelector('td.sid-cell[data-v="'+v+'"][data-r="'+r+'"]');
  if (td) td.textContent = _sidGridCellText(_sidCurPat()[v][r]);
}

/* ── Horizontal tracker (piano roll) ─────────────────────────────────────
 * The song (order list, 32 rows per step) drawn left to right, pitch bottom
 * to top. A note lasts until the voice's next note or note-off. Editing writes
 * the tracker cells: click = note on the active voice with the current
 * instrument, drag = its length (note-off at the end), drag a note = pitch,
 * drag its right edge = length, right-click = delete. Patterns are shared, so
 * an edit shows at every song step that uses the pattern. */
const _SID_ROLL_COLORS = ["#ffb347", "#7c9cff", "#ff6b6b", "#4ade80", "#f7d154", "#c084fc", "#38d6ff", "#ff8fd8", "#a3e635", "#fb923c", "#2dd4bf", "#e879f9"];

const _SID_ROLL_VOICE = ["#38d6ff", "#ff5ccf", "#4ade80", "#ffb020", "#a78bfa", "#f87171"];

var _sidRollView = { row0: 0, colW: 14, rowPx: 11, lo: 36, span: 48, voice: 0, raf: 0, drag: null, hover: null, follow: true, sel: new Set(), band: null, mark: null };

function _sidRollState() {
  try { return JSON.parse(localStorage.getItem("c64va-sid-roll") || "{}") || {}; } catch (_) { return {}; }
}

function _sidRollSave(patch) {
  const st = Object.assign(_sidRollState(), patch);
  try { localStorage.setItem("c64va-sid-roll", JSON.stringify(st)); } catch (_) {}
}

function _sidRollTotalRows() { return Math.max(1, (_sidSong && _sidSong.length ? _sidSong.length : 1) * _SID_ROWS); }

function _sidRollCell(v, g) {
  const pos = Math.floor(g / _SID_ROWS), r = g % _SID_ROWS;
  const pat = _sidPatterns && _sidPatterns[_sidSong ? _sidSong[pos] : 0];
  return pat ? { pat: pat, idx: _sidSong[pos], r: r, cell: pat[v][r] } : null;
}

function _sidRollWrite(v, g, cell) {
  const at = _sidRollCell(v, g);
  if (!at) return;
  at.pat[v][at.r] = Object.assign({ note: null, inst: 0, fx: null, fxval: 0 }, cell);
  if (at.idx === _sidPat) _sidSetCellText(v, at.r);
}

// notes of the whole song: { v, note, inst, start, end } in song rows
function _sidRollNotes() {
  const total = _sidRollTotalRows(), notes = [];
  for (let v = 0; v < _sidVoiceCount(); v++) {
    let cur = null;
    for (let g = 0; g < total; g++) {
      const at = _sidRollCell(v, g);
      const c = at && at.cell;
      if (!c) continue;
      if (c.note != null) {
        if (cur) { cur.end = g; notes.push(cur); }
        cur = { v: v, note: c.note, inst: c.inst | 0, start: g, end: total };
      } else if (c.fx === "C" && cur) {
        cur.end = g; notes.push(cur); cur = null;
      }
    }
    if (cur) notes.push(cur);
  }
  return notes;
}

function _sidRollGeom(cv) {
  const W = cv.clientWidth, H = cv.clientHeight, keyW = 36, rulerH = 16;
  // the pitch range follows the window height and the vertical zoom (px per semitone), around the same centre
  const span = Math.max(6, Math.min(96, Math.round((H - rulerH) / _sidRollView.rowPx)));
  if (H && span !== _sidRollView.span) {
    const mid = _sidRollView.lo + _sidRollView.span / 2;
    _sidRollView.span = span;
    _sidRollView.lo = Math.max(0, Math.min(96 - span, Math.round(mid - span / 2)));
  }
  const rowH = (H - rulerH) / _sidRollView.span;
  return { W: W, H: H, keyW: keyW, rulerH: rulerH, rowH: rowH, colW: _sidRollView.colW };
}

function _sidRollHit(cv, ev) {
  const g = _sidRollGeom(cv), rect = cv.getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  if (x < g.keyW || y < g.rulerH) return null;
  const row = Math.floor(_sidRollView.row0 + (x - g.keyW) / g.colW);
  const pitch = _sidRollView.lo + _sidRollView.span - 1 - Math.floor((y - g.rulerH) / g.rowH);
  return { row: row, rowX: _sidRollView.row0 + (x - g.keyW) / g.colW, pitch: Math.max(0, Math.min(95, pitch)), x: x, y: y, g: g };
}

function _sidRollNoteAt(notes, hit) {
  // the active voice first, then any voice
  const on = function(n) { return n.note === hit.pitch && hit.row >= n.start && hit.row < n.end; };
  return notes.find(function(n) { return n.v === _sidRollView.voice && on(n); }) || notes.find(on) || null;
}

// What a press would take hold of: the right end of a note (length), or its body (moving it). The end's
// zone reaches a little past the note and takes up to half of a short one, so a one-row note can
// be caught; a note starting right there keeps its own body.
function _sidRollGrab(notes, hit) {
  const g = hit.g, body = _sidRollNoteAt(notes, hit);
  const atEnd = function(n) {
    if (n.note !== hit.pitch || (hit.row >= n.end && body)) return false;
    const xEnd = g.keyW + (n.end - _sidRollView.row0) * g.colW;
    const inside = Math.min(Math.max(6, g.colW * 0.35), (n.end - n.start) * g.colW / 2);
    return hit.x >= xEnd - inside && hit.x <= xEnd + Math.min(4, g.colW * 0.3);
  };
  const ends = notes.filter(atEnd);
  const end = ends.find(function(n) { return n.v === _sidRollView.voice; }) || ends[0];
  if (end) return { note: end, kind: "len" };
  return body ? { note: body, kind: "move" } : null;
}
// a note grows up to the voice's next note, and does not eat it
function _sidRollNoteLimit(notes, n) {
  return notes.reduce(function(limit, x) { return x.v === n.v && x.start > n.start ? Math.min(limit, x.start) : limit; }, _sidRollTotalRows());
}
function _sidRollDragEnd(d, hit) {
  const want = d.fresh ? hit.row + 1 : Math.round(hit.rowX);
  return Math.max(d.note.start + 1, Math.min(d.limit, want));
}
// Moving a note in time: the voice's rows are saved when the drag starts, and each step starts from
// them, so whatever the note passes over comes back behind it. It stops one row short of the next
// note (shortened there, and its length returns on the way back) and can cut into the previous one.
function _sidRollMoveStart(notes, n, hit) {
  const same = notes.filter(function(x) { return x.v === n.v; });
  const prev = same.filter(function(x) { return x.start < n.start; }).reduce(function(a, x) { return !a || x.start > a.start ? x : a; }, null);
  const limit = _sidRollNoteLimit(notes, n);
  const from = prev ? prev.start : 0, rows = [];
  for (let g = from; g <= limit && g < _sidRollTotalRows(); g++) {
    const at = _sidRollCell(n.v, g);
    rows.push(at && at.cell ? Object.assign({}, at.cell) : null);
  }
  const first = _sidRollCell(n.v, n.start);
  return {
    kind: "move", note: n, limit: limit, grabRow: hit.row, origStart: n.start, length: n.end - n.start, origEnd: n.end,
    prevEnd: prev ? prev.end : -1, min: prev ? prev.start + 1 : 0, max: limit - 1, from: from, rows: rows,
    cell: Object.assign({}, first.cell),
  };
}
function _sidRollMoveTo(d, start) {
  const n = d.note, total = _sidRollTotalRows();
  d.rows.forEach(function(cell, i) { if (cell) _sidRollWrite(n.v, d.from + i, cell); });
  _sidRollWrite(n.v, d.origStart, {});
  const clearOff = function(g) {
    const at = g < total ? _sidRollCell(n.v, g) : null;
    if (at && at.cell && at.cell.note == null && at.cell.fx === "C") _sidRollWrite(n.v, g, {});
  };
  clearOff(d.origEnd);
  // the previous note keeps its end: a note-off in place of the note that ended it, none under this one
  if (d.prevEnd >= 0) {
    if (d.prevEnd === d.origStart && start > d.origStart) _sidRollWrite(n.v, d.origStart, { fx: "C" });
    else if (start < d.prevEnd) clearOff(d.prevEnd);
  }
  const end = Math.min(start + d.length, d.limit);
  const target = _sidRollCell(n.v, start);
  _sidRollWrite(n.v, start, Object.assign({}, d.cell, { fx: d.cell.fx || (target && target.cell && target.cell.fx !== "C" ? target.cell.fx : null), fxval: d.cell.fx ? d.cell.fxval : (target && target.cell && target.cell.fx !== "C" ? target.cell.fxval : 0) }));
  if (end < total) {
    const at = _sidRollCell(n.v, end);
    if (at && at.cell && at.cell.note == null && !at.cell.fx) _sidRollWrite(n.v, end, { fx: "C" });
  }
  n.start = start;
  n.end = end;
}
function _sidRollPreview(inst, note) {
  try {
    _sidEnsureAudio();
    _sidPlayInst(_sidInsts[inst] || _sidCurInst(), _sidNoteFreq(note), _sidAudio.currentTime + 0.01, 0.25);
  } catch (_) {}
}

// a note's end: note-off on its end row (when that row has no note) and nothing in between
function _sidRollSetEnd(n, end) {
  const total = _sidRollTotalRows();
  end = Math.max(n.start + 1, Math.min(total, end));
  for (let g = n.start + 1; g < Math.max(end, n.end); g++) {
    const at = _sidRollCell(n.v, g);
    if (at && at.cell && (at.cell.note != null || at.cell.fx === "C")) _sidRollWrite(n.v, g, {});
  }
  if (end < total) {
    const at = _sidRollCell(n.v, end);
    if (at && at.cell && at.cell.note == null && !at.cell.fx) _sidRollWrite(n.v, end, { fx: "C" });
  }
  // shortened: the old note-off is not needed any more
  if (end < n.end && n.end < total) {
    const old = _sidRollCell(n.v, n.end);
    if (old && old.cell && old.cell.note == null && old.cell.fx === "C") _sidRollWrite(n.v, n.end, {});
  }
  n.end = end;
}

// The note's own row is cleared, and the note before it on the voice keeps its end: where it rang
// on into this note, a note-off takes the note's place.
function _sidRollDelete(n) {
  const notes = _sidRollNotes();
  const prev = notes.filter(function(x) { return x.v === n.v && x.start < n.start; })
    .reduce(function(a, x) { return !a || x.start > a.start ? x : a; }, null);
  _sidRollWrite(n.v, n.start, {});
  const at = n.end < _sidRollTotalRows() ? _sidRollCell(n.v, n.end) : null;
  if (at && at.cell && at.cell.note == null && at.cell.fx === "C") _sidRollWrite(n.v, n.end, {});
  if (prev && prev.end === n.start) _sidRollWrite(n.v, n.start, { fx: "C" });
}
// ---- selection, clipboard and quantize of the horizontal tracker ----
var _sidRollClip = null;
// the grid in rows, and whether a recording is quantized when it stops; no initializer: the setup
// sets them before these lines run
var _sidQuant;
var _sidQuantRec;
function _sidRollKey(n) { return n.v + ":" + n.start; }
function _sidRollSelected(notes) {
  return notes.filter(function(n) { return _sidRollView.sel.has(_sidRollKey(n)); });
}
// Puts notes in like a paste, over what is there: { v, start, len, cell }, len null = rings on.
// Returns the keys of the notes placed.
function _sidRollPlace(items) {
  const total = _sidRollTotalRows(), voices = _sidVoiceCount(), keys = [];
  items.filter(function(it) { return it.v < voices && it.start >= 0 && it.start < total; })
    .sort(function(a, b) { return a.start - b.start; })
    .forEach(function(it) {
      const end = it.len == null ? it.start + 1 : Math.min(total, it.start + Math.max(1, it.len));
      // a note it cuts short loses the note-off that ended it further on
      const cut = _sidRollNotes().find(function(n) { return n.v === it.v && n.start < it.start && n.end > end; });
      if (cut && cut.end < total) {
        const off = _sidRollCell(it.v, cut.end);
        if (off && off.cell && off.cell.note == null && off.cell.fx === "C") _sidRollWrite(it.v, cut.end, {});
      }
      for (let g = it.start + 1; g < end; g++) {
        const at = _sidRollCell(it.v, g);
        if (at && at.cell && (at.cell.note != null || at.cell.fx === "C")) _sidRollWrite(it.v, g, {});
      }
      _sidRollWrite(it.v, it.start, Object.assign({}, it.cell));
      if (it.len != null && end < total) {
        const at = _sidRollCell(it.v, end);
        if (at && at.cell && at.cell.note == null && !at.cell.fx) _sidRollWrite(it.v, end, { fx: "C" });
      }
      keys.push(it.v + ":" + it.start);
    });
  return keys;
}
function _sidRollItem(n, start) {
  const at = _sidRollCell(n.v, n.start);
  return { v: n.v, start: start, len: n.end >= _sidRollTotalRows() ? null : n.end - n.start, cell: Object.assign({}, at.cell) };
}
function _sidRollCopySelected() {
  const sel = _sidRollSelected(_sidRollNotes());
  if (!sel.length) return 0;
  const first = Math.min.apply(null, sel.map(function(n) { return n.start; }));
  _sidRollClip = sel.map(function(n) { return _sidRollItem(n, n.start - first); });
  return sel.length;
}
function _sidRollDeleteSelected() {
  const sel = _sidRollSelected(_sidRollNotes()).sort(function(a, b) { return b.start - a.start; });
  // one by one, each against the notes as they are by then
  sel.forEach(function(n) {
    const now = _sidRollNotes().find(function(x) { return x.v === n.v && x.start === n.start; });
    if (now) _sidRollDelete(now);
  });
  _sidRollView.sel.clear();
  return sel.length;
}
function _sidRollCutSelected() {
  return _sidRollCopySelected() ? _sidRollDeleteSelected() : 0;
}
function _sidRollPasteAt(row) {
  if (!_sidRollClip || !_sidRollClip.length) return 0;
  const keys = _sidRollPlace(_sidRollClip.map(function(c) { return Object.assign({}, c, { start: row + c.start }); }));
  _sidRollView.sel = new Set(keys);
  // the paste point moves past the pasted notes, so a second paste follows them
  const span = Math.max.apply(null, _sidRollClip.map(function(c) { return c.start + (c.len || 1); }));
  _sidRollView.mark = Math.min(_sidRollTotalRows() - 1, row + span);
  return keys.length;
}
// Each note's start to the nearest multiple of grid rows, its length kept. Returns the keys after.
function _sidRollQuantizeNotes(notes, grid) {
  const total = _sidRollTotalRows();
  const keys = [], moving = [];
  notes.forEach(function(n) {
    const start = Math.max(0, Math.min(total - 1, Math.round(n.start / grid) * grid));
    if (start === n.start) keys.push(_sidRollKey(n));
    else moving.push({ n: n, item: _sidRollItem(n, start) });
  });
  moving.slice().sort(function(a, b) { return b.n.start - a.n.start; }).forEach(function(m) {
    const now = _sidRollNotes().find(function(x) { return x.v === m.n.v && x.start === m.n.start; });
    if (now) _sidRollDelete(now);
  });
  return keys.concat(_sidRollPlace(moving.map(function(m) { return m.item; })));
}
function _sidRollQuantizeSelected() {
  const grid = _sidQuant || 4;
  const sel = _sidRollSelected(_sidRollNotes());
  if (grid < 2 || !sel.length) return 0;
  _sidRollView.sel = new Set(_sidRollQuantizeNotes(sel, grid));
  return sel.length;
}
// The notes of a take, when it stops: their rows in the song, then quantized.
function _sidRecordQuantize(rec, grid) {
  if (grid < 2 || !rec.taken || !rec.taken.length) return 0;
  const want = new Set(rec.taken.map(function(t) {
    const idx = _sidPatterns.indexOf(t.pattern);
    let pos = _sidSong.indexOf(idx, rec.songPos0 || 0);
    if (pos < 0) pos = _sidSong.indexOf(idx);
    return pos < 0 ? "" : t.voice + ":" + (pos * _SID_ROWS + t.row);
  }));
  const notes = _sidRollNotes().filter(function(n) { return want.has(_sidRollKey(n)); });
  _sidRollQuantizeNotes(notes, grid);
  return notes.length;
}
// The paste point: with Ctrl+V the row under the mouse, else the row last clicked in the roll
// (marked there), else the tracker cursor.
function _sidRollPasteRow(atMouse) {
  const total = _sidRollTotalRows(), hv = _sidRollView.hover, m = _sidRollView.mark;
  if (atMouse && hv && hv.row >= 0 && hv.row < total) return hv.row;
  return m != null && m < total ? m : _sidSongPos * _SID_ROWS + _sidSel.row;
}
function _sidRollSyncTools() {
  const has = _sidRollView.sel.size > 0;
  [["sid-roll-cut", has], ["sid-roll-copy", has], ["sid-roll-delete", has], ["sid-roll-paste", !!(_sidRollClip && _sidRollClip.length)], ["sid-roll-quantize", has]]
    .forEach(function(p) { const el = document.getElementById(p[0]); if (el) el.disabled = !p[1]; });
}
function _sidRollAfterEdit() {
  _sidRollSyncTools();
  if (typeof _sidHistSchedule === "function") _sidHistSchedule();
}
function _sidRollPlayRow() {
  const playing = !!(_sidTimer || _sidWaPlay);
  if (!playing) return null;
  const pos = _sidPlayMode === "all" ? _sidSongPlayPos : Math.max(0, _sidSong.indexOf(_sidPlayPat));
  return pos * _SID_ROWS + _sidRow;
}

function _sidRollLegend(notes) {
  const box = document.getElementById("sid-roll-legend");
  if (!box) return;
  const used = Array.from(new Set(notes.map(function(n) { return n.inst; }))).sort(function(x, y) { return x - y; });
  const key = used.join(",") + "|" + used.map(function(i) { return _sidInsts[i] && _sidInsts[i].name; }).join(",");
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = "";
  used.forEach(function(i) {
    const chip = document.createElement("span");
    chip.className = "sid-roll-chip";
    const sw = document.createElement("span");
    sw.className = "sid-roll-swatch";
    sw.style.background = _SID_ROLL_COLORS[i % _SID_ROLL_COLORS.length];
    const label = document.createElement("span");
    label.textContent = (i < 10 ? "0" : "") + i + " " + ((_sidInsts[i] && _sidInsts[i].name) || "");
    chip.title = label.textContent;
    chip.append(sw, label);
    box.appendChild(chip);
  });
}

function _sidRollDraw() {
  const cv = document.getElementById("sid-roll-canvas");
  if (!cv || !_sidPatterns) return;
  const g = _sidRollGeom(cv), view = _sidRollView;
  if (!g.W || !g.H) return;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(g.W * dpr) || cv.height !== Math.round(g.H * dpr)) { cv.width = Math.round(g.W * dpr); cv.height = Math.round(g.H * dpr); }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const total = _sidRollTotalRows();
  const visRows = (g.W - g.keyW) / g.colW;
  const playRow = _sidRollPlayRow();
  // follow: the playhead stays at a third of the width, the song scrolls under it
  if (playRow != null && view.follow && !view.drag) view.row0 = playRow - visRows / 3;
  view.row0 = Math.max(0, Math.min(view.row0, Math.max(0, total - visRows * 0.5)));
  const xOf = function(row) { return g.keyW + (row - view.row0) * g.colW; };
  const yOf = function(n) { return g.rulerH + (view.lo + view.span - 1 - n) * g.rowH; };
  const black = function(n) { return [1, 3, 6, 8, 10].includes(n % 12); };
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, g.W, g.H);
  for (let n = view.lo; n < view.lo + view.span; n++) {
    ctx.fillStyle = black(n) ? "#0e1428" : "#121a33";
    ctx.fillRect(g.keyW, yOf(n), g.W - g.keyW, g.rowH);
    if (n % 12 === 0) { ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect(g.keyW, yOf(n) + g.rowH - 1, g.W - g.keyW, 1); }
  }
  // beats, pattern boundaries and the ruler with the song step / pattern number
  const r0 = Math.floor(view.row0), r1 = Math.min(total, Math.ceil(view.row0 + visRows) + 1);
  for (let row = r0; row <= r1; row++) {
    const x = Math.round(xOf(row)) + 0.5;
    if (x < g.keyW) continue;
    const start = row % _SID_ROWS === 0;
    if (!start && row % _SID_ROWS_PER_BEAT && g.colW < 10) continue;
    ctx.strokeStyle = start ? "rgba(255,255,255,0.28)" : row % _SID_ROWS_PER_BEAT === 0 ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)";
    ctx.beginPath(); ctx.moveTo(x, g.rulerH); ctx.lineTo(x, g.H); ctx.stroke();
    if (start && row < total) {
      const pos = row / _SID_ROWS, pat = _sidSong[pos];
      ctx.fillStyle = pos === _sidSongPos ? "#ffd84f" : "#8a93b0";
      ctx.font = "10px monospace";
      ctx.fillText(String(pos).padStart(2, "0") + ":" + (pat < 10 ? "0" : "") + pat, x + 3, 11);
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(g.keyW, g.rulerH - 1, g.W - g.keyW, 1);
  if (r1 >= total) { ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(xOf(total), g.rulerH, g.W - xOf(total), g.H - g.rulerH); }
  // the editor cursor (selected row of the selected song step)
  const curRow = _sidSongPos * _SID_ROWS + _sidSel.row;
  ctx.fillStyle = "rgba(255,216,79,0.10)";
  ctx.fillRect(xOf(curRow), g.rulerH, g.colW, g.H - g.rulerH);
  const notes = _sidRollNotes();
  const live = [];
  const edge = view.drag ? (view.drag.kind === "len" ? view.drag.note : null) : view.edge;
  notes.forEach(function(n) {
    const x0 = Math.max(g.keyW, xOf(n.start)), x1 = Math.min(g.W, xOf(n.end));
    if (x1 <= x0 || n.note < view.lo || n.note >= view.lo + view.span) return;
    const y = yOf(n.note) + 1, h = Math.max(2, g.rowH - 2);
    const sounding = playRow != null && playRow >= n.start && playRow < n.end;
    if (sounding) live.push(n);
    ctx.globalAlpha = n.v === view.voice ? 1 : 0.6;
    ctx.fillStyle = _SID_ROLL_COLORS[n.inst % _SID_ROLL_COLORS.length];
    ctx.fillRect(x0, y, x1 - x0 - 1, h);
    ctx.fillStyle = _SID_ROLL_VOICE[n.v];
    ctx.fillRect(x0, y, Math.min(3, x1 - x0), h);
    ctx.strokeStyle = sounding ? "#fff" : _SID_ROLL_VOICE[n.v];
    ctx.lineWidth = sounding ? 1.5 : 1;
    ctx.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 2, h - 1);
    ctx.lineWidth = 1;
    if (edge && edge.v === n.v && edge.start === n.start) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(x1 - 3, y, 2, h);
    }
    if (view.sel.has(_sidRollKey(n))) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 1, y + 1, x1 - x0 - 3, h - 2);
      ctx.lineWidth = 1;
    }
    if (x1 - x0 > 30 && h >= 9) {
      ctx.fillStyle = "#0b1020";
      ctx.font = Math.min(10, Math.floor(h - 1)) + "px monospace";
      ctx.fillText(_sidNoteName(n.note), x0 + 5, y + h - 2);
    }
    ctx.globalAlpha = 1;
  });
  if (view.band) {
    const b = view.band;
    const rx0 = xOf(Math.min(b.r0, b.r1)), rx1 = xOf(Math.max(b.r0, b.r1));
    const ry0 = yOf(Math.max(b.p0, b.p1)), ry1 = yOf(Math.min(b.p0, b.p1)) + g.rowH;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.strokeRect(rx0 + 0.5, ry0 + 0.5, rx1 - rx0, ry1 - ry0);
    ctx.setLineDash([]);
  }
  // hover cell on the active voice
  const hv = view.hover;
  if (hv && !view.drag && hv.pitch >= view.lo && hv.pitch < view.lo + view.span && hv.row < total) {
    ctx.strokeStyle = _SID_ROLL_VOICE[view.voice];
    ctx.strokeRect(xOf(hv.row) + 0.5, yOf(hv.pitch) + 0.5, g.colW - 1, g.rowH - 1);
  }
  // keys
  for (let n = view.lo; n < view.lo + view.span; n++) {
    const hit = live.find(function(s) { return s.note === n; });
    ctx.fillStyle = hit ? _SID_ROLL_VOICE[hit.v] : black(n) ? "#1a1f2e" : "#d9deea";
    ctx.fillRect(0, yOf(n), g.keyW - 2, Math.max(1, g.rowH - 1));
    if (n % 12 === 0 && g.rowH >= 7) {
      ctx.fillStyle = hit ? "#0b1020" : "#3a4256";
      ctx.font = Math.min(10, Math.floor(g.rowH)) + "px monospace";
      ctx.fillText(_sidNoteName(n), 2, yOf(n) + g.rowH - 2);
    }
  }
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, g.keyW, g.rulerH);
  const mark = view.mark;
  if (mark != null && mark < total) {
    const x = Math.round(xOf(mark));
    if (x >= g.keyW && x <= g.W) {
      ctx.fillStyle = "#ffd34d";
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x, g.rulerH, 1, g.H - g.rulerH);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, g.rulerH - 1); ctx.closePath();
      ctx.fill();
    }
  }
  if (playRow != null) {
    const x = Math.round(xOf(playRow + 0.5));
    if (x >= g.keyW) { ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(x, g.rulerH, 1, g.H - g.rulerH); }
  }
  _sidRollLegend(notes);
}

function _sidRollLoop() {
  const roll = document.getElementById("sid-roll");
  if (!roll || roll.hidden || !document.getElementById("sid-editor-dialog")?.open) { _sidRollView.raf = 0; return; }
  _sidRollDraw();
  _sidRollView.raf = requestAnimationFrame(_sidRollLoop);
}

function _sidRollSyncHeader() {
  const follow = document.getElementById("sid-roll-follow");
  if (follow) { follow.classList.toggle("sid-metronome-on", _sidRollView.follow); follow.setAttribute("aria-pressed", String(_sidRollView.follow)); }
  const voices = _sidVoiceCount();
  if (_sidRollView.voice >= voices) _sidRollView.voice = voices - 1;
  document.querySelectorAll(".sid-roll-vbtn").forEach(function(b) {
    b.hidden = Number(b.dataset.voice) >= voices;
    b.classList.toggle("active", Number(b.dataset.voice) === _sidRollView.voice);
  });
  const inst = document.getElementById("sid-roll-inst");
  if (inst) inst.textContent = (_sidInst < 10 ? "0" : "") + _sidInst + " " + ((_sidCurInst() && _sidCurInst().name) || "");
}

// fit the pitch range to the song's notes (four octaves around them)
function _sidRollFitPitch() {
  const notes = _sidRollNotes();
  let mid = 48;
  if (notes.length) {
    let lo = 95, hi = 0;
    notes.forEach(function(n) { lo = Math.min(lo, n.note); hi = Math.max(hi, n.note); });
    mid = Math.round((lo + hi) / 2);
  }
  _sidRollView.lo = Math.max(0, Math.min(96 - _sidRollView.span, mid - (_sidRollView.span >> 1)));
}

function _sidRollShow(on) {
  const roll = document.getElementById("sid-roll");
  if (!roll) return;
  roll.hidden = !on;
  const btn = document.getElementById("sid-roll-btn");
  if (btn) { btn.classList.toggle("sid-metronome-on", !!on); btn.setAttribute("aria-pressed", String(!!on)); }
  _sidRollSave({ open: !!on });
  if (!on) return;
  const st = _sidRollState();
  if (Number.isFinite(st.width)) roll.style.width = st.width + "px";
  if (Number.isFinite(st.height)) roll.style.height = st.height + "px";
  if (Number.isFinite(st.colW)) _sidRollView.colW = st.colW;
  if (Number.isFinite(st.rowPx)) _sidRollView.rowPx = st.rowPx;
  if (typeof st.follow === "boolean") _sidRollView.follow = st.follow;
  _sidRollView.voice = _sidSel.voice;
  _sidRollFitPitch();
  _sidRollSyncHeader();
  const x = Number.isFinite(st.left) ? st.left : 80, y = Number.isFinite(st.top) ? st.top : 120;
  _sidPlaceFixed(roll, x, y);
  requestAnimationFrame(function() { _sidPlaceFixed(roll, x, y); });
  if (!_sidRollView.raf) _sidRollView.raf = requestAnimationFrame(_sidRollLoop);
}

// vertical zoom: pixels per semitone (the visible pitch range follows)
function _sidRollZoomV(factor) {
  _sidRollView.rowPx = Math.max(4, Math.min(32, _sidRollView.rowPx * factor));
  _sidRollSave({ rowPx: _sidRollView.rowPx });
}

function _sidRollRestore() {
  if (_sidRollState().open) _sidRollShow(true);
}

function _sidSetupRoll() {
  const roll = document.getElementById("sid-roll");
  const cv = document.getElementById("sid-roll-canvas");
  const hdr = roll && roll.querySelector(".sid-roll-hdr");
  if (!roll || !cv || !hdr) return;
  document.getElementById("sid-roll-btn")?.addEventListener("click", function() { _sidRollShow(roll.hidden); });
  document.getElementById("sid-roll-close")?.addEventListener("click", function() { _sidRollShow(false); });
  document.getElementById("sid-roll-play")?.addEventListener("click", _sidPauseToggle);
  document.getElementById("sid-roll-follow")?.addEventListener("click", function() {
    _sidRollView.follow = !_sidRollView.follow;
    _sidRollSave({ follow: _sidRollView.follow });
    _sidRollSyncHeader();
  });
  document.getElementById("sid-roll-stop")?.addEventListener("click", function() { _sidStop(); });
  document.getElementById("sid-roll-metronome")?.addEventListener("click", _sidToggleMetronome);
  document.getElementById("sid-roll-vzoom-out")?.addEventListener("click", function() { _sidRollZoomV(1 / 1.25); });
  document.getElementById("sid-roll-vzoom-in")?.addEventListener("click", function() { _sidRollZoomV(1.25); });
  document.querySelectorAll(".sid-roll-vbtn").forEach(function(b) {
    b.addEventListener("click", function() { _sidRollView.voice = Number(b.dataset.voice); _sidRollSyncHeader(); });
  });
  // drag the window by its header; save the size after a CSS resize
  let move = null, sizeAtDown = null;
  hdr.addEventListener("pointerdown", function(e) {
    if (e.target.closest("button")) return;
    const rect = roll.getBoundingClientRect();
    move = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    try { hdr.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  hdr.addEventListener("pointermove", function(e) { if (move) _sidDragTo(move, roll, e.clientX - move.dx, e.clientY - move.dy); });
  const endMove = function() { _sidDragFlush(move, roll); if (move && move.at) _sidRollSave({ left: move.at.x, top: move.at.y }); move = null; };
  hdr.addEventListener("pointerup", endMove);
  hdr.addEventListener("pointercancel", endMove);
  roll.addEventListener("pointerdown", function() { sizeAtDown = { w: roll.offsetWidth, h: roll.offsetHeight }; });
  window.addEventListener("pointerup", function() {
    if (!sizeAtDown) return;
    const w = roll.offsetWidth, h = roll.offsetHeight;
    if (w > 0 && h > 0 && (w !== sizeAtDown.w || h !== sizeAtDown.h)) _sidRollSave({ width: w, height: h });
    sizeAtDown = null;
  });
  // editing
  cv.addEventListener("contextmenu", function(e) { e.preventDefault(); });
  cv.addEventListener("pointerdown", function(e) {
    const hit = _sidRollHit(cv, e);
    cv.focus({ preventScroll: true });
    if (!hit) {
      // a click on the ruler only sets the paste point
      const g = _sidRollGeom(cv), rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const row = Math.floor(_sidRollView.row0 + (x - g.keyW) / g.colW);
      if (e.button === 0 && x >= g.keyW && y < g.rulerH && row < _sidRollTotalRows()) { _sidRollView.mark = row; e.preventDefault(); }
      return;
    }
    if (hit.row >= _sidRollTotalRows()) return;
    const notes = _sidRollNotes();
    const n = _sidRollNoteAt(notes, hit);
    if (e.button === 0) _sidRollView.mark = hit.row;
    if (e.button === 2) {
      if (n) { _sidRollView.sel.delete(_sidRollKey(n)); _sidRollDelete(n); _sidRollAfterEdit(); }
      return;
    }
    if (e.button !== 0) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && n) {
      const key = _sidRollKey(n);
      if (_sidRollView.sel.has(key)) _sidRollView.sel.delete(key); else _sidRollView.sel.add(key);
      _sidRollSyncTools();
      e.preventDefault();
      return;
    }
    if (mod && !e.shiftKey) { e.preventDefault(); return; }
    if (e.shiftKey) {
      // a frame: it selects every note it touches, Ctrl+Shift adds to the selection
      _sidRollView.band = { r0: hit.rowX, p0: hit.pitch, r1: hit.rowX, p1: hit.pitch, add: mod };
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      return;
    }
    _sidRollView.sel.clear();
    _sidRollSyncTools();
    const grab = _sidRollGrab(notes, hit);
    if (grab) {
      _sidRollView.drag = grab.kind === "move" ? _sidRollMoveStart(notes, grab.note, hit) : { kind: "len", note: grab.note, limit: _sidRollNoteLimit(notes, grab.note) };
      _sidRollView.voice = grab.note.v;
      _sidRollSyncHeader();
    } else {
      const v = _sidRollView.voice;
      _sidRollWrite(v, hit.row, { note: hit.pitch, inst: _sidInst });
      const nn = { v: v, note: hit.pitch, inst: _sidInst, start: hit.row, end: hit.row + 1 };
      // the new note ends where the voice's next note (or note-off) already was
      const next = notes.filter(function(x) { return x.v === v && x.start > hit.row; }).sort(function(p, q) { return p.start - q.start; })[0];
      nn.end = next ? next.start : _sidRollTotalRows();
      const limit = nn.end;
      _sidRollSetEnd(nn, hit.row + 1);
      _sidRollView.drag = { kind: "len", note: nn, fresh: true, limit: limit };
      _sidRollPreview(_sidInst, hit.pitch);
    }
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  cv.addEventListener("pointermove", function(e) {
    const hit = _sidRollHit(cv, e);
    _sidRollView.hover = hit;
    if (_sidRollView.band) {
      if (hit) { _sidRollView.band.r1 = hit.rowX; _sidRollView.band.p1 = hit.pitch; }
      return;
    }
    const d = _sidRollView.drag;
    if (!d) {
      const grab = hit && hit.row < _sidRollTotalRows() ? _sidRollGrab(_sidRollNotes(), hit) : null;
      _sidRollView.edge = grab && grab.kind === "len" ? grab.note : null;
      cv.style.cursor = grab ? (grab.kind === "len" ? "ew-resize" : "move") : "";
      return;
    }
    if (!hit) return;
    if (d.kind === "move") {
      const start = Math.max(d.min, Math.min(d.max, d.origStart + hit.row - d.grabRow));
      if (hit.pitch !== d.note.note) {
        d.cell.note = hit.pitch;
        d.note.note = hit.pitch;
        const at = _sidRollCell(d.note.v, d.note.start);
        _sidRollWrite(d.note.v, d.note.start, Object.assign({}, at.cell, { note: hit.pitch }));
        _sidRollPreview(d.note.inst, hit.pitch);
      }
      if (start !== d.note.start) _sidRollMoveTo(d, start);
    } else if (d.kind === "len") {
      const end = _sidRollDragEnd(d, hit);
      if (end !== d.note.end) _sidRollSetEnd(d.note, end);
    }
  });
  const endDrag = function(e) {
    const b = _sidRollView.band;
    if (b) {
      _sidRollView.band = null;
      const r0 = Math.min(b.r0, b.r1), r1 = Math.max(b.r0, b.r1), p0 = Math.min(b.p0, b.p1), p1 = Math.max(b.p0, b.p1);
      if (!b.add) _sidRollView.sel.clear();
      _sidRollNotes().forEach(function(n) {
        if (n.start <= r1 && n.end > r0 && n.note >= p0 && n.note <= p1) _sidRollView.sel.add(_sidRollKey(n));
      });
      _sidRollSyncTools();
    }
    _sidRollView.drag = null;
    if (e && e.pointerId != null) { try { cv.releasePointerCapture(e.pointerId); } catch (_) {} }
  };
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);
  cv.addEventListener("pointerleave", function() { _sidRollView.hover = null; _sidRollView.edge = null; });
  cv.tabIndex = 0;
  const rollCommand = function(what, atMouse) {
    if (what === "cut") _sidRollCutSelected();
    else if (what === "copy") _sidRollCopySelected();
    else if (what === "paste") _sidRollPasteAt(_sidRollPasteRow(atMouse));
    else if (what === "delete") _sidRollDeleteSelected();
    else if (what === "quantize") _sidRollQuantizeSelected();
    _sidRollAfterEdit();
  };
  ["cut", "copy", "paste", "delete", "quantize"].forEach(function(what) {
    document.getElementById("sid-roll-" + what)?.addEventListener("click", function() { rollCommand(what); cv.focus({ preventScroll: true }); });
  });
  // on the whole window: after a header button the focus is not on the canvas
  roll.addEventListener("keydown", function(e) {
    const el = e.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    let what = null;
    if (mod && k === "x") what = "cut";
    else if (mod && k === "c") what = "copy";
    else if (mod && k === "v") what = "paste";
    else if (!mod && (e.key === "Delete" || e.key === "Backspace")) what = "delete";
    else if (!mod && k === "q") what = "quantize";
    else if (mod && k === "a") {
      _sidRollView.sel = new Set(_sidRollNotes().map(_sidRollKey));
      _sidRollSyncTools();
    } else if (e.key === "Escape" && _sidRollView.sel.size) {
      _sidRollView.sel.clear();
      _sidRollSyncTools();
    } else return;
    e.preventDefault();
    e.stopPropagation();
    if (what) rollCommand(what, true);
  });
  // wheel: scroll in time, Shift = pitch, Ctrl = zoom
  cv.addEventListener("wheel", function(e) {
    e.preventDefault();
    const view = _sidRollView;
    if (e.altKey) {
      _sidRollZoomV(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    } else if (e.ctrlKey) {
      view.colW = Math.max(4, Math.min(48, view.colW * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      _sidRollSave({ colW: view.colW });
    } else if (e.shiftKey) {
      view.lo = Math.max(0, Math.min(96 - view.span, view.lo + (e.deltaY < 0 ? 1 : -1)));
    } else {
      view.row0 = Math.max(0, view.row0 + (e.deltaX || e.deltaY) / view.colW);
    }
  }, { passive: false });
}

/* Undo / redo of the SID Editor. The tune changes in too many places to mark each one, so after a
 * user action the whole tune is compared with the last saved state: a knob's drag or a whole
 * recording is one step. A pattern that did not change shares its string with the state before. */
var _sidHist = { cur: null, undo: [], redo: [], timer: null };
const _SID_HIST_MAX = 100;
function _sidHistSnap(prev) {
  const title = document.getElementById("sid-tune-title");
  return {
    insts: JSON.stringify(_sidInsts),
    pats: _sidPatterns.map(function(pat, i) {
      const text = JSON.stringify(pat);
      return prev && prev.pats[i] === text ? prev.pats[i] : text;
    }),
    song: JSON.stringify(_sidSong), speed: _sidSpeed, sid2: _sidSid2Addr, title: title ? title.textContent : "",
    vol: _sidVol(), vol2: _sidVol2(), ntsc: _sidIsNtsc(),
  };
}
function _sidHistSame(a, b) {
  return a.insts === b.insts && a.song === b.song && a.speed === b.speed && a.sid2 === b.sid2 && a.title === b.title
    && a.vol === b.vol && a.vol2 === b.vol2 && a.ntsc === b.ntsc
    && a.pats.length === b.pats.length && a.pats.every(function(text, i) { return text === b.pats[i]; });
}
function _sidHistRender() {
  const set = function(id, on) { const el = document.getElementById(id); if (el) el.disabled = !on; };
  set("sid-undo", _sidHist.undo.length > 0);
  set("sid-redo", _sidHist.redo.length > 0);
  set("sid-roll-undo", _sidHist.undo.length > 0);
  set("sid-roll-redo", _sidHist.redo.length > 0);
}
function _sidHistCheck() {
  clearTimeout(_sidHist.timer);
  _sidHist.timer = null;
  // a recording is one step: it is saved when it stops
  if (!_sidPatterns || _sidRecording) return;
  const h = _sidHist, now = _sidHistSnap(h.cur);
  if (h.cur && _sidHistSame(h.cur, now)) return;
  if (h.cur) {
    h.undo.push(h.cur);
    if (h.undo.length > _SID_HIST_MAX) h.undo.shift();
    h.redo.length = 0;
  }
  h.cur = now;
  _sidHistRender();
}
function _sidHistSchedule() {
  if (!document.getElementById("sid-editor-dialog")?.open) return;
  clearTimeout(_sidHist.timer);
  _sidHist.timer = setTimeout(_sidHistCheck, 300);
}
// Shows what changed: the instrument and the pattern that differ, with the song step that plays it.
function _sidHistApply(to, from) {
  const parse = function(text) { return JSON.parse(text); };
  const before = parse(from.insts);
  _sidInsts = parse(to.insts);
  _sidPatterns = to.pats.map(parse);
  _sidSong = parse(to.song);
  _sidSpeed = to.speed;
  _sidSid2Addr = to.sid2;
  _sidSetSongVol(to.vol);
  _sidSetSongVol2(to.vol2 != null ? to.vol2 : to.vol);
  _sidSetNtsc(to.ntsc);
  const inst = _sidInsts.findIndex(function(x, i) { return JSON.stringify(x) !== JSON.stringify(before[i]); });
  _sidInst = Math.max(0, Math.min(_sidInsts.length - 1, inst >= 0 ? inst : _sidInst));
  const pat = to.pats.findIndex(function(text, i) { return text !== from.pats[i]; });
  _sidPat = Math.max(0, Math.min(_sidPatterns.length - 1, pat >= 0 ? pat : _sidPat));
  _sidSongPos = Math.max(0, Math.min(_sidSong.length - 1, _sidSongPos));
  if (_sidSong[_sidSongPos] !== _sidPat && _sidSong.includes(_sidPat)) _sidSongPos = _sidSong.indexOf(_sidPat);
  _sidSelAnchor = null;
  const speed = document.getElementById("sid-speed");
  if (speed) speed.value = String(_sidSpeed);
  _sidUpdateBpmDisplay();
  if (to.title !== from.title) _sidSetTuneTitle(to.title);
  _sidBuildInstSel(); _sidLoadInstUI(); _sidBuildPatSel(); _sidBuildSongList(); _sidBuildTracker();
}
function _sidHistStep(from, into) {
  if (_sidRecording) return;
  _sidHistCheck();
  if (!from.length) return;
  const to = from.pop();
  into.push(_sidHist.cur);
  _sidHistApply(to, _sidHist.cur);
  _sidHist.cur = _sidHistSnap(to);
  _sidHistRender();
}
function _sidUndo() { _sidHistStep(_sidHist.undo, _sidHist.redo); }
function _sidRedo() { _sidHistStep(_sidHist.redo, _sidHist.undo); }

function _sidPreviewSelectedRow() {
  const pat = _sidCurPat();
  const row = Math.max(0, Math.min(_SID_ROWS - 1, _sidSel.row));
  _sidEnsureAudio();
  const when = _sidAudio.currentTime + 0.02;
  const rowSec = Math.max(_sidSpeed, 1) / _sidFps();
  const notes = [];
  for (let v = 0; v < pat.length; v++) {
    const cell = pat[v]?.[row];
    if (cell && cell.note != null) {
      const inst = _sidInsts[cell.inst] || _sidCurInst();
      _sidPlayInst(inst, _sidNoteFreq(cell.note), when, rowSec);
      notes.push(cell.note);
    }
  }
  if (notes.length) _sidFlashVirtualKeyboardNotes(notes);
  const t = document.getElementById("sid-tracker");
  if (t) {
    t.querySelectorAll("tr.sid-playing").forEach(function(r){ r.classList.remove("sid-playing"); });
    const tr = t.querySelector('tr.sid-trow[data-row="'+row+'"]');
    if (tr) {
      tr.classList.add("sid-playing");
      tr.scrollIntoView({ block: "nearest" });
      setTimeout(function() { tr.classList.remove("sid-playing"); }, Math.max(120, Math.round(rowSec * 1000)));
    }
  }
}

/* Keyboard note mapping (tracker style, one octave + above) */
const _SID_KEYMAP = { z:0,s:1,x:2,d:3,c:4,v:5,g:6,b:7,h:8,n:9,j:10,m:11,
  q:12,2:13,w:14,3:15,e:16,r:17,5:18,t:19,6:20,y:21,7:22,u:23,i:24 };

/* ── Audio ── */
function _sidEnsureAudio() {
  if (!_sidAudio) _sidAudio = new (window.AudioContext || window.webkitAudioContext)();
  if (_sidAudio.state === "suspended") _sidAudio.resume();
  if (!_sidMasterGain) {
    _sidMasterGain = _sidAudio.createGain();
    _sidMasterGain.gain.value = _sidMasterVol;
    _sidMasterGain.connect(_sidAudio.destination);
  }
  return _sidAudio;
}

function _sidPlayerAudio() {
  if (!_sidExtAudio) {
    _sidExtAudio = new (window.AudioContext || window.webkitAudioContext)();
    _sidExtGain = _sidExtAudio.createGain();
    _sidExtGain.gain.value = _sidMasterVol;
    _sidExtGain.connect(_sidExtAudio.destination);
  }
  return _sidExtAudio;
}
// Sets the shared SID volume (0-100) and keeps the SID Editor and the SID
// player knobs in step; persisted as c64va-sid-master-vol.
function _sidSetMasterVolume(pct, persist = true) {
  pct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  _sidMasterVol = pct / 100;
  ["sid-master-vol-val", "sid-ed-master-vol-val", "websid-play-vol-val"].forEach(function(id) {
    const value = document.getElementById(id);
    if (value) value.textContent = String(pct);
  });
  _sidKnobRender(document.getElementById("sid-master-vol"), pct);
  _sidKnobRender(document.getElementById("sid-ed-master-vol"), pct);
  _sidKnobRender(document.getElementById("websid-play-vol"), pct);
  _sidApplyMasterVolume();
  if (persist) { try { localStorage.setItem("c64va-sid-master-vol", String(pct)); } catch (_) {} }
}

// Volume knob geometry: 0-100 maps to a 270° sweep, 0° = straight up.
const _SID_KNOB_SWEEP = 270;

function _sidKnobPoint(deg, r) {
  const rad = deg * Math.PI / 180;
  return (20 + r * Math.sin(rad)).toFixed(2) + " " + (20 - r * Math.cos(rad)).toFixed(2);
}

function _sidKnobArc(fromDeg, toDeg, r) {
  if (toDeg - fromDeg < 0.5) return "";
  return "M" + _sidKnobPoint(fromDeg, r) + "A" + r + " " + r + " 0 " + (toDeg - fromDeg > 180 ? 1 : 0) + " 1 " + _sidKnobPoint(toDeg, r);
}

function _sidKnobRender(knob, pct) {
  if (!knob) return;
  const start = -_SID_KNOB_SWEEP / 2;
  const angle = start + _SID_KNOB_SWEEP * pct / 100;
  knob.querySelector(".websid-play-knob-track")?.setAttribute("d", _sidKnobArc(start, -start, 16.5));
  knob.querySelector(".websid-play-knob-value")?.setAttribute("d", _sidKnobArc(start, angle, 16.5));
  knob.querySelector(".websid-play-knob-pointer")?.setAttribute("transform", "rotate(" + angle.toFixed(1) + " 20 20)");
  knob.setAttribute("aria-valuenow", String(pct));
}

// Drag up / right = louder (200 px for the full range), wheel ±2, keys ±1 / ±10.
function _sidKnobBind(knob, get, set) {
  if (!knob) return;
  let drag = null;
  knob.addEventListener("pointerdown", function(e) {
    drag = { x: e.clientX, y: e.clientY, value: get() };
    try { knob.setPointerCapture(e.pointerId); } catch (_) {}
    knob.focus();
    e.preventDefault();
  });
  knob.addEventListener("pointermove", function(e) {
    if (!drag) return;
    set(drag.value + ((drag.y - e.clientY) + (e.clientX - drag.x)) / 2);
  });
  const end = function(e) {
    drag = null;
    try { knob.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  knob.addEventListener("pointerup", end);
  knob.addEventListener("pointercancel", end);
  knob.addEventListener("wheel", function(e) {
    e.preventDefault();
    set(get() + (e.deltaY < 0 ? 2 : -2));
  }, { passive: false });
  knob.addEventListener("keydown", function(e) {
    const step = e.shiftKey ? 10 : 1;
    const delta = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 10, PageDown: -10 }[e.key];
    if (delta !== undefined) set(get() + delta);
    else if (e.key === "Home") set(0);
    else if (e.key === "End") set(100);
    else return;
    e.preventDefault();
  });
}

function _sidLoadMasterVolume() {
  let pct = Math.round(_sidMasterVol * 100);
  try {
    const saved = localStorage.getItem("c64va-sid-master-vol");
    if (saved !== null && Number.isFinite(Number(saved))) pct = Number(saved);
  } catch (_) {}
  _sidSetMasterVolume(pct, false);
}

function _sidApplyMasterVolume() {
  [_sidMasterGain, _sidExtGain].forEach(function(node) {
    if (!node) return;
    // a suspended context's clock stands, so a ramp would wait for the resume
    if (node.context.state === "suspended") { node.gain.value = _sidMasterVol; return; }
    try { node.gain.setTargetAtTime(_sidMasterVol, node.context.currentTime, 0.02); }
    catch(_) { node.gain.value = _sidMasterVol; }
  });
}
/* Note preview: `inst` plays for holdSec, then the gate is released: one engine
   voice with the release tail, on the backend's SID or (no backend) the synth. */
function _sidPlayNote(inst, note, when, holdSec) {
  const ac = _sidEnsureAudio();
  const td = _sidTuneData({ insts: [inst], patterns: [], song: [0], speed: 255 });
  const e = _sidEngineNew(td);
  const ins = td.insts[0];
  const hold = Math.max(2, Math.round(Math.max(0.04, holdSec) * _sidFps()));
  const tail = Math.min(150, Math.ceil(_SID_DCR[ins.r] / 20) + 6);
  if (_sidUsesNativeCore()) {
    _sidRenderNative(e, hold + tail, ac.sampleRate, function(eng, k) {
      if (k === 0) _sidEngNoteOn(eng, 0, Math.max(0, Math.min(95, note | 0)), 0);
      if (k === hold) eng.v[0].gate = 0;
    }).then(function(data) {
      _sidPlayBuffer(data, Math.max(ac.currentTime + 0.01, when));
    }).catch(function(error) {
      console.warn("SID preview failed:", error);
    });
    return { src: null };
  }
  const data = _sidRenderEngine(e, hold + tail, ac.sampleRate, function(eng, k) {
    if (k === 0) _sidEngNoteOn(eng, 0, Math.max(0, Math.min(95, note | 0)), 0);
    if (k === hold) eng.v[0].gate = 0;
  });
  return { src: _sidPlayBuffer(data, when) };
}

function _sidPlayInst(inst, freq, when, holdSec) {
  const note = Math.round(57 + 12 * Math.log2(Math.max(1, freq) / 440));
  return _sidPlayNote(inst, note, when, holdSec);
}

/* ── Metronome + BPM helpers ─────────────────────────────────────────────
 * BPM derives from the frames-per-row Speed input: 50 Hz (PAL) or 60 Hz (NTSC), 4 rows/beat.
 * The metronome runs off the same setInterval tick that drives the tracker
 * row highlight, so it stays in phase with the preview. */
function _sidComputeBpm() {
  const rowSec = Math.max(_sidSpeed, 1) / _sidFps();
  return Math.round(60 / (rowSec * _SID_ROWS_PER_BEAT));
}

function _sidUpdateBpmDisplay() {
  const el = document.getElementById("sid-bpm");
  if (el) el.textContent = String(_sidComputeBpm());
}

function _sidSetSongVol(vol) {
  _sidSongVol = Math.max(0, Math.min(15, Number(vol) | 0));
  const el = document.getElementById("sid-song-vol");
  if (el) { el.value = String(_sidSongVol); _sidParamKnobSync(el); }
  const val = document.getElementById("sid-song-vol-val");
  if (val) val.textContent = String(_sidSongVol);
}
// Two SIDs: a volume knob for each chip, labelled by chip.
function _sidSongVolSync(twoSids) {
  const vol2 = document.getElementById("sid-song-vol2-group");
  if (vol2) vol2.hidden = !twoSids;
  const vol1 = document.getElementById("sid-song-vol-lbl");
  if (vol1) vol1.textContent = t(twoSids ? "sidSongVol1" : "sidSongVol");
}
function _sidSetSongVol2(vol) {
  _sidSongVol2 = Math.max(0, Math.min(15, Number(vol) | 0));
  const el = document.getElementById("sid-song-vol2");
  if (el) { el.value = String(_sidSongVol2); _sidParamKnobSync(el); }
  const val = document.getElementById("sid-song-vol2-val");
  if (val) val.textContent = String(_sidSongVol2);
}
function _sidSetNtsc(on) {
  _sidNtsc = !!on;
  const el = document.getElementById("sid-video");
  if (el) el.value = _sidNtsc ? "ntsc" : "pal";
  _sidUpdateBpmDisplay();
}

function _sidPlayMetronomeClick(accent) {
  if (!_sidMetronomeEnabled) return;
  try {
    if (!_sidMetroCtx) _sidMetroCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_sidMetroCtx.state === "suspended") _sidMetroCtx.resume();
    const ac = _sidMetroCtx, t = ac.currentTime + 0.005;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = accent ? 1600 : 900;
    // fixed click level: the SID master volume does not affect the metronome
    const peak = 0.32;
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  } catch (_) {}
}

// Ütés: kattanás (ha be van kapcsolva) + a billentyűzet ütemlámpájának villanása
let _sidBeatLampTimer = null;

function _sidMetronomeBeat(accent) {
  _sidPlayMetronomeClick(accent);
  const lamps = ["sid-beat", "sid-vkbd-beat", "sid-roll-beat"].map(function(id){ return document.getElementById(id); }).filter(Boolean);
  lamps.forEach(function(lamp) {
    lamp.classList.add("sid-beat-on");
    lamp.classList.toggle("sid-beat-accent", !!accent);
  });
  clearTimeout(_sidBeatLampTimer);
  _sidBeatLampTimer = setTimeout(function(){ lamps.forEach(function(lamp){ lamp.classList.remove("sid-beat-on", "sid-beat-accent"); }); }, 90);
}

function _sidToggleMetronome() {
  _sidMetronomeEnabled = !_sidMetronomeEnabled;
  ["sid-metronome", "sid-vkbd-metronome", "sid-roll-metronome"].forEach(function(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(_sidMetronomeEnabled));
    btn.classList.toggle("sid-metronome-on", _sidMetronomeEnabled);
  });
}

function _sidRecordRender() {
  ["sid-record", "sid-vkbd-record"].forEach(function(id) {
    const button = document.getElementById(id);
    if (!button) return;
    button.classList.toggle("sid-recording", !!_sidRecording);
    button.setAttribute("aria-pressed", String(!!_sidRecording));
    button.setAttribute("aria-label", _sidRecording ? t("sidRecordStop") : t("sidRecord"));
  });
}

// A pattern végén a felvétel új, üres patternben folytatódik (a song-ba is bekerül)
function _sidRecordNextPattern(rec) {
  rec.startedAt += (_SID_ROWS - rec.startRow) * rec.rowMs;
  rec.startRow = 0;
  rec.lastStep = -1;
  _sidPatterns.push(_sidNewPattern());
  _sidBuildPatSel();
  _sidSetPattern(_sidPatterns.length - 1, true);
  _sidSongInsert();
  rec.pattern = _sidCurPat();
}

function _sidRecordTick() {
  const rec = _sidRecording;
  if (!rec) return;
  let step = Math.floor((performance.now() - rec.startedAt) / rec.rowMs);
  while (step >= _SID_ROWS - rec.startRow) {
    _sidRecordNextPattern(rec);
    step = Math.floor((performance.now() - rec.startedAt) / rec.rowMs);
  }
  if (step === rec.lastStep) return;
  rec.lastStep = step;
  rec.row = rec.startRow + step;
  rec.pendingOff.forEach(function(voice) { _sidRecordPolyOff(rec, voice); });
  rec.pendingOff.clear();
  _sidSel.voice = rec.voice;
  _sidSel.row = rec.row;
  _sidRefreshSel();
  if ((step % _SID_ROWS_PER_BEAT) === 0) _sidMetronomeBeat(((step / _SID_ROWS_PER_BEAT) | 0) % _SID_BEATS_PER_BAR === 0);
}

function _sidRecordNote(note) {
  const rec = _sidRecording;
  if (!rec) return false;
  rec.pattern[rec.voice][rec.row] = { note: note, inst: rec.inst, fx: null, fxval: 0 };
  if (rec.taken) rec.taken.push({ pattern: rec.pattern, row: rec.row, voice: rec.voice });
  _sidSetCellText(rec.voice, rec.row);
  _sidEnsureAudio();
  _sidPlayInst(_sidInsts[rec.inst], _sidNoteFreq(note), _sidAudio.currentTime + 0.01, Math.max(0.08, rec.rowMs / 1000 * 0.9));
  _sidFlashVirtualKeyboardNotes([note]);
  return true;
}

// Poly record (MIDI): every held key takes a voice of its own, from the selected voice on, and
// its release writes a note-off, because a voice left alone would ring on. With all voices held
// the oldest key gives up its voice. A voice with a release due on this row is the last choice,
// so that a quick melody does not overwrite its own notes.
const _SID_POLY_CHORD_MS = 40;
function _sidRecordPolyVoice(rec) {
  const held = Array.from(rec.held.values(), function(h) { return h.voice; });
  const order = rec.pattern.map(function(_, i) { return (rec.voice + i) % rec.pattern.length; });
  const free = order.filter(function(v) { return !held.includes(v); });
  const ready = free.find(function(v) { return !rec.pendingOff.has(v); });
  return ready ?? free[0] ?? held[0];
}
function _sidRecordPolyNote(note, midiNote) {
  const rec = _sidRecording;
  const voice = _sidRecordPolyVoice(rec);
  rec.held.forEach(function(h, key) { if (h.voice === voice) rec.held.delete(key); });
  rec.pendingOff.delete(voice);
  // the keys of a chord may fall on both sides of a row boundary
  const now = performance.now();
  const inChord = rec.chord && rec.chord.pattern === rec.pattern && now - rec.chord.at < _SID_POLY_CHORD_MS;
  if (!inChord) rec.chord = { pattern: rec.pattern, row: rec.row, at: now };
  const row = rec.chord.row;
  rec.pattern[voice][row] = { note: note, inst: rec.inst, fx: null, fxval: 0 };
  if (rec.taken) rec.taken.push({ pattern: rec.pattern, row: row, voice: voice });
  _sidSetCellText(voice, row);
  rec.held.set(midiNote, { voice: voice, pattern: rec.pattern, row: row });
  _sidEnsureAudio();
  _sidPlayInst(_sidInsts[rec.inst], _sidNoteFreq(note), _sidAudio.currentTime + 0.01, Math.max(0.08, rec.rowMs / 1000 * 0.9));
  _sidFlashVirtualKeyboardNotes([note]);
}
function _sidRecordPolyOff(rec, voice) {
  const cell = rec.pattern[voice][rec.row];
  if (cell && (cell.note != null || cell.fx)) return;
  rec.pattern[voice][rec.row] = { note: null, inst: 0, fx: "C", fxval: 0 };
  _sidSetCellText(voice, rec.row);
}
function _sidRecordPolyRelease(midiNote) {
  const rec = _sidRecording;
  const held = rec && rec.held.get(midiNote);
  if (!held) return;
  rec.held.delete(midiNote);
  // released on its own row: the note-off has to wait for the next one
  if (held.pattern === rec.pattern && held.row === rec.row) rec.pendingOff.add(held.voice);
  else _sidRecordPolyOff(rec, held.voice);
}
function _sidRecordStart() {
  if (!_sidPatterns) return;
  _sidStop();
  _sidRecording = {
    pattern: _sidCurPat(), voice: _sidSel.voice, inst: _sidInst, startRow: _sidSel.row,
    row: _sidSel.row, rowMs: Math.max(1, _sidSpeed) * 1000 / _sidFps(), startedAt: performance.now(), lastStep: -1, timer: null,
    held: new Map(), pendingOff: new Set(), chord: null, taken: [], songPos0: _sidSongPos
  };
  _sidRecordTick();
  _sidRecording.timer = setInterval(_sidRecordTick, 16);
  _sidRecordRender();
}

function _sidRecordStop() {
  const rec = _sidRecording;
  if (!rec) return;
  if (rec.timer) clearInterval(rec.timer);
  _sidRecording = null;
  if (_sidRecordQuantize(rec, _sidQuantRec ? (_sidQuant || 4) : 0)) _sidBuildTracker();
  _sidRecordRender();
  if (typeof _sidHistSchedule === "function") _sidHistSchedule();
}

function _sidToggleRecord() { if (_sidRecording) _sidRecordStop(); else _sidRecordStart(); }

let _sidExternalCore = null;

// SID Player buffer (Settings → SID preview): how many seconds the backend renders ahead.
// Functions, not a const table: the Settings dialog reads them before this point of the script runs.
function _sidPlayerAheadSeconds(size) {
  return { 2048: 10, 4096: 15, 8192: 20, 16384: 30 }[size] || 0;
}

function _sidPlayerBufferSize() {
  let n = 2048;
  try { n = parseInt(localStorage.getItem("c64va-sid-player-buffer"), 10) || 2048; } catch (_) {}
  return _sidPlayerAheadSeconds(n) ? n : 2048;
}

function _buildPsidBytes(prgBytes, initAddr, playAddr, name, released = "2026", secondSid = 0) {
  const HEADER_LEN = 0x7C;
  const out = new Uint8Array(HEADER_LEN + prgBytes.length);
  const wStr = (off, str, maxLen) => {
    const bytes = new TextEncoder().encode((str || "").substring(0, maxLen - 1));
    for (let i = 0; i < bytes.length; i++) out[off + i] = bytes[i];
  };
  // Magic 'PSID', version 2, dataOffset $7C
  out[0]=0x50; out[1]=0x53; out[2]=0x49; out[3]=0x44;
  out[4]=0x00; out[5]=0x02;
  out[6]=0x00; out[7]=0x7C;
  // LoadAddress = 0 → read from first two bytes of PRG data
  out[8]=0x00; out[9]=0x00;
  // InitAddress (big-endian)
  out[10]=(initAddr>>8)&0xFF; out[11]=initAddr&0xFF;
  // PlayAddress (0 = use IRQ vector installed by init)
  out[12]=(playAddr>>8)&0xFF; out[13]=playAddr&0xFF;
  // Songs / StartSong
  out[14]=0x00; out[15]=0x01;
  out[16]=0x00; out[17]=0x01;
  // Speed (0 = all songs vsync-driven)
  out[18]=0x00; out[19]=0x00; out[20]=0x00; out[21]=0x00;
  wStr(0x16, name || "Visual Assembler preview", 32);
  wStr(0x36, "Visual Assembler", 32);
  wStr(0x56, released, 32);
  // Flags: bit2..3 = PAL (01) or NTSC (10), bit4..5 = 6581 (01) → 0x14 / 0x18
  out[0x76]=0x00; out[0x77]=_sidIsNtsc() ? 0x18 : 0x14;
  // startPage, pageLength, secondSIDAddress = 0; PSID v3 for a second SID
  if (secondSid) { out[5]=0x03; out[0x7A]=(secondSid - 0xD000) >> 4; }
  out.set(prgBytes, HEADER_LEN);
  return out;
}

// The exported player is assembled by the VMA compiler in the backend.
async function _buildSidPreviewPrg() {
  if (!window.electronAPI?.vmaBuildRaw) return null;
  try {
    const result = await window.electronAPI.vmaBuildRaw(_sidExportAsmPlayable());
    if (!result || !result.ok) {
      console.warn("SID preview compile failed:", result && result.error);
      return null;
    }
    return Uint8Array.from(result.prg);
  } catch (e) {
    console.warn("SID preview build error:", e);
    return null;
  }
}

function _sidPauseBtnMarkup(isPlaying) {
  return isPlaying
    ? '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3.5" width="2.5" height="9" fill="currentColor"/><rect x="9.5" y="3.5" width="2.5" height="9" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5l8 4.5-8 4.5z" fill="currentColor"/></svg>';
}

function _sidUpdatePauseButton() {
  const isPlaying = !!_sidTimer && !_sidPaused;
  ["sid-vkbd-play", "sid-roll-play"].forEach(function(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.innerHTML = _sidPauseBtnMarkup(isPlaying);
    btn.setAttribute("aria-label", _sidPaused ? t("sidResume") : isPlaying ? t("sidPause") : t("sidPlay"));
  });
  // the tracker toolbar has separate Play and Pause buttons
  const play = document.getElementById("sid-play");
  if (play) {
    play.setAttribute("aria-label", _sidPaused ? t("sidResume") : t("sidPlay"));
    play.classList.toggle("sid-transport-on", isPlaying);
  }
  const pause = document.getElementById("sid-pause");
  if (pause) {
    pause.setAttribute("aria-label", _sidPaused ? t("sidResume") : t("sidPause"));
    pause.setAttribute("aria-pressed", _sidPaused ? "true" : "false");
    pause.classList.toggle("sid-pause-on", _sidPaused);
  }
}

// Tracker Play: start, or continue after a pause; does nothing while playing.
function _sidPlayOnly() {
  if (_sidPaused) { _sidPlay(false); return; }
  if (_sidTimer) return;
  _sidPlay(true);
}

// Tracker Pause: pause while playing, continue when paused; stopped, nothing.
function _sidPauseOnly() {
  if (_sidPaused || _sidTimer) _sidPauseToggle();
}

function _sidPlayerShowTune(filename, engine) {
  _sidPlayerEngineName = engine;
  _sidExtElapsed = 0;
  _sidExtSetStatus("playing");
  _sidPlayerShow();
  _sidPlayerRenderList();
}

function _sidPlayerHideWindow() {
  const dlg = document.getElementById("websid-play-dialog");
  if (!dlg) return;
  try { if (dlg.open) dlg.close(); } catch(_) {}
}

/* Transport of the SID player. Play restarts the current tune when stopped;
 * pause suspends the AudioContext, so the counter only advances while sound is produced. */
let _sidExtFile = null;

let _sidExtStatus = "stopped";

let _sidExtElapsed = 0;

let _sidExtRunSince = null;

let _sidExtTick = null;

let _sidExtStarting = false;

let _sidExtStartSeq = 0;

function _sidExtFormatTime(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

function _sidExtElapsedMs() {
  return _sidExtElapsed + (_sidExtRunSince !== null ? performance.now() - _sidExtRunSince : 0);
}

function _sidExtRender() {
  const time = document.getElementById("websid-play-time");
  if (time && !_sidSeekDragging) time.textContent = _sidExtFormatTime(_sidExtElapsedMs());
  const dlg = document.getElementById("websid-play-dialog");
  if (dlg) {
    dlg.classList.toggle("websid-play-dialog--paused", _sidExtStatus === "paused");
    dlg.classList.toggle("websid-play-dialog--stopped", _sidExtStatus === "stopped");
  }
  const play = document.getElementById("websid-play-play");
  if (play) play.classList.toggle("websid-play-tool--active", _sidExtStatus === "playing");
  const pause = document.getElementById("websid-play-pause");
  if (pause) {
    pause.classList.toggle("websid-play-tool--active", _sidExtStatus === "paused");
    pause.disabled = _sidExtStatus === "stopped";
  }
  const stop = document.getElementById("websid-play-stop");
  if (stop) stop.disabled = _sidExtStatus === "stopped";
  _sidPlayerTickUi();
}

function _sidExtSetStatus(status) {
  if (status === "playing") {
    if (_sidExtRunSince === null) _sidExtRunSince = performance.now();
  } else {
    _sidExtElapsed = status === "stopped" ? 0 : _sidExtElapsedMs();
    _sidExtRunSince = null;
  }
  _sidExtStatus = status;
  if (status === "playing" && !_sidExtTick) {
    _sidExtTick = setInterval(function() { _sidExtRender(); _sidPlayerAutoAdvance(); }, 250);
  }
  if (status !== "playing" && _sidExtTick) { clearInterval(_sidExtTick); _sidExtTick = null; }
  _sidExtRender();
}

async function _sidExtStartFile(bytes, filename, song = 0) {
  // Stop the running tune with the window kept open: the engines' own stop
  // closes it, and the late "close" event would then stop the new tune too.
  // Unconditional: a tune that is still starting (status "stopped") must be
  // stopped this way too when the user switches quickly.
  _sidExtStop();
  _sidExtFile = { bytes, name: filename, song };
  const seq = ++_sidExtStartSeq;
  _sidExtStarting = true;
  try {
    return await _vaSidPlayFileBytes(bytes, filename, song);
  } finally {
    if (seq === _sidExtStartSeq) _sidExtStarting = false;
  }
}

function _sidExtPlay() {
  if (_sidExtStarting || _sidExtStatus === "playing") return;
  if (_sidExtStatus === "paused") {
    if (_sidExternalCore) {
      _sidExternalCore.paused = false;
      _sidPlayerAudio().resume();
    }
    _sidExtSetStatus("playing");
    return;
  }
  if (_sidPlaylist.length) _sidPlayerPlayIndex(Math.max(0, _sidPlaylistIndex));
  else if (_sidExtFile) _sidExtStartFile(_sidExtFile.bytes, _sidExtFile.name, _sidExtFile.song);
}

function _sidExtPause() {
  if (_sidExtStatus === "paused") { _sidExtPlay(); return; }
  if (_sidExtStatus !== "playing") return;
  if (_sidExternalCore) {
    _sidExternalCore.paused = true;
    if (_sidExtAudio) _sidExtAudio.suspend();
  }
  _sidExtSetStatus("paused");
}

function _sidExtStop() {
  if (_sidExternalCore) _sidExternalCoreStop(true);
  _sidExtSetStatus("stopped");
}

// The backend runs the skipped part silently. The counter and the bar jump at once; while a seek is running only the
// newest target is kept, so quick clicks do not queue up several seeks.
let _sidExtSeekTarget = null;

let _sidExtSeeking = false;

function _sidPlayerCanSeek() {
  return _sidExtStatus !== "stopped" && !!_sidExternalCore;
}

async function _sidExtSeek(ms) {
  if (_sidExtStarting || !_sidPlayerCanSeek()) return;
  ms = Math.max(0, Math.round(ms));
  const showAt = function(at) {
    _sidExtElapsed = at;
    if (_sidExtRunSince !== null) _sidExtRunSince = performance.now();
    _sidExtRender();
  };
  showAt(ms);
  _sidExtSeekTarget = ms;
  if (_sidExtSeeking) return;
  _sidExtSeeking = true;
  // the sound returns only when the emulation has run up to the target
  const dlg = document.getElementById("websid-play-dialog");
  dlg?.classList.add("websid-play-dialog--seeking");
  try {
    while (_sidExtSeekTarget !== null) {
      const target = _sidExtSeekTarget;
      _sidExtSeekTarget = null;
      if (_sidExternalCore) await _vaSidSeek(_sidExternalCore, target);
      // the counter restarts at the target once its sound is there
      if (_sidExtSeekTarget === null && _sidExtStatus !== "stopped") showAt(target);
    }
  } finally {
    _sidExtSeeking = false;
    dlg?.classList.remove("websid-play-dialog--seeking");
  }
}

/* ── SID player window: playlist, skip, seek ───────────────────────────
 * A .sid file has no length, so every tune gets _SID_TUNE_LENGTH_MS on the
 * seek bar; after that the playlist moves on (the last tune keeps playing). */
function _sidEngineName() {
  return _sidPreviewEngine === "resid" ? "reSID" : "VA SID Core";
}
function _sidEngineLabel() {
  return (_sidPreviewEngine === "resid" ? "reSID" : "VA SID Core v" + _VA_SID_CORE_VERSION) + " (MOS " + _sidPreviewModel + ")";
}

// The SID Editor header names the emulation its previews and playback use.
function _sidEditorEngineSync() {
  const el = document.getElementById("sid-engine-name");
  if (el) el.textContent = _sidUsesNativeCore() ? "· " + _sidEngineLabel() : "";
  // the VA-VK badge names the running emulation too
  const chip = document.getElementById("sid-vkbd-brand-chip");
  if (chip) chip.textContent = _sidUsesNativeCore() ? _sidEngineName() + " · " + _sidPreviewModel : "";
}

// The engine that plays the current tune; when stopped, the one Play would use.
let _sidPlayerEngineName = "";

function _sidPlayerEngineLabel() {
  if (_sidExtStatus !== "stopped" && _sidPlayerEngineName) return _sidPlayerEngineName;
  return _sidEngineLabel();
}

const _SID_TUNE_LENGTH_MS = 180000;

let _sidPlaylist = [];

let _sidPlaylistIndex = -1;

// shuffle: the ids played in this round (in order), so Next never repeats a tune
// until every entry has played and Previous steps back along the random order
let _sidShuffle = false;

let _sidShuffleHistory = [];

let _sidSeekDragging = false;

function _sidPsidInfo(bytes) {
  if (!bytes || bytes.length < 0x76) return null;
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== "PSID" && magic !== "RSID") return null;
  const str = function(offset) {
    let out = "";
    for (let i = offset; i < offset + 32 && bytes[i]; i++) out += String.fromCharCode(bytes[i]);
    return out.trim();
  };
  const songs = Math.max(1, (bytes[0x0e] << 8) | bytes[0x0f]);
  const startSong = Math.min(songs, Math.max(1, (bytes[0x10] << 8) | bytes[0x11]));
  return { title: str(0x16), author: str(0x36), released: str(0x56), songs, startSong };
}

// lengths: the subtune lengths in ms (from HVSC), hvsc: the tune's HVSC path
function _sidPlayerItem(entry, info) {
  const lengths = Array.isArray(entry.lengths) && entry.lengths.every(function(ms) { return Number.isFinite(ms) && ms >= 0; }) ? entry.lengths : null;
  return { id: crypto.randomUUID(), name: entry.name, bytes: entry.bytes, info, song: _sidValidSong(entry.song, info), fav: !!entry.fav,
    lengths, hvsc: typeof entry.hvsc === "string" ? entry.hvsc : null };
}

function _sidPlayerAdd(entries, playFirst, startIndex = 0) {
  const added = [];
  entries.forEach(function(entry) {
    const info = _sidPsidInfo(entry.bytes);
    if (!info) { showViceToast(tf("sidPlayerNotSid", { name: entry.name }), true); return; }
    const item = _sidPlayerItem(entry, info);
    _sidPlaylist.push(item);
    added.push(item);
  });
  _sidPlayerShow();
  _sidPlayerRenderList();
  _sidPlayerPersist();
  if (added.length && (playFirst || _sidExtStatus === "stopped")) {
    _sidPlayerPlayIndex(_sidPlaylist.indexOf(added[Math.max(0, Math.min(startIndex, added.length - 1))]));
  }
}

async function _sidPlayerAddFiles(fileList, playFirst) {
  const entries = [];
  for (const file of Array.from(fileList || [])) {
    if (/\.sidpl$/i.test(file.name)) {
      try { _sidPlayerLoadPlaylist(JSON.parse(await file.text()), file.name); }
      catch (_) { showViceToast(tf("sidPlayerBadPlaylist", { name: file.name }), true); }
      continue;
    }
    try { entries.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }); } catch (_) {}
  }
  if (entries.length) _sidPlayerAdd(entries, playFirst);
}

function _sidPlayerPlayIndex(index) {
  const item = _sidPlaylist[index];
  if (!item) return;
  _sidPlaylistIndex = index;
  if (_sidShuffle && _sidShuffleHistory[_sidShuffleHistory.length - 1] !== item.id) _sidShuffleHistory.push(item.id);
  _sidPlayerRenderList();
  _sidPlayerPersist();
  _sidExtStartFile(item.bytes, item.name, item.song);
}

function _sidPlayerPrev() {
  if (!_sidPlaylist.length) return;
  if (_sidShuffle && _sidExtElapsedMs() <= 3000 && _sidShuffleHistory.length > 1) {
    _sidShuffleHistory.pop();
    const back = _sidPlaylist.findIndex(function(item) { return item.id === _sidShuffleHistory[_sidShuffleHistory.length - 1]; });
    if (back >= 0) { _sidPlayerPlayIndex(back); return; }
  }
  // like a CD player: back to the start first, a second press steps back
  const index = _sidExtElapsedMs() > 3000 || _sidPlaylistIndex <= 0 ? _sidPlaylistIndex : _sidPlaylistIndex - 1;
  _sidPlayerPlayIndex(Math.max(0, index));
}

function _sidValidSong(song, info) {
  return Number.isInteger(song) && song >= 1 && song <= info.songs ? song : info.startSong;
}

// Steps the current entry's subtune; a running tune restarts on the new one.
function _sidPlayerSong(delta) {
  const item = _sidPlaylist[_sidPlaylistIndex];
  if (!item || item.info.songs < 2) return;
  const song = Math.max(1, Math.min(item.info.songs, item.song + delta));
  if (song === item.song) return;
  item.song = song;
  _sidPlayerPersist();
  if (_sidExtStatus === "stopped") _sidPlayerRenderList();
  else _sidPlayerPlayIndex(_sidPlaylistIndex);
}

function _sidPlayerNext() {
  if (_sidShuffle) {
    if (_sidPlaylist.length < 2) return;
    const current = _sidPlaylist[_sidPlaylistIndex]?.id;
    let pool = _sidPlaylist.filter(function(item) { return !_sidShuffleHistory.includes(item.id); });
    if (!pool.length) {
      // every tune played: a new round, starting from the current one
      _sidShuffleHistory = current ? [current] : [];
      pool = _sidPlaylist.filter(function(item) { return item.id !== current; });
    }
    _sidPlayerPlayIndex(_sidPlaylist.indexOf(pool[Math.floor(Math.random() * pool.length)]));
    return;
  }
  if (_sidPlaylistIndex < _sidPlaylist.length - 1) _sidPlayerPlayIndex(_sidPlaylistIndex + 1);
}

function _sidPlayerSetShuffle(on) {
  _sidShuffle = !!on;
  const current = _sidPlaylist[_sidPlaylistIndex]?.id;
  _sidShuffleHistory = _sidShuffle && current ? [current] : [];
  const btn = document.getElementById("websid-play-shuffle");
  if (btn) {
    btn.classList.toggle("websid-play-tool--active", _sidShuffle);
    btn.setAttribute("aria-pressed", String(_sidShuffle));
  }
  _sidPlayerPersist();
}

function _sidPlayerRemove(id) {
  const index = _sidPlaylist.findIndex(function(item) { return item.id === id; });
  if (index < 0) return;
  _sidPlaylist.splice(index, 1);
  if (index === _sidPlaylistIndex) {
    _sidExtStop();
    _sidExtFile = null;
    _sidPlaylistIndex = Math.min(index, _sidPlaylist.length - 1);
  } else if (index < _sidPlaylistIndex) {
    _sidPlaylistIndex--;
  }
  _sidPlayerRenderList();
  _sidPlayerPersist();
}

function _sidPlayerClear() {
  _sidExtStop();
  _sidPlaylist = [];
  _sidPlaylistIndex = -1;
  _sidShuffleHistory = [];
  _sidExtFile = null;
  _sidPlayerRenderList();
  _sidPlayerPersist();
}

// The current subtune's length when HVSC knows it, otherwise 0.
function _sidPlayerTuneMs() {
  const item = _sidPlaylist[_sidPlaylistIndex];
  const ms = item?.lengths?.[item.song - 1];
  return ms > 0 ? ms : 0;
}

function _sidPlayerLengthMs() {
  const known = _sidPlayerTuneMs();
  if (known) return Math.max(known, Math.ceil(_sidExtElapsedMs() / 1000) * 1000);
  return Math.max(_SID_TUNE_LENGTH_MS, Math.ceil((_sidExtElapsedMs() + 1) / 60000) * 60000);
}

// Only the playback timer moves on. Doing this from the UI refresh re-entered
// itself (Next renders the list while the status is still "playing") and
// started every remaining tune of the playlist at once.
function _sidPlayerAutoAdvance() {
  if (_sidExtStatus === "playing" && !_sidExtStarting && _sidExtElapsedMs() >= (_sidPlayerTuneMs() || _SID_TUNE_LENGTH_MS)
      && (_sidShuffle ? _sidPlaylist.length > 1 : _sidPlaylistIndex < _sidPlaylist.length - 1)) {
    _sidPlayerNext();
  }
}

function _sidPlayerTickUi() {
  const elapsed = _sidExtElapsedMs();
  const seek = document.getElementById("websid-play-seek");
  if (seek && !_sidSeekDragging) {
    seek.max = String(Math.round(_sidPlayerLengthMs() / 1000));
    seek.value = String(Math.floor(elapsed / 1000));
    seek.disabled = !_sidPlayerCanSeek();
  }
  const len = document.getElementById("websid-play-length");
  if (len) len.textContent = _sidExtFormatTime(_sidPlayerLengthMs());
  const hasPlaylist = _sidPlaylist.length > 0;
  const prev = document.getElementById("websid-play-prev");
  if (prev) prev.disabled = !hasPlaylist;
  const next = document.getElementById("websid-play-next");
  if (next) next.disabled = _sidShuffle ? _sidPlaylist.length < 2 : _sidPlaylistIndex >= _sidPlaylist.length - 1;
  ["websid-play-rew", "websid-play-fwd"].forEach(function(id) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !_sidPlayerCanSeek();
  });
  const play = document.getElementById("websid-play-play");
  if (play) play.disabled = !hasPlaylist && !_sidExtFile;
  const clear = document.getElementById("websid-play-clear");
  if (clear) clear.disabled = !hasPlaylist;
  const save = document.getElementById("websid-play-save-list");
  if (save) save.disabled = !hasPlaylist;
}

let _sidPlayerShownIndex = -1;

// Keeps the current entry visible in the playlist (only inside the list, the
// floating window itself does not move).
function _sidPlayerRevealCurrent(list) {
  const li = list.children[_sidPlaylistIndex];
  if (!li) return;
  const lr = list.getBoundingClientRect(), ir = li.getBoundingClientRect();
  if (ir.top < lr.top) list.scrollTop -= lr.top - ir.top;
  else if (ir.bottom > lr.bottom) list.scrollTop += ir.bottom - lr.bottom;
}

function _sidPlayerRenderList() {
  const list = document.getElementById("websid-play-list");
  if (list) {
    // emptying the list resets its scroll position: keep it
    const scrollTop = list.scrollTop;
    list.textContent = "";
    _sidPlaylist.forEach(function(item, index) {
      const li = document.createElement("li");
      li.className = "websid-play-item" + (index === _sidPlaylistIndex ? " websid-play-item--current" : "");
      li.dataset.id = item.id;
      const no = document.createElement("span");
      no.className = "websid-play-item-no";
      no.textContent = String(index + 1);
      const name = document.createElement("span");
      name.className = "websid-play-item-name";
      name.textContent = item.info.title ? item.info.title + (item.info.author ? " — " + item.info.author : "") : item.name;
      const fav = document.createElement("button");
      fav.type = "button";
      fav.className = "websid-play-item-fav" + (item.fav ? " websid-play-item-fav--on" : "");
      fav.textContent = item.fav ? "★" : "☆";
      fav.setAttribute("aria-label", t("sidPlayerFavorite"));
      fav.setAttribute("aria-pressed", String(!!item.fav));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "websid-play-item-del";
      del.textContent = "×";
      del.setAttribute("aria-label", t("sidPlayerRemove"));
      li.append(no, fav, name, del);
      list.appendChild(li);
    });
    list.scrollTop = scrollTop;
    if (_sidPlaylistIndex !== _sidPlayerShownIndex) {
      _sidPlayerShownIndex = _sidPlaylistIndex;
      _sidPlayerRevealCurrent(list);
    }
  }
  const current = _sidPlaylist[_sidPlaylistIndex];
  const fileEl = document.getElementById("websid-play-file");
  if (fileEl) fileEl.textContent = current ? (current.info.title || current.name) : "";
  const metaEl = document.getElementById("websid-play-meta");
  if (metaEl) metaEl.textContent = current ? [current.info.author, current.info.released].filter(Boolean).join(" · ") : "";
  const engineEl = document.getElementById("websid-play-engine");
  if (engineEl) {
    engineEl.textContent = _sidPlayerEngineLabel();
    engineEl.setAttribute("aria-label", t("sidPreviewEngine") + ": " + engineEl.textContent);
  }
  const songRow = document.getElementById("websid-play-song-row");
  if (songRow) songRow.hidden = !current || current.info.songs < 2;
  const songEl = document.getElementById("websid-play-song");
  if (songEl && current) songEl.textContent = current.song + " / " + current.info.songs;
  const songPrev = document.getElementById("websid-play-song-prev");
  if (songPrev) songPrev.disabled = !current || current.song <= 1;
  const songNext = document.getElementById("websid-play-song-next");
  if (songNext) songNext.disabled = !current || current.song >= current.info.songs;
  const hint = document.getElementById("websid-play-drop-hint");
  if (hint) hint.hidden = _sidPlaylist.length > 0;
  _sidPlayerTickUi();
}

function _sidPlayerSyncButton() {
  const btn = document.getElementById("sid-player-btn");
  if (!btn) return;
  const open = !!document.getElementById("websid-play-dialog")?.open;
  btn.classList.toggle("main-tb-btn--active", open);
  btn.setAttribute("aria-pressed", String(open));
}

function _sidPlayerShow() {
  const dlg = document.getElementById("websid-play-dialog");
  if (!dlg) return;
  const note = document.getElementById("websid-play-note");
  if (note) note.hidden = !document.getElementById("sid-editor-dialog")?.open;
  if (dlg.open) return;
  // A non-modal dialog under an open modal one (SID Editor) is inert, so
  // over a modal editor it has to enter the top layer itself.
  let overModal = false;
  try { overModal = !!document.querySelector("dialog[open]:modal"); } catch (_) {}
  dlg._applyPosition?.();
  try { if (overModal) dlg.showModal(); else dlg.show(); }
  catch (_) { try { dlg.show(); } catch (__) {} }
  _sidPlayerSyncButton();
  _sidPlayerRenderList();
  _sidPlayerPersist();
  if (_sidVizState().open) setTimeout(_sidVizShow, 0);
}

function _sidPlayerToggle() {
  const dlg = document.getElementById("websid-play-dialog");
  if (dlg?.open) dlg.close();
  else _sidPlayerShow();
}

/* Playlist file (.sidpl): JSON with the tunes embedded as base64, because the
 * WebView only hands over file contents, not paths. The same shape is kept in
 * localStorage, so the list and the window's open state survive a restart. */
const _SID_PLAYLIST_FORMAT = "va-sid-playlist";

const _SID_PLAYER_STORE = "c64va-sid-player";

function _sidBytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function _sidBase64ToBytes(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function _sidPlaylistToJson() {
  return {
    format: _SID_PLAYLIST_FORMAT,
    version: 1,
    current: Math.max(0, _sidPlaylistIndex),
    items: _sidPlaylist.map(function(item) {
      return { name: item.name, song: item.song, fav: item.fav || undefined, hvsc: item.hvsc || undefined, lengths: item.lengths || undefined, data: _sidBytesToBase64(item.bytes) };
    })
  };
}

// Returns the decoded entries, or null when the text is not a playlist.
function _sidPlaylistFromJson(json) {
  if (!json || json.format !== _SID_PLAYLIST_FORMAT || !Array.isArray(json.items)) return null;
  const entries = [];
  json.items.forEach(function(item) {
    if (!item || typeof item.name !== "string" || typeof item.data !== "string") return;
    try {
      entries.push({ name: item.name, song: Number(item.song) || 0, fav: item.fav === true, hvsc: item.hvsc, lengths: item.lengths, bytes: _sidBase64ToBytes(item.data) });
    } catch (_) {}
  });
  return { entries, current: Number.isInteger(json.current) ? json.current : 0 };
}

function _sidPlayerLoadPlaylist(json, sourceName) {
  const list = _sidPlaylistFromJson(json);
  if (!list) { showViceToast(tf("sidPlayerBadPlaylist", { name: sourceName }), true); return false; }
  _sidPlayerClear();
  _sidPlayerAdd(list.entries, false, Math.min(list.current, list.entries.length - 1));
  return true;
}

async function _sidPlayerSavePlaylist() {
  if (!_sidPlaylist.length) return;
  const text = JSON.stringify(_sidPlaylistToJson(), null, 1);
  const bytes = Array.from(new TextEncoder().encode(text));
  if (window.electronAPI?.saveBin) {
    const res = await window.electronAPI.saveBin({ bytes, fileName: "playlist.sidpl" });
    if (res?.ok) showViceToast(t("sidPlayerSaved"));
    else if (res && !res.canceled) showViceToast(res.error || t("sidPlayerSaveFailed"), true);
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = "playlist.sidpl";
  a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
}

function _sidPlayerPersist() {
  try {
    const dlg = document.getElementById("websid-play-dialog");
    const state = _sidPlaylistToJson();
    state.open = !!dlg?.open;
    state.shuffle = _sidShuffle;
    localStorage.setItem(_SID_PLAYER_STORE, JSON.stringify(state));
  } catch (_) {
    // too many tunes for localStorage: keep at least the window state
    try { localStorage.setItem(_SID_PLAYER_STORE, JSON.stringify({ open: !!document.getElementById("websid-play-dialog")?.open, shuffle: _sidShuffle })); } catch (__) {}
  }
}

function _sidPlayerRestore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(_SID_PLAYER_STORE) || "null"); } catch (_) {}
  if (!saved) return;
  const list = _sidPlaylistFromJson(saved);
  if (list && list.entries.length) {
    list.entries.forEach(function(entry) {
      const info = _sidPsidInfo(entry.bytes);
      if (info) _sidPlaylist.push(_sidPlayerItem(entry, info));
    });
    _sidPlaylistIndex = _sidPlaylist.length ? Math.max(0, Math.min(list.current, _sidPlaylist.length - 1)) : -1;
  }
  if (saved.shuffle) _sidPlayerSetShuffle(true);
  if (saved.open) _sidPlayerShow();
  else _sidPlayerRenderList();
}

/* ── HVSC (High Voltage SID Collection) in the SID Player ───────────────
 * The catalog is HVSC's DOCUMENTS/Songlengths.md5: every tune's path and its
 * subtune lengths. The backend (hvsc.rs) reads it and the tunes from a local
 * HVSC folder, its cache, or a mirror; searching runs here. */
const _HVSC_RESULT_LIMIT = 300;

const _HVSC_ADD_ALL_MAX = 100;

const _HVSC_STORE = "c64va-sid-hvsc";

const _HVSC_SECTIONS = { MUSICIANS: "Musicians", GAMES: "Games", DEMOS: "Demos" };

// "4:33.108" → 273108 ms; markers after the time, like "(G)", are ignored
function _hvscParseLength(text) {
  const m = /^(\d+):(\d{1,2})(?:\.(\d{1,3}))?/.exec(String(text).trim());
  if (!m) return 0;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000 + (m[3] ? Number(m[3].padEnd(3, "0")) : 0);
}

function _hvscParseCatalog(text) {
  const entries = [];
  let path = null;
  String(text || "").split(/\r?\n/).forEach(function(line) {
    if (line.startsWith("; /")) { path = line.slice(2).trim(); return; }
    const eq = line.indexOf("=");
    if (!path || eq < 0 || line.startsWith(";") || line.startsWith("[")) return;
    // "/MUSICIANS/H/Hubbard_Rob/Commando.sid": the composer folder is the 4th part
    const parts = path.split("/");
    const title = parts[parts.length - 1].replace(/\.sid$/i, "").replace(/_/g, " ");
    const author = parts[1] === "MUSICIANS" && parts.length > 4 ? parts[3].replace(/_/g, " ") : "";
    const lengths = line.slice(eq + 1).trim().split(/\s+/).map(_hvscParseLength);
    entries.push({ p: path, t: title, a: author, s: parts[1], l: lengths, k: path.toLowerCase().replace(/_/g, " ") });
    path = null;
  });
  return entries;
}

// A composer is the MUSICIANS folder of the tune, so GAMES and DEMOS have none.
// Every word must start a word of the name: "rob" is Rob and Robert, not Probe.
function _hvscComposerMatches(entry, words) {
  const name = entry.a.toLowerCase().split(/[\s.-]+/);
  return words.every(function(w) { return name.some(function(n) { return n.startsWith(w); }); });
}

// Every word must occur in the path (title, composer, folders); titles that
// match the query come first.
function _hvscSearch(entries, query, limit = _HVSC_RESULT_LIMIT, field = "all") {
  const words = String(query || "").toLowerCase().replace(/_/g, " ").split(/\s+/).filter(Boolean);
  const phrase = words.join(" ");
  if (phrase.length < 2) return { total: 0, items: [] };
  if (field === "composer") {
    const found = (entries || []).filter(function(e) { return _hvscComposerMatches(e, words); });
    found.sort(function(a, b) { return a.a.localeCompare(b.a) || a.t.localeCompare(b.t); });
    return { total: found.length, items: found.slice(0, limit) };
  }
  const hits = (entries || []).filter(function(e) { return words.every(function(w) { return e.k.includes(w); }); });
  const rank = function(e) {
    const title = e.t.toLowerCase();
    return title === phrase ? 0 : title.startsWith(phrase) ? 1 : title.includes(phrase) ? 2 : e.a.toLowerCase().includes(phrase) ? 3 : 4;
  };
  hits.sort(function(a, b) { return rank(a) - rank(b) || a.t.localeCompare(b.t); });
  return { total: hits.length, items: hits.slice(0, limit) };
}

function _hvscRandom(entries, count) {
  const out = [];
  const used = new Set();
  const n = Math.min(count, (entries || []).length);
  while (out.length < n) {
    const i = Math.floor(Math.random() * entries.length);
    if (!used.has(i)) { used.add(i); out.push(entries[i]); }
  }
  return out;
}

let _hvscEntries = null;

let _hvscVersion = null;

let _hvscSource = "";

let _hvscLoading = null;

let _hvscError = "";

let _hvscResults = [];

let _hvscTotal = 0;

let _hvscBusy = "";

let _hvscLocalPath = "";

let _hvscDownload = null;

// { phase: "download" | "extract", done, total } while the whole collection is fetched

function _hvscAvailable() {
  return !!window.electronAPI?.hvscCatalog;
}

function _hvscOpen() {
  return !document.getElementById("websid-hvsc")?.hidden;
}

function _hvscPersist() {
  try {
    localStorage.setItem(_HVSC_STORE, JSON.stringify({ open: _hvscOpen(), query: document.getElementById("websid-hvsc-search")?.value || "", field: _hvscField() }));
  } catch (_) {}
}

async function _hvscLoad(refresh) {
  if (!_hvscAvailable()) { _hvscRender(); return; }
  if (_hvscLoading) return _hvscLoading;
  if (_hvscEntries && !refresh) return;
  _hvscError = "";
  _hvscLoading = (async function() {
    try {
      const status = await window.electronAPI.hvscStatus();
      _hvscLocalPath = status?.localOk ? status.localPath : "";
      const res = await window.electronAPI.hvscCatalog(!!refresh);
      _hvscEntries = _hvscParseCatalog(res.text);
      _hvscVersion = res.version || null;
      _hvscSource = res.source;
    } catch (e) {
      _hvscError = String(e?.message || e);
    }
  })();
  _hvscRender();
  try { await _hvscLoading; } finally { _hvscLoading = null; }
  _hvscRunSearch();
}

function _hvscField() {
  return document.getElementById("websid-hvsc-field")?.value === "composer" ? "composer" : "all";
}

function _hvscFieldSync() {
  const text = t(_hvscField() === "composer" ? "sidHvscSearchComposer" : "sidHvscSearch");
  const search = document.getElementById("websid-hvsc-search");
  search?.setAttribute("placeholder", text);
  search?.setAttribute("aria-label", text);
}

function _hvscRunSearch() {
  const query = document.getElementById("websid-hvsc-search")?.value || "";
  const res = _hvscSearch(_hvscEntries, query, _HVSC_RESULT_LIMIT, _hvscField());
  _hvscResults = res.items;
  _hvscTotal = res.total;
  _hvscRender();
  _hvscPersist();
}

function _hvscShowRandom() {
  if (!_hvscEntries) return;
  const search = document.getElementById("websid-hvsc-search");
  if (search) search.value = "";
  _hvscResults = _hvscRandom(_hvscEntries, 25);
  _hvscTotal = _hvscResults.length;
  _hvscRender();
  _hvscPersist();
}

function _hvscStatusText() {
  if (!_hvscAvailable()) return t("sidHvscDesktopOnly");
  if (_hvscLoading) return t("sidHvscLoading");
  if (_hvscDownload) {
    const { phase, done, total } = _hvscDownload;
    if (phase === "extract") return tf("sidHvscUnpacking", { done: done.toLocaleString(), total: total.toLocaleString() });
    const mb = function(bytes) { return (bytes / 1048576).toFixed(1); };
    return tf("sidHvscDownloading", { done: mb(done), total: total ? mb(total) : "?" });
  }
  if (_hvscError) return tf("sidHvscLoadFailed", { error: _hvscError });
  if (!_hvscEntries) return "";
  if (_hvscBusy) return _hvscBusy;
  const count = _hvscEntries.length.toLocaleString();
  let text = _hvscVersion ? tf("sidHvscCountVersion", { version: _hvscVersion, count }) : tf("sidHvscCount", { count });
  text += " · " + (_hvscSource === "local" ? t("sidHvscSourceLocal") : t("sidHvscSourceOnline"));
  const query = document.getElementById("websid-hvsc-search")?.value.trim();
  if (query) text += " · " + (_hvscTotal ? tf("sidHvscResults", { shown: _hvscResults.length, total: _hvscTotal }) : t("sidHvscNoResults"));
  else if (!_hvscResults.length) text += " · " + t("sidHvscHint");
  return text;
}

function _hvscRender() {
  const panel = document.getElementById("websid-hvsc");
  const btn = document.getElementById("websid-play-hvsc");
  if (btn) {
    btn.classList.toggle("websid-play-tool--active", _hvscOpen());
    btn.setAttribute("aria-pressed", String(_hvscOpen()));
  }
  if (!panel || panel.hidden) return;
  const status = document.getElementById("websid-hvsc-status");
  if (status) {
    status.textContent = _hvscStatusText();
    status.classList.toggle("websid-hvsc-status--error", !!_hvscError);
  }
  const ready = !!_hvscEntries && !_hvscLoading;
  const random = document.getElementById("websid-hvsc-random");
  if (random) random.disabled = !ready;
  const refresh = document.getElementById("websid-hvsc-refresh");
  if (refresh) refresh.disabled = !_hvscAvailable() || !!_hvscLoading || _hvscSource === "local";
  const addAll = document.getElementById("websid-hvsc-add-all");
  if (addAll) addAll.disabled = !ready || !_hvscResults.length || !!_hvscBusy;
  const download = document.getElementById("websid-hvsc-download");
  if (download) {
    download.disabled = !_hvscAvailable() || !!_hvscLoading;
    download.classList.toggle("websid-play-tool--active", !!_hvscDownload);
    download.setAttribute("aria-label", _hvscDownload ? t("sidHvscDownloadCancel") : t("sidHvscDownloadAll"));
  }
  const folder = document.getElementById("websid-hvsc-folder");
  if (folder) {
    folder.disabled = !_hvscAvailable() || !!_hvscLoading || !!_hvscDownload;
    folder.classList.toggle("websid-play-tool--active", !!_hvscLocalPath);
    folder.setAttribute("aria-label", _hvscLocalPath ? tf("sidHvscFolderClear", { path: _hvscLocalPath }) : t("sidHvscFolder"));
  }
  const search = document.getElementById("websid-hvsc-search");
  if (search) search.disabled = !ready;
  const hvscField = document.getElementById("websid-hvsc-field");
  if (hvscField) hvscField.disabled = !ready;
  const list = document.getElementById("websid-hvsc-list");
  if (!list) return;
  list.textContent = "";
  const inList = new Set(_sidPlaylist.map(function(item) { return item.hvsc; }).filter(Boolean));
  _hvscResults.forEach(function(entry, index) {
    const li = document.createElement("li");
    li.className = "websid-play-item websid-hvsc-item" + (inList.has(entry.p) ? " websid-hvsc-item--added" : "");
    li.dataset.index = String(index);
    li.dataset.path = entry.p;
    const name = document.createElement("span");
    name.className = "websid-play-item-name";
    name.textContent = entry.t;
    const who = document.createElement("span");
    who.className = "websid-hvsc-item-who";
    who.textContent = entry.a || _HVSC_SECTIONS[entry.s] || entry.s;
    const len = document.createElement("span");
    len.className = "websid-hvsc-item-len";
    len.textContent = _sidExtFormatTime(entry.l[0] || 0) + (entry.l.length > 1 ? " +" + (entry.l.length - 1) : "");
    const add = document.createElement("button");
    add.type = "button";
    add.className = "websid-hvsc-item-btn websid-hvsc-item-add";
    add.textContent = "+";
    add.setAttribute("aria-label", t("sidHvscAdd"));
    const save = document.createElement("button");
    save.type = "button";
    save.className = "websid-hvsc-item-btn websid-hvsc-item-save";
    save.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    save.setAttribute("aria-label", t("sidHvscSave"));
    li.append(name, who, len, add, save);
    list.appendChild(li);
  });
}

function _hvscFileName(entry) {
  return entry.p.slice(entry.p.lastIndexOf("/") + 1);
}

async function _hvscFetchBytes(entry) {
  try {
    return new Uint8Array(await window.electronAPI.hvscFetch(entry.p));
  } catch (e) {
    showViceToast(tf("sidHvscFetchFailed", { name: _hvscFileName(entry), error: String(e?.message || e) }), true);
    return null;
  }
}

// Adds a tune and plays it if asked; a tune already in the playlist is only played.
async function _hvscAddEntry(entry, play) {
  const existing = _sidPlaylist.findIndex(function(item) { return item.hvsc === entry.p; });
  if (existing >= 0) {
    if (play) _sidPlayerPlayIndex(existing);
    return true;
  }
  const bytes = await _hvscFetchBytes(entry);
  if (!bytes) return false;
  _sidPlayerAdd([{ name: _hvscFileName(entry), bytes, lengths: entry.l, hvsc: entry.p }], play);
  _hvscRender();
  return true;
}

async function _hvscAddAll() {
  const batch = _hvscResults.slice(0, _HVSC_ADD_ALL_MAX);
  if (!batch.length || _hvscBusy) return;
  const known = new Set(_sidPlaylist.map(function(item) { return item.hvsc; }));
  const entries = [];
  try {
    for (let i = 0; i < batch.length; i++) {
      _hvscBusy = tf("sidHvscAdding", { done: i + 1, total: batch.length });
      _hvscRender();
      if (known.has(batch[i].p)) continue;
      const bytes = await _hvscFetchBytes(batch[i]);
      if (bytes) entries.push({ name: _hvscFileName(batch[i]), bytes, lengths: batch[i].l, hvsc: batch[i].p });
    }
  } finally {
    _hvscBusy = "";
  }
  if (entries.length) _sidPlayerAdd(entries, false);
  _hvscRender();
}

async function _hvscSaveEntry(entry) {
  const bytes = await _hvscFetchBytes(entry);
  if (!bytes || !window.electronAPI?.saveBin) return;
  const fileName = _hvscFileName(entry);
  const res = await window.electronAPI.saveBin({ bytes: Array.from(bytes), fileName });
  if (res?.ok) showViceToast(tf("sidHvscSaved", { name: fileName }));
  else if (res && !res.canceled) showViceToast(res.error || t("sidPlayerSaveFailed"), true);
}

async function _hvscToggleFolder() {
  if (!_hvscAvailable()) return;
  if (_hvscLocalPath) {
    await window.electronAPI.hvscClearFolder();
    _hvscLocalPath = "";
  } else {
    const res = await window.electronAPI.hvscChooseFolder();
    if (!res || res.canceled) return;
    if (!res.ok) { showViceToast(t("sidHvscNotHvsc"), true); return; }
    _hvscLocalPath = res.path;
  }
  _hvscEntries = null;
  await _hvscLoad(false);
}

// Fetches the official .7z into a folder the user picks and switches to it;
// pressed again while running, it cancels.
async function _hvscDownloadAll() {
  if (!window.electronAPI?.hvscDownloadAll) return;
  if (_hvscDownload) { window.electronAPI.hvscCancelDownload(); return; }
  if (!(await _showConfirm(t("sidHvscDownloadConfirm")))) return;
  _hvscDownload = { phase: "download", done: 0, total: 0 };
  _hvscRender();
  let res = null;
  try {
    res = await window.electronAPI.hvscDownloadAll();
  } catch (e) {
    showViceToast(tf("sidHvscDownloadFailed", { error: String(e?.message || e) }), true);
  } finally {
    _hvscDownload = null;
  }
  if (res?.ok) {
    _hvscLocalPath = res.path;
    _hvscEntries = null;
    showViceToast(tf("sidHvscDownloaded", { path: res.path }));
    await _hvscLoad(false);
  } else {
    _hvscRender();
  }
}

function _hvscSetOpen(open) {
  const panel = document.getElementById("websid-hvsc");
  if (!panel) return;
  panel.hidden = !open;
  _hvscRender();
  _hvscPersist();
  if (open) {
    _hvscLoad(false);
    setTimeout(function() { document.getElementById("websid-hvsc-search")?.focus(); }, 0);
  }
}

function _hvscRestore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(_HVSC_STORE) || "null"); } catch (_) {}
  const search = document.getElementById("websid-hvsc-search");
  if (search && typeof saved?.query === "string") search.value = saved.query;
  const hvscField = document.getElementById("websid-hvsc-field");
  if (hvscField && saved?.field === "composer") hvscField.value = "composer";
  _hvscFieldSync();
  if (saved?.open) _hvscSetOpen(true);
}

/* ── SID Player spectrum analyzer (#sid-viz-dialog) ─────────────────────
 * LED-style bars: an AnalyserNode after the shared master gain, log-spaced bands,
 * cells that fade out slowly, and a mirrored floor in perspective. Drawn only
 * while the window is open. State: localStorage c64va-sid-viz {open, bands, w, h}. */
const _SID_VIZ_STORE = "c64va-sid-viz";

const _SID_VIZ_ROWS = 10;

const _SID_VIZ_FLOOR_ROWS = 5;

let _sidVizBands = 16;

let _sidVizRaf = 0;

let _sidVizGlow = null;

let _sidVizLevels = null;

let _sidVizVa = null;



let _sidVizData = null;

let _sidVizWithPlayer = false;

// Band edges in Hz, log-spaced between 30 Hz and 14 kHz (or Nyquist).
function _sidVizBandEdges(bands, sampleRate) {
  const lo = 30, hi = Math.min(14000, sampleRate / 2);
  const edges = [];
  for (let i = 0; i <= bands; i++) edges.push(lo * Math.pow(hi / lo, i / bands));
  return edges;
}

// Band levels 0..1 from byte frequency data (the loudest bin of each band).
function _sidVizBandLevels(data, sampleRate, fftSize, bands) {
  const edges = _sidVizBandEdges(bands, sampleRate);
  const hz = sampleRate / fftSize;
  const out = new Array(bands).fill(0);
  for (let b = 0; b < bands; b++) {
    const from = Math.max(1, Math.floor(edges[b] / hz));
    const to = Math.max(from, Math.min(data.length - 1, Math.ceil(edges[b + 1] / hz) - 1));
    let peak = 0;
    for (let i = from; i <= to; i++) peak = Math.max(peak, data[i]);
    out[b] = peak / 255;
  }
  return out;
}

// Row color: green at the bottom through yellow to orange at the top.
function _sidVizRowHue(row, rows) {
  return 125 - (row / Math.max(1, rows - 1)) * 100;
}

function _sidVizTap(gain) {
  const an = gain.context.createAnalyser();
  an.fftSize = 2048;
  an.minDecibels = -90;
  an.maxDecibels = -25;
  an.smoothingTimeConstant = 0.55;
  gain.connect(an);
  return an;
}
function _sidVizAnalysers() {
  const list = [];
  if (_sidAudio && _sidMasterGain) {
    if (!_sidVizVa) _sidVizVa = _sidVizTap(_sidMasterGain);
    list.push(_sidVizVa);
  }
  if (_sidExtGain) {
    if (!_sidVizExt) _sidVizExt = _sidVizTap(_sidExtGain);
    list.push(_sidVizExt);
  }
  return list;
}

function _sidVizReadLevels() {
  const levels = new Array(_sidVizBands).fill(0);
  _sidVizAnalysers().forEach(function(an) {
    if (!_sidVizData || _sidVizData.length !== an.frequencyBinCount) _sidVizData = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(_sidVizData);
    _sidVizBandLevels(_sidVizData, an.context.sampleRate, an.fftSize, _sidVizBands).forEach(function(v, i) { levels[i] = Math.max(levels[i], v); });
  });
  return levels;
}

function _sidVizDraw() {
  const canvas = document.getElementById("sid-viz-canvas");
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  const bands = _sidVizBands, rows = _SID_VIZ_ROWS;
  if (!_sidVizGlow || _sidVizGlow.length !== bands * rows) {
    _sidVizGlow = new Float32Array(bands * rows);
    _sidVizLevels = new Float32Array(bands);
  }
  // bars rise at once and fall smoothly; a cell left behind keeps a fading glow
  const raw = _sidVizReadLevels();
  for (let b = 0; b < bands; b++) _sidVizLevels[b] = Math.max(raw[b], _sidVizLevels[b] - 0.035);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const padX = w * 0.06, top = h * 0.08;
  const floorH = h * 0.2;
  const base = h - floorH;
  const colW = (w - padX * 2) / bands;
  const rowH = (base - top) / rows;
  const gapX = colW * 0.22, gapY = rowH * 0.18;
  const cx = w / 2;
  for (let b = 0; b < bands; b++) {
    const lit = _sidVizLevels[b] * rows;
    const x = padX + b * colW + gapX / 2;
    for (let r = 0; r < rows; r++) {
      const k = b * rows + r;
      const on = Math.max(0, Math.min(1, lit - r));
      _sidVizGlow[k] = Math.max(on, _sidVizGlow[k] * 0.9);
      const alpha = Math.max(0.05, _sidVizGlow[k]);
      ctx.fillStyle = "hsla(" + _sidVizRowHue(r, rows) + ", 82%, 52%, " + alpha.toFixed(3) + ")";
      ctx.fillRect(x, base - (r + 1) * rowH + gapY / 2, colW - gapX, rowH - gapY);
    }
    // mirrored floor: the lowest rows again, flattened and spread in perspective
    let y = base + gapY / 2;
    for (let f = 0; f < _SID_VIZ_FLOOR_ROWS; f++) {
      const fh = (floorH / (_SID_VIZ_FLOOR_ROWS + 1.5)) * (1 - f * 0.12);
      const s0 = 1 + f * 0.07, s1 = 1 + (f + 1) * 0.07;
      const x0 = x, x1 = x + colW - gapX;
      const glow = Math.max(0.05, _sidVizGlow[b * rows + f]);
      ctx.fillStyle = "hsla(" + _sidVizRowHue(f, rows) + ", 82%, 45%, " + (glow * 0.4 * (1 - f / _SID_VIZ_FLOOR_ROWS)).toFixed(3) + ")";
      ctx.beginPath();
      ctx.moveTo(cx + (x0 - cx) * s0, y);
      ctx.lineTo(cx + (x1 - cx) * s0, y);
      ctx.lineTo(cx + (x1 - cx) * s1, y + fh * 0.78);
      ctx.lineTo(cx + (x0 - cx) * s1, y + fh * 0.78);
      ctx.closePath();
      ctx.fill();
      y += fh;
    }
  }
}

function _sidVizLoop() {
  _sidVizRaf = 0;
  if (!document.getElementById("sid-viz-dialog")?.open) return;
  _sidVizDraw();
  _sidVizRaf = requestAnimationFrame(_sidVizLoop);
}

function _sidVizState() {
  try { return JSON.parse(localStorage.getItem(_SID_VIZ_STORE) || "{}") || {}; } catch (_) { return {}; }
}

function _sidVizSave(patch) {
  try { localStorage.setItem(_SID_VIZ_STORE, JSON.stringify(Object.assign(_sidVizState(), patch))); } catch (_) {}
}

function _sidVizSyncButton() {
  const open = !!document.getElementById("sid-viz-dialog")?.open;
  const btn = document.getElementById("websid-play-viz");
  if (btn) {
    btn.classList.toggle("websid-play-tool--active", open);
    btn.setAttribute("aria-pressed", String(open));
  }
}

function _sidVizShow() {
  const dlg = document.getElementById("sid-viz-dialog");
  if (!dlg || dlg.open) return;
  const card = dlg.querySelector(".sid-viz-card");
  const saved = _sidVizState();
  if (card && saved.w > 0) card.style.width = saved.w + "px";
  if (card && saved.h > 0) card.style.height = saved.h + "px";
  // like the SID Player: above an open modal editor it has to be modal itself
  let overModal = false;
  try { overModal = !!document.querySelector("dialog[open]:modal"); } catch (_) {}
  dlg._applyPosition?.();
  try { if (overModal) dlg.showModal(); else dlg.show(); } catch (_) { try { dlg.show(); } catch (__) {} }
  _sidVizSyncButton();
  _sidVizSave({ open: true });
  if (!_sidVizRaf) _sidVizRaf = requestAnimationFrame(_sidVizLoop);
}

function _sidVizToggle() {
  const dlg = document.getElementById("sid-viz-dialog");
  if (dlg?.open) dlg.close();
  else _sidVizShow();
}

function _sidVizSetBands(n) {
  _sidVizBands = [8, 16, 24, 32].includes(n) ? n : 16;
  const select = document.getElementById("sid-viz-bands");
  if (select) select.value = String(_sidVizBands);
  _sidVizSave({ bands: _sidVizBands });
}

/* ── SID Editor channel spectrum (#sid-ana) ──────────────────────────────
 * One LED spectrum per voice. The audio output is one mix, so each voice's
 * spectrum is computed from the registers the engine plays: the harmonics of its
 * waveform at its frequency, an ADSR approximation, the filter and the volume.
 * While the window is open the playing engine records its frames (e.snap); the
 * row events, which follow the audio in every engine, say how far they have
 * sounded. Note previews have no engine frames here and do not show. */
var _sidAna = { raf: 0, env: [], levels: [], rowFrame: -1, rowAt: 0, last: null };

const _SID_ANA_BANDS = 16;

const _SID_ANA_ROWS = 10;

const _SID_ANA_DB = 48;

/* One 50 Hz frame of a voice's envelope: { env 0..1, st 0 release / 1 attack / 2 decay, gate }. */
function _sidAnaEnvStep(s, regs, b, trig) {
  const g = regs[b + 4] & 1;
  if (g && (!s.gate || trig)) s.st = 1;
  else if (!g && s.gate) s.st = 0;
  s.gate = g;
  const su = (regs[b + 6] >> 4) / 15;
  if (s.st === 1) {
    s.env += 20 / _SID_ATK[regs[b + 5] >> 4];
    if (s.env >= 1) { s.env = 1; s.st = 2; }
  } else if (s.st === 2) {
    s.env = su + (s.env - su) * Math.exp(-92 / _SID_DCR[regs[b + 5] & 15]);
  } else {
    s.env *= Math.exp(-92 / _SID_DCR[regs[b + 6] & 15]);
  }
  return s.env;
}

// Gain of the SID filter at hz for a chip's registers, for a voice routed through it.
function _sidAnaFilterGain(regs, at, hz) {
  const mode = regs[at + 0x18];
  const fc = Math.max(30, 30 + ((regs[at + 0x15] & 7) | (regs[at + 0x16] << 3)) * 5.8);
  const r = hz / fc, r2 = r * r, den = Math.sqrt(1 + r2 * r2);
  let gain = 0;
  if (mode & 0x10) gain = Math.max(gain, 1 / den);
  if (mode & 0x20) gain = Math.max(gain, r / den);
  if (mode & 0x40) gain = Math.max(gain, r2 / den);
  return gain;
}

/* Band levels 0..1 of one voice: at = the chip's first register, bit = its voice 0..2.
   Combined waveforms sound like the AND of the two: the weaker harmonic counts. */
function _sidAnaVoiceLevels(regs, at, bit, env, bands) {
  const out = new Array(bands).fill(0);
  const b = at + bit * 7, ctl = regs[b + 4], mode = regs[at + 0x18];
  const hz = (regs[b] | (regs[b + 1] << 8)) * _sidClockHz() / 16777216;
  const routed = (regs[at + 0x17] >> bit) & 1;
  const vol = env * (mode & 15) / 15;
  if (!(ctl & 0xF0) || (ctl & 8) || hz < 1 || vol <= 0 || (bit === 2 && !routed && (mode & 0x80))) return out;
  const edges = _sidVizBandEdges(bands, 44100);
  const duty = (regs[b + 2] | ((regs[b + 3] & 15) << 8)) / 4096;
  const put = function(band, f, amp) {
    const a = amp * vol * (routed ? _sidAnaFilterGain(regs, at, f) : 1);
    if (a > 0) out[band] = Math.max(out[band], Math.min(1, 1 + 20 * Math.log10(a) / _SID_ANA_DB));
  };
  for (let n = 1; n * hz < edges[bands]; n++) {
    const f = n * hz;
    if (f < edges[0]) continue;
    let band = 0;
    while (band < bands - 1 && f >= edges[band + 1]) band++;
    let amp = Infinity;
    if (ctl & 0x10) amp = Math.min(amp, n & 1 ? 1 / (n * n) : 0);
    if (ctl & 0x20) amp = Math.min(amp, 1 / n);
    if (ctl & 0x40) amp = Math.min(amp, Math.abs(Math.sin(Math.PI * n * duty)) / n);
    if (amp !== Infinity && !(ctl & 0x80)) put(band, f, amp);
  }
  // noise: flat up to about eight times the set frequency
  if (ctl & 0x80) {
    for (let k = 0; k < bands; k++) {
      const f = Math.sqrt(edges[k] * edges[k + 1]);
      if (f <= hz * 8) put(k, f, 0.35);
    }
  }
  return out;
}

// A playing engine records its frames while the window is open.
function _sidAnaAttach() {
  const box = document.getElementById("sid-ana");
  const on = !!box && !box.hidden;
  if (_sidWaPlay && _sidWaPlay.e) {
    if (on && !_sidWaPlay.e.snap) _sidWaPlay.e.snap = [];
    if (!on) _sidWaPlay.e.snap = null;
  }
}

function _sidAnaRow(ev) {
  _sidAna.rowFrame = ev.frame || 0;
  _sidAna.rowAt = performance.now();
}

/* Takes the recorded frames that have sounded by now (the frames of a row are 20 ms
   apart, and at most one long row runs on from the last row event). */
function _sidAnaAdvance(now) {
  const e = _sidWaPlay && _sidWaPlay.e;
  if (!e || !e.snap || _sidAna.rowFrame < 0) return;
  const target = _sidAna.rowFrame + Math.min(255, Math.floor((now - _sidAna.rowAt) / 20));
  while (e.snap.length && e.snap[0].frame <= target) {
    const fr = e.snap.shift();
    fr.trig.forEach(function(trig, v) {
      const s = _sidAna.env[v] || (_sidAna.env[v] = { env: 0, st: 0, gate: 0 });
      _sidAnaEnvStep(s, fr.regs, 25 * (v / 3 | 0) + 7 * (v % 3), trig);
    });
    _sidAna.last = fr.regs;
  }
}

function _sidAnaDraw() {
  const cv = document.getElementById("sid-ana-canvas");
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(cv.clientWidth * dpr)), H = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  _sidAnaAdvance(performance.now());
  const voices = _sidVoiceCount(), rows = voices / 3;
  const bands = _SID_ANA_BANDS, led = _SID_ANA_ROWS;
  const cellW = W / 3, cellH = H / rows, pad = 8 * dpr, label = 14 * dpr;
  const playing = !!_sidWaPlay;
  ctx.font = "700 " + Math.round(10 * dpr) + "px 'IBM Plex Mono', monospace";
  ctx.textBaseline = "top";
  for (let v = 0; v < voices; v++) {
    const chip = v / 3 | 0, bit = v % 3, s = _sidAna.env[v];
    const regs = _sidAna.last;
    const raw = playing && regs && s && 25 * chip + 25 <= regs.length
      ? _sidAnaVoiceLevels(regs, 25 * chip, bit, s.env, bands) : null;
    const lv = _sidAna.levels[v] || (_sidAna.levels[v] = new Float32Array(bands));
    const x0 = bit * cellW + pad, y0 = chip * cellH + pad;
    ctx.fillStyle = _SID_ROLL_VOICE[v];
    ctx.fillText(voices > 3 ? "S" + (chip + 1) + " V" + (bit + 1) : "V" + (bit + 1), x0, y0);
    const colW = (cellW - pad * 2) / bands, rowH = (cellH - pad * 2 - label) / led;
    for (let k = 0; k < bands; k++) {
      // bars rise at once and fall smoothly, like the SID Player's analyzer
      lv[k] = Math.max(raw ? raw[k] : 0, lv[k] - 0.035);
      const lit = lv[k] * led;
      for (let r = 0; r < led; r++) {
        const on = Math.max(0, Math.min(1, lit - r));
        ctx.fillStyle = "hsla(" + _sidVizRowHue(r, led) + ", 82%, 52%, " + Math.max(0.06, on).toFixed(3) + ")";
        ctx.fillRect(x0 + k * colW + colW * 0.11, y0 + label + (led - 1 - r) * rowH + rowH * 0.09, colW * 0.78, rowH * 0.82);
      }
    }
  }
}

function _sidAnaLoop() {
  _sidAna.raf = 0;
  const box = document.getElementById("sid-ana");
  if (!box || box.hidden || !document.getElementById("sid-editor-dialog")?.open) return;
  _sidAnaAttach();
  _sidAnaDraw();
  _sidAna.raf = requestAnimationFrame(_sidAnaLoop);
}

function _sidAnaState() {
  try { return JSON.parse(localStorage.getItem("c64va-sid-ana") || "{}") || {}; } catch (_) { return {}; }
}

function _sidAnaSave(patch) {
  try { localStorage.setItem("c64va-sid-ana", JSON.stringify(Object.assign(_sidAnaState(), patch))); } catch (_) {}
}

function _sidAnaShow(on) {
  const box = document.getElementById("sid-ana");
  if (!box) return;
  box.hidden = !on;
  const btn = document.getElementById("sid-ana-btn");
  if (btn) { btn.classList.toggle("sid-metronome-on", !!on); btn.setAttribute("aria-pressed", String(!!on)); }
  _sidAnaSave({ open: !!on });
  _sidAnaAttach();
  if (!on) return;
  const st = _sidAnaState();
  if (Number.isFinite(st.width)) box.style.width = st.width + "px";
  if (Number.isFinite(st.height)) box.style.height = st.height + "px";
  const x = Number.isFinite(st.left) ? st.left : 120, y = Number.isFinite(st.top) ? st.top : 160;
  _sidPlaceFixed(box, x, y);
  requestAnimationFrame(function() { _sidPlaceFixed(box, x, y); });
  if (!_sidAna.raf) _sidAna.raf = requestAnimationFrame(_sidAnaLoop);
}

function _sidAnaRestore() {
  if (_sidAnaState().open) _sidAnaShow(true);
}

function _sidSetupAna() {
  const box = document.getElementById("sid-ana");
  const hdr = box && box.querySelector(".sid-trk-float-hdr");
  if (!box || !hdr) return;
  document.getElementById("sid-ana-btn")?.addEventListener("click", function() { _sidAnaShow(box.hidden); });
  document.getElementById("sid-ana-close")?.addEventListener("click", function() { _sidAnaShow(false); });
  let move = null, sizeAtDown = null;
  hdr.addEventListener("pointerdown", function(e) {
    if (e.target.closest("button")) return;
    const rect = box.getBoundingClientRect();
    move = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    try { hdr.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  hdr.addEventListener("pointermove", function(e) { if (move) _sidDragTo(move, box, e.clientX - move.dx, e.clientY - move.dy); });
  const endMove = function() { _sidDragFlush(move, box); if (move && move.at) _sidAnaSave({ left: move.at.x, top: move.at.y }); move = null; };
  hdr.addEventListener("pointerup", endMove);
  hdr.addEventListener("pointercancel", endMove);
  box.addEventListener("pointerdown", function() { sizeAtDown = { w: box.offsetWidth, h: box.offsetHeight }; });
  window.addEventListener("pointerup", function() {
    if (!sizeAtDown) return;
    const w = box.offsetWidth, h = box.offsetHeight;
    if (w > 0 && h > 0 && (w !== sizeAtDown.w || h !== sizeAtDown.h)) _sidAnaSave({ width: w, height: h });
    sizeAtDown = null;
  });
}

function setupSidVisualizer() {
  const dlg = document.getElementById("sid-viz-dialog");
  if (!dlg) return;
  document.getElementById("websid-play-viz")?.addEventListener("click", _sidVizToggle);
  document.getElementById("sid-viz-close")?.addEventListener("click", function() { dlg.close(); });
  document.getElementById("sid-viz-bands")?.addEventListener("change", function(e) { _sidVizSetBands(Number(e.target.value)); });
  dlg.addEventListener("keydown", function(e) { if (e.key === "Escape") { e.preventDefault(); dlg.close(); } });
  dlg.addEventListener("close", function() {
    if (dlg.open) return;
    if (_sidVizRaf) { cancelAnimationFrame(_sidVizRaf); _sidVizRaf = 0; }
    _sidVizSyncButton();
    // closed together with the player: it reopens with the player
    if (!_sidVizWithPlayer) _sidVizSave({ open: false });
    _sidVizWithPlayer = false;
  });
  const card = dlg.querySelector(".sid-viz-card");
  if (card && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(function() {
      if (dlg.open) _sidVizSave({ w: Math.round(card.offsetWidth), h: Math.round(card.offsetHeight) });
    }).observe(card);
  }
  const saved = _sidVizState();
  _sidVizSetBands(Number(saved.bands) || 16);
  if (saved.open && document.getElementById("websid-play-dialog")?.open) setTimeout(_sidVizShow, 0);
}

function _sidExternalCoreStop(keepDialog = false) {
  const state = _sidExternalCore;
  if (!state) return;
  _sidExternalCore = null;
  state.active = false;
  if (state.timer) clearInterval(state.timer);
  _sidExtSources.forEach(function(src){ try { src.stop(); } catch (_) {} });
  _sidExtSources.clear();
  if (state.paused && _sidExtAudio) _sidExtAudio.resume();
  if (!keepDialog) _sidPlayerHideWindow();
  // released at once: a render still in flight finishes on its own session
  // lock, and waiting for it let stale sessions pile up on quick switches
  window.electronAPI.releaseSidFile(state.sessionId).catch(function() {});
}

async function _vaSidPlayFileBytes(bytes, filename, song = 0) {
  if (!window.electronAPI?.renderSidFile || !window.electronAPI?.releaseSidFile) {
    showViceToast(t("sidPlayerNeedsDesktop"), true);
    return false;
  }
  _sidStop(true);
  const ac = _sidPlayerAudio();
  if (ac.state === "suspended") ac.resume();
  // A renderer hosszú DOM-művelet alatt nem fut. Tíz másodpercnyi már az
  // AudioContext szálán ütemezett hang ezért akkor is folytatódik.
  const aheadTarget = _sidPlayerAheadSeconds(_sidPlayerBufferSize());
  const aheadRefill = aheadTarget * 0.7;
  const state = {
    sessionId: crypto.randomUUID(), active: true, busy: false, timer: null,
    queue: Promise.resolve(), nextTime: ac.currentTime + 0.08, fileBytes: Array.from(bytes),
    tuneBytes: Array.from(bytes), renderedMs: 0, skipMs: 0, seeking: false, song
  };
  _sidExternalCore = state;
  const pump = async function(force) {
    if (!state.active || state.busy || (state.seeking && !force)) return false;
    state.busy = true;
    try {
      do {
        const payload = { sessionId: state.sessionId, sampleRate: ac.sampleRate,
          model: _sidPreviewModel, engine: _sidPreviewEngine, frames: 20, skipMs: Math.max(0, Math.round(state.skipMs)), song: state.song };
        if (state.fileBytes) payload.fileBytes = state.fileBytes;
        state.queue = window.electronAPI.renderSidFile(payload);
        const rendered = await state.queue;
        const pcm = _sidDecodePcm16(rendered.pcm);
        if (!state.active) return false;
        if (!pcm.length) throw new Error("Empty SID audio buffer.");
        const samples = pcm.length / rendered.channels;
        state.fileBytes = null;
        state.renderedMs += state.skipMs + samples * 1000 / ac.sampleRate;
        state.skipMs = 0;
        state.nextTime = Math.max(state.nextTime, ac.currentTime + 0.02);
        _sidPlayBuffer(pcm, state.nextTime, _sidExtSources, rendered.channels, _sidExtGain);
        state.nextTime += samples / ac.sampleRate;
        // A Web Audio szál előre ütemezett hangja UI-terhelés alatt is tovább szól.
      } while (state.active && !state.paused && (!state.seeking || force) && state.nextTime - ac.currentTime < aheadTarget);
      return true;
    } catch (e) {
      if (state.active) {
        // the player window stays open; only this tune stops
        _sidExtStop();
        showViceToast(_sidEngineName() + ": " + (e?.message || e), true);
      }
      return false;
    } finally {
      state.busy = false;
    }
  };
  state.pump = pump;
  if (!(await pump())) return false;
  if (!state.active) return false;
  // the core resolves "0 = start song" from the header; show what it plays
  window.electronAPI.sidFileInfo?.(state.sessionId).then(function(info) {
    const item = _sidPlaylist[_sidPlaylistIndex];
    if (!state.active || !item || item.bytes !== bytes || !info?.song) return;
    item.song = info.song;
    _sidPlayerRenderList();
  }).catch(function() {});
  _sidPlayerShowTune(filename, _sidEngineLabel());
  state.timer = setInterval(function() {
    if (state.active && !state.paused && state.nextTime - ac.currentTime < aheadRefill) pump();
  }, 50);
  return true;
}

// The scheduled audio is dropped; forward seeks continue the session, backward
// ones restart the tune in a new session and skip to the target.
async function _vaSidSeek(state, targetMs) {
  state.seeking = true;
  try {
    while (state.busy) await state.queue.catch(function() {});
    if (!state.active) return;
    _sidExtSources.forEach(function(src){ try { src.stop(); } catch (_) {} });
    _sidExtSources.clear();
    if (targetMs >= state.renderedMs) {
      state.skipMs = Math.round(targetMs - state.renderedMs);
    } else {
      window.electronAPI.releaseSidFile(state.sessionId).catch(function() {});
      state.sessionId = crypto.randomUUID();
      state.fileBytes = state.tuneBytes;
      state.renderedMs = 0;
      state.skipMs = targetMs;
    }
    state.nextTime = 0;
    await state.pump(true);
  } finally {
    state.seeking = false;
  }
}

/* Tracker playback driven by the JS engine. The engine yields the frame of
 * every row; those become timed highlight events, and the frames are rendered
 * by the backend's SID (or the synth). Tune data is re-read for every chunk, so
 * edits are heard while playing. */
function _sidWaClock(w) {
  return w.audio ? _sidAudio.currentTime : performance.now() / 1000;
}

function _sidWaTune() {
  const playAll = _sidPlayMode === "all";
  return _sidTuneData({ song: playAll ? ((_sidSong && _sidSong.length) ? _sidSong : [0]) : [_sidPat] });
}

function _sidWaEngine(td, audio) {
  const e = _sidEngineNew(td);
  if (_sidPlayMode === "all") {
    e.opos = Math.max(0, Math.min(td.song.length - 1, _sidSongPlayPos | 0));
    e.pat = td.song[e.opos] | 0;
  }
  // the 6502 player reads row 0 `speed` frames after init; the previews start
  // the engine one frame before row 0 instead
  if (audio) e.tick = 1;
  return e;
}
// The engine's volume is 0 until the first note, and on reSID that step is a loud click on the
// first note (the backend settles the chip on the first frame). The registers the first note
// will set, per chip, from a dry run: the frames before it carry them.
function _sidWaOpeningMixer(td) {
  const e = _sidWaEngine(td, true);
  const open = new Array(e.chips).fill(null);
  for (let k = 0; k < 6000 && open.includes(null); k++) {
    _sidEngFrame(e);
    open.forEach(function(regs, c) {
      const at = 25 * c;
      if (!regs && (e.regs[at + 0x18] & 15)) open[c] = Array.from(e.regs.subarray(at + 0x15, at + 0x19));
    });
  }
  return open;
}
function _sidWaOpenFrame(w, frame) {
  w.open.forEach(function(regs, c) {
    if (!regs) return;
    const at = 25 * c;
    if (frame[at + 0x18] & 15) { w.open[c] = null; return; }
    regs.forEach(function(value, i) { frame[at + 0x15 + i] = value; });
  });
  return frame;
}
function _sidWaStart(audio) {
  if (audio) _sidEnsureAudio();
  const td = _sidWaTune();
  const e = _sidWaEngine(td, audio);
  _sidWaPlay = { e: e, audio: !!audio, core: !!audio && _sidUsesNativeCore(), sidCoreSession: audio && _sidUsesNativeCore() ? crypto.randomUUID() : null, coreQueue: Promise.resolve(), events: [], next: 0, timer: null, open: audio && _sidUsesNativeCore() && _sidPreviewEngine === "resid" ? _sidWaOpeningMixer(td) : null };
  _sidWaPlay.next = _sidWaClock(_sidWaPlay) + 0.05;
  _sidWaSchedule();
  _sidWaPlay.timer = setInterval(_sidWaSchedule, 20);
  _sidTimer = _sidWaPlay.timer;
}

function _sidWaSchedule() {
  const w = _sidWaPlay;
  if (!w) return;
  const now = _sidWaClock(w);
  const chunk = w.core ? 10 : 20;
  const lookahead = w.core ? 0.3 : 0.5;
  while (w.next - now < lookahead) {
    const e = w.e;
    const td = _sidWaTune();
    e.td = td; e.a = td.a;
    if (e.opos >= td.song.length) { e.opos = 0; e.row = 0; }
    if (_sidPlayMode !== "all") e.pat = td.song[0] | 0;
    const first = e.frame, from = e.rows.length;
    if (w.audio) {
      if (w.core) {
        const frames = [];
        for (let k = 0; k < chunk; k++) {
          _sidEngFrame(e);
          const frame = _sidNativeFrame(e);
          frames.push(w.open ? _sidWaOpenFrame(w, frame) : frame);
        }
        const playAt = w.next;
        w.coreQueue = w.coreQueue.then(function() {
          if (_sidWaPlay !== w) return;
          return _sidRenderNativeFrames(frames, _sidAudio.sampleRate, w.sidCoreSession).then(function(data) {
            if (_sidWaPlay === w && !_sidPaused) _sidPlayBuffer(data, Math.max(_sidAudio.currentTime + 0.01, playAt));
          });
        }).catch(function(error) { console.warn("VA SID Core playback failed:", error); });
      } else {
        _sidPlayBuffer(_sidRenderEngine(e, chunk, _sidAudio.sampleRate), w.next);
      }
    } else {
      for (let k = 0; k < chunk; k++) _sidEngFrame(e);
    }
    for (let k = from; k < e.rows.length; k++) {
      const r = e.rows[k];
      w.events.push({ time: w.next + (r.frame - first) / _sidFps(), row: r.row, opos: r.opos, pat: r.pat, frame: r.frame });
    }
    e.rows.length = 0;
    w.next += chunk / _sidFps();
  }
  while (w.events.length && w.events[0].time <= now) _sidWaShowRow(w.events.shift());
}

/* Playback counter LCD: song position, pattern, row and play time while playing;
   stopped, it shows the edit position (selected song step, pattern and row). */
function _sidLcdShow(pos, pat, row, frames, playing) {
  const two = function(v) { return String(Math.max(0, v | 0)).padStart(2, "0"); };
  const set = function(id, text) { const el = document.getElementById(id); if (el && el.textContent !== text) el.textContent = text; };
  set("sid-lcd-pos", two(pos));
  set("sid-lcd-pat", two(pat));
  set("sid-lcd-row", two(row));
  const tenths = Math.floor(Math.max(0, frames) / 5);
  const sec = Math.floor(tenths / 10);
  set("sid-lcd-time", Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0") + "." + (tenths % 10));
  document.getElementById("sid-lcd")?.classList.toggle("sid-lcd--playing", !!playing);
}

// runs from _setupAppSettings at startup too: no module-level const here (TDZ)
function _sidLcdApplyColor() {
  let color = "green";
  try { if (localStorage.getItem("c64va-sid-lcd-color") === "red") color = "red"; } catch (_) {}
  document.getElementById("sid-lcd")?.classList.toggle("sid-lcd--red", color === "red");
  const sel = document.getElementById("sid-lcd-color");
  if (sel) sel.value = color;
}

function _sidLcdIdle() {
  _sidLcdShow(_sidSongPos, _sidPat, _sidSel ? _sidSel.row : 0, 0, false);
}

function _sidWaShowRow(ev) {
  _sidRow = ev.row;
  _sidAnaRow(ev);
  _sidLcdShow(_sidPlayMode === "all" ? ev.opos : _sidSongPos, ev.pat, ev.row, ev.frame || 0, true);
  if (_sidPlayMode === "all") {
    _sidSongPlayPos = ev.opos;
    _sidPlayPat = ev.pat;
    if (_sidPat !== ev.pat) _sidSetPattern(ev.pat, true);
    if (ev.row === 0) _sidBuildSongList();
  }
  _sidVkbdTrackRow(ev);
  if ((ev.row % _SID_ROWS_PER_BEAT) === 0) {
    _sidMetronomeBeat(((ev.row / _SID_ROWS_PER_BEAT) | 0) % _SID_BEATS_PER_BAR === 0);
  }
  const t = document.getElementById("sid-tracker");
  if (t) {
    t.querySelectorAll("tr.sid-playing").forEach(function(r){ r.classList.remove("sid-playing"); });
    const tr = t.querySelector('tr.sid-trow[data-row="' + ev.row + '"]');
    if (tr) { tr.classList.add("sid-playing"); tr.scrollIntoView({ block: "nearest" }); }
  }
}

function _sidWaStop() {
  const stopped = _sidWaPlay;
  if (stopped && stopped.timer) clearInterval(stopped.timer);
  _sidWaPlay = null;
  _sidAna.rowFrame = -1; _sidAna.last = null; _sidAna.env = [];
  if (stopped && stopped.sidCoreSession && window.electronAPI?.releaseSidPreview) {
    stopped.coreQueue.finally(function() {
      window.electronAPI.releaseSidPreview(stopped.sidCoreSession).catch(function() {});
    });
  }
  _sidPreviewSources.forEach(function(src){ try { src.stop(); } catch (_) {} });
  _sidPreviewSources.clear();
}

function _sidStop(stopExternal = false) {
  if (typeof _sidVkbdClearPlay === "function") _sidVkbdClearPlay();
  if (typeof _sidRecordStop === "function") _sidRecordStop();
  if (_sidTimer) { clearInterval(_sidTimer); _sidTimer = null; }
  // Az editor saját preview-ja nem zárhatja be a külön SID Player ablakot.
  if (stopExternal && typeof _sidExternalCore !== "undefined" && _sidExternalCore) _sidExternalCoreStop();
  _sidWaStop();
  _sidPaused = false;
  const t = document.getElementById("sid-tracker");
  if (t) t.querySelectorAll("tr.sid-playing").forEach(function(r){ r.classList.remove("sid-playing"); });
  _sidUpdatePauseButton();
  const back = _sidPlayReturn;
  _sidPlayReturn = null;
  if (back) {
    // a song step picked during playback wins
    const pat = back.songPos === _sidSongPos ? back.pat : _sidSong[_sidSongPos];
    if (pat !== _sidPat) _sidSetPattern(pat, true);
  }
  _sidBuildSongList();
  if (typeof _sidLcdIdle === "function") _sidLcdIdle();
}

async function _sidPlay(resetPosition = true) {
  if (_sidTimer) { clearInterval(_sidTimer); _sidTimer = null; }
  _sidWaStop();
  const playAll = _sidPlayMode === "all";
  if (resetPosition) {
    _sidSongPlayPos = 0;
    if (playAll) {
      if (!_sidPlayReturn) _sidPlayReturn = { pat: _sidPat, songPos: _sidSongPos };
      _sidPlayPat = (_sidSong && _sidSong.length) ? _sidSong[0] : 0;
      _sidSetPattern(_sidPlayPat, true);
    } else {
      _sidPlayReturn = null;
      _sidPlayPat = _sidPat;
    }
    _sidRow = 0;
    _sidBuildSongList();
  }
  _sidPaused = false;

  _sidWaStart(true);
  _sidUpdatePauseButton();
}

function _sidPauseToggle() {
  if (_sidPaused) {
    _sidPlay(false);
    return;
  }
  if (_sidTimer) {
    clearInterval(_sidTimer); _sidTimer = null;
    _sidWaStop();
    _sidPaused = true;
    _sidUpdatePauseButton();
    return;
  }
  _sidPlay(true);
}

/* ── Tune data shared by the 6502 player, the JS engine and the UB export ──
 * Per-instrument parameters are flattened into one byte array per parameter
 * (indexed by instrument number), the wave/arpeggio tables are concatenated
 * (at most 255 steps in all). */
function _sidFreqTables() {
  const clock = _sidClockHz();
  if (_sidFreqTables.cache && _sidFreqTables.cache.clock === clock) return _sidFreqTables.cache;
  const f = [], semi = [];
  for (let n = 0; n < 96; n++) {
    const hz = 440 * Math.pow(2, (n - 57) / 12);
    f.push(Math.min(0xFFFF, Math.round(hz * 16777216 / clock)));
  }
  for (let n = 0; n < 96; n++) semi.push(Math.max(0, f[Math.min(95, n + 1)] - f[n]) || (n ? semi[n - 1] : 0));
  _sidFreqTables.cache = { f: f, semi: semi, clock: clock };
  return _sidFreqTables.cache;
}

function _sidTuneData(opts) {
  opts = opts || {};
  const insts = (opts.insts || _sidInsts || []).map(_sidInstNorm);
  if (!insts.length) insts.push(_sidInstNorm(null));
  const patterns = opts.patterns || _sidPatterns || [];
  const songSrc = opts.song || ((_sidSong && _sidSong.length) ? _sidSong : [0]);
  const song = songSrc.map(function(idx){ return Math.max(0, Math.min(Math.max(0, patterns.length - 1), idx | 0)); });
  const speed = Math.max(1, Math.min(255, (opts.speed !== undefined ? opts.speed : _sidSpeed) | 0));
  const a = { ictl:[], iad:[], isr:[], ipwl:[], ipwh:[], icul:[], icuh:[], icel:[], iceh:[], icsp:[], ifl:[], ires:[],
    imode:[], ivol:[], ivdl:[], ivsp:[], ivdp:[], ipms:[], ipmnl:[], ipmnh:[], ipmxl:[], ipmxh:[], igt:[], ihr:[],
    iffw:[], itst:[], itln:[], itlp:[], itsp:[], tw:[], tn:[], ta:[] };
  insts.forEach(function(o) {
    a.ictl.push(_sidInstCtrl(o)); a.iad.push((o.a << 4) | o.d); a.isr.push((o.s << 4) | o.r);
    a.ipwl.push(o.pw & 0xFF); a.ipwh.push(o.pw >> 8);
    a.icul.push(o.cut & 0xFF); a.icuh.push(o.cut >> 8); a.icel.push(o.cutEnd & 0xFF); a.iceh.push(o.cutEnd >> 8);
    // the sweep runs from cut toward cutEnd: the sign of the per-frame step follows the direction
    a.icsp.push(!o.cutSpeed ? 0 : o.cutEnd >= o.cut ? o.cutSpeed : (256 - o.cutSpeed) & 0xFF);
    a.ifl.push((o.filt ? 1 : 0) | (o.cutPing ? 2 : 0)); a.ires.push(o.res << 4);
    a.imode.push((o.lp?0x10:0) | (o.bp?0x20:0) | (o.hp?0x40:0) | (o.off3?0x80:0)); a.ivol.push(o.songVol ? 0x10 : o.vol); // $10 = the song's
    a.ivdl.push(o.vibDelay); a.ivsp.push(o.vibSpeed); a.ivdp.push(o.vibDepth);
    const pmin = Math.min(o.pwmMin, o.pwmMax), pmax = Math.max(o.pwmMin, o.pwmMax);
    a.ipms.push(o.pwmSpeed); a.ipmnl.push(pmin & 0xFF); a.ipmnh.push(pmin >> 8); a.ipmxl.push(pmax & 0xFF); a.ipmxh.push(pmax >> 8);
    a.igt.push(o.gateTimer); a.ihr.push(o.hr ? 1 : 0); a.iffw.push(o.firstWave);
    // identical step runs are stored once: the 255-step table space goes further
    const bytes = o.table.map(function(s){ return [s.w & 0xFF, s.n & 0xFF, s.abs ? 1 : 0]; });
    let at = -1;
    for (let k = 0; bytes.length && k + bytes.length <= a.tw.length && at < 0; k++) {
      if (bytes.every(function(x, i){ return a.tw[k + i] === x[0] && a.tn[k + i] === x[1] && a.ta[k + i] === x[2]; })) at = k;
    }
    const steps = at >= 0 ? bytes : bytes.slice(0, Math.max(0, 255 - a.tw.length));
    a.itst.push(at >= 0 ? at : a.tw.length); a.itln.push(steps.length);
    a.itlp.push(o.tableLoop >= 0 && o.tableLoop < steps.length ? o.tableLoop : 0xFF);
    a.itsp.push(o.tableSpeed);
    if (at < 0) steps.forEach(function(x){ a.tw.push(x[0]); a.tn.push(x[1]); a.ta.push(x[2]); });
  });
  const chips = patterns[0] && patterns[0].length > 3 ? 2 : 1;
  const vol = Math.max(0, Math.min(15, (opts.vol !== undefined ? opts.vol : _sidVol()) | 0));
  const vol2 = Math.max(0, Math.min(15, (opts.vol2 !== undefined ? opts.vol2 : opts.vol !== undefined ? opts.vol : _sidVol2()) | 0));
  return { speed: speed, vol: vol, vol2: vol2, insts: insts, patterns: patterns, song: song.length ? song : [0], a: a, chips: chips };
}

/* Cell → player bytes: note 1..96 (0 = none), instrument (out-of-range → 0), fx code, fx value. */
function _sidCellBytes(c, instCount) {
  const note = c && c.note != null ? Math.max(0, Math.min(95, c.note | 0)) + 1 : 0;
  const inst = c ? (c.inst | 0) & 0xFF : 0;
  const fx = c && c.fx ? ({ V: 1, U: 2, D: 3, C: 4, F: 5 })[c.fx] || 0 : 0;
  return [note, inst < instCount ? inst : 0, fx, c ? (c.fxval | 0) & 0xFF : 0];
}

/* ── JS engine: a frame-exact model of the exported 6502 player ─────────────
 * One _sidEngFrame call = one IRQ of the player (sid_frame). It keeps the SID
 * registers the player has written in e.regs (25 per SID, the second SID's
 * after the first's); the Web Audio preview renders them with _sidSynthRender,
 * and the tests compare them with the 6502 code. Filter and volume are per SID. */
function _sidEngineNew(td) {
  const voice = function() {
    return { on:0, inst:0, note:0, gate:0, jon:0, ffr:0, ctl:0, sl:0, fvo:0, fvs:0, fvc:0,
      vdl:0, vcn:0, vdr:0, vof:0, vst:0, pw:0, pwd:0, tpos:0, tcnt:0, wav:0, nof:0, nab:0 };
  };
  const filter = function() {
    return { own: 0xFF, cut: 0, spd: 0, tgt: 0, start: 0, end: 0, ping: 0, res: 0, mode: 0, route: 0 };
  };
  const chips = td.chips, voices = chips * 3;
  return { td: td, a: td.a, ft: _sidFreqTables(), chips: chips, base: [0, 7, 14, 25, 32, 39].slice(0, voices),
    regs: new Uint8Array(25 * chips), trig: new Array(voices).fill(false),
    tick: td.speed, spd: td.speed, row: 0, opos: 0, pat: td.song[0] | 0, frame: 0, rows: [],
    v: Array.from({ length: voices }, voice), vols: [td.vol | 0, (td.vol2 !== undefined ? td.vol2 : td.vol) | 0], fs: [filter(), filter()] };
}

function _sidEngTab(e, s, k) {
  const w = e.a.tw[k] | 0;
  if (w) s.wav = w & 0xFE;
  s.nof = e.a.tn[k] | 0;
  s.nab = e.a.ta[k] | 0;
}

function _sidEngNoteOn(e, v, n, i) {
  const a = e.a, s = e.v[v], chip = v / 3 | 0, f = e.fs[chip], base = e.base[v];
  s.ctl &= 0xFE;
  e.regs[base + 4] = s.ctl;
  e.trig[v] = true;
  s.note = n; s.inst = i; s.on = 1; s.gate = 1; s.jon = 1;
  s.sl = 0; s.fvo = 0; s.fvs = 0; s.fvc = 0; s.pwd = 0; s.vof = 0; s.tpos = 0; s.nof = 0; s.nab = 0; s.vdr = 1;
  s.ffr = a.iffw[i];
  s.pw = a.ipwl[i] | (a.ipwh[i] << 8);
  s.vdl = a.ivdl[i];
  s.vcn = ((a.ivsp[i] + 1) & 0xFF) >> 1 || 1;
  s.tcnt = a.itsp[i];
  s.wav = a.ictl[i];
  let m = e.ft.semi[n], mul = a.ivdp[i], acc = 0;
  while (mul) { if (mul & 1) acc = (acc + m) & 0xFFFF; m = (m << 1) & 0xFFFF; mul >>= 1; }
  s.vst = acc >> 5;
  if (a.itln[i]) _sidEngTab(e, s, a.itst[i]);
  e.regs[base + 5] = a.iad[i];
  e.regs[base + 6] = a.isr[i];
  if (a.ivol[i] < 0x10) e.vols[chip] = a.ivol[i];
  if (a.ifl[i] & 1) {
    f.own = v;
    f.cut = f.start = a.icul[i] | (a.icuh[i] << 8);
    f.end = f.tgt = a.icel[i] | (a.iceh[i] << 8);
    f.spd = a.icsp[i]; f.ping = a.ifl[i] & 2; f.res = a.ires[i]; f.mode = a.imode[i];
    f.route |= 1 << (v % 3);
  } else {
    f.route &= ~(1 << (v % 3)) & 0xFF;
  }
}

function _sidEngRow(e) {
  const td = e.td, pat = td.patterns[e.pat];
  e.rows.push({ frame: e.frame, row: e.row, opos: e.opos, pat: e.pat });
  for (let v = 0; v < e.v.length; v++) {
    const b = _sidCellBytes(pat ? pat[v][e.row] : null, td.insts.length);
    const s = e.v[v];
    if (b[0]) _sidEngNoteOn(e, v, b[0] - 1, b[1]);
    const fx = b[2], val = b[3];
    if (fx !== 1) s.fvo = 0;
    if (fx === 4) s.gate = 0;
    else if (fx === 5) { if (val) e.spd = val; }
    else if (fx === 1) {
      const hold = (val >> 4) || 1;
      if (hold === s.fvc) { s.fvc = 0; s.fvs ^= 0xFF; } else s.fvc = (s.fvc + 1) & 0xFF;
      const d = (val & 0x0F) * 4;
      s.fvo = s.fvs ? d : (0x10000 - d) & 0xFFFF;
    }
    else if (fx === 2) s.sl = (s.sl + val) & 0xFFFF;
    else if (fx === 3) s.sl = (s.sl - val) & 0xFFFF;
  }
  e.row++;
  if (e.row >= _SID_ROWS) {
    e.row = 0;
    e.opos++;
    if (e.opos >= td.song.length) e.opos = 0;
    e.pat = td.song[e.opos] | 0;
  }
}

/* Gate timer / hard restart: gt frames before a row that starts a new note on
   this voice the gate is cleared (and with hard restart ADSR is zeroed). */
function _sidEngHr(e) {
  const a = e.a;
  for (let v = 0; v < e.v.length; v++) {
    const s = e.v[v];
    if (!s.on) continue;
    const gt = a.igt[s.inst];
    if (!gt || gt !== e.tick || gt === e.spd) continue;
    const pat = e.td.patterns[e.pat];
    if (!_sidCellBytes(pat ? pat[v][e.row] : null, e.td.insts.length)[0]) continue;
    s.gate = 0;
    if (a.ihr[s.inst]) { e.regs[e.base[v] + 5] = 0; e.regs[e.base[v] + 6] = 0; }
  }
}

function _sidEngUpdate(e) {
  const a = e.a;
  for (let v = 0; v < e.v.length; v++) {
    const s = e.v[v];
    if (!s.on) continue;
    const i = s.inst, base = e.base[v];
    let ctl;
    if (s.jon) {
      s.jon = 0;
      if (s.ffr) { ctl = s.ffr; s.ffr = 0; } else ctl = s.wav | s.gate;
    } else {
      if (a.itln[i]) {
        s.tcnt = (s.tcnt - 1) & 0xFF;
        if (!s.tcnt) {
          s.tcnt = a.itsp[i];
          s.tpos = (s.tpos + 1) & 0xFF;
          if (s.tpos >= a.itln[i]) s.tpos = a.itlp[i] === 0xFF ? a.itln[i] - 1 : a.itlp[i];
          _sidEngTab(e, s, (s.tpos + a.itst[i]) & 0xFF);
        }
      }
      ctl = s.wav | s.gate;
    }
    s.ctl = ctl;
    e.regs[base + 4] = ctl;
    let n;
    if (s.nab) n = s.nof;
    else if (s.nof & 0x80) { const sum = s.nof + s.note; n = sum >= 256 ? sum - 256 : 0; }
    else n = s.nof + s.note;
    if (n >= 96) n = 95;
    const fr = (e.ft.f[n] + s.sl + s.fvo + s.vof) & 0xFFFF;
    e.regs[base] = fr & 0xFF;
    e.regs[base + 1] = fr >> 8;
    if (a.ivsp[i] && a.ivdp[i]) {
      if (s.vdl) s.vdl--;
      else {
        s.vof = s.vdr ? (s.vof + s.vst) & 0xFFFF : (s.vof - s.vst) & 0xFFFF;
        s.vcn = (s.vcn - 1) & 0xFF;
        if (!s.vcn) { s.vcn = a.ivsp[i]; s.vdr ^= 1; }
      }
    }
    e.regs[base + 2] = s.pw & 0xFF;
    e.regs[base + 3] = (s.pw >> 8) & 0xFF;
    const ps = a.ipms[i];
    if (ps) {
      const mx = a.ipmxl[i] | (a.ipmxh[i] << 8), mn = a.ipmnl[i] | (a.ipmnh[i] << 8);
      if (!s.pwd) {
        s.pw = (s.pw + ps) & 0xFFFF;
        if (s.pw >= mx) { s.pw = mx; s.pwd = 1; }
      } else {
        const p = s.pw - ps;
        if (p < 0 || p <= mn) { s.pw = mn; s.pwd = 0; } else s.pw = p;
      }
    }
  }
  for (let c = 0; c < e.chips; c++) {
    const f = e.fs[c], at = 25 * c;
    e.regs[at + 0x15] = f.cut & 7;
    e.regs[at + 0x16] = (f.cut >> 3) & 0xFF;
    e.regs[at + 0x17] = (f.res | f.route) & 0xFF;
    e.regs[at + 0x18] = (f.mode | e.vols[c]) & 0xFF;
    if (f.own !== 0xFF && f.spd) {
      let reach;
      if (f.spd < 0x80) {
        f.cut = (f.cut + f.spd) & 0xFFFF;
        reach = f.cut >= f.tgt;
      } else {
        const cut = f.cut + f.spd - 256;
        f.cut = cut & 0xFFFF;
        reach = cut < 0 || cut <= f.tgt;
      }
      if (reach) {
        f.cut = f.tgt;
        if (f.ping) { f.tgt = f.tgt === f.end ? f.start : f.end; f.spd = (256 - f.spd) & 0xFF; }
        else f.spd = 0;
      }
    }
  }
}

function _sidEngFrame(e) {
  e.trig.fill(false);
  e.tick = (e.tick - 1) & 0xFF;
  if (!e.tick) { e.tick = e.spd; _sidEngRow(e); }
  _sidEngHr(e);
  _sidEngUpdate(e);
  if (e.snap) e.snap.push({ frame: e.frame, regs: e.regs.slice(), trig: e.trig.slice() });
  e.frame++;
  return e.regs;
}

/* ── Small SID synthesizer: preview fallback without the backend ──────────
 * Renders one 50 Hz frame of register state: triangle/saw/pulse/noise with
 * the SID's AND-combined waveforms, test bit, ring modulation and hard sync
 * (voice 1 ← 3, 2 ← 1, 3 ← 2), an ADSR approximation and a resonant
 * state-variable filter with routing, LP/BP/HP and 3 OFF. Not cycle exact. */
function _sidSynthNew(sr) {
  return { sr: sr, ph: [0, 0, 0], env: [0, 0, 0], st: [0, 0, 0], gate: [0, 0, 0], nz: [0, 0, 0], nzc: [0, 0, 0], lp: 0, bp: 0, hp: 0 };
}

function _sidSynthRender(sy, regs, trig, out, off, count) {
  const sr = sy.sr, dt = 1 / sr, clk = _sidClockHz() / 16777216 / sr;
  const fr = [0, 0, 0], pw = [0, 0, 0], ctl = [0, 0, 0], at = [0, 0, 0], kd = [1, 1, 1], su = [0, 0, 0], kr = [1, 1, 1];
  for (let v = 0; v < 3; v++) {
    const b = 7 * v;
    fr[v] = (regs[b] | (regs[b + 1] << 8)) * clk;
    pw[v] = (regs[b + 2] | ((regs[b + 3] & 15) << 8)) / 4096;
    ctl[v] = regs[b + 4];
    at[v] = dt / Math.max(0.002, _SID_ATK[regs[b + 5] >> 4] / 1000);
    kd[v] = Math.exp(-dt * 4.6 / Math.max(0.006, _SID_DCR[regs[b + 5] & 15] / 1000));
    su[v] = (regs[b + 6] >> 4) / 15;
    kr[v] = Math.exp(-dt * 4.6 / Math.max(0.006, _SID_DCR[regs[b + 6] & 15] / 1000));
    const g = ctl[v] & 1;
    if (g && (!sy.gate[v] || (trig && trig[v]))) sy.st[v] = 1;
    else if (!g && sy.gate[v]) sy.st[v] = 0;
    sy.gate[v] = g;
  }
  const cut = (regs[0x15] & 7) | (regs[0x16] << 3);
  const fc = Math.min(30 + cut * 5.8, sr * 0.4);
  const fk = 2 * Math.sin(Math.PI * fc / (2 * sr));
  const q = 1 / (0.707 + (regs[0x17] >> 4) * 0.3);
  const route = regs[0x17] & 7, mode = regs[0x18], vol = (mode & 15) / 15;
  const wrapped = [false, false, false];
  for (let i = 0; i < count; i++) {
    for (let v = 0; v < 3; v++) {
      wrapped[v] = false;
      if (ctl[v] & 8) { sy.ph[v] = 0; continue; }
      sy.ph[v] += fr[v];
      if (sy.ph[v] >= 1) { sy.ph[v] -= Math.floor(sy.ph[v]); wrapped[v] = true; }
    }
    for (let v = 0; v < 3; v++) if ((ctl[v] & 2) && wrapped[(v + 2) % 3]) sy.ph[v] = 0;
    let direct = 0, filt = 0;
    for (let v = 0; v < 3; v++) {
      let e = sy.env[v];
      if (sy.st[v] === 1) { e += at[v]; if (e >= 1) { e = 1; sy.st[v] = 2; } }
      else if (sy.st[v] === 2) e = su[v] + (e - su[v]) * kd[v];
      else e *= kr[v];
      sy.env[v] = e;
      if (e < 1e-5) continue;
      const p = sy.ph[v], c = ctl[v];
      let w = 0xFFF, any = false;
      if (c & 0x10) {
        let tri = p < 0.5 ? p * 2 : 2 - p * 2;
        if ((c & 4) && sy.ph[(v + 2) % 3] >= 0.5) tri = 1 - tri;
        w &= (tri * 4095) | 0; any = true;
      }
      if (c & 0x20) { w &= (p * 4095) | 0; any = true; }
      if (c & 0x40) { w &= p >= pw[v] ? 4095 : 0; any = true; }
      if (c & 0x80) {
        const k = (p * 16) | 0;
        if (k !== sy.nzc[v]) { sy.nzc[v] = k; sy.nz[v] = (Math.random() * 4096) | 0; }
        w &= sy.nz[v]; any = true;
      }
      if (!any) continue;
      const smp = (w / 4095 - 0.5) * 2 * e;
      if (route & (1 << v)) filt += smp;
      else if (!(v === 2 && (mode & 0x80))) direct += smp;
    }
    for (let k = 0; k < 2; k++) {
      sy.lp += fk * sy.bp;
      sy.hp = filt - sy.lp - q * sy.bp;
      sy.bp += fk * sy.hp;
    }
    if (!Number.isFinite(sy.lp) || !Number.isFinite(sy.bp)) { sy.lp = 0; sy.bp = 0; sy.hp = 0; }
    let fo = 0;
    if (mode & 0x10) fo += sy.lp;
    if (mode & 0x20) fo += sy.bp;
    if (mode & 0x40) fo += sy.hp;
    out[off + i] = (direct + fo) * vol * 0.22;
  }
}

/* Runs the engine for `frames` frames and renders the audio. hook(e, frame)
   runs before each frame (note previews trigger notes / release from it). */
function _sidRenderEngine(e, frames, sr, hook) {
  const synths = e.synths || (e.synths = Array.from({ length: e.chips }, function() { return _sidSynthNew(sr); }));
  const total = Math.ceil(frames * sr / _sidFps());
  const parts = synths.map(function() { return new Float32Array(total); });
  let pos = 0, acc = 0;
  for (let k = 0; k < frames; k++) {
    if (hook) hook(e, k);
    _sidEngFrame(e);
    acc += sr / _sidFps();
    const n = Math.min(total - pos, Math.floor(acc) - pos);
    if (n > 0) {
      synths.forEach(function(sy, c) {
        _sidSynthRender(sy, e.regs.subarray(25 * c, 25 * c + 25), e.trig.slice(3 * c, 3 * c + 3), parts[c], pos, n);
      });
      pos += n;
    }
  }
  if (parts.length === 1) return parts[0];
  // SID 1 left, SID 2 right
  const out = new Float32Array(total * 2);
  for (let i = 0; i < total; i++) { out[i * 2] = parts[0][i]; out[i * 2 + 1] = parts[1][i]; }
  out.channels = 2;
  return out;
}

// channels: 1, or 2 for interleaved stereo (tunes with several SIDs)
// output: the node to play into, on a context of its own that must not be woken up here
function _sidPlayBuffer(data, when, sources = _sidPreviewSources, channels = data.channels || 1, output = null) {
  const ac = output ? output.context : _sidEnsureAudio();
  const samples = Math.max(1, data.length / channels);
  const buf = ac.createBuffer(channels, samples, ac.sampleRate);
  for (let c = 0; c < channels; c++) {
    const out = new Float32Array(samples);
    for (let i = 0; i < samples; i++) out[i] = data[i * channels + c] || 0;
    buf.copyToChannel(out, c);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(output || _sidMasterGain || ac.destination);
  src.start(Math.max(ac.currentTime, when));
  sources.add(src);
  src.onended = function() { sources.delete(src); };
  return src;
}

function _sidUsesNativeCore() {
  return typeof window.electronAPI?.renderSidPreview === "function";
}

function _sidDecodePcm16(base64) {
  const raw = atob(base64);
  const out = new Float32Array(raw.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const value = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    out[i] = (value & 0x8000 ? value - 0x10000 : value) / 32768;
  }
  return out;
}

function _sidRenderNativeFrames(frames, sampleRate, sessionId) {
  const payload = { sampleRate: Math.round(sampleRate), model: _sidPreviewModel, engine: _sidPreviewEngine, ntsc: _sidIsNtsc(), frames: frames };
  if (sessionId) payload.sessionId = sessionId;
  return window.electronAPI.renderSidPreview(payload).then(function(base64) {
    const pcm = _sidDecodePcm16(base64);
    if (frames[0].length > 26) pcm.channels = 2;
    return pcm;
  });
}

/* One backend frame: the 25 registers per SID + the voices whose note restarted
   (the player clears and sets the gate within the frame; the chip needs the edge). */
function _sidNativeFrame(engine) {
  const out = Array.from(engine.regs);
  out.push(engine.trig.reduce(function(m, on, v) { return on ? m | (1 << v) : m; }, 0));
  return out;
}

function _sidRenderNative(engine, frameCount, sampleRate, hook) {
  const frames = [];
  for (let frame = 0; frame < frameCount; frame++) {
    if (hook) hook(engine, frame);
    _sidEngFrame(engine);
    frames.push(_sidNativeFrame(engine));
  }
  return _sidRenderNativeFrames(frames, sampleRate);
}

/* ── Export ── */
function _sidWaveByte(inst) {
  return (inst.tri?0x10:0) | (inst.saw?0x20:0) | (inst.pul?0x40:0) | (inst.noi?0x80:0) | (inst.ring?0x04:0) | (inst.sync?0x02:0) | 0x01;
}

function _sidInstBytes(ins) {
  return [_sidWaveByte(ins), (ins.a<<4)|ins.d, (ins.s<<4)|ins.r,
          ins.pw&0xFF, (ins.pw>>8)&0x0F, ins.cut&0x07, (ins.cut>>3)&0xFF,
          (ins.res<<4), ((ins.lp?0x10:0)|(ins.bp?0x20:0)|(ins.hp?0x40:0))|ins.vol];
}

/* Binary save/load: [numInst][numPat] + 9 bytes/inst + 4 bytes/cell
 * (note+1, inst, fxCode, fxval). A leading 0xFE marker byte distinguishes
 * this versioned layout from pre-effect-column saves, which had no marker
 * and only 2 bytes/cell (note+1, inst) — since a legacy save's first byte
 * is always its instrument count, and nobody builds a 254-instrument bank
 * in this editor, 0xFE is safe to use as an unambiguous "new format" flag.
 * _sidDeserialize below reads the marker and picks the matching cell size. */
/* 0xFD format (current): [0xFD][ni][np][speed], per instrument the 9 classic
 * bytes + the extension below + its name, then the 4-byte cells and the song.
 * 0xFC is the same with 6 voices per pattern (a tune with a second SID), and a
 * byte after the speed: the second SID's address as in a PSID header ($42 = $D420).
 * 0xFE (effect column, no extension) and the unmarked legacy layout still load. */
function _sidInstExtBytes(ins) {
  const o = _sidInstNorm(ins);
  const flags = (o.filt?0x04:0) | (o.off3?0x08:0) | (o.hr?0x10:0) | (o.cutPing?0x20:0) | (o.songVol?0x40:0);
  const out = [flags, o.cutEnd & 0xFF, o.cutEnd >> 8, o.cutSpeed, o.vibDelay, o.vibSpeed, o.vibDepth,
    o.pwmSpeed, o.pwmMin & 0xFF, o.pwmMin >> 8, o.pwmMax & 0xFF, o.pwmMax >> 8,
    o.gateTimer, o.firstWave, o.tableSpeed, o.tableLoop < 0 ? 0xFF : o.tableLoop, o.table.length];
  o.table.forEach(function(s){ out.push(s.w, s.n & 0xFF, s.abs ? 1 : 0); });
  const name = Array.from(new TextEncoder().encode(String(o.name || ""))).slice(0, 255);
  out.push(name.length);
  return out.concat(name);
}

function _sidReadInstExt(ins, src, p) {
  const flags = src[p++] || 0;
  ins.filt = !!(flags & 0x04); ins.off3 = !!(flags & 0x08); ins.hr = !!(flags & 0x10); ins.cutPing = !!(flags & 0x20); ins.songVol = !!(flags & 0x40);
  ins.cutEnd = (src[p++] || 0) | ((src[p++] || 0) << 8);
  ins.cutSpeed = src[p++] || 0;
  ins.vibDelay = src[p++] || 0; ins.vibSpeed = src[p++] || 0; ins.vibDepth = src[p++] || 0;
  ins.pwmSpeed = src[p++] || 0;
  ins.pwmMin = (src[p++] || 0) | ((src[p++] || 0) << 8);
  ins.pwmMax = (src[p++] || 0) | ((src[p++] || 0) << 8);
  ins.gateTimer = src[p++] || 0; ins.firstWave = src[p++] || 0; ins.tableSpeed = src[p++] || 1;
  const loop = src[p++]; ins.tableLoop = loop === 0xFF || loop === undefined ? -1 : loop;
  const len = src[p++] || 0;
  ins.table = [];
  for (let k = 0; k < len; k++) {
    const w = src[p++] || 0, n = src[p++] || 0, abs = !!src[p++];
    ins.table.push({ w: w, n: abs ? n : (n > 127 ? n - 256 : n), abs: abs });
  }
  const nameLen = src[p++] || 0;
  const name = new TextDecoder().decode(Uint8Array.from(Array.from(src.slice(p, p + nameLen))));
  if (name) ins.name = name;
  return p + nameLen;
}

function _sidSerialize() {
  const voices = _sidVoiceCount();
  const out = [voices > 3 ? 0xFC : 0xFD, _sidInsts.length, _sidPatterns.length, Math.max(1, Math.min(255, _sidSpeed | 0))];
  if (voices > 3) out.push((_sidSid2Addr - 0xD000) >> 4);
  _sidInsts.forEach(function(ins){
    _sidInstBytes(ins).forEach(function(b){ out.push(b & 0xFF); });
    _sidInstExtBytes(ins).forEach(function(b){ out.push(b & 0xFF); });
  });
  _sidPatterns.forEach(function(pat){
    for (let v=0;v<voices;v++) for (let r=0;r<_SID_ROWS;r++) {
      const c = pat[v][r];
      out.push(c.note==null?0:(c.note+1)&0xFF);
      out.push(c.inst&0xFF);
      out.push(c.fx ? (_SID_FX_CODES[c.fx]||0) : 0);
      out.push(c.fxval&0xFF);
    }
  });
  // Song/order list, appended after the pattern data — older saves simply
  // end here, which _sidDeserialize below treats as "no song data" and
  // synthesizes one that reproduces the old (patterns played 0..N in
  // storage order) behavior, so existing projects still sound the same.
  const song = (_sidSong && _sidSong.length) ? _sidSong : [0];
  out.push(Math.min(255, song.length) & 0xFF);
  song.slice(0, 255).forEach(function(idx){ out.push(idx & 0xFF); });
  // trailer: $A6, the tune's volume, timing flags (bit 0 = NTSC), the second SID's volume; older saves end before it
  // ($A5: the same, from before the instruments' volume left the editor)
  out.push(0xA6, _sidVol(), _sidIsNtsc() ? 1 : 0, _sidVol2());
  return Uint8Array.from(out);
}

function _sidDeserialize(src) {
  _sidStop();
  let p = 0;
  const extended = src[0] === 0xFD || src[0] === 0xFC; // see the format comment above _sidSerialize
  const voices = src[0] === 0xFC ? 6 : 3;
  const versioned = extended || src[0] === 0xFE;
  if (versioned) p = 1;
  const ni = src[p++] || 0, np = src[p++] || 0;
  if (extended) {
    _sidSpeed = src[p++] || 6;
    const speedEl = document.getElementById("sid-speed");
    if (speedEl) speedEl.value = String(_sidSpeed);
  }
  _sidSid2Addr = voices > 3 ? 0xD000 + ((src[p++] || 0x42) << 4) : 0xD420;
  _sidInsts = [];
  for (let i=0;i<ni;i++) {
    const ctrl=src[p++], ad=src[p++], sr=src[p++], pwlo=src[p++], pwhi=src[p++], cutlo=src[p++], cuthi=src[p++], resfilt=src[p++], mv=src[p++];
    const ins = { name:"Sound "+i,
      tri:!!(ctrl&0x10), saw:!!(ctrl&0x20), pul:!!(ctrl&0x40), noi:!!(ctrl&0x80),
      pw:(pwlo|((pwhi&0x0F)<<8)), a:(ad>>4)&0x0F, d:ad&0x0F, s:(sr>>4)&0x0F, r:sr&0x0F,
      lp:!!(mv&0x10), bp:!!(mv&0x20), hp:!!(mv&0x40),
      cut:((cutlo&0x07)|((cuthi&0xFF)<<3)), res:(resfilt>>4)&0x0F, vol:mv&0x0F };
    if (extended) {
      ins.ring = !!(ctrl & 0x04); ins.sync = !!(ctrl & 0x02);
      p = _sidReadInstExt(ins, src, p);
    }
    _sidInsts.push(_sidInstNorm(ins));
  }
  if (!_sidInsts.length) _sidInsts = [_sidNewInst()];
  _sidPatterns = [];
  for (let pi=0; pi<np; pi++) {
    const pat = _sidNewPattern(voices);
    for (let v=0;v<voices;v++) for (let r=0;r<_SID_ROWS;r++){
      const note=src[p++], inst=src[p++];
      let fx = null, fxval = 0;
      if (versioned) { fx = _SID_FX_NAMES[src[p++] || 0] || null; fxval = src[p++] || 0; }
      pat[v][r] = { note: note ? note-1 : null, inst: inst||0, fx: fx, fxval: fxval };
    }
    _sidPatterns.push(pat);
  }
  if (!_sidPatterns.length) _sidPatterns = [_sidNewPattern(voices)];
  if (p < src.length) {
    const songLen = src[p++] || 0;
    _sidSong = [];
    for (let i = 0; i < songLen; i++) _sidSong.push(src[p++] || 0);
    if (!_sidSong.length) _sidSong = [0];
  } else {
    // Pre-song-list save: reproduce the old "play every pattern, in
    // storage order" behavior as an explicit order list.
    _sidSong = _sidPatterns.map(function(_, i){ return i; });
  }
  const trailer = src[p] === 0xA5 || src[p] === 0xA6;
  _sidSetNtsc(trailer ? !!(src[p + 2] & 1) : false);
  if (src[p] === 0xA6) {
    _sidSetSongVol(src[p + 1] & 15);
    _sidSetSongVol2(p + 3 < src.length ? src[p + 3] & 15 : src[p + 1] & 15);
  }
  else {
    // an older save: its instruments set the chip's volume, which is no longer editable;
    // the first instrument's becomes the tune's, and every instrument keeps to it
    _sidSetSongVol(_sidInsts[0] ? _sidInsts[0].vol : 15);
    _sidSetSongVol2(_sidVol());
    _sidInsts.forEach(function(ins) { ins.songVol = true; });
  }
  _sidSong = _sidSong.map(function(idx){ return Math.max(0, Math.min(_sidPatterns.length - 1, idx|0)); });
  _sidSongPos = 0;
  _sidSongPlayPos = 0;
  _sidInst = 0; _sidPat = _sidSong[0] || 0; _sidPlayPat = _sidPat;
  _sidSyncPlayModeSel();
  _sidBuildInstSel(); _sidLoadInstUI(); _sidBuildPatSel(); _sidBuildSongList(); _sidBuildTracker();
  if (typeof _sidHistSchedule === "function") _sidHistSchedule();
}

/* ── GoatTracker 2 (.sng, GTS3–GTS5) import ─────────────────────────────────
 * Lossy conversion to the editor's model. The per-channel order lists (with
 * transpose and repeat) are flattened into one 3-voice row stream, cut into
 * 32-row patterns (identical ones shared) and listed in the song. Instruments:
 * AD/SR, first wave, gate timer / hard restart; the wavetable becomes the
 * wave / arpeggio table, the pulse table PWM (start, min/max, speed), the
 * filter table filter mode, resonance and cutoff sweep, the speed table entry
 * the instrument vibrato. Pattern commands: key off → C, portamento → U/D,
 * tempo → F, toneporta → a plain note; the rest are dropped and counted. A gate
 * released by the wavetable becomes a C on the next free row. Returns null
 * for a file that is not a GoatTracker song. */
function _sidGoatImport(bytes) {
  const b = bytes || [];
  const id = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (!/^GTS[345]$/.test(id)) return null;
  let p = 4;
  const r8 = function() { if (p >= b.length) throw new Error("eof"); return b[p++]; };
  const str = function(n) {
    let s = "";
    for (let k = 0; k < n; k++) { const c = r8(); if (c && s.length === k) s += String.fromCharCode(c); }
    return s.trim();
  };
  const signed = function(v) { return v >= 0x80 ? v - 0x100 : v; };
  try {
    const name = str(32), author = str(32);
    str(32);
    const subtunes = r8();
    const orders = [];
    for (let s = 0; s < subtunes; s++) {
      const ch = [];
      for (let c = 0; c < 3; c++) { const n = r8(); const o = []; for (let k = 0; k <= n; k++) o.push(r8()); ch.push(o); }
      orders.push(ch);
    }
    const gi = [];
    const ni = r8();
    for (let i = 0; i < ni; i++) {
      gi.push({ ad: r8(), sr: r8(), wp: r8(), pp: r8(), fp: r8(), sp: r8(), vd: r8(), gt: r8(), fw: r8(), name: str(16) });
    }
    const tl = [], tr = [];
    for (let tb = 0; tb < 4; tb++) {
      const n = r8(), l = [], rr = [];
      for (let k = 0; k < n; k++) l.push(r8());
      for (let k = 0; k < n; k++) rr.push(r8());
      tl.push(l); tr.push(rr);
    }
    const gp = [];
    const np = r8();
    for (let i = 0; i < np; i++) {
      const len = r8(), rows = [];
      for (let k = 0; k < len; k++) {
        const row = [r8(), r8(), r8(), r8()];
        if (row[0] !== 0xFF) rows.push(row);
      }
      gp.push(rows);
    }
    if (!orders.length) return null;

    const skipped = {};
    const skip = function(key) { skipped[key] = (skipped[key] || 0) + 1; };
    const CMD_NAMES = ["", "1xx portamento up", "2xx portamento down", "3xx toneporta", "4xx vibrato", "5xx set AD",
      "6xx set SR", "7xx set wave", "8xx wavetable ptr", "9xx pulsetable ptr", "Axx filtertable ptr", "Bxx filter control",
      "Cxx cutoff", "Dxx master volume", "Exx funktempo", "Fxx tempo"];
    const ft = _sidFreqTables();
    const tempo0 = 6;

    // ── instruments ──
    const insts = gi.map(function(g, i) {
      const ins = _sidNewInst(g.name || ("GT " + String(i + 1).padStart(2, "0")));
      ins.a = g.ad >> 4; ins.d = g.ad & 15; ins.s = g.sr >> 4; ins.r = g.sr & 15;
      ins.firstWave = g.fw >= 0xFE ? 0 : g.fw;
      ins.gateTimer = (g.gt & 0x40) ? 0 : Math.min(15, g.gt & 0x3F);
      ins.hr = ins.gateTimer > 0 && !(g.gt & 0x80);
      ins.vol = 15;
      // wavetable → table steps (one step per frame)
      const W = 0, steps = [], seen = {};
      let ptr = g.wp, loop = -1, prev = { w: 0, n: 0, abs: false }, gateOff = -1, guard = 0;
      while (ptr && ptr <= tl[W].length && steps.length < 31 && guard++ < 512) {
        const L = tl[W][ptr - 1], R = tr[W][ptr - 1];
        if (L === 0xFF) { if (!R) break; if (seen[R] !== undefined) { loop = seen[R]; break; } ptr = R; continue; }
        if (seen[ptr] !== undefined) { loop = seen[ptr]; break; }
        seen[ptr] = steps.length;
        ptr++;
        if (L >= 0xF0) continue;
        let n = prev.n, abs = prev.abs;
        if (R !== 0x80) {
          if (R > 0x80) { n = R & 0x7F; abs = true; } else { n = R >= 0x60 ? R - 0x80 : R; abs = false; }
        }
        if (L >= 0x01 && L <= 0x0F) {
          for (let k = 0; k < L && steps.length < 31; k++) steps.push({ w: 0, n: prev.n, abs: prev.abs });
          prev = { w: 0, n: n, abs: abs };
        } else if (L >= 0xE0) {
          prev = { w: 0x08, n: n, abs: abs };
        } else {
          prev = { w: L, n: n, abs: abs };
          if (L >= 0x10 && !(L & 1) && gateOff < 0) gateOff = steps.length;
        }
        steps.push(prev);
      }
      const wave = steps.find(function(s){ return s.w >= 0x10; });
      if (wave) {
        ins.tri = !!(wave.w & 0x10); ins.saw = !!(wave.w & 0x20); ins.pul = !!(wave.w & 0x40); ins.noi = !!(wave.w & 0x80);
        ins.ring = !!(wave.w & 0x04); ins.sync = !!(wave.w & 0x02);
      }
      // the editor applies step 0 on the note's first frame (first wave); GoatTracker one frame later
      if (steps.length) steps.unshift(Object.assign({}, steps[0]));
      const plain = steps.every(function(s){ return (!s.w || (s.w & 0xFE) === (wave ? wave.w & 0xFE : 0)) && !s.abs && !s.n; });
      ins.table = plain ? [] : steps;
      ins.tableLoop = plain || loop < 0 ? -1 : loop + 1;
      ins.tableSpeed = 1;
      ins._gateOffFrame = gateOff < 0 ? -1 : gateOff + 1;
      // pulse table → start width + PWM range / speed
      if (g.pp) {
        let pt = g.pp, pw = -1, time = 0, lo = 4095, hi = 0, mods = 0, speedSum = 0, frames = 0, start = -1;
        for (let f = 0; f < 600 && pt && pt <= tl[1].length; f++) {
          if (tl[1][pt - 1] === 0xFF) { pt = tr[1][pt - 1]; if (!pt) break; }
          const L = tl[1][pt - 1], R = tr[1][pt - 1];
          if (!time) {
            if (L >= 0x80) { pw = ((L & 15) << 8) | R; pt++; }
            else { time = L; }
          }
          if (time) {
            if (pw < 0) pw = 0x800;
            pw = (pw + signed(R)) & 0xFFF;
            mods++; speedSum += Math.abs(signed(R));
            if (!--time) pt++;
          }
          if (pw >= 0) { if (start < 0) start = pw; lo = Math.min(lo, pw); hi = Math.max(hi, pw); }
          frames++;
        }
        if (start >= 0) ins.pw = start;
        if (mods) {
          ins.pwmSpeed = Math.min(255, Math.max(1, Math.round(speedSum / mods)));
          ins.pwmMin = Math.max(0x80, lo); ins.pwmMax = Math.min(0xF80, hi);
          if (ins.pwmMax <= ins.pwmMin) ins.pwmSpeed = 0;
        }
      }
      // filter table → mode, resonance, cutoff (+ sweep)
      if (g.fp) {
        let pt = g.fp, time = 0, cut = -1, first = -1, up = false, down = false, mods = 0, speedSum = 0;
        for (let f = 0; f < 600 && pt && pt <= tl[2].length; f++) {
          if (tl[2][pt - 1] === 0xFF) { pt = tr[2][pt - 1]; if (!pt) break; }
          const L = tl[2][pt - 1], R = tr[2][pt - 1];
          if (!time) {
            if (L >= 0x80) {
              ins.lp = !!(L & 0x10); ins.bp = !!(L & 0x20); ins.hp = !!(L & 0x40);
              ins.res = R >> 4; ins.filt = true;
              pt++;
              if (pt <= tl[2].length && tl[2][pt - 1] === 0x00) { cut = tr[2][pt - 1]; pt++; }
            } else if (L) time = L;
            else { cut = R; pt++; }
          }
          if (time) {
            if (cut < 0) cut = 0;
            const s = signed(R);
            cut = (cut + s) & 0xFF;
            mods++; speedSum += Math.abs(s);
            if (s > 0) up = true; else if (s < 0) down = true;
            if (!--time) pt++;
          }
          if (cut >= 0 && first < 0) first = cut;
        }
        if (first >= 0) { ins.cut = first << 3; ins.cutEnd = cut << 3; }
        if (mods && cut !== first) {
          ins.cutSpeed = Math.min(127, Math.max(1, Math.round(speedSum / mods * 8)));
          ins.cutPing = up && down;
        }
        if (!ins.lp && !ins.bp && !ins.hp) ins.filt = false;
      }
      // speed table entry → instrument vibrato (vibrato delay 0 = off)
      if (g.sp && g.vd && g.sp <= tl[3].length) {
        const cmp = tl[3][g.sp - 1], spd = tr[3][g.sp - 1];
        ins.vibDelay = Math.max(0, g.vd - 1);
        ins.vibSpeed = Math.max(1, Math.min(15, Math.round((cmp & 0x7F) / 2) || 1));
        ins.vibDepth = cmp & 0x80 ? Math.min(15, 32 >> Math.min(5, spd)) : Math.min(15, Math.max(1, Math.round(spd * 32 / ft.semi[48])));
      }
      return ins;
    });
    if (!insts.length) insts.push(_sidNewInst());

    // ── order lists → one row stream per voice ──
    const MAX_ROWS = 255 * _SID_ROWS;
    const order = orders[0];
    const chans = order.map(function(ol) {
      const end = ol.indexOf(0xFF);
      const stop = end < 0 ? ol.length : end;
      const restart = end >= 0 && end + 1 < ol.length ? ol[end + 1] : 0;
      const entries = [];
      let trans = 0, k = 0, loopEntry = -1;
      while (k < stop) {
        if (loopEntry < 0 && k >= restart) loopEntry = entries.length;
        let v = ol[k];
        if (v >= 0xE0 && v < 0xFF) { trans = v - 0xF0; k++; continue; }
        let rep = 1;
        if (v >= 0xD0 && v < 0xE0) { rep = v - 0xD0 + 1; k++; v = ol[k]; if (k >= stop) break; }
        for (let n = 0; n < rep; n++) entries.push({ pat: v, trans: trans });
        k++;
      }
      return { entries: entries, loopEntry: Math.max(0, Math.min(loopEntry, entries.length - 1)) };
    });
    const rowsOf = function(ch, limit) {
      const out = [];
      let e = 0, guard = 0;
      while (out.length < limit && ch.entries.length && guard++ < 4096) {
        const en = ch.entries[e];
        (gp[en.pat] || []).forEach(function(row){ out.push({ row: row, trans: en.trans }); });
        e++;
        if (e >= ch.entries.length) e = ch.loopEntry;
      }
      return out;
    };
    const natural = chans.map(function(ch) {
      return ch.entries.reduce(function(sum, en){ return sum + (gp[en.pat] || []).length; }, 0);
    });
    const total = Math.min(MAX_ROWS, Math.max.apply(null, natural.concat([1])));
    const streams = chans.map(function(ch){ return rowsOf(ch, total).slice(0, total); });

    // ── rows → cells ──
    let tempo = tempo0;
    const empty = function() { return { note: null, inst: 0, fx: null, fxval: 0 }; };
    const voices = [0, 1, 2].map(function() { return Array.from({ length: Math.ceil(total / _SID_ROWS) * _SID_ROWS }, empty); });
    const curInst = [0, 0, 0];
    for (let r = 0; r < total; r++) {
      for (let v = 0; v < 3; v++) {
        const cell = streams[v][r];
        if (!cell) continue;
        const note = cell.row[0], gin = cell.row[1], cmd = cell.row[2], val = cell.row[3];
        if (gin && gin <= insts.length) curInst[v] = gin - 1;
        const out = voices[v][r];
        if (note >= 0x60 && note <= 0xBC) {
          out.note = Math.max(0, Math.min(95, note - 0x60 + cell.trans));
          out.inst = curInst[v];
          const gOff = insts[curInst[v]]._gateOffFrame;
          if (gOff >= 0 && cmd !== 3) {
            const at = r + Math.max(1, Math.ceil(gOff / Math.max(1, tempo)));
            const next = streams[v][at];
            const busy = function(c) { return !!c && ((c.row[0] >= 0x60 && c.row[0] <= 0xBC) || c.row[0] === 0xBE); };
            let free = at < total && !busy(next);
            for (let k = r + 1; free && k < at; k++) { if (busy(streams[v][k])) free = false; }
            if (free) voices[v][at]._cut = true;
          }
        } else if (note === 0xBE) {
          out.fx = "C";
        }
        if (cmd === 1 || cmd === 2) {
          const sp = val && val <= tl[3].length ? (tl[3][val - 1] << 8) | tr[3][val - 1] : 0;
          // GoatTracker slides every frame of the row, the editor once per row
          if (sp && !out.fx) { out.fx = cmd === 1 ? "U" : "D"; out.fxval = Math.min(255, sp * tempo); }
          if (sp * tempo > 255) skip(CMD_NAMES[cmd] + " (clamped)");
        } else if (cmd === 15) {
          const tv = val & 0x7F;
          if (tv >= 2) { tempo = tv; if (!out.fx) { out.fx = "F"; out.fxval = tv; } }
          else skip(CMD_NAMES[14]);
        } else if (cmd === 3) {
          if (out.note != null) skip(CMD_NAMES[3]);
        } else if (cmd) {
          skip(CMD_NAMES[cmd]);
        }
      }
    }
    voices.forEach(function(col) {
      col.forEach(function(c) { if (c._cut) { if (!c.fx && c.note == null) c.fx = "C"; delete c._cut; } });
    });
    insts.forEach(function(ins){ delete ins._gateOffFrame; });

    // ── 32-row patterns, identical ones shared ──
    const patterns = [], song = [], keys = {};
    for (let r = 0; r < voices[0].length && song.length < 255; r += _SID_ROWS) {
      const pat = voices.map(function(col){ return col.slice(r, r + _SID_ROWS); });
      const key = JSON.stringify(pat);
      if (keys[key] === undefined) { keys[key] = patterns.length; patterns.push(pat); }
      song.push(keys[key]);
    }
    if (!patterns.length) { patterns.push([0, 1, 2].map(function(){ return Array.from({ length: _SID_ROWS }, empty); })); song.push(0); }
    if (subtunes > 1) skip("subtunes 2–" + subtunes);
    return { name: name, author: author, insts: insts.map(_sidInstNorm), patterns: patterns, song: song, speed: tempo0, skipped: skipped };
  } catch (_) {
    return null;
  }
}

function _sidApplyGoatImport(bytes) {
  const res = _sidGoatImport(bytes);
  if (!res) { showViceToast(t("sidGoatInvalid"), true); return false; }
  _sidApplyImportedTune(res);
  const skipped = Object.keys(res.skipped).map(function(k){ return k + " ×" + res.skipped[k]; });
  showViceToast(tf("sidGoatImported", { insts: res.insts.length, pats: res.patterns.length, song: res.song.length }) +
    (skipped.length ? " " + tf("sidGoatSkipped", { list: skipped.join(", ") }) : ""), false);
  return true;
}

/* .sid import: the tune runs in VA SID Core (Rust sid_register_dump), the
   per-frame SID register dump is turned back into rows. Note on = gate edge or
   a legato pitch change; rows of L / L+1 frames start on the note ons (F effects
   carry the changes); pitch = the most common semitone of the main waveform.
   Instruments come from ADSR, the waveform / pitch steps of the whole note
   (→ wave table), pulse and filter movement and the gate timing. A frame holds
   26 bytes per SID (the registers + the gate edges): a tune with two SIDs becomes
   six voices, and its second SID's address comes along as `sid2`. */
const _SID_DUMP_MAX_INSTS = 128;

const _SID_DUMP_TABLE_STEPS = 32;

const _SID_DUMP_WINDOW = 128;

function _sidDumpImport(regs, meta) {
  meta = meta || {};
  const FB = meta.frameBytes || 26;
  const frames = Math.floor((regs ? regs.length : 0) / FB);
  if (frames < 2) return null;
  const R = function(f, i) { return regs[f * FB + i]; };
  const ft = _sidFreqTables();
  // the editor's note table is PAL; NTSC tunes run on a faster clock
  const clockScale = (meta.frameRate || 50) > 55 ? 1022727 / 985248 : 1;
  const noteOf = function(freq) {
    if (!freq) return null;
    const n = Math.round(12 * Math.log2(freq * clockScale / ft.f[0]));
    return n < 0 ? 0 : n > 95 ? 95 : n;
  };
  const skipped = {};
  const skip = function(key) { skipped[key] = (skipped[key] || 0) + 1; };

  // ── note ons per voice ──
  const voices = Array.from({ length: Math.round(FB / 26) * 3 }, function(_, v) {
    const at = 26 * (v / 3 | 0), bit = v % 3, ons = [];
    for (let f = 0; f < frames; f++) {
      if ((R(f, at + 25) >> bit) & 1) ons.push(f);
    }
    return { at: at, bit: bit, b: at + bit * 7, ons: ons };
  });
  // a gate edge within 2 frames of the previous one on the same voice retriggers the same note
  voices.forEach(function(vc) {
    let last = -Infinity;
    vc.ons = vc.ons.filter(function(f) {
      if (f - last <= 2) { skip("retriggers merged"); return false; }
      last = f;
      return true;
    });
  });
  // legato: under a held gate the pitch moves to a new semitone and stays there
  const LEGATO_HOLD = 5;
  voices.forEach(function(vc) {
    const b = vc.b, extra = [];
    const pitchAt = function(g) {
      const c = R(g, b + 4);
      return c & 1 ? noteOf(R(g, b) | (R(g, b + 1) << 8)) * 256 + (c & 0xF0) : null;
    };
    vc.ons.forEach(function(f, k) {
      const next = k + 1 < vc.ons.length ? vc.ons[k + 1] : frames;
      let held = null;
      for (let g = f; g + LEGATO_HOLD <= next; g++) {
        const p = pitchAt(g);
        if (p == null) break;
        let stable = true;
        for (let i = 1; i < LEGATO_HOLD && stable; i++) stable = pitchAt(g + i) === p;
        if (!stable) continue;
        if (held !== null && p !== held && (p & 0xF0) === (held & 0xF0) && g - f > 2) {
          // skip back to where this pitch started
          let s0 = g;
          while (s0 - 1 > f && pitchAt(s0 - 1) === p) s0--;
          if (!extra.length || s0 - extra[extra.length - 1] > 2) extra.push(s0);
        }
        held = p;
        g += LEGATO_HOLD - 1;
      }
    });
    if (extra.length) {
      skip("legato notes (retriggered)");
      vc.ons = vc.ons.concat(extra).sort(function(a, c){ return a - c; });
    }
  });
  const allOns = [].concat.apply([], voices.map(function(vc){ return vc.ons; })).sort(function(a, b){ return a - b; });
  if (!allOns.length) return null;
  // note ons a frame apart on different voices share a row
  const times = allOns.filter(function(f, i){ return !i || f - allOns[i - 1] > 1; });

  // ── row timing: rows of L or L+1 frames start exactly on the note ons (funktempo,
  // swing and tempo changes included); L = the longest that fits ≥ 97 % of the gaps ──
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  const splits = function(g, L) { return Math.ceil(g / (L + 1)) <= Math.floor(g / L); };
  const pickL = function(minRatio) {
    for (let L = 64; L >= 2; L--) {
      let ok = 0;
      gaps.forEach(function(g){ if (splits(g, L)) ok++; });
      if (ok >= minRatio * gaps.length) return L;
    }
    return 0;
  };
  const speed = gaps.length ? (pickL(0.97) || pickL(0.9) || pickL(0.75) || 1) : 6;
  const rowStart = [times[0]];
  const pushRows = function(g, k) {
    const at = rowStart[rowStart.length - 1];
    for (let i = 1; i <= k; i++) rowStart.push(at + Math.round(i * g / k));
  };
  // a note on too close to the previous row joins it; the next gap counts from that row
  let carry = 0;
  gaps.forEach(function(g0) {
    const g = g0 + carry;
    carry = 0;
    const lo = Math.ceil(g / (speed + 1)), hi = Math.floor(g / speed);
    if (lo <= hi) pushRows(g, Math.max(lo, Math.min(hi, Math.round(g / (speed + 0.5)))));
    else if (g <= speed / 3) { skip("timing (rounded)"); carry = g; }
    else pushRows(g, Math.max(1, Math.round(g / speed)));
  });
  const rowLen = function(r) { return r + 1 < rowStart.length ? rowStart[r + 1] - rowStart[r] : speed; };
  const rowOf = function(f) {
    const n = rowStart.length;
    if (f >= rowStart[n - 1]) return n - 1 + Math.round((f - rowStart[n - 1]) / speed);
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rowStart[mid] <= f) lo = mid; else hi = mid - 1; }
    return lo + 1 < n && rowStart[lo + 1] - f < f - rowStart[lo] ? lo + 1 : lo;
  };

  const MAX_ROWS = 255 * _SID_ROWS;
  let totalRows = rowOf(allOns[allOns.length - 1]) + 2;
  if (totalRows > MAX_ROWS) { totalRows = MAX_ROWS; skip("length (cut)"); }
  totalRows = Math.ceil(totalRows / _SID_ROWS) * _SID_ROWS;
  const empty = function() { return { note: null, inst: 0, fx: null, fxval: 0 }; };
  const cols = voices.map(function(){ return Array.from({ length: totalRows }, empty); });

  // ── notes → cells, instruments by signature ──
  const insts = [], instKeys = {}, recs = [];
  const mode = function(arr) {
    const cnt = {}, first = {};
    arr.forEach(function(x, i){ if (x == null) return; cnt[x] = (cnt[x] || 0) + 1; if (first[x] === undefined) first[x] = i; });
    let best = null;
    Object.keys(cnt).forEach(function(k){ if (best === null || cnt[k] > cnt[best] || (cnt[k] === cnt[best] && first[k] < first[best])) best = k; });
    return best === null ? null : +best;
  };
  const same = function(a, c) { return a.w === c.w && a.n === c.n && a.abs === c.abs; };
  voices.forEach(function(vc, v) {
    const b = vc.b, at = vc.at;
    const freqAt = function(g) { return R(g, b) | (R(g, b + 1) << 8); };
    const pwAt = function(g) { return R(g, b + 2) | ((R(g, b + 3) & 15) << 8); };
    const cutAt = function(g) { return (R(g, at + 0x15) & 7) | (R(g, at + 0x16) << 3); };
    vc.ons.forEach(function(f, k) {
      const next = k + 1 < vc.ons.length ? vc.ons[k + 1] : frames;
      // the whole note up to the next one: after the gate off the release still sounds
      let len = Math.max(1, Math.min(next - f, _SID_DUMP_WINDOW));
      // a frame without waveform is the hard restart before the next note
      for (let i = 1; i < len; i++) { if (!(R(f + i, b + 4) & 0xF0)) { len = i; break; } }
      let off = -1;
      for (let g = f + 1; g < next; g++) { if (!(R(g, b + 4) & 1)) { off = g; break; } }
      const row = rowOf(f);
      if (row >= totalRows) return;
      if (cols[v][row].note != null) { skip("notes on the same row"); return; }

      // main waveform: the most common one, the note: its most common semitone
      const waves = [];
      for (let i = 0; i < len; i++) { const w = R(f + i, b + 4) & 0xFE; if (!(w & 0x08) && (w & 0xF0)) waves.push(w); }
      const w = mode(waves) || (R(f, b + 4) & 0xF6);
      const pitches = [];
      for (let i = 0; i < len; i++) { if ((R(f + i, b + 4) & 0xF0) === (w & 0xF0)) pitches.push(noteOf(freqAt(f + i))); }
      const base = mode(pitches.length ? pitches : [noteOf(freqAt(f))]);
      if (base == null) return;

      const ins = _sidNewInst("SID");
      const ad = R(f, b + 5), sr = R(f, b + 6);
      ins.a = ad >> 4; ins.d = ad & 15; ins.s = sr >> 4; ins.r = sr & 15;
      ins.tri = !!(w & 0x10); ins.saw = !!(w & 0x20); ins.pul = !!(w & 0x40); ins.noi = !!(w & 0x80);
      ins.ring = !!(w & 0x04); ins.sync = !!(w & 0x02);

      // waveform / pitch per frame (absolute notes); the wave table is built after all notes
      // are known. A test-bit / waveform-less frame (hard restart) is silent: no pitch, and
      // as a table step it becomes the test bit (0 would keep the previous waveform).
      const raw = [];
      for (let i = 0; i < len; i++) {
        const sw = R(f + i, b + 4) & 0xFE;
        const silent = (sw & 0x08) || !(sw & 0xF0);
        raw.push({ w: silent ? (sw & 0xF0) | 0x08 : sw, n: silent ? null : noteOf(freqAt(f + i)) });
      }
      // vibrato: a regular wobble of the main-wave pitch around the note → instrument
      // vibrato (the player's triangle LFO: half period = speed frames, depth*speed/64
      // semitones), and those frames stay on the note in the wave table
      let vibFrom = -1;
      {
        const dev = [];
        for (let i = 0; i < len; i++) {
          const fr = freqAt(f + i), sw = raw[i].w;
          dev.push(fr && (sw & 0xF0) === (w & 0xF0) && !(sw & 0x08) ? 12 * Math.log2(fr * clockScale / ft.f[0]) - base : null);
        }
        let start = 0;
        while (start < len && dev[start] == null) start++;
        let d0 = start;
        while (d0 + 1 < len && dev[d0 + 1] != null && Math.abs(dev[d0 + 1] - dev[start]) < 0.03) d0++;
        const ext = [];
        let dir = 0;
        for (let i = d0 + 1; i < len && dev[i] != null && dev[i - 1] != null; i++) {
          const dd = dev[i] - dev[i - 1];
          if (Math.abs(dd) < 1e-6) continue;
          const nd = dd > 0 ? 1 : -1;
          if (dir && nd !== dir) ext.push({ i: i - 1, x: dev[i - 1] });
          dir = nd;
        }
        const wob = dev.slice(d0 + 1).filter(function(x){ return x != null; });
        if (ext.length >= 4 && wob.length && wob.every(function(x){ return Math.abs(x) < 0.6; })) {
          const gaps = [];
          for (let k = 1; k < ext.length; k++) gaps.push(ext[k].i - ext[k - 1].i);
          const half = gaps.reduce(function(x, y){ return x + y; }, 0) / gaps.length;
          const spread = Math.sqrt(gaps.reduce(function(x, y){ return x + (y - half) * (y - half); }, 0) / gaps.length);
          const hi = ext.filter(function(e, k){ return k === 0 || e.x > ext[k - 1].x; });
          const lo = ext.filter(function(e, k){ return k > 0 && e.x < ext[k - 1].x; });
          const avg = function(arr) { return arr.reduce(function(x, e){ return x + e.x; }, 0) / Math.max(1, arr.length); };
          const amp = (avg(hi) - avg(lo)) / 2;
          if (lo.length && spread <= half * 0.35 && amp >= 0.05) {
            const speedV = Math.max(1, Math.min(15, Math.round(half)));
            const depth = Math.max(1, Math.min(15, Math.round(amp * 64 / speedV)));
            ins.vibSpeed = speedV; ins.vibDepth = depth; ins.vibDelay = Math.min(255, d0);
            vibFrom = d0 + 1;
          }
        }
      }
      // gate: released on a later row → note cut there; a few frames before the
      // next note → gate timer (hard restart if ADSR is zeroed); within the first
      // frames of a note → the envelope decays at the release rate instead
      if (off >= 0) {
        const cr = rowOf(off), gap = next - off;
        if (cr > row && (next >= frames || cr < rowOf(next))) {
          if (cr < totalRows && cols[v][cr].note == null && !cols[v][cr].fx) cols[v][cr] = { note: null, inst: 0, fx: "C", fxval: 0 };
        } else if (next < frames && gap < speed && gap <= 15) {
          ins.gateTimer = gap;
          // the player zeroes ADSR with the gate: if the tune does it later, the release has to sound until then
          ins.hr = R(off, b + 5) === 0 && R(off, b + 6) === 0;
        } else {
          ins.s = 0; ins.d = ins.r;
        }
      }

      // the filter keeps moving after the waveform went silent (a drum's hard restart): the whole note counts
      const moveEnd = Math.min(next, f + _SID_DUMP_WINDOW, frames);
      // units per frame, also when the player writes only every few frames; a wrap-around is no speed
      const movement = function(valueAt, from, until) {
        const steps = [];
        for (let g = from + 1; g < until; g++) { const d = Math.abs(valueAt(g) - valueAt(g - 1)); if (d) steps.push(d); }
        if (!steps.length) return 0;
        const median = steps.slice().sort(function(a, c){ return a - c; })[steps.length >> 1];
        const sum = steps.reduce(function(a, d){ return a + (d > 16 * median ? median : d); }, 0);
        return Math.max(1, Math.round(sum / Math.max(1, until - from - 1)));
      };
      // pulse width from the first frame on the pulse wave (drum attacks often precede it)
      const end = f + len;
      let pf = f;
      while (pf < end - 1 && !(R(pf, b + 4) & 0x40)) pf++;
      ins.pw = pwAt(pf);
      let lo = ins.pw, hi = ins.pw;
      for (let g = pf + 1; g < end; g++) {
        const p = pwAt(g);
        lo = Math.min(lo, p); hi = Math.max(hi, p);
      }
      if (hi > lo) { ins.pwmSpeed = Math.min(255, movement(pwAt, pf, end)); ins.pwmMin = lo; ins.pwmMax = hi; }
      // filter: global registers, routed per voice
      const mv = R(f, at + 0x18);
      ins.vol = mv & 15; ins.songVol = false;
      ins.off3 = !!(mv & 0x80);
      ins.filt = !!((R(f, at + 0x17) >> vc.bit) & 1);
      if (ins.filt) {
        ins.lp = !!(mv & 0x10); ins.bp = !!(mv & 0x20); ins.hp = !!(mv & 0x40);
        ins.res = R(f, at + 0x17) >> 4;
        // the next change of the cutoff after frame g
        const nextCut = function(g) {
          for (let i = g + 1; i < moveEnd; i++) { const d = cutAt(i) - cutAt(i - 1); if (d) return d; }
          return 0;
        };
        // a filter table can start one frame after the gate: a big step that then turns back
        let cf = f;
        if (f + 2 < moveEnd) {
          const d1 = cutAt(f + 1) - cutAt(f), d2 = nextCut(f + 1);
          if (Math.abs(d1) >= 64 && d2 && (d1 > 0) !== (d2 > 0)) cf = f + 1;
        }
        ins.cut = cutAt(cf);
        // the sweep of this note ends where the filter jumps again: another voice's note restarted it
        let sweepEnd = moveEnd, dir = 0, still = 0, up = false, down = false;
        for (let g = cf + 1; g < moveEnd; g++) {
          const d = cutAt(g) - cutAt(g - 1);
          if (!d) { still++; continue; }
          const turns = function(a, c) { return a && c && (a > 0) !== (c > 0); };
          if (Math.abs(d) >= 64 && (turns(dir, d) || (still >= 2 && turns(d, nextCut(g))))) { sweepEnd = g; break; }
          still = 0;
          dir = d;
          if (d > 0) up = true; else down = true;
        }
        ins.cutEnd = cutAt(sweepEnd - 1);
        if (up && down) {
          // an LFO: the player bounces between two values, so those are the extremes, whatever the phase
          let cutLo = ins.cut, cutHi = ins.cut;
          for (let g = cf + 1; g < sweepEnd; g++) { cutLo = Math.min(cutLo, cutAt(g)); cutHi = Math.max(cutHi, cutAt(g)); }
          if (cutHi - cutLo >= 16) {
            const falling = cutAt(cf + 1) <= ins.cut;
            ins.cut = falling ? cutHi : cutLo;
            ins.cutEnd = falling ? cutLo : cutHi;
            ins.cutPing = true;
            ins.cutSpeed = Math.min(127, movement(cutAt, cf, sweepEnd));
          } else ins.cutEnd = ins.cut;
        } else if ((up || down) && ins.cutEnd !== ins.cut) {
          // a one-way sweep often falls fast and then creeps (a filter table): what counts is when it gets there
          let reach = sweepEnd - 1;
          const near = Math.abs(ins.cutEnd - ins.cut) >> 4;
          while (reach > cf + 1 && Math.abs(cutAt(reach - 1) - ins.cutEnd) <= near) reach--;
          const frames2 = Math.max(1, reach - cf), range = Math.abs(ins.cutEnd - ins.cut);
          // the player moves at most 127 per frame: too fast a sweep ends on time, from a nearer start
          if (range > 127 * frames2) ins.cut = ins.cutEnd + (ins.cut > ins.cutEnd ? 127 : -127) * frames2;
          ins.cutSpeed = Math.min(127, Math.max(1, Math.ceil(Math.abs(ins.cutEnd - ins.cut) / frames2)));
        }
      }
      cols[v][row] = { note: base, inst: 0, fx: null, fxval: 0 };
      recs.push({ v: v, row: row, base: base, w: w, ins: ins, raw: raw, vibFrom: vibFrom });
    });
  });

  // ── wave tables: per step, absolute or relative pitch — whichever stays the same
  // across the notes of one instrument shape (fixed-pitch drums vs arpeggios) ──
  const shapeOf = function(r) {
    return [r.ins.a, r.ins.d, r.ins.s, r.ins.r, r.w, r.ins.gateTimer].concat(r.raw.slice(0, 4).map(function(x){ return x.w; })).join(",");
  };
  const shapes = {};
  recs.forEach(function(r){ (shapes[shapeOf(r)] = shapes[shapeOf(r)] || []).push(r); });
  Object.keys(shapes).forEach(function(key) {
    const group = shapes[key];
    const steps = Math.max.apply(null, group.map(function(r){ return r.raw.length; }));
    const absAt = [];
    for (let k = 0; k < steps; k++) {
      const absVotes = {}, relVotes = {};
      let absBest = 0, relBest = 0, far = false;
      group.forEach(function(r) {
        const x = r.raw[k];
        if (!x || x.n == null) return;
        absVotes[x.n] = (absVotes[x.n] || 0) + 1; absBest = Math.max(absBest, absVotes[x.n]);
        const rel = x.n - r.base;
        relVotes[rel] = (relVotes[rel] || 0) + 1; relBest = Math.max(relBest, relVotes[rel]);
        if ((x.w & 0xF0) !== (r.w & 0xF0) && Math.abs(rel) > 12) far = true;
      });
      absAt.push(absBest > relBest || (absBest === relBest && far));
    }
    group.forEach(function(r){ r.absAt = absAt; });
  });
  recs.forEach(function(r) {
    const w = r.w, ins = r.ins, len = r.raw.length;
    const steps = r.raw.map(function(x, k) {
      if (x.n == null || (r.vibFrom >= 0 && k >= r.vibFrom && x.w === w)) return { w: x.w, n: 0, abs: false };
      return r.absAt[k] ? { w: x.w, n: x.n, abs: true } : { w: x.w, n: x.n - r.base, abs: false };
    });
    const isPlain = function(st) { return st.w === w && st.n === 0 && !st.abs; };
    if (!steps.every(isPlain)) {
      // a table step can last several frames: one step per common run length
      let runGcd = 0;
      for (let k = 0, run = 1; k + 1 < len; k++) {
        if (same(steps[k], steps[k + 1])) { run++; continue; }
        const gcd = function(a, c) { return c ? gcd(c, a % c) : a; };
        runGcd = gcd(runGcd, run);
        run = 1;
      }
      const tableSpeed = runGcd >= 2 ? Math.min(15, runGcd) : 1;
      const packed = tableSpeed > 1 ? steps.filter(function(_, k){ return k % tableSpeed === 0; }) : steps;
      const plen = packed.length;
      // shortest table: a prefix plus a period that repeats to the end of the note. The last frames may
      // already prepare the next note (hard restart): they do not count against a period
      let tStart = -1, tPer = 0;
      const maxTrim = Math.min(6, plen >> 2);
      for (let trim = 0; trim <= maxTrim && tStart < 0; trim++) {
      for (let p = 1; p <= _SID_DUMP_TABLE_STEPS && tStart < 0; p++) {
        let st = plen - trim - p;
        while (st > 0 && same(packed[st - 1], packed[st - 1 + p])) st--;
        if (plen - trim - st >= 2 * p && st + p <= _SID_DUMP_TABLE_STEPS) { tStart = st; tPer = p; }
      }
      }
      let table, loop;
      if (tStart >= 0) {
        table = packed.slice(0, tStart + tPer);
        // a single repeated step needs no loop: the table holds its last step
        loop = tPer === 1 ? -1 : tStart;
      } else {
        table = packed.slice(0, _SID_DUMP_TABLE_STEPS);
        loop = -1;
        if (plen > _SID_DUMP_TABLE_STEPS) skip("long wave tables (cut)");
      }
      if (loop < 0) {
        while (table.length > 1 && isPlain(table[table.length - 1]) && isPlain(table[table.length - 2])) table.pop();
      }
      if (!table.every(isPlain)) { ins.table = table; ins.tableLoop = loop; ins.tableSpeed = tableSpeed; }
    }
    const norm = _sidInstNorm(ins);
    // coarse signature: pulse width only matters for the pulse wave (and not under
    // a running sweep, where the start is arbitrary); filter sweeps are global
    const key = JSON.stringify(Object.assign({}, norm, {
      // a free-running sweep is not reset by the notes: its start per note, coarsely, keeps it going
      name: "", pw: norm.pul ? norm.pw >> (norm.pwmSpeed ? 9 : 8) : 0, pwmMin: 0, pwmMax: 0,
      pwmSpeed: norm.pul && norm.pwmSpeed ? Math.round(Math.log2(norm.pwmSpeed)) : 0,
      cut: norm.cut >> 6, cutEnd: norm.cutSpeed ? norm.cutEnd >> 7 : 0, cutSpeed: norm.cutSpeed ? Math.round(Math.log2(norm.cutSpeed)) : 0, cutPing: norm.cutPing
    }));
    let idx = instKeys[key];
    if (idx === undefined) { idx = insts.length; instKeys[key] = idx; insts.push(norm); }
    else if (norm.pwmSpeed) {
      insts[idx].pwmMin = Math.min(insts[idx].pwmMin, norm.pwmMin);
      insts[idx].pwmMax = Math.max(insts[idx].pwmMax, norm.pwmMax);
    }
    cols[r.v][r.row].inst = idx;
  });
  if (!insts.length) return null;

  // ── too many instruments: the rarest ones map to the closest kept one ──
  let finalInsts = insts, remap = insts.map(function(_, i){ return i; });
  if (insts.length > _SID_DUMP_MAX_INSTS) {
    const use = insts.map(function(){ return 0; });
    cols.forEach(function(col){ col.forEach(function(c){ if (c.note != null) use[c.inst]++; }); });
    const keep = insts.map(function(_, i){ return i; })
      .sort(function(a, c){ return use[c] - use[a] || a - c; })
      .slice(0, _SID_DUMP_MAX_INSTS).sort(function(a, c){ return a - c; });
    // the waveform and pitch steps of the first frames weigh most: a drum table on a bass note is far worse than another ADSR
    const tableDist = function(a, c) {
      let sum = 0;
      for (let k = 0; k < 8; k++) {
        const x = a.table[Math.min(k, a.table.length - 1)] || { w: _sidInstCtrl(a), n: 0, abs: false };
        const y = c.table[Math.min(k, c.table.length - 1)] || { w: _sidInstCtrl(c), n: 0, abs: false };
        if ((x.w & 0xF0) !== (y.w & 0xF0)) sum += 30;
        if (x.abs !== y.abs) sum += 20; else sum += Math.min(12, Math.abs(x.n - y.n)) * 2;
      }
      return sum;
    };
    const dist = function(a, c) {
      return (_sidInstCtrl(a) !== _sidInstCtrl(c) ? 100 : 0) + tableDist(a, c) + Math.abs(a.a - c.a) + Math.abs(a.d - c.d) +
        Math.abs(a.s - c.s) + Math.abs(a.r - c.r) + (a.filt !== c.filt ? 20 : 0) + (a.gateTimer !== c.gateTimer ? 4 : 0) +
        Math.abs(a.pw - c.pw) / 512;
    };
    remap = insts.map(function(ins, i) {
      const k = keep.indexOf(i);
      if (k >= 0) return k;
      let best = 0;
      keep.forEach(function(j, n){ if (dist(ins, insts[j]) < dist(ins, insts[keep[best]])) best = n; });
      return best;
    });
    finalInsts = keep.map(function(i){ return insts[i]; });
    skip("instruments merged " + (insts.length - keep.length));
  }
  cols.forEach(function(col){ col.forEach(function(c){ if (c.note != null) c.inst = remap[c.inst]; }); });
  // the player holds at most 255 table steps in all: the most used instruments
  // keep theirs whole, the rest keep what fits (the attack comes first)
  const used = finalInsts.map(function(){ return 0; });
  cols.forEach(function(col){ col.forEach(function(c){ if (c.note != null) used[c.inst]++; }); });
  // (identical tables are stored once, see _sidTuneData)
  let tableLeft = 255;
  const stored = {};
  finalInsts.map(function(_, i){ return i; }).sort(function(a, c){ return used[c] - used[a] || a - c; }).forEach(function(i) {
    const ins = finalInsts[i];
    const tkey = JSON.stringify(ins.table);
    if (!ins.table.length || stored[tkey]) return;
    if (ins.table.length > tableLeft) {
      ins.table = ins.table.slice(0, tableLeft);
      if (ins.tableLoop >= ins.table.length) ins.tableLoop = -1;
      skip("wave tables shortened");
    }
    stored[JSON.stringify(ins.table)] = true;
    tableLeft -= ins.table.length;
  });
  finalInsts.forEach(function(ins){
    const wave = [ins.tri && "TRI", ins.saw && "SAW", ins.pul && "PUL", ins.noi && "NOI"].filter(Boolean).join("+") || "---";
    ins.name = wave + (ins.table && ins.table.length ? " TAB" : "");
  });

  // ── row lengths: an F effect one row ahead sets the length of the next row ──
  for (let r = 0; r + 1 < totalRows; r++) {
    const val = Math.min(255, rowLen(r + 1));
    if (val === Math.min(255, rowLen(r))) continue;
    // timing wins over a note cut: a missed speed change would shift the rest of the song
    let v = cols.findIndex(function(col){ return !col[r].fx; });
    if (v < 0) v = cols.findIndex(function(col){ return col[r].fx === "C"; });
    if (v < 0) { skip("speed changes"); continue; }
    if (cols[v][r].fx === "C") skip("note cuts dropped");
    cols[v][r].fx = "F"; cols[v][r].fxval = val;
  }

  // ── 32-row patterns, identical ones shared ──
  const patterns = [], song = [], keys = {};
  for (let r = 0; r < totalRows && song.length < 255; r += _SID_ROWS) {
    const pat = cols.map(function(col){ return col.slice(r, r + _SID_ROWS); });
    const key = JSON.stringify(pat);
    if (keys[key] === undefined) { keys[key] = patterns.length; patterns.push(pat); }
    song.push(keys[key]);
  }
  return { name: meta.name || "", author: meta.author || "", insts: finalInsts, patterns: patterns, song: song,
    speed: Math.max(1, Math.min(255, rowLen(0))), skipped: skipped, sid2: meta.sid2Addr || 0 };
}

function _sidSetTuneTitle(title) {
  const el = document.getElementById("sid-tune-title");
  if (el) el.textContent = title || "";
  try {
    if (title) localStorage.setItem("va-sid-tune-title", title);
    else localStorage.removeItem("va-sid-tune-title");
  } catch (_) {}
}

function _sidApplyImportedTune(res, title) {
  _sidStop();
  _sidSetTuneTitle(title);
  _sidInsts = res.insts;
  _sidPatterns = res.patterns;
  _sidSong = res.song;
  _sidSpeed = res.speed;
  _sidSetSongVol(res.vol != null ? res.vol : 15);
  _sidSetSongVol2(res.vol2 != null ? res.vol2 : _sidVol());
  _sidSetNtsc(!!res.ntsc);
  if (res.sid2) _sidSid2Addr = res.sid2;
  const speedEl = document.getElementById("sid-speed");
  if (speedEl) speedEl.value = String(_sidSpeed);
  if (typeof _sidUpdateBpmDisplay === "function") _sidUpdateBpmDisplay();
  _sidSongPos = 0; _sidSongPlayPos = 0;
  _sidInst = 0; _sidPat = _sidSong[0] || 0; _sidPlayPat = _sidPat;
  _sidSyncPlayModeSel();
  _sidBuildInstSel(); _sidLoadInstUI(); _sidBuildPatSel(); _sidBuildSongList(); _sidBuildTracker();
  if (typeof _sidHistSchedule === "function") _sidHistSchedule();
}

let _sidSidImportBytes = null;

function _sidHeaderInfo(bytes) {
  const b = bytes || [];
  const id = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if ((id !== "PSID" && id !== "RSID") || b.length < 0x76) return null;
  const str = function(o) { let s = ""; for (let k = 0; k < 32 && b[o + k]; k++) s += String.fromCharCode(b[o + k]); return s.trim(); };
  return { songs: (b[0x0e] << 8) | b[0x0f], start: (b[0x10] << 8) | b[0x11], name: str(0x16), author: str(0x36) };
}

function _sidOpenSidImport(bytes) {
  const info = _sidHeaderInfo(bytes);
  if (!info || !info.songs) { showViceToast(t("sidImportSidInvalid"), true); return; }
  if (!window.electronAPI?.sidRegisterDump) { showViceToast(t("sidImportSidDesktopOnly"), true); return; }
  const dlg = document.getElementById("sid-import-sid-dialog");
  if (!dlg) return;
  _sidSidImportBytes = bytes;
  document.getElementById("sid-import-sid-title").textContent = t("sidImportSidTitle");
  document.getElementById("sid-import-sid-tune").textContent = [info.name, info.author].filter(Boolean).join(" — ");
  document.getElementById("sid-import-sid-song-label").textContent = tf("sidImportSidSong", { songs: info.songs });
  document.getElementById("sid-import-sid-seconds-label").textContent = t("sidImportSidSeconds");
  const songEl = document.getElementById("sid-import-sid-song");
  songEl.max = String(info.songs);
  songEl.value = String(Math.max(1, Math.min(info.songs, info.start || 1)));
  songEl.disabled = info.songs < 2;
  document.getElementById("sid-import-sid-status").textContent = "";
  const progressWrap = document.getElementById("sid-import-sid-progress");
  if (progressWrap) progressWrap.hidden = true;
  const go = document.getElementById("sid-import-sid-go");
  go.textContent = t("sidImportSidGo");
  go.disabled = false;
  document.getElementById("sid-import-sid-cancel").textContent = t("sidImportSidCancel");
  dlg.showModal();
}

async function _sidRunSidImport() {
  const dlg = document.getElementById("sid-import-sid-dialog");
  const go = document.getElementById("sid-import-sid-go");
  const status = document.getElementById("sid-import-sid-status");
  if (!_sidSidImportBytes || go.disabled) return;
  const song = Math.max(1, parseInt(document.getElementById("sid-import-sid-song").value, 10) || 1);
  const seconds = Math.max(1, Math.min(900, parseInt(document.getElementById("sid-import-sid-seconds").value, 10) || 120));
  const busy = function(on) {
    go.disabled = on;
    go.textContent = t(on ? "sidImportSidGoBusy" : "sidImportSidGo");
    document.getElementById("sid-import-sid-song").disabled = on || document.getElementById("sid-import-sid-song").max === "1";
    document.getElementById("sid-import-sid-seconds").disabled = on;
  };
  const wrap = document.getElementById("sid-import-sid-progress");
  const bar = document.getElementById("sid-import-sid-bar");
  // state: null = hidden, -1 = indeterminate, 0..100 = percent
  const progress = function(state, label) {
    if (wrap) wrap.hidden = state === null;
    if (bar) {
      bar.classList.toggle("update-progress-bar--indeterminate", state === -1);
      bar.style.width = state >= 0 ? state + "%" : "";
    }
    if (label !== undefined) status.textContent = label;
  };
  busy(true);
  progress(0, t("sidImportSidWorking"));
  let unlisten = null;
  try {
    unlisten = await window.electronAPI.onSidDumpProgress?.(function(p) {
      if (!p || !p.total) return;
      const pct = Math.min(100, Math.round(p.done * 100 / p.total));
      progress(pct, t("sidImportSidWorking") + " " + pct + "%");
    });
  } catch (_) { unlisten = null; }
  try {
    const dump = await window.electronAPI.sidRegisterDump({ fileBytes: Array.from(_sidSidImportBytes), song: song, seconds: seconds });
    progress(-1, t("sidImportSidConverting"));
    // let the dialog paint before the (synchronous) conversion
    await new Promise(function(r){ setTimeout(r, 30); });
    const bin = atob(dump.regs || "");
    const regs = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) regs[i] = bin.charCodeAt(i);
    const res = _sidDumpImport(regs, dump);
    if (!res) { progress(null, t("sidImportSidNoNotes")); busy(false); return; }
    progress(null, "");
    busy(false);
    dlg.close();
    const info = _sidHeaderInfo(_sidSidImportBytes);
    _sidSidImportBytes = null;
    _sidApplyImportedTune(res, info ? [info.name, info.author].filter(Boolean).join(" — ") : "");
    const skipped = Object.keys(res.skipped).map(function(k){ return k + " ×" + res.skipped[k]; });
    showViceToast(tf("sidImportSidDone", { insts: res.insts.length, pats: res.patterns.length, song: res.song.length, speed: res.speed }) +
      (skipped.length ? " " + tf("sidGoatSkipped", { list: skipped.join(", ") }) : "") +
      (dump.sidCount > 2 ? " " + tf("sidImportSidFirstOnly", { count: dump.sidCount }) : ""), false);
  } catch (err) {
    progress(null, String((err && err.message) || err));
    busy(false);
  } finally {
    if (typeof unlisten === "function") unlisten();
  }
}

function _sidExport(kind) {
  if (kind === "asm") return _sidExportAsmPlayable();
  // BASIC DATA dump (unchanged legacy path)
  let lines = [];
  const dd = function(arr){ return arr.join(","); };
  _sidInsts.forEach(function(ins, i) {
    const ctrl = _sidWaveByte(ins);
    const ad = (ins.a<<4) | ins.d;
    const sr = (ins.s<<4) | ins.r;
    const resFilt = (ins.res<<4) | 0;
    const modeVol = ((ins.lp?0x10:0)|(ins.bp?0x20:0)|(ins.hp?0x40:0)) | (ins.songVol ? _sidVol() : ins.vol);
    const bytes = [ctrl, ad, sr, ins.pw&0xFF, (ins.pw>>8)&0x0F, ins.cut&0x07, (ins.cut>>3)&0xFF, resFilt, modeVol];
    lines.push((1000+i*10) + " DATA " + dd(bytes) + " : REM " + ins.name);
  });
  _sidPatterns.forEach(function(pat, pi) {
    lines.push("REM PATTERN " + pi);
    for (let v = 0; v < pat.length; v++) {
      const notes = [];
      for (let r = 0; r < _SID_ROWS; r++) { const c = pat[v][r]; notes.push(c.note==null ? 0 : (c.note+1)); }
      lines.push((2000+pi*(pat.length > 3 ? 200 : 100)+v*30) + " DATA " + dd(notes));
    }
  });
  const song = (_sidSong && _sidSong.length) ? _sidSong : [0];
  lines.push("REM SONG ORDER (pattern index per position)");
  lines.push("9000 DATA " + dd(song));
  return lines.join("\n");
}

const _SID_PLAYER_CODE_MAX = 0x900;

const _SID_PLAYER_2SID_EXTRA = 0x500;

function _sidExportAsmPlayable() {
  const lines = [];
  const L = function() { for (let i = 0; i < arguments.length; i++) lines.push(arguments[i].startsWith(";") || arguments[i].startsWith("*") || arguments[i].endsWith(":") || !arguments[i] ? arguments[i] : "    " + arguments[i]); };
  const hx = function(n){ return "$" + (n&0xFF).toString(16).toUpperCase().padStart(2,"0"); };
  const dh = function(arr){ return arr.map(hx).join(", "); };
  const chunk = function(label, arr, perLine) {
    perLine = perLine || 16;
    lines.push(label + ":");
    if (!arr.length) lines.push("    .byte $00");
    for (let i = 0; i < arr.length; i += perLine) {
      lines.push("    .byte " + dh(arr.slice(i, i + perLine)));
    }
  };

  // Each pattern is addressed via a 16-bit pointer (base + patternIndex*32,
  // computed once per pattern by sid_load_pattern), so the pattern count is
  // not bounded by one 8-bit index across the song; 256 is a defensive cap.
  // Six voices need twice the data, so fewer patterns fit below $A000.
  const nv = _sidPatterns[0] && _sidPatterns[0].length > 3 ? 6 : 3;
  const sid2 = nv > 3 ? _sidSid2Addr : 0xD420;
  const exportedPatterns = Math.min(_sidPatterns.length, nv > 3 ? 46 : 256);
  const td = _sidTuneData({ patterns: _sidPatterns.slice(0, exportedPatterns) });
  const speed = td.speed;
  const exportedSong = td.song.slice(0, 255);
  const a = td.a;

  L("; =========================================================",
    "; SID player + tune (generated by Visual Assembler SID editor)",
    "; " + (_sidIsNtsc() ? "NTSC 60" : "PAL 50") + " Hz IRQ-driven, " + (nv > 3 ? "6 voices (second SID at $" + sid2.toString(16).toUpperCase() + ")" : "3 voices") + ", " + _SID_ROWS + "-row patterns",
    "; Call JSR sid_init once to start playback; JSR sid_stop to silence.",
    "; Own IRQ instead: skip sid_init's IRQ setup and JSR sid_frame once per frame.",
    "; Speed: " + speed + " frames/row. " + exportedPatterns + " pattern(s) in the bank, " +
      exportedSong.length + " step(s) in the song/order list (patterns may repeat).");
  if (exportedPatterns < _sidPatterns.length) {
    L("; NOTE: only the first " + exportedPatterns + " patterns are exported (" + _sidPatterns.length + " present).");
  }
  if (exportedSong.length < td.song.length) {
    L("; NOTE: only the first " + exportedSong.length + " song steps are exported (" + td.song.length +
      " present); order-list player uses an 8-bit position counter.");
  }
  L(";",
    "; Zero page usage (avoid these if combining with other code):",
    ";   $FB SID_TICK  $FC SID_ROW  $FD SID_ORDERPOS",
    ";   $02-$19  twelve pattern-relative pointers (v0/v1/v2 x notes/insts/fx/fxval)",
    ";   $1A SID_TMP2   $1B/$1C SID_OFFSET (pattern-index*32, 16-bit)",
    ";   $2F SID_SPEED_CUR (current frames/row; changed at runtime by the F effect)",
    ...(nv > 3 ? [";   $50-$67  the same twelve pointers of v3/v4/v5 (second SID)",
      ";   $68/$69  the current voice's SID registers"] : []),
    "; Everything else (voice, modulation and filter state) lives in sid_state.",
    ";",
    "; Every frame: per voice the wave/arpeggio table, instrument vibrato,",
    "; pulse width modulation, gate timer / hard restart; the filter cutoff sweep",
    "; of the voice that last started a filter-routed instrument.",
    "; Effect column (once per row): V=vibrato, U/D=slide up/down, C=note cut,",
    "; F=speed change.",
    "; =========================================================",
    "",
    "* = $080D",
    "",
    "sid_main:",
    "JSR sid_init",
    "sid_main_loop:",
    "JMP sid_main_loop",
    "",
    "* = $C000",
    "");

  const STATE_V = ["on", "inst", "note", "gate", "jon", "ffr", "ctl", "sll", "slh", "fvol", "fvoh", "fvs", "fvc",
    "vdl", "vcn", "vdr", "vofl", "vofh", "vstl", "vsth", "pwl", "pwh", "pwd", "tpos", "tcnt", "wav", "nof", "nab"];
  // filter and volume are per SID: the second SID's state has the suffix 2
  const STATE_F = ["fown", "fcl", "fch", "fspd", "ftl", "fth", "fsl", "fsh", "fel", "feh", "fping", "fres", "fmode",
    "froute", "vol"];
  const STATE_G = STATE_F.concat(nv > 3 ? STATE_F.map(function(n){ return n + "2"; }) : [],
    ["cv", "ci", "fxv", "tmp", "t0", "t1", "t3", "m0", "m1"]);
  const stateSize = STATE_V.length * nv + STATE_G.length;

  // ---- sid_init / sid_stop / sid_irq -------------------------------------
  L("sid_init:",
    "SEI",
    "LDA #$00",
    "STA $D418",
    "LDX #$18",
    "sid_clr:",
    "STA $D400,X",
    ...(nv > 3 ? ["STA $" + sid2.toString(16).toUpperCase() + ",X"] : []),
    "DEX",
    "BPL sid_clr",
    "LDX #" + hx(stateSize),
    "sid_clr_state:",
    "DEX",
    "STA sid_state,X",
    "BNE sid_clr_state",
    "LDA #$FF",
    "STA sid_fown",            // no voice owns the filter yet
    ...(nv > 3 ? ["STA sid_fown2"] : []),
    "LDA #" + hx(td.vol),
    "STA sid_vol",             // the tune's volume, per SID
    ...(nv > 3 ? ["LDA #" + hx(td.vol2), "STA sid_vol2"] : []),
    "LDA #" + hx(speed),
    "STA $FB",                 // SID_TICK
    "STA $2F",                 // SID_SPEED_CUR (the F effect can change it later)
    "LDA #$00",
    "STA $FC",                 // SID_ROW
    "STA $FD",                 // SID_ORDERPOS = 0
    "LDX sid_order",           // X = pattern index for order slot 0
    "JSR sid_load_pattern",
    "LDA #<sid_irq",
    "STA $0314",
    "LDA #>sid_irq",
    "STA $0315",
    "LDA #$01",
    "STA $D01A",               // enable raster IRQ
    "LDA #$80",
    "STA $D012",               // trigger raster line $80
    "LDA $D011",
    "AND #$7F",
    "STA $D011",               // clear bit 8 of raster
    "LDA #$7F",
    "STA $DC0D",               // CIA1 ints off
    "STA $DD0D",               // CIA2 ints off
    "LDA $DC0D",
    "LDA $DD0D",
    "CLI",
    "RTS",
    "",
    "sid_stop:",
    "SEI",
    "LDA #$00",
    "STA $D01A",
    "STA $D404",
    "STA $D40B",
    "STA $D412",
    "STA $D418",
    ...(nv > 3 ? [4, 11, 18, 24].map(function(r){ return "STA $" + (sid2 + r).toString(16).toUpperCase(); }) : []),
    "LDA #$81",
    "STA $DC0D",               // restore CIA1 timer A IRQ
    "LDA #$31",
    "STA $0314",
    "LDA #$EA",
    "STA $0315",               // restore KERNAL IRQ vector
    "CLI",
    "RTS",
    "",
    "sid_irq:",
    "LDA #$01",
    "STA $D019",               // ack raster
    "JSR sid_frame",
    "JMP $EA31",
    "",
    "; One frame of the player: row step every SID_SPEED_CUR frames, then the",
    "; per-frame instrument work.",
    "sid_frame:",
    "DEC $FB",
    "BNE sid_frame_norow",
    "LDA $2F",
    "STA $FB",
    "JSR sid_play_row",
    "sid_frame_norow:",
    "JSR sid_hr_check",
    "JMP sid_update",
    "");

  // ---- sid_play_row ------------------------------------------------------
  const voiceInfo = [
    { n: "v0", i: 0, notesPtr: "$02", instsPtr: "$04", fxPtr: "$0E", fxvalPtr: "$10", sid: 0xD400 },
    { n: "v1", i: 1, notesPtr: "$06", instsPtr: "$08", fxPtr: "$12", fxvalPtr: "$14", sid: 0xD407 },
    { n: "v2", i: 2, notesPtr: "$0A", instsPtr: "$0C", fxPtr: "$16", fxvalPtr: "$18", sid: 0xD40E },
    { n: "v3", i: 3, notesPtr: "$50", instsPtr: "$52", fxPtr: "$5C", fxvalPtr: "$5E", sid: sid2 },
    { n: "v4", i: 4, notesPtr: "$54", instsPtr: "$56", fxPtr: "$60", fxvalPtr: "$62", sid: sid2 + 7 },
    { n: "v5", i: 5, notesPtr: "$58", instsPtr: "$5A", fxPtr: "$64", fxvalPtr: "$66", sid: sid2 + 14 }
  ].slice(0, nv);
  const h4 = function(n){ return "$" + n.toString(16).toUpperCase().padStart(4, "0"); };
  // Voice registers: an index from $D400 with one SID. A second SID can be out of
  // the index's reach, so with two SIDs they go through a pointer set per voice.
  const vbase = nv > 3 ? "JSR sid_vptr" : "LDY sid_vbase,X";
  const vreg = function(r) {
    return nv > 3 ? ["LDY #" + hx(r), "STA ($68),Y"] : ["STA " + h4(0xD400 + r) + ",Y"];
  };
  L("sid_play_row:");
  voiceInfo.forEach(function(vi) {
    L("LDY $FC",
      "LDA (" + vi.notesPtr + "),Y",
      "BEQ sid_skip_" + vi.n,
      "STA $1A",               // note 1..96
      "LDA (" + vi.instsPtr + "),Y",
      "TAX",
      "LDA #" + hx(vi.i),
      "STA sid_cv",
      "LDA $1A",
      "JSR sid_set_voice",
      "sid_skip_" + vi.n + ":",
      // effect column: any effect but V stops the effect vibrato
      "LDY $FC",
      "LDA (" + vi.fxvalPtr + "),Y",
      "TAX",                   // X = fx value
      "LDA (" + vi.fxPtr + "),Y",
      "STA $1A",               // fx code (0=none,1=V,2=U,3=D,4=C,5=F)
      "CMP #$01",
      "BEQ sid_fxv_" + vi.n,
      "LDA #$00",
      "STA sid_fvol+" + vi.i,
      "STA sid_fvoh+" + vi.i,
      "LDA $1A",
      "BEQ sid_fxdone_" + vi.n,
      "CMP #$04",              // C = note cut
      "BNE sid_fxnc_" + vi.n,
      "LDA #$00",
      "STA sid_gate+" + vi.i,
      "JMP sid_fxdone_" + vi.n,
      "sid_fxnc_" + vi.n + ":",
      "CMP #$05",              // F = speed change
      "BNE sid_fxnf_" + vi.n,
      "TXA",
      "BEQ sid_fxdone_" + vi.n,
      "STA $2F",
      "JMP sid_fxdone_" + vi.n,
      "sid_fxnf_" + vi.n + ":",
      "CMP #$02",              // U = slide up
      "BNE sid_fxnu_" + vi.n,
      "JSR sid_slideup_" + vi.n,
      "JMP sid_fxdone_" + vi.n,
      "sid_fxnu_" + vi.n + ":",
      "CMP #$03",              // D = slide down
      "BNE sid_fxdone_" + vi.n,
      "JSR sid_slidedown_" + vi.n,
      "JMP sid_fxdone_" + vi.n,
      "sid_fxv_" + vi.n + ":",
      "JSR sid_vib_" + vi.n,
      "sid_fxdone_" + vi.n + ":");
  });
  L("INC $FC",
    "LDA $FC",
    "CMP #" + hx(_SID_ROWS),
    "BCC sid_row_done",
    "JSR sid_next_order_step",
    "sid_row_done:",
    "RTS",
    "",
    "sid_next_order_step:",
    "LDA #$00",
    "STA $FC",
    "INC $FD",
    "LDX $FD",
    "CPX #" + hx(exportedSong.length),
    "BCC sid_order_ok",
    "LDX #$00",
    "STX $FD",
    "sid_order_ok:",
    "LDX $FD",
    "LDA sid_order,X",
    "TAX",
    "JMP sid_load_pattern",
    "",
    "; X = pattern index: point the twelve per-voice column pointers at its row 0",
    "sid_load_pattern:",
    "TXA",
    "STA $1B",
    "LDA #$00",
    "STA $1C");
  for (let k = 0; k < 5; k++) L("ASL $1B", "ROL $1C");
  voiceInfo.flatMap(function(vi) {
    return [[vi.notesPtr, "sid_" + vi.n + "_notes"], [vi.instsPtr, "sid_" + vi.n + "_insts"],
      [vi.fxPtr, "sid_" + vi.n + "_fx"], [vi.fxvalPtr, "sid_" + vi.n + "_fxval"]];
  }).forEach(function(entry) {
    const zpHi = "$" + (parseInt(entry[0].slice(1), 16) + 1).toString(16).toUpperCase().padStart(2, "0");
    L("CLC", "LDA #<" + entry[1], "ADC $1B", "STA " + entry[0], "LDA #>" + entry[1], "ADC $1C", "STA " + zpHi);
  });
  L("RTS", "");

  // ---- effect column routines (X = fx value on entry) ---------------------
  voiceInfo.forEach(function(vi) {
    L("sid_vib_" + vi.n + ":", "STX sid_fxv", "LDX #" + hx(vi.i), "JMP sid_fx_vib",
      "sid_slideup_" + vi.n + ":", "STX sid_fxv", "LDX #" + hx(vi.i), "JMP sid_fx_up",
      "sid_slidedown_" + vi.n + ":", "STX sid_fxv", "LDX #" + hx(vi.i), "JMP sid_fx_down");
  });
  L("; V: square wobble of +-depth*4 around the pitch, flipping every hold rows",
    "sid_fx_vib:",
    "LDA sid_fxv",
    "LSR", "LSR", "LSR", "LSR",
    "BNE sid_fxvib_sp",
    "LDA #$01",
    "sid_fxvib_sp:",
    "CMP sid_fvc,X",
    "BNE sid_fxvib_hold",
    "LDA #$00",
    "STA sid_fvc,X",
    "LDA sid_fvs,X",
    "EOR #$FF",
    "STA sid_fvs,X",
    "JMP sid_fxvib_apply",
    "sid_fxvib_hold:",
    "INC sid_fvc,X",
    "sid_fxvib_apply:",
    "LDA sid_fxv",
    "AND #$0F",
    "ASL", "ASL",
    "STA sid_tmp",
    "LDA sid_fvs,X",
    "BEQ sid_fxvib_neg",
    "LDA sid_tmp",
    "STA sid_fvol,X",
    "LDA #$00",
    "STA sid_fvoh,X",
    "RTS",
    "sid_fxvib_neg:",
    "LDA #$00",
    "SEC",
    "SBC sid_tmp",
    "STA sid_fvol,X",
    "LDA #$00",
    "SBC #$00",
    "STA sid_fvoh,X",
    "RTS",
    "sid_fx_up:",
    "CLC",
    "LDA sid_sll,X",
    "ADC sid_fxv",
    "STA sid_sll,X",
    "LDA sid_slh,X",
    "ADC #$00",
    "STA sid_slh,X",
    "RTS",
    "sid_fx_down:",
    "SEC",
    "LDA sid_sll,X",
    "SBC sid_fxv",
    "STA sid_sll,X",
    "LDA sid_slh,X",
    "SBC #$00",
    "STA sid_slh,X",
    "RTS",
    "");

  // ---- sid_set_voice: note on (A = note 1..96, X = instrument, sid_cv = voice)
  L("sid_set_voice:",
    "SEC",
    "SBC #$01",
    "STA sid_tmp",             // note 0..95
    "STX sid_ci",
    "LDX sid_cv",
    vbase,
    "LDA sid_ctl,X",
    "AND #$FE",
    "STA sid_ctl,X",
    ...vreg(4),             // gate off: the gate on below retriggers the envelope
    "LDA sid_tmp",
    "STA sid_note,X",
    "LDA sid_ci",
    "STA sid_inst,X",
    "LDA #$01",
    "STA sid_on,X",
    "STA sid_gate,X",
    "STA sid_jon,X",
    "STA sid_vdr,X",
    "LDA #$00",
    "STA sid_sll,X",
    "STA sid_slh,X",
    "STA sid_fvol,X",
    "STA sid_fvoh,X",
    "STA sid_fvs,X",
    "STA sid_fvc,X",
    "STA sid_pwd,X",
    "STA sid_vofl,X",
    "STA sid_vofh,X",
    "STA sid_tpos,X",
    "STA sid_nof,X",
    "STA sid_nab,X",
    "LDY sid_ci",
    "LDA sid_iffw,Y",
    "STA sid_ffr,X",
    "LDA sid_ipwl,Y",
    "STA sid_pwl,X",
    "LDA sid_ipwh,Y",
    "STA sid_pwh,X",
    "LDA sid_ivdl,Y",
    "STA sid_vdl,X",
    "LDA sid_ivsp,Y",
    "CLC",
    "ADC #$01",
    "LSR",
    "BNE sid_sv_vcn",
    "LDA #$01",
    "sid_sv_vcn:",
    "STA sid_vcn,X",
    "LDA sid_itsp,Y",
    "STA sid_tcnt,X",
    "LDA sid_ictl,Y",
    "STA sid_wav,X",
    // vibrato step = (semitone(note) * depth) >> 5
    "LDA sid_ivdp,Y",
    "STA sid_t3",
    "LDA #$00",
    "STA sid_vstl,X",
    "STA sid_vsth,X",
    "LDY sid_tmp",
    "LDA sid_semi_lo,Y",
    "STA sid_m0",
    "LDA sid_semi_hi,Y",
    "STA sid_m1",
    "sid_sv_mul:",
    "LSR sid_t3",
    "BCC sid_sv_noadd",
    "CLC",
    "LDA sid_vstl,X",
    "ADC sid_m0",
    "STA sid_vstl,X",
    "LDA sid_vsth,X",
    "ADC sid_m1",
    "STA sid_vsth,X",
    "sid_sv_noadd:",
    "ASL sid_m0",
    "ROL sid_m1",
    "LDA sid_t3",
    "BNE sid_sv_mul",
    "LDY #$05",
    "sid_sv_shr:",
    "LSR sid_vsth,X",
    "ROR sid_vstl,X",
    "DEY",
    "BNE sid_sv_shr",
    "LDY sid_ci",
    "LDA sid_itln,Y",
    "BEQ sid_sv_notab",
    "LDA sid_itst,Y",
    "JSR sid_tab_apply",
    "LDY sid_ci",
    "sid_sv_notab:",
    "LDA sid_iad,Y",
    "STA sid_t0",
    "LDA sid_isr,Y",
    vbase,
    ...vreg(6),
    "LDA sid_t0",
    ...vreg(5),
    "LDY sid_ci");
  const takeFilter = function(s) {
    L(
      "LDA sid_ivol,Y",
      "CMP #$10",                // $10 = the song's volume: the chip keeps it
      "BCS sid_sv_vol" + s,
      "STA sid_vol" + s,
      "sid_sv_vol" + s + ":",
      "LDA sid_ifl,Y",
      "AND #$01",
      "BEQ sid_sv_nofilt" + s,
      // this voice takes over the filter: cutoff sweep, resonance, mode
      "STX sid_fown" + s,
      "LDA sid_icul,Y",
      "STA sid_fcl" + s,
      "STA sid_fsl" + s,
      "LDA sid_icuh,Y",
      "STA sid_fch" + s,
      "STA sid_fsh" + s,
      "LDA sid_icel,Y",
      "STA sid_fel" + s,
      "STA sid_ftl" + s,
      "LDA sid_iceh,Y",
      "STA sid_feh" + s,
      "STA sid_fth" + s,
      "LDA sid_icsp,Y",
      "STA sid_fspd" + s,
      "LDA sid_ifl,Y",
      "AND #$02",
      "STA sid_fping" + s,
      "LDA sid_ires,Y",
      "STA sid_fres" + s,
      "LDA sid_imode,Y",
      "STA sid_fmode" + s,
      "LDA sid_vbit,X",
      "ORA sid_froute" + s,
      "STA sid_froute" + s,
      "RTS",
      "sid_sv_nofilt" + s + ":",
      "LDA sid_vbit,X",
      "EOR #$FF",
      "AND sid_froute" + s,
      "STA sid_froute" + s,
      "RTS");
  };
  if (nv > 3) L("CPX #$03", "BCC sid_sv_sid1", "JMP sid_sv_sid2", "sid_sv_sid1:");
  takeFilter("");
  if (nv > 3) { L("sid_sv_sid2:"); takeFilter("2"); }
  L("",
    "; A = table step, X = voice: waveform (0 = keep) and note offset",
    "sid_tab_apply:",
    "TAY",
    "LDA sid_tw,Y",
    "BEQ sid_ta_keep",
    "AND #$FE",
    "STA sid_wav,X",
    "sid_ta_keep:",
    "LDA sid_tn,Y",
    "STA sid_nof,X",
    "LDA sid_ta,Y",
    "STA sid_nab,X",
    "RTS",
    "");

  // ---- gate timer / hard restart: gt frames before the next new note -----
  L("sid_hr_check:");
  voiceInfo.forEach(function(vi) {
    L("LDA sid_on+" + vi.i,
      "BEQ sid_hr_" + vi.n,
      "LDY sid_inst+" + vi.i,
      "LDA sid_igt,Y",
      "BEQ sid_hr_" + vi.n,
      "CMP $FB",
      "BNE sid_hr_" + vi.n,
      "CMP $2F",
      "BEQ sid_hr_" + vi.n,
      "LDY $FC",
      "LDA (" + vi.notesPtr + "),Y",
      "BEQ sid_hr_" + vi.n,
      "LDA #$00",
      "STA sid_gate+" + vi.i,
      "LDY sid_inst+" + vi.i,
      "LDA sid_ihr,Y",
      "BEQ sid_hr_" + vi.n,
      "LDA #$00",
      "STA " + h4(vi.sid + 5),
      "STA " + h4(vi.sid + 6),
      "sid_hr_" + vi.n + ":");
  });
  L("RTS", "");

  // ---- per-frame update: table, pitch, vibrato, pulse width, filter -------
  L("sid_update:",
    "LDX #$00",
    "sid_up_loop:",
    "LDA sid_on,X",
    "BNE sid_up_on",
    "JMP sid_up_next",
    "sid_up_on:",
    "LDY sid_inst,X",
    "STY sid_ci",
    "LDA sid_jon,X",
    "BEQ sid_up_tab",
    "LDA #$00",
    "STA sid_jon,X",
    "LDA sid_ffr,X",
    "BEQ sid_up_wgate",
    "PHA",
    "LDA #$00",
    "STA sid_ffr,X",
    "PLA",
    "JMP sid_up_wctl",
    "sid_up_tab:",
    "LDA sid_itln,Y",
    "BEQ sid_up_wgate",
    "DEC sid_tcnt,X",
    "BNE sid_up_wgate",
    "LDA sid_itsp,Y",
    "STA sid_tcnt,X",
    "INC sid_tpos,X",
    "LDA sid_tpos,X",
    "CMP sid_itln,Y",
    "BCC sid_up_tstep",
    "LDA sid_itlp,Y",
    "CMP #$FF",
    "BNE sid_up_tloop",
    "LDA sid_itln,Y",
    "SEC",
    "SBC #$01",
    "sid_up_tloop:",
    "STA sid_tpos,X",
    "sid_up_tstep:",
    "LDA sid_tpos,X",
    "CLC",
    "ADC sid_itst,Y",
    "JSR sid_tab_apply",
    "LDY sid_ci",
    "sid_up_wgate:",
    "LDA sid_wav,X",
    "ORA sid_gate,X",
    "sid_up_wctl:",
    "STA sid_ctl,X",
    vbase,
    ...vreg(4),
    // note index: absolute table note, or note + signed offset, clamped 0..95
    "LDA sid_nab,X",
    "BEQ sid_up_rel",
    "LDA sid_nof,X",
    "JMP sid_up_nclamp",
    "sid_up_rel:",
    "LDA sid_nof,X",
    "BMI sid_up_nneg",
    "CLC",
    "ADC sid_note,X",
    "JMP sid_up_nclamp",
    "sid_up_nneg:",
    "CLC",
    "ADC sid_note,X",
    "BCS sid_up_nclamp",
    "LDA #$00",
    "sid_up_nclamp:",
    "CMP #$60",
    "BCC sid_up_nok",
    "LDA #$5F",
    "sid_up_nok:",
    "TAY",
    // frequency = table + slide + effect vibrato + instrument vibrato
    "CLC",
    "LDA sid_freq_lo,Y",
    "ADC sid_sll,X",
    "STA sid_t0",
    "LDA sid_freq_hi,Y",
    "ADC sid_slh,X",
    "STA sid_t1",
    "CLC",
    "LDA sid_t0",
    "ADC sid_fvol,X",
    "STA sid_t0",
    "LDA sid_t1",
    "ADC sid_fvoh,X",
    "STA sid_t1",
    "CLC",
    "LDA sid_t0",
    "ADC sid_vofl,X",
    "STA sid_t0",
    "LDA sid_t1",
    "ADC sid_vofh,X",
    vbase,
    ...vreg(1),
    "LDA sid_t0",
    ...vreg(0),
    // instrument vibrato: after the delay a triangle LFO, flipping every speed frames
    "LDY sid_ci",
    "LDA sid_ivsp,Y",
    "BEQ sid_up_novib",
    "LDA sid_ivdp,Y",
    "BEQ sid_up_novib",
    "LDA sid_vdl,X",
    "BEQ sid_up_vrun",
    "DEC sid_vdl,X",
    "JMP sid_up_novib",
    "sid_up_vrun:",
    "LDA sid_vdr,X",
    "BEQ sid_up_vdown",
    "CLC",
    "LDA sid_vofl,X",
    "ADC sid_vstl,X",
    "STA sid_vofl,X",
    "LDA sid_vofh,X",
    "ADC sid_vsth,X",
    "STA sid_vofh,X",
    "JMP sid_up_vcnt",
    "sid_up_vdown:",
    "SEC",
    "LDA sid_vofl,X",
    "SBC sid_vstl,X",
    "STA sid_vofl,X",
    "LDA sid_vofh,X",
    "SBC sid_vsth,X",
    "STA sid_vofh,X",
    "sid_up_vcnt:",
    "DEC sid_vcn,X",
    "BNE sid_up_novib",
    "LDA sid_ivsp,Y",
    "STA sid_vcn,X",
    "LDA sid_vdr,X",
    "EOR #$01",
    "STA sid_vdr,X",
    "sid_up_novib:",
    // pulse width out, then the PWM sweep bouncing between min and max
    vbase,
    "LDA sid_pwl,X",
    ...vreg(2),
    "LDA sid_pwh,X",
    ...vreg(3),
    "LDY sid_ci",
    "LDA sid_ipms,Y",
    "BEQ sid_up_next",
    "STA sid_t0",
    "LDA sid_pwd,X",
    "BNE sid_up_pwdn",
    "CLC",
    "LDA sid_pwl,X",
    "ADC sid_t0",
    "STA sid_pwl,X",
    "LDA sid_pwh,X",
    "ADC #$00",
    "STA sid_pwh,X",
    "CMP sid_ipmxh,Y",
    "BCC sid_up_next",
    "BNE sid_up_pwtop",
    "LDA sid_pwl,X",
    "CMP sid_ipmxl,Y",
    "BCC sid_up_next",
    "sid_up_pwtop:",
    "LDA sid_ipmxl,Y",
    "STA sid_pwl,X",
    "LDA sid_ipmxh,Y",
    "STA sid_pwh,X",
    "LDA #$01",
    "STA sid_pwd,X",
    "JMP sid_up_next",
    "sid_up_pwdn:",
    "SEC",
    "LDA sid_pwl,X",
    "SBC sid_t0",
    "STA sid_pwl,X",
    "LDA sid_pwh,X",
    "SBC #$00",
    "STA sid_pwh,X",
    "BCC sid_up_pwbot",
    "CMP sid_ipmnh,Y",
    "BCC sid_up_pwbot",
    "BNE sid_up_next",
    "LDA sid_pwl,X",
    "CMP sid_ipmnl,Y",
    "BEQ sid_up_pwbot",
    "BCS sid_up_next",
    "sid_up_pwbot:",
    "LDA sid_ipmnl,Y",
    "STA sid_pwl,X",
    "LDA sid_ipmnh,Y",
    "STA sid_pwh,X",
    "LDA #$00",
    "STA sid_pwd,X",
    "sid_up_next:",
    "INX",
    "CPX #" + hx(nv),
    "BCS sid_up_filter",
    "JMP sid_up_loop");
  L("sid_up_filter:");
  if (nv > 3) L("JSR sid_filter2");
  // filter registers, then the cutoff sweep (bounce with ping-pong)
  const filterUpdate = function(s, o) {
    L(
      "LDA sid_fcl" + s,
      "AND #$07",
      "STA " + h4(0xD415 + o),
      "LDA sid_fch" + s,
      "STA sid_t1",
      "LDA sid_fcl" + s,
      "LSR sid_t1",
      "ROR",
      "LSR sid_t1",
      "ROR",
      "LSR sid_t1",
      "ROR",
      "STA " + h4(0xD416 + o),
      "LDA sid_fres" + s,
      "ORA sid_froute" + s,
      "STA " + h4(0xD417 + o),
      "LDA sid_fmode" + s,
      "ORA sid_vol" + s,
      "STA " + h4(0xD418 + o),
      "LDA sid_fown" + s,
      "BMI sid_fl_ret" + s,
      "LDA sid_fspd" + s,
      "BNE sid_fl_go" + s,
      "sid_fl_ret" + s + ":",
      "RTS",
      "sid_fl_go" + s + ":",
      "BMI sid_fl_neg" + s,
      "CLC",
      "ADC sid_fcl" + s,
      "STA sid_fcl" + s,
      "LDA sid_fch" + s,
      "ADC #$00",
      "STA sid_fch" + s,
      "CMP sid_fth" + s,
      "BCC sid_fl_ret" + s,
      "BNE sid_fl_reach" + s,
      "LDA sid_fcl" + s,
      "CMP sid_ftl" + s,
      "BCC sid_fl_ret" + s,
      "JMP sid_fl_reach" + s,
      "sid_fl_neg" + s + ":",
      "CLC",
      "ADC sid_fcl" + s,
      "STA sid_fcl" + s,
      "LDA sid_fch" + s,
      "ADC #$FF",
      "STA sid_fch" + s,
      "BMI sid_fl_reach" + s,
      "CMP sid_fth" + s,
      "BCC sid_fl_reach" + s,
      "BNE sid_fl_ret" + s,
      "LDA sid_fcl" + s,
      "CMP sid_ftl" + s,
      "BEQ sid_fl_reach" + s,
      "BCS sid_fl_ret" + s,
      "sid_fl_reach" + s + ":",
      "LDA sid_ftl" + s,
      "STA sid_fcl" + s,
      "LDA sid_fth" + s,
      "STA sid_fch" + s,
      "LDA sid_fping" + s,
      "BNE sid_fl_bounce" + s,
      "LDA #$00",
      "STA sid_fspd" + s,
      "RTS",
      "sid_fl_bounce" + s + ":",
      "LDA sid_ftl" + s,
      "CMP sid_fel" + s,
      "BNE sid_fl_toend" + s,
      "LDA sid_fth" + s,
      "CMP sid_feh" + s,
      "BNE sid_fl_toend" + s,
      "LDA sid_fsl" + s,
      "STA sid_ftl" + s,
      "LDA sid_fsh" + s,
      "STA sid_fth" + s,
      "JMP sid_fl_flip" + s,
      "sid_fl_toend" + s + ":",
      "LDA sid_fel" + s,
      "STA sid_ftl" + s,
      "LDA sid_feh" + s,
      "STA sid_fth" + s,
      "sid_fl_flip" + s + ":",
      "LDA #$00",
      "SEC",
      "SBC sid_fspd" + s,
      "STA sid_fspd" + s,
      "sid_fl_done" + s + ":",
      "RTS");
  };
  filterUpdate("", 0);
  if (nv > 3) {
    L("sid_filter2:");
    filterUpdate("2", sid2 - 0xD400);
    L("; X = voice: $68/$69 = its SID registers (A is kept)",
      "sid_vptr:",
      "PHA",
      "LDA sid_vbase,X",
      "STA $68",
      "LDA sid_vbaseh,X",
      "STA $69",
      "PLA",
      "RTS");
  }
  L("");

  // ---- data ----------------------------------------------------------------
  const dataStart = lines.length;
  if (nv > 3) {
    const bases = voiceInfo.map(function(vi){ return vi.sid; });
    chunk("sid_vbase", bases.map(function(x){ return x & 0xFF; }));
    chunk("sid_vbaseh", bases.map(function(x){ return x >> 8; }));
  } else {
    chunk("sid_vbase", [0, 7, 14]);
  }
  chunk("sid_vbit", [1, 2, 4, 1, 2, 4].slice(0, nv));
  L("; Song/order list: which pattern plays at each step; a pattern may",
    "; appear more than once.");
  chunk("sid_order", exportedSong);
  L("",
    "; Instruments: one table per parameter, indexed by instrument number",
    "; (ctrl w/o gate, AD, SR, PW, cutoff start/end/step, flags 1=filter 2=ping-pong,",
    "; resonance, mode+3off, volume, vibrato delay/speed/depth, PWM step/min/max,",
    "; gate timer, hard restart, first-frame wave, wave table start/len/loop/speed)",
    "sid_instruments:");
  [["sid_ictl", "ictl"], ["sid_iad", "iad"], ["sid_isr", "isr"], ["sid_ipwl", "ipwl"], ["sid_ipwh", "ipwh"],
   ["sid_icul", "icul"], ["sid_icuh", "icuh"], ["sid_icel", "icel"], ["sid_iceh", "iceh"], ["sid_icsp", "icsp"],
   ["sid_ifl", "ifl"], ["sid_ires", "ires"], ["sid_imode", "imode"], ["sid_ivol", "ivol"],
   ["sid_ivdl", "ivdl"], ["sid_ivsp", "ivsp"], ["sid_ivdp", "ivdp"],
   ["sid_ipms", "ipms"], ["sid_ipmnl", "ipmnl"], ["sid_ipmnh", "ipmnh"], ["sid_ipmxl", "ipmxl"], ["sid_ipmxh", "ipmxh"],
   ["sid_igt", "igt"], ["sid_ihr", "ihr"], ["sid_iffw", "iffw"],
   ["sid_itst", "itst"], ["sid_itln", "itln"], ["sid_itlp", "itlp"], ["sid_itsp", "itsp"]].forEach(function(p) {
    chunk(p[0], a[p[1]]);
  });
  L("; Wave/arpeggio table steps: waveform (0 = keep), note offset, 1 = absolute note");
  chunk("sid_tw", a.tw);
  chunk("sid_tn", a.tn);
  chunk("sid_ta", a.ta);
  L("");

  // notes + instrument + effect columns per voice, all patterns concatenated
  for (let v = 0; v < nv; v++) {
    const notes = [], insts = [], fxs = [], fxvals = [];
    for (let pi = 0; pi < exportedPatterns; pi++) {
      for (let r = 0; r < _SID_ROWS; r++) {
        const b = _sidCellBytes(_sidPatterns[pi][v][r], td.insts.length);
        notes.push(b[0]); insts.push(b[1]); fxs.push(b[2]); fxvals.push(b[3]);
      }
    }
    chunk("sid_v" + v + "_notes", notes);
    chunk("sid_v" + v + "_insts", insts);
    chunk("sid_v" + v + "_fx", fxs);
    chunk("sid_v" + v + "_fxval", fxvals);
  }
  L("");

  const ft = _sidFreqTables();
  L("; " + (_sidIsNtsc() ? "NTSC" : "PAL") + " frequency table (note 0 = C-0, note 95 = B-7) and semitone steps");
  chunk("sid_freq_lo", ft.f.map(function(x){ return x & 0xFF; }));
  chunk("sid_freq_hi", ft.f.map(function(x){ return x >> 8; }));
  chunk("sid_semi_lo", ft.semi.map(function(x){ return x & 0xFF; }));
  chunk("sid_semi_hi", ft.semi.map(function(x){ return x >> 8; }));
  // The player code fits in _SID_PLAYER_CODE_MAX bytes. When code + data + state
  // would reach $D000 (I/O), the data moves to its own segment ending below
  // $A000 (BASIC ROM), so a long tune never lands in I/O or under ROM.
  const dataLines = lines.slice(dataStart);
  const dataBytes = dataLines.reduce(function(n, l) {
    const m = /^\s*\.byte\s+(.*)$/.exec(l);
    return m ? n + m[1].split(",").length : n;
  }, 0);
  const codeMax = nv > 3 ? _SID_PLAYER_CODE_MAX + _SID_PLAYER_2SID_EXTRA : _SID_PLAYER_CODE_MAX;
  const split = 0xC000 + codeMax + dataBytes + stateSize > 0xD000;
  _sidExportAsmPlayable.dataOrg = split ? (0xA000 - dataBytes) & 0xFF00 : 0xC000;
  if (split) lines.length = dataStart;
  L("", "; Player state (cleared by sid_init)", "sid_state:");
  STATE_V.forEach(function(n){ L("sid_" + n + ":", ".byte " + new Array(nv).fill("$00").join(", ")); });
  STATE_G.forEach(function(n){ L("sid_" + n + ":", ".byte $00"); });
  if (split) {
    L("", "; Tune data (" + dataBytes + " bytes): too long for $C000-$CFFF next to the player",
      "* = $" + _sidExportAsmPlayable.dataOrg.toString(16).toUpperCase(), "");
    dataLines.forEach(function(l){ lines.push(l); });
  }

  return lines.join("\n");
}

// UltimateBasic export: a `tune ... end` block (instruments, order list and
// pattern rows as text) plus `music play`. The UB compiler turns it into a
// zero-page-free player, so nothing here is machine code.
function _sidExportUbBlock() {
  const hx = function(n, w){ return "$" + (n >>> 0).toString(16).toUpperCase().padStart(w, "0"); };
  const speed = Math.max(1, Math.min(255, _sidSpeed|0));
  const exportedPatterns = Math.min(_sidPatterns.length, 8);
  const song = ((_sidSong && _sidSong.length) ? _sidSong : [0])
    .map(function(idx){ return Math.max(0, Math.min(exportedPatterns - 1, idx|0)); })
    .slice(0, 255);
  const lines = [];
  lines.push("# SID tune (generated by Visual Assembler SID editor)");
  lines.push("# Place where the music should start; music play / music stop control it.");
  if (exportedPatterns < _sidPatterns.length) {
    lines.push("# NOTE: only the first " + exportedPatterns + " patterns are exported (" + _sidPatterns.length + " present).");
  }
  if (_sidPatterns[0] && _sidPatterns[0].length > 3) lines.push("# NOTE: UltimateBasic plays one SID: only the first three voices are exported.");
  lines.push("tune");
  lines.push("  speed " + speed);
  _sidInsts.forEach(function(raw, i) {
    const ins = _sidInstNorm(raw);
    // any routing bit in resfilt = "route the voice that plays this instrument"
    const resFilt = (ins.res<<4) | (ins.filt ? 0x07 : 0x00);
    const modeVol = ((ins.lp?0x10:0)|(ins.bp?0x20:0)|(ins.hp?0x40:0)|(ins.off3?0x80:0)) | (ins.songVol ? _sidVol() : ins.vol);
    lines.push("  inst " + [i, hx(_sidWaveByte(ins), 2), hx((ins.a<<4)|ins.d, 2), hx((ins.s<<4)|ins.r, 2),
      hx(ins.pw & 0xFFF, 4), hx(ins.cut & 0x7FF, 4), hx(resFilt, 2), hx(modeVol, 2)].join(", ") +
      "   # " + String(ins.name || "").replace(/[\r\n]+/g, " "));
    if (ins.vibDelay || ins.vibSpeed || ins.vibDepth || ins.pwmSpeed) {
      lines.push("  imod " + [i, ins.vibDelay, ins.vibSpeed, ins.vibDepth, ins.pwmSpeed, hx(ins.pwmMin, 4), hx(ins.pwmMax, 4)].join(", "));
    }
    if (ins.cutSpeed || ins.cutPing || ins.cutEnd !== ins.cut) {
      lines.push("  ifilt " + [i, hx(ins.cutEnd, 4), ins.cutSpeed, ins.cutPing ? 1 : 0].join(", "));
    }
    if (ins.gateTimer || ins.hr || ins.firstWave) {
      lines.push("  igate " + [i, ins.gateTimer, ins.hr ? 1 : 0, hx(ins.firstWave, 2)].join(", "));
    }
    if (ins.table.length) {
      const steps = ins.table.map(function(s) {
        const w = s.w ? (s.w & 0xFF).toString(16).toUpperCase().padStart(2, "0") : "..";
        return '"' + w + " " + (s.abs ? "=" + s.n : (s.n < 0 ? "-" : "+") + Math.abs(s.n)) + '"';
      });
      lines.push("  itab " + [i, ins.tableSpeed, ins.tableLoop < 0 ? 255 : ins.tableLoop].join(", ") + ", " + steps.join(", "));
    }
  });
  for (let i = 0; i < song.length; i += 16) lines.push("  order " + song.slice(i, i + 16).join(", "));
  for (let pi = 0; pi < exportedPatterns; pi++) {
    for (let v = 0; v < 3; v++) {
      const cells = [];
      for (let r = 0; r < _SID_ROWS; r++) {
        const c = _sidCellText(_sidPatterns[pi][v][r]);
        cells.push(c === "... .. ..." ? "..." : c);
      }
      while (cells.length && cells[cells.length - 1] === "...") cells.pop();
      if (!cells.length) continue;
      lines.push("  pat " + pi + ", " + v + ", " + cells.map(function(c){ return '"' + c + '"'; }).join(", "));
    }
  }
  lines.push("end");
  lines.push("music play");
  return lines.join("\n");
}

function _sidExportToUb() {
  return _ubInsertOrCopy(_sidExportUbBlock());
}

function _ubInsertOrCopy(txt) {
  if (!txt) return false;
  navigator.clipboard.writeText(txt).catch(function(){});
  showViceToast(t("sidExportUbCopied"));
  return false;
}

function _sidCopyExport(kind) {
  navigator.clipboard.writeText(_sidExport(kind)).catch(function(){});
}

/* ── Init + wiring ── */
function _sidInit() {
  if (_sidInited) return;
  _sidInited = true;
  _sidInsts = [_sidNewInst()];
  _sidPatterns = [_sidNewPattern()];
  _sidPlayPat = 0;
  _sidSong = [0];
  _sidSongPos = 0;
  _sidSongPlayPos = 0;
  _sidSyncPlayModeSel();
  _sidUpdateBpmDisplay();
  _sidLoadMasterVolume();
  _sidLoadPreviewSettings();
  _sidBuildPresetSelect();
  _sidBuildInstSel();
  _sidLoadInstUI();
  _sidBuildPatSel();
  _sidBuildSongList();
  _sidBuildTracker();
  // VA-VK settings (read here: setupSidEditor runs before these lets exist)
  const vkSaved = _sidVkbdState();
  if (typeof vkSaved.insert === "boolean") _sidVkbdInsertMode = vkSaved.insert;
  if (typeof vkSaved.showPlay === "boolean") _sidVkbdShowPlay = vkSaved.showPlay;
  const showPlayToggle = document.getElementById("sid-vkbd-showplay");
  if (showPlayToggle) showPlayToggle.checked = _sidVkbdShowPlay;
  if (Number.isFinite(vkSaved.octave)) _sidOctave = Math.max(0, Math.min(7, vkSaved.octave));
  _sidSetOctave(_sidOctave);
  _sidUpdatePauseButton();
  _sidRenderVirtualKeyboard();
}

function _sidBuildPatSel() {
  const sel = document.getElementById("sid-pat-sel"); if (!sel) return;
  sel.innerHTML = "";
  _sidPatterns.forEach(function(p, i) {
    const o = document.createElement("option"); o.value = i; o.textContent = "Pat " + (i<10?"0":"") + i; sel.appendChild(o);
  });
  sel.value = _sidPat;
}

function setupSidEditor() {
  const dialog = document.getElementById("sid-editor-dialog");
  if (!dialog) return;
  const onId = function(id, ev, fn){ const el=document.getElementById(id); if(el) el.addEventListener(ev, fn); };

  const syncEditorButton = function() {
    const btn = document.getElementById("sid-editor-btn");
    btn?.classList.toggle("main-tb-btn--active", dialog.open);
    btn?.setAttribute("aria-pressed", String(dialog.open));
    try { localStorage.setItem("va-sid-editor-open", dialog.open ? "1" : "0"); } catch (_) {}
  };
  // non-modal: the SID Player and the other windows stay usable beside it
  const openEditor = function() {
    // centered, but with left / top: a centering transform would be the panels' containing block
    if (!_editorDialogPositions["sid-editor-dialog"]) {
      _editorDialogPositions["sid-editor-dialog"] = {
        left: Math.round(Math.max(8, (window.innerWidth - Math.min(1000, window.innerWidth * 0.97)) / 2)),
        top: Math.round(Math.max(8, (window.innerHeight - Math.min(1120, window.innerHeight * 0.98)) / 2))
      };
    }
    dialog._applyPosition?.();
    if (!_sidInited) { _sidInit(); _sidAutosaveStart(); }
    if (!_sidHist.cur) _sidHistCheck();
    _sidEditorEngineSync(); _sidLcdIdle(); dialog.show();
    // place the detached tracker before the first paint (no jump from the default spot)
    _sidRestoreTrackerFloat();
    _sidRollRestore();
    _sidAnaRestore();
    if (_sidVkbdState().open) _sidOpenVirtualKeyboard(false);
    syncEditorButton();
  };
  const closeEditor = function() { _sidCloseVirtualKeyboard(false); _sidStop(); _sidAutosave(); dialog.close(); syncEditorButton(); };
  onId("sid-editor-btn", "click", function() { if (dialog.open) closeEditor(); else openEditor(); });
  onId("app-new-tune-btn", "click", function() {
    if (!dialog.open) openEditor();
    document.getElementById("sid-new-tune")?.click();
  });
  onId("sid-close", "click", closeEditor);
  // Esc in a non-modal dialog is handled here, and not while a floating part has the focus
  dialog.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && !e.target.closest(".sid-vkbd-dialog, .sid-trk-float")) { e.preventDefault(); closeEditor(); }
  });
  if (localStorage.getItem("va-sid-editor-open") === "1") setTimeout(openEditor, 0);


  // instrument param bindings
  _sidInstFields().forEach(function(f) {
    const check = f[2] === "check";
    onId(f[0], check ? "change" : "input", function(e) {
      _sidCurInst()[f[1]] = check ? e.target.checked : parseInt(e.target.value, 10);
      if (f[3]) { const v = document.getElementById(f[3]); if (v) v.textContent = e.target.value; }
      // choosing a filter mode routes the voice through the filter (it would be silent otherwise)
      if (check && e.target.checked && (f[1] === "lp" || f[1] === "bp" || f[1] === "hp")) {
        _sidCurInst().filt = true;
        const route = document.getElementById("sid-filt"); if (route) route.checked = true;
      }
      _sidDrawADSR();
    });
  });
  // setupSidEditor még az app.js SID-állapotdeklarációi előtt fut.
  // A tekerő geometriája csak a script teljes kiértékelése után érhető el.
  setTimeout(_sidInitParamKnobs, 0);
  onId("sid-first-wave", "change", function(e){ _sidCurInst().firstWave = parseInt(e.target.value, 10) || 0; });
  onId("sid-table-speed", "input", function(e){
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v)) _sidCurInst().tableSpeed = Math.max(1, Math.min(15, v));
    _sidTableEdited();
  });
  onId("sid-table-loop", "change", function(e){ _sidCurInst().tableLoop = parseInt(e.target.value, 10); _sidTableEdited(); _sidRenderTable(); });
  onId("sid-table-preset", "change", function(e){ _sidApplyTablePreset(e.target.value); });
  onId("sid-table-add", "click", function(){
    const inst = _sidCurInst();
    if (inst.table.length >= 32) return;
    const last = inst.table[inst.table.length - 1];
    inst.table.push(last ? { w: 0, n: last.abs ? last.n : 0, abs: last.abs } : { w: 0, n: 0, abs: false });
    _sidTableEdited();
    _sidRenderTable();
  });
  onId("sid-inst-name", "input", function(e){ _sidCurInst().name = e.target.value; _sidBuildInstSel(); });
  onId("sid-inst-sel", "change", function(e){ _sidInst = parseInt(e.target.value,10); _sidLoadInstUI(); });
  _sidVkbdInstKnobBind();
  onId("sid-inst-add", "click", function(){ _sidInsts.push(_sidNewInst(t("sidNewInstrumentName") + " " + (_sidInsts.length+1))); _sidInst = _sidInsts.length-1; _sidBuildInstSel(); _sidLoadInstUI(); });
  onId("sid-preview", "click", function(){ _sidEnsureAudio(); _sidPlayInst(_sidCurInst(), _sidNoteFreq(57), _sidAudio.currentTime+0.02, 0.5); });

  // ADSR graph: drag the A/D/S/R handles with the mouse
  const adsrC = document.getElementById("sid-adsr-canvas");
  if (adsrC) {
    adsrC.style.cursor = "pointer";
    // A vászon felbontása követi a megjelenített méretet, így a rajz nem nyúlik
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(function(){
        const w = Math.round(adsrC.clientWidth), h = Math.round(adsrC.clientHeight);
        if (w > 0 && h > 0 && (adsrC.width !== w || adsrC.height !== h)) { adsrC.width = w; adsrC.height = h; _sidDrawADSR(); }
      }).observe(adsrC);
    }
    let drag = null;
    const pos = function(e){ const r = adsrC.getBoundingClientRect(); return { x:(e.clientX-r.left)*(adsrC.width/r.width), y:(e.clientY-r.top)*(adsrC.height/r.height) }; };
    const cl = function(v){ return Math.max(0, Math.min(15, Math.round(v))); };
    const upd = function(p){
      const g = _sidAdsrGeom; if (!g || !drag) return;
      const inst = _sidCurInst();
      if (drag === "a") inst.a = cl((p.x - g.x0)/g.q * 15);
      else if (drag === "d") { inst.d = cl((p.x - (g.x0+g.q))/g.q * 15); inst.s = cl((g.y0 - p.y)/(g.y0-g.yTop) * 15); }
      else if (drag === "s") inst.s = cl((g.y0 - p.y)/(g.y0-g.yTop) * 15);
      else if (drag === "r") inst.r = cl((p.x - (g.x0+3*g.q))/g.q * 15);
      ["a","d","s","r"].forEach(function(k){ const sl=document.getElementById("sid-"+k); if(sl) sl.value=inst[k]; const vv=document.getElementById("sid-"+k+"-val"); if(vv) vv.textContent=inst[k]; });
      _sidDrawADSR();
    };
    adsrC.addEventListener("pointerdown", function(e){
      const p = pos(e), g = _sidAdsrGeom; if (!g) return;
      let best=null, bd=16;
      g.handles.forEach(function(h){ const d=Math.hypot(p.x-h.x, p.y-h.y); if(d<bd){bd=d;best=h.id;} });
      if (best) { drag=best; try{adsrC.setPointerCapture(e.pointerId);}catch(_){} upd(p); e.preventDefault(); }
    });
    adsrC.addEventListener("pointermove", function(e){ if (drag) upd(pos(e)); });
    const end = function(e){ drag=null; if(e&&e.pointerId!=null){try{adsrC.releasePointerCapture(e.pointerId);}catch(_){}} };
    adsrC.addEventListener("pointerup", end);
    adsrC.addEventListener("pointercancel", end);
  }

  // tracker
  onId("sid-pat-sel", "change", function(e){ _sidSetPattern(parseInt(e.target.value,10), true); });
  onId("sid-chip-count", "change", function(e){ _sidSetSidCount(Number(e.target.value) === 2 ? 2 : 1); });
  const sid2Addr = document.getElementById("sid-chip-addr");
  if (sid2Addr) {
    _sidSid2Addrs().forEach(function(a) {
      const o = document.createElement("option");
      o.value = String(a); o.textContent = "$" + a.toString(16).toUpperCase();
      sid2Addr.appendChild(o);
    });
    sid2Addr.value = String(_sidSid2Addr);
    sid2Addr.addEventListener("change", function(e) {
      _sidStop();
      _sidSid2Addr = Number(e.target.value);
    });
  }
  onId("sid-pat-add", "click", function(){ _sidPatterns.push(_sidNewPattern()); _sidBuildPatSel(); _sidSetPattern(_sidPatterns.length-1, true); });
  onId("sid-song-add", "click", _sidSongInsert);
  onId("sid-song-del", "click", _sidSongRemove);
  onId("sid-song-up", "click", function(){ _sidSongMove(-1); });
  onId("sid-song-down", "click", function(){ _sidSongMove(1); });
  onId("sid-play-mode", "change", function(e){ _sidPlayMode = e.target.value === "current" ? "current" : "all"; if(_sidTimer){ _sidPlay(); } });
  onId("sid-song-vol", "input", function(e){
    _sidSongVol = Math.max(0, Math.min(15, parseInt(e.target.value, 10) || 0));
    const val = document.getElementById("sid-song-vol-val");
    if (val) val.textContent = String(_sidSongVol);
    if (_sidTimer) { _sidPlay(); }
  });
  onId("sid-song-vol2", "input", function(e){
    _sidSongVol2 = Math.max(0, Math.min(15, parseInt(e.target.value, 10) || 0));
    const val = document.getElementById("sid-song-vol2-val");
    if (val) val.textContent = String(_sidSongVol2);
    if (_sidTimer) { _sidPlay(); }
  });
  onId("sid-video", "change", function(e){
    _sidSetNtsc(e.target.value === "ntsc");
    if (_sidTimer) { _sidPlay(); }
  });
  onId("sid-inst-del", "click", _sidInstDeleteCurrent);
  onId("sid-inst-unused", "click", function(){
    const n = _sidInstRemoveUnused();
    showViceToast(n ? tf("sidRemoveUnusedDone", { n: n }) : t("sidRemoveUnusedNone"), false, true);
  });
  onId("sid-speed", "input", function(e){
    _sidSpeed = Math.max(1, Math.min(255, parseInt(e.target.value,10)||6));
    _sidUpdateBpmDisplay();
    if (_sidTimer) { _sidPlay(); }
  });
  const sidSpeedStep = function(d) {
    const el = document.getElementById("sid-speed");
    _sidSpeed = Math.max(1, Math.min(255, _sidSpeed + d));
    if (el) el.value = String(_sidSpeed);
    _sidUpdateBpmDisplay();
    if (_sidTimer) { _sidPlay(); }
  };
  onId("sid-speed-down", "click", function(){ sidSpeedStep(-1); });
  onId("sid-speed-up", "click", function(){ sidSpeedStep(1); });
  onId("sid-metronome", "click", _sidToggleMetronome);
  // Tördelő toolbar: a tooltip a dialógus belseje felé nyílik
  ["sid-clear", "sid-voice-copy"].forEach(function(id) {
    onId(id, "pointerenter", function(e) {
      const btn = e.currentTarget, box = dialog.getBoundingClientRect(), r = btn.getBoundingClientRect();
      btn.classList.toggle("sid-tip-end", r.left + r.width / 2 > box.left + box.width / 2);
    });
  });
  onId("sid-vkbd-metronome", "click", _sidToggleMetronome);
  onId("sid-pat-del", "click", _sidPatternDelete);
  onId("sid-record", "click", _sidToggleRecord);
  onId("sid-vkbd-record", "click", _sidToggleRecord);
  onId("sid-chord-preview", "click", _sidPreviewChord);
  onId("sid-arp-preview", "click", _sidPreviewArpeggio);
  onId("sid-chord-add", "click", _sidInsertChord);
  onId("sid-arp-add", "click", _sidInsertArpeggio);
  ["sid-master-vol", "sid-ed-master-vol"].forEach(function(id) {
    _sidKnobBind(document.getElementById(id),
      function() { return Math.round(_sidMasterVol * 100); },
      function(pct) { _sidSetMasterVolume(pct); });
  });
  onId("sid-play", "click", _sidPlayOnly);
  onId("sid-pause", "click", _sidPauseOnly);
  onId("sid-stop", "click", _sidStop);
  onId("sid-vkbd-play", "click", _sidPauseToggle);
  onId("sid-vkbd-stop", "click", _sidStop);
  onId("sid-virtual-keyboard", "click", function(){
    _sidOpenVirtualKeyboard();
    _dlgRaisePanel(document.getElementById("sid-virtual-keyboard-dialog"));
  });
  onId("sid-midi-connect", "click", _sidMidiConnect);
  try { _sidMidiPoly = localStorage.getItem("c64va-sid-midi-poly") === "1"; } catch (_) {}
  const midiPoly = document.getElementById("sid-midi-poly");
  if (midiPoly) midiPoly.checked = _sidMidiPoly;
  onId("sid-midi-poly", "change", function(e) {
    _sidMidiPoly = !!e.target.checked;
    try { localStorage.setItem("c64va-sid-midi-poly", _sidMidiPoly ? "1" : "0"); } catch (_) {}
  });
  onId("sid-midi-input", "change", function(e) { _sidMidiSetInput(e.target.value); });
  onId("sid-vkbd-close", "click", function(){
    _sidCloseVirtualKeyboard();
  });
  onId("sid-vkbd-oct-down", "click", function(){ _sidSetOctave(_sidOctave-1); });
  onId("sid-vkbd-oct-up", "click", function(){ _sidSetOctave(_sidOctave+1); });
  onId("sid-vkbd-showplay", "change", function(e){
    _sidVkbdShowPlay = !!e.target.checked;
    _sidSaveVkbdState({ showPlay: _sidVkbdShowPlay });
    _sidVkbdRenderPlay();
  });
  onId("sid-vkbd-insert", "change", function(e){
    _sidVkbdInsertMode = !!e.target.checked;
    _sidSaveVkbdState({ insert: _sidVkbdInsertMode });
  });
  onId("sid-vkbd-octaves", "change", function(e){
    try { localStorage.setItem("c64va-sid-vkbd-octaves", e.target.value); } catch (_) {}
    _sidRenderVirtualKeyboard();
  });
  const sidVkbdHdr = document.querySelector("#sid-virtual-keyboard-dialog .sid-vkbd-hdr");
  const sidVkbdDlg = document.getElementById("sid-virtual-keyboard-dialog");
  if (sidVkbdHdr && sidVkbdDlg) {
    sidVkbdHdr.addEventListener("pointerdown", function(e) {
      if (e.target.closest("button")) return;
      const rect = sidVkbdDlg.getBoundingClientRect();
      _sidVkbdDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      try { sidVkbdHdr.setPointerCapture(e.pointerId); } catch(_) {}
      e.preventDefault();
    });
    sidVkbdHdr.addEventListener("pointermove", function(e) {
      if (!_sidVkbdDrag) return;
      _sidDragTo(_sidVkbdDrag, sidVkbdDlg, e.clientX - _sidVkbdDrag.dx, e.clientY - _sidVkbdDrag.dy);
    });
    const endVkbdDrag = function(e) {
      if (!_sidVkbdDrag) return;
      _sidDragFlush(_sidVkbdDrag, sidVkbdDlg);
      if (_sidVkbdDrag.at) _sidSaveVkbdState({ left: _sidVkbdDrag.at.x, top: _sidVkbdDrag.at.y });
      _sidVkbdDrag = null;
      if (e && e.pointerId != null) { try { sidVkbdHdr.releasePointerCapture(e.pointerId); } catch(_) {} }
    };
    sidVkbdHdr.addEventListener("pointerup", endVkbdDrag);
    sidVkbdHdr.addEventListener("pointercancel", endVkbdDrag);
  }
  onId("sid-tracker-detach", "click", function(){ _sidSetTrackerDetached(!_sidTrackerIsDetached()); });
  _sidSetupRoll();
  _sidSetupAna();
  onId("sid-inst-sel", "change", _sidRollSyncHeader);
  onId("sid-tracker-attach", "click", function(){ _sidSetTrackerDetached(false); });
  _sidSetupTrackerFloat();
  let trkDetached = false;
  try { trkDetached = !!(JSON.parse(localStorage.getItem("c64va-sid-tracker-float") || "{}").detached); } catch (_) {}
  if (trkDetached) _sidSetTrackerDetached(true);
  // Files: save/load .bin + export blocks / export asm
  onId("sid-export-asm", "click", function(){ _sidCopyExport("asm"); });
  onId("sid-export-ub", "click", function(){
    _sidExportToUb();
  });
  onId("sid-save-bin", "click", function(){ _saveBinFile(_sidSerialize(), "sound.bin"); });
  onId("sid-export-psid", "click", async function(){
    let prg = await _buildSidPreviewPrg();
    if (!prg || prg.length < 3) { showViceToast?.(t("sidExportPsidFailed"), true); return; }
    // a build $0801-től tölt (BASIC stub + kitöltés); a .sid-be csak a lejátszó kell ($C000-tól,
    // hosszú dalnál az adatszegmens kezdetétől, ami $C000 alatt van)
    const load = prg[0] | (prg[1] << 8);
    const from = Math.min(0xC000, _sidExportAsmPlayable.dataOrg || 0xC000);
    if (load < from && prg.length > 2 + from - load) prg = Uint8Array.from([from & 0xFF, from >> 8, ...prg.slice(2 + from - load)]);
    // a lejátszó a sid_init-ben saját IRQ-t telepít ($C000), ezért playAddress = 0
    _saveBinFile(_buildPsidBytes(prg, 0xC000, 0x0000, "VA SID tune", String(new Date().getFullYear()), _sidVoiceCount() > 3 ? _sidSid2Addr : 0), "tune.sid");
  });
  const sidBinFile = document.getElementById("sid-bin-file");
  onId("sid-load-bin", "click", function(){ if (sidBinFile) sidBinFile.click(); });
  const sidSngFile = document.getElementById("sid-sng-file");
  onId("sid-import-goat", "click", function(){ if (sidSngFile) sidSngFile.click(); });
  if (sidSngFile) sidSngFile.addEventListener("change", function(e){
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(){ _sidApplyGoatImport(new Uint8Array(reader.result)); };
    reader.readAsArrayBuffer(file); e.target.value = "";
  });
  const sidSidFile = document.getElementById("sid-sid-file");
  const sidNewTune = async function(){
    if (!(await _showConfirm(t("sidNewTuneConfirm")))) return;
    _sidApplyImportedTune({ insts: [_sidNewInst()], patterns: [_sidNewPattern()], song: [0], speed: 6 }, "");
  };
  onId("sid-new-tune", "click", sidNewTune);
  onId("sid-import-sid", "click", function(){ if (sidSidFile) sidSidFile.click(); });
  if (sidSidFile) sidSidFile.addEventListener("change", function(e){
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(){ _sidOpenSidImport(new Uint8Array(reader.result)); };
    reader.readAsArrayBuffer(file); e.target.value = "";
  });
  onId("sid-import-sid-go", "click", function(){ _sidRunSidImport(); });
  onId("sid-import-sid-cancel", "click", function(){ document.getElementById("sid-import-sid-dialog")?.close(); });
  if (sidBinFile) sidBinFile.addEventListener("change", function(e){
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(){ _sidStop(); _sidDeserialize(new Uint8Array(reader.result)); _sidSetTuneTitle(file.name); };
    reader.readAsArrayBuffer(file); e.target.value = "";
  });

  // keyboard note entry / navigation
  const wrap = document.getElementById("sid-tracker-wrap");
  if (wrap) wrap.addEventListener("keydown", function(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.target.isContentEditable) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === "c") { _sidCopySelection(); e.preventDefault(); return; }
    if (e.ctrlKey && k === "v") { _sidPasteSelection(); e.preventDefault(); return; }
    if (e.key === "ArrowDown") {
      if (e.shiftKey) { if (_sidSelAnchor === null) _sidSelAnchor = { voice: _sidSel.voice, row: _sidSel.row }; } else { _sidSelAnchor = null; }
      _sidSel.row = (_sidSel.row+1)%_SID_ROWS; _sidRefreshSel(); e.preventDefault(); return;
    }
    if (e.key === "ArrowUp") {
      if (e.shiftKey) { if (_sidSelAnchor === null) _sidSelAnchor = { voice: _sidSel.voice, row: _sidSel.row }; } else { _sidSelAnchor = null; }
      _sidSel.row = (_sidSel.row-1+_SID_ROWS)%_SID_ROWS; _sidRefreshSel(); e.preventDefault(); return;
    }
    if (e.key === "ArrowLeft") { _sidSelAnchor = null; const n = _sidVoiceCount(); _sidSel.voice = (_sidSel.voice+n-1)%n; _sidRefreshSel(); e.preventDefault(); return; }
    if (e.key === "ArrowRight") { _sidSelAnchor = null; _sidSel.voice = (_sidSel.voice+1)%_sidVoiceCount(); _sidRefreshSel(); e.preventDefault(); return; }
    if (e.key === "Delete" || e.key === "Backspace" || k === ".") {
      _sidSelAnchor = null;
      _sidCurPat()[_sidSel.voice][_sidSel.row] = { note:null, inst:0 };
      _sidSetCellText(_sidSel.voice, _sidSel.row);
      _sidSel.row = (_sidSel.row+1)%_SID_ROWS; _sidRefreshSel(); e.preventDefault(); return;
    }
    if (e.key === "Enter") {
      const td = document.querySelector('#sid-tracker td.sid-cell[data-v="' + _sidSel.voice + '"][data-r="' + _sidSel.row + '"]');
      if (td) _sidBeginManualEdit(_sidSel.voice, _sidSel.row, td);
      e.preventDefault(); return;
    }
    // note-off (key-off), like the key left of / on "1" in trackers
    if (e.key === "1" || e.key === "`" || e.key === "=") {
      _sidSelAnchor = null;
      _sidCurPat()[_sidSel.voice][_sidSel.row] = { note: null, inst: 0, fx: "C", fxval: 0 };
      _sidSetCellText(_sidSel.voice, _sidSel.row);
      _sidSel.row = (_sidSel.row + 1) % _SID_ROWS; _sidRefreshSel(); e.preventDefault(); return;
    }
    if (_SID_KEYMAP.hasOwnProperty(k)) {
      _sidInsertNoteAtSelection(_sidOctave*12 + _SID_KEYMAP[k], true);
      e.preventDefault(); return;
    }
    if (k === "+" || k === "*" || e.key === "PageUp")   { _sidSetOctave(_sidOctave+1); e.preventDefault(); }
    if (k === "-" || k === "/" || e.key === "PageDown") { _sidSetOctave(_sidOctave-1); e.preventDefault(); }
  });

  _sidQuant = 4;
  _sidQuantRec = false;
  try {
    const grid = Number(localStorage.getItem("c64va-sid-quantize"));
    if ([2, 4, 8, 16].includes(grid)) _sidQuant = grid;
    _sidQuantRec = localStorage.getItem("c64va-sid-quantize-rec") === "1";
  } catch (_) {}
  const quantSel = document.getElementById("sid-quantize");
  if (quantSel) quantSel.value = String(_sidQuant);
  const quantRec = document.getElementById("sid-quantize-rec");
  if (quantRec) quantRec.checked = _sidQuantRec;
  onId("sid-quantize", "change", function(e) {
    _sidQuant = Number(e.target.value) || 4;
    try { localStorage.setItem("c64va-sid-quantize", String(_sidQuant)); } catch (_) {}
  });
  onId("sid-quantize-rec", "change", function(e) {
    _sidQuantRec = !!e.target.checked;
    try { localStorage.setItem("c64va-sid-quantize-rec", _sidQuantRec ? "1" : "0"); } catch (_) {}
  });
  // Undo / redo. Text fields keep their own Ctrl+Z.
  onId("sid-undo", "click", _sidUndo);
  onId("sid-redo", "click", _sidRedo);
  onId("sid-roll-undo", "click", _sidUndo);
  onId("sid-roll-redo", "click", _sidRedo);
  ["pointerup", "keyup", "change", "input", "wheel"].forEach(function(type) {
    window.addEventListener(type, _sidHistSchedule, { capture: true, passive: true });
  });
  // on the window: a button that has just gone disabled leaves the focus outside the dialog
  window.addEventListener("keydown", function(e) {
    if (!dialog.open || !(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k !== "z" && k !== "y") return;
    const el = e.target;
    const inDialog = el.closest && el.closest("dialog");
    if (inDialog && inDialog !== dialog) return;
    if (el instanceof HTMLTextAreaElement || el.isContentEditable) return;
    if (el instanceof HTMLInputElement && !["checkbox", "radio", "range", "button"].includes(el.type)) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === "y" || e.shiftKey) _sidRedo(); else _sidUndo();
  }, true);

  // Voice copy/paste
  onId("sid-voice-copy", "click", function(){
    _sidCopySelection();
  });
  onId("sid-voice-paste", "click", function(){
    _sidPasteSelection();
  });
  onId("sid-clear", "click", function(){
    _sidClearSelection();
  });
  if (wrap) {
    wrap.addEventListener("selectstart", function(e) {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    });
    wrap.addEventListener("contextmenu", function(e) {
      if (!e.target.closest("td.sid-cell")) _sidHideCtxMenu();
    });
  }

  // Octave controls
  onId("sid-oct-up", "click", function(){ _sidSetOctave(_sidOctave+1); });
  onId("sid-oct-down", "click", function(){ _sidSetOctave(_sidOctave-1); });
  onId("sid-row-preview", "click", _sidPreviewSelectedRow);
}

function _sidSetOctave(o) {
  _sidOctave = Math.max(0, Math.min(7, o));
  const el = document.getElementById("sid-oct-val");
  if (el) el.textContent = _sidOctave;
  const vkEl = document.getElementById("sid-vkbd-octave-val");
  if (vkEl) vkEl.textContent = _sidOctave;
  _sidSaveVkbdState({ octave: _sidOctave });
  _sidRenderVirtualKeyboard();
}

/* ── Nem modális ablakok sorrendje ──────────────────────────────────────────
 * A legutóbb kattintott / megnyitott nem modális <dialog> kerül felülre (z-index 9960 + sorszám), így a
 * menük és tooltipek (9990+) továbbra is felettük maradnak; a modális ablakok úgyis a top layerben vannak. */
let _dlgStack = [];

function _dlgIsModal(dlg) {
  try { return dlg.matches(":modal"); } catch (_) { return false; }
}

function _dlgRaise(dlg) {
  _dlgStack = _dlgStack.filter((d) => d !== dlg && d.open && !_dlgIsModal(d));
  _dlgStack.push(dlg);
  _dlgStack.forEach((d, i) => { d.style.zIndex = String(9960 + i); });
  _dlgMarkActive(dlg);
}

// The active (last used) window gets a highlighted frame and header (.dlg-active): a non-modal
// dialog or a floating panel of the SID Editor. A panel is a window of its own, not its dialog.
const _DLG_PANELS = ".sid-trk-float:not([hidden]), .sid-vkbd-dialog:not([hidden])";
function _dlgMarkActive(active) {
  document.querySelectorAll(".dlg-active").forEach((d) => { if (d !== active) d.classList.remove("dlg-active"); });
  active?.classList.add("dlg-active");
}

// The panels' order inside the editor. It stays under the editor's own menus (z-index 40).
let _dlgPanelStack = [];
function _dlgRaisePanel(panel) {
  _dlgPanelStack = _dlgPanelStack.filter((p) => p !== panel && !p.hidden);
  _dlgPanelStack.push(panel);
  _dlgPanelStack.forEach((p, i) => { p.style.zIndex = String(30 + i); });
  _dlgMarkActive(_dlgPanelWindow(panel));
}

// A szerkesztő kártyája a panelek testvére, ezért velük közös sorrendben van: aktívan fölöttük.
function _dlgPanelWindow(panel) {
  return panel.classList.contains("sid-card") ? panel.parentElement : panel;
}

// Megnyitáskor a panelek látszanak, a kártya nem takarja őket a múltkori sorrend miatt.
function _dlgEditorOpened(editor) {
  const card = editor.firstElementChild;
  _dlgPanelStack = _dlgPanelStack.filter((p) => p !== card);
  card.style.zIndex = "";
  _dlgMarkTop();
}

// The window on top after the active one went away.
function _dlgMarkTop() {
  _dlgStack = _dlgStack.filter((d) => d.open && !_dlgIsModal(d));
  const top = _dlgStack[_dlgStack.length - 1] || null;
  const panels = top?.id === "sid-editor-dialog" ? _dlgPanelStack.filter((p) => !p.hidden) : [];
  _dlgMarkActive(panels.length ? _dlgPanelWindow(panels[panels.length - 1]) : top);
}

function setupDialogStacking() {
  document.addEventListener("pointerdown", (e) => {
    const dlg = e.target?.closest?.("dialog[open]");
    if (e.target?.closest?.("#sid-ctx-menu")) return;
    if (dlg && !_dlgIsModal(dlg)) {
      _dlgRaise(dlg);
      const panel = e.target.closest(_DLG_PANELS);
      if (panel) _dlgRaisePanel(panel);
      else if (dlg.id === "sid-editor-dialog") _dlgRaisePanel(dlg.firstElementChild);
    }
    // a főablakba kattintva egyik lebegő ablak sem aktív
    else if (!dlg) _dlgMarkActive(null);
  }, true);
  // a toggle nem buborékol, de a document capture-fázisban megkapja
  document.addEventListener("toggle", (e) => {
    const dlg = e.target;
    if (!(dlg instanceof HTMLDialogElement)) return;
    if (dlg.open && !_dlgIsModal(dlg)) {
      _dlgRaise(dlg);
      if (dlg.id === "sid-editor-dialog") _dlgEditorOpened(dlg);
    }
    else if (!dlg.open && (dlg.classList.contains("dlg-active") || dlg.querySelector(".dlg-active"))) {
      // bezáráskor az alatta lévő nyitott ablak lesz az aktív
      dlg.classList.remove("dlg-active");
      dlg.querySelector(".dlg-active")?.classList.remove("dlg-active");
      _dlgStack = _dlgStack.filter((d) => d !== dlg);
      _dlgMarkTop();
    }
  }, true);
  // A panel a hidden attribútummal nyílik és zárul, több helyről is.
  const panelObserver = new MutationObserver((changes) => {
    changes.forEach(({ target: panel }) => {
      if (!panel.hidden) { if (panel.closest("dialog[open]")) _dlgRaisePanel(panel); return; }
      const wasActive = panel.classList.contains("dlg-active");
      panel.classList.remove("dlg-active");
      _dlgPanelStack = _dlgPanelStack.filter((p) => p !== panel);
      if (wasActive) _dlgMarkTop();
    });
  });
  document.querySelectorAll(".sid-trk-float, .sid-vkbd-dialog").forEach((panel) => panelObserver.observe(panel, { attributes: true, attributeFilter: ["hidden"] }));
}

_confirmYes?.addEventListener("click", () => { _confirmDialog?.close(); _confirmResolve?.(true); });

_confirmNo?.addEventListener("click",  () => { _confirmDialog?.close(); _confirmResolve?.(false); });

_confirmDialog?.addEventListener("cancel", () => { _confirmResolve?.(false); });

function _themeSyncPicker() {
  const current = document.documentElement.dataset.theme;
  document.querySelectorAll(".theme-option").forEach((btn) => {
    if (btn.dataset.themeOpt === current) btn.setAttribute("data-active", "");
    else btn.removeAttribute("data-active");
  });
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("c64-block-theme", theme);
  _themeSyncPicker();
  // the canvases read the theme's colours when they draw
  if (_sidInited) _sidDrawADSR();
}
function _setupThemePicker() {
  document.querySelectorAll(".theme-option").forEach(btn => {
    btn.addEventListener("click", () => {
      setTheme(btn.dataset.themeOpt);
    });
  });
  document.addEventListener("click", e => {
    const picker = document.getElementById("theme-picker");
    if (picker?.open && !picker.contains(e.target)) picker.removeAttribute("open");
  });
  // a panel fixen pozicionált, görgetésnél elszakadna a gombtól → bezárjuk (a saját görgetése kivétel)
  const closeThemePickerOnScroll = (e) => {
    const picker = document.getElementById("theme-picker");
    if (picker?.open && !(e.target instanceof Node && picker.contains(e.target))) picker.removeAttribute("open");
  };
  document.addEventListener("scroll", closeThemePickerOnScroll, true);
  document.addEventListener("wheel", closeThemePickerOnScroll, { capture: true, passive: true });
  window.addEventListener("resize", () => document.getElementById("theme-picker")?.removeAttribute("open"));

  // Position theme-picker panel as fixed popup relative to the summary button
  document.getElementById("theme-picker")?.addEventListener("toggle", (e) => {
    const panel = document.querySelector(".theme-picker-panel");
    if (!panel) return;
    if (e.newState === "open") {
      const summaryRect = document.getElementById("theme-toggle")?.getBoundingClientRect();
      if (summaryRect) {
        // a nyitott panel valós mérete (a témák számával nő)
        panel.style.maxHeight = "";
        const panelW = panel.offsetWidth || 160;
        const panelH = panel.offsetHeight || 140;
        let left = summaryRect.left;
        // Keep inside viewport
        if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
        if (left < 8) left = 8;
        const below = window.innerHeight - summaryRect.bottom - 14;
        const above = summaryRect.top - 14;
        let top = summaryRect.bottom + 6;
        // lent nincs hely → felfelé, ha ott több van; ha egyik sem elég, görgethető
        if (panelH > below && above > below) {
          top = Math.max(8, summaryRect.top - panelH - 6);
          if (panelH > above) panel.style.maxHeight = above + "px";
        } else if (panelH > below) {
          panel.style.maxHeight = below + "px";
        }
        panel.style.top  = top + "px";
        panel.style.left = left + "px";
      }
      panel.classList.add("theme-picker-panel--placed");
    } else {
      panel.classList.remove("theme-picker-panel--placed");
    }
  });
  _themeSyncPicker();
}

function _sidApplyTranslations() {
  const setText = (sel, val) => { const el = document.querySelector(sel); if (el) el.textContent = val; };
  const setAttr = (sel, val) => {
    const el = document.querySelector(sel);
    if (el) {
      el.setAttribute("aria-label", val);
      el.removeAttribute("title");
    }
  };
  setAttr('.ce-tool-btn[data-ce-tool="pencil"]', t("hgToolPencil"));
  setAttr('.ce-tool-btn[data-ce-tool="line"]', t("hgToolLine"));
  setAttr('.ce-tool-btn[data-ce-tool="rect"]', t("hgToolRect"));
  setAttr('.ce-tool-btn[data-ce-tool="fillrect"]', t("hgToolFillRect"));
  setAttr('.ce-tool-btn[data-ce-tool="fill"]', t("hgToolFill"));
  setAttr('.ce-tool-btn[data-ce-tool="picker"]', t("hgToolPicker"));
  document.querySelectorAll(".ed-file-btn").forEach(el => { el.textContent = t("edFilesBtn"); });
  setText('[data-ce-ink="3"]', t("ceFg"));
  setText('[data-ce-ink="0"]', t("ceBg"));
  setText('[data-ce-ink="1"]', t("ceMc1"));
  setText('[data-ce-ink="2"]', t("ceMc2"));
  setText('[data-lv-export="save-level"]', t("lvSave"));
  setText('[data-lv-export="screen"]', t("lvSaveScreen"));
  setText('[data-lv-export="screen-color"]', t("lvSaveScreenColor"));
  setText('[data-lv-export="blocks"]', t("lvExportBlocks"));
  setText('[data-lv-export="asm"]', t("lvCopyAsm"));
  setText('[data-lv-export="rle-asm"]', t("lvRleAsm"));
  setText('[data-lv-export="rle-blocks"]', t("lvRleBlocks"));
  setText(".sid-title", t("sidTitle"));
  setText("#sid-load-bin", t("sidLoadBin"));
  setText("#sid-save-bin", t("sidSaveBin"));
  setText("#sid-import-goat", t("sidImportGoat"));
  setText("#sid-new-tune", t("sidNewTune"));
  setText("#sid-import-sid", t("sidImportSid"));
  setText("#sid-master-vol-lbl", t("sidMasterVolume"));
  setText("#sid-vkbd-inst-lbl", t("sidVkbdInstrumentLabel"));
  setText("#sid-lcd-pos-lbl", t("sidLcdPos"));
  setText("#sid-lcd-pat-lbl", t("sidLcdPat"));
  setText("#sid-lcd-row-lbl", t("sidLcdRow"));
  setText("#sid-lcd-time-lbl", t("sidLcdTime"));
  document.getElementById("sid-vkbd-inst-knob")?.setAttribute("aria-label", t("sidVkbdInstrumentLabel"));
  try { if (_sidInsts) _sidVkbdInstSync(); } catch (_) {}
  setText("#websid-play-vol-lbl", t("sidMasterVolume"));
  setText("#sid-ed-master-vol-lbl", t("sidMasterVolume"));
  setAttr("#sid-ed-master-vol", t("sidMasterVolume"));
  setAttr("#sid-master-vol", t("sidMasterVolume"));
  setText("#sid-midi-lbl", t("sidMidi"));
  setText("#sid-midi-connect", t("sidMidiConnect"));
  setText("#sid-midi-poly-label", t("sidMidiPoly"));
  setAttr("#sid-record", t("sidRecord"));
  setAttr("#sid-vkbd-record", t("sidRecord"));
  setText("#sid-preview-engine-lbl", t("sidPreviewEngine"));
  setText("#sid-preview-model-lbl", t("sidPreviewModel"));
  setText("#sid-lcd-color-lbl", t("sidLcdColor"));
  setText("#sid-player-buffer-lbl", t("sidPlayerBuffer"));
  const sidLcdColor = document.getElementById("sid-lcd-color");
  if (sidLcdColor) {
    if (sidLcdColor.options[0]) sidLcdColor.options[0].textContent = t("sidLcdColorGreen");
    if (sidLcdColor.options[1]) sidLcdColor.options[1].textContent = t("sidLcdColorRed");
  }
  const sidPreviewEngine = document.getElementById("sid-preview-engine");
  if (sidPreviewEngine) {
    if (sidPreviewEngine.options[0]) sidPreviewEngine.options[0].textContent = t("sidPreviewEngineResid");
    if (sidPreviewEngine.options[1]) sidPreviewEngine.options[1].textContent = t("sidPreviewEngineVaCore") + " v" + _VA_SID_CORE_VERSION;
    sidPreviewEngine.value = _sidPreviewEngine;
  }
  const sidPreviewModel = document.getElementById("sid-preview-model");
  if (sidPreviewModel) {
    sidPreviewModel.value = _sidPreviewModel;
  }
  setText("#websid-play-title", t("sidPlayerTitle"));
  setText("#websid-play-note", t("websidPlayNote"));
  setText("#websid-play-drop-hint", t("sidPlayerDropHint"));
  setAttr("#websid-play-play", t("sidPlay"));
  setAttr("#websid-play-pause", t("sidPause"));
  setAttr("#websid-play-stop", t("websidPlayStop"));
  setAttr("#websid-play-prev", t("sidPlayerPrev"));
  setAttr("#websid-play-next", t("sidPlayerNext"));
  setAttr("#websid-play-shuffle", t("sidPlayerShuffle"));
  setAttr("#websid-play-rew", t("sidPlayerBack10"));
  setAttr("#websid-play-fwd", t("sidPlayerForward10"));
  setAttr("#websid-play-add", t("sidPlayerAdd"));
  setAttr("#websid-play-clear", t("sidPlayerClear"));
  setAttr("#websid-play-hvsc", t("sidHvsc"));
  setAttr("#websid-play-viz", t("sidVizOpen"));
  setText("#sid-viz-title", t("sidVizTitle"));
  setText("#sid-viz-bands-lbl", t("sidVizBands"));
  setAttr("#websid-hvsc-random", t("sidHvscRandom"));
  setAttr("#websid-hvsc-add-all", t("sidHvscAddAll"));
  setAttr("#websid-hvsc-refresh", t("sidHvscRefresh"));
  setAttr("#websid-hvsc-search", t("sidHvscSearch"));
  _hvscFieldSync();
  setAttr("#websid-hvsc-field", t("sidHvscField"));
  setText('#websid-hvsc-field option[value="all"]', t("sidHvscFieldAll"));
  setText('#websid-hvsc-field option[value="composer"]', t("sidHvscFieldComposer"));
  setAttr("#websid-play-open-list", t("sidPlayerOpenList"));
  setAttr("#websid-play-song-prev", t("sidPlayerPrevSong"));
  setAttr("#websid-play-song-next", t("sidPlayerNextSong"));
  setAttr("#websid-play-save-list", t("sidPlayerSaveList"));
  setAttr("#websid-play-seek", t("sidPlayerSeek"));
  setAttr("#websid-play-vol", t("sidPlayerVolume"));
  setAttr("#websid-play-close", t("close"));
  setAttr("#sid-player-btn", t("sidPlayerTitle"));
  try { _sidPlayerRenderList(); } catch (_) {}
  setText("#sid-export-asm", t("sidExportAsm"));
  setText("#sid-export-ub", t("sidExportUb"));
  setText("#sid-export-psid", t("sidExportPsid"));
  setText(".sid-inst-row .sid-lbl", t("sidInstrumentLabel"));
  setAttr("#sid-inst-add", t("sidAddInstrument"));
  setAttr("#sid-inst-del", t("sidDeleteInstrument"));
  setText("#sid-inst-unused", t("sidRemoveUnused"));
  setText("#sid-song-vol-lbl", t(document.getElementById("sid-song-vol2-group")?.hidden === false ? "sidSongVol1" : "sidSongVol"));
  setText("#sid-song-vol2-lbl", t("sidSongVol2"));
  setAttr("#sid-song-vol2", t("sidSongVol2Tip"));
  setAttr("#sid-song-vol2-knob", t("sidSongVol2Tip"));
  setAttr("#sid-song-vol", t("sidSongVolTip"));
  setAttr("#sid-song-vol-knob", t("sidSongVolTip"));
  setAttr("#sid-video", t("sidVideoTip"));
  setAttr("#sid-preview", t("sidPreview"));
  const sidWaveLbl = document.querySelector(".sid-wave-row .sid-lbl");
  if (sidWaveLbl) sidWaveLbl.textContent = t("sidWaveformLabel");
  const sidPwLbl = document.querySelector(".sid-wave-row .sid-mini-lbl");
  if (sidPwLbl) sidPwLbl.textContent = t("sidPwLabel");
  const sidSections = document.querySelectorAll(".sid-section");
  if (sidSections[0]) sidSections[0].textContent = t("sidAdsrLabel");
  if (sidSections[1]) sidSections[1].textContent = t("sidFilterLabel");
  const sidAdsrLbls = document.querySelectorAll(".sid-adsr .sid-sl-lbl");
  if (sidAdsrLbls[0]) sidAdsrLbls[0].textContent = t("sidAttack");
  if (sidAdsrLbls[1]) sidAdsrLbls[1].textContent = t("sidDecay");
  if (sidAdsrLbls[2]) sidAdsrLbls[2].textContent = t("sidSustain");
  if (sidAdsrLbls[3]) sidAdsrLbls[3].textContent = t("sidRelease");
  [["#sid-cut-lbl", "sidCutoff"], ["#sid-res-lbl", "sidResonance"],
   ["#sid-filt-lbl", "sidRouteFilter"], ["#sid-cut-end-lbl", "sidCutEnd"], ["#sid-cut-speed-lbl", "sidCutSweep"],
   ["#sid-cut-ping-lbl", "sidCutPing"], ["#sid-vib-title", "sidVibratoTitle"], ["#sid-vib-delay-lbl", "sidModDelay"],
   ["#sid-vib-speed-lbl", "sidModSpeed"], ["#sid-vib-depth-lbl", "sidModDepth"], ["#sid-pwm-title", "sidPwmTitle"],
   ["#sid-pwm-speed-lbl", "sidModSpeed"], ["#sid-pwm-min-lbl", "sidModMin"], ["#sid-pwm-max-lbl", "sidModMax"],
   ["#sid-gate-title", "sidGateTitle"], ["#sid-gate-timer-lbl", "sidGateTimer"], ["#sid-hr-lbl", "sidHardRestart"],
   ["#sid-first-wave-lbl", "sidFirstFrame"], ["#sid-gate-hint", "sidGateHint"], ["#sid-table-title", "sidTableTitle"],
   ["#sid-table-speed-lbl", "sidModSpeed"], ["#sid-table-loop-lbl", "sidTableLoop"], ["#sid-table-add", "sidTableAdd"],
   ['#sid-first-wave option[value="0"]', "sidFirstOff"]].forEach(function(p) { setText(p[0], t(p[1])); });
  try { _sidBuildPresetSelect(); } catch (_) {}
  setText("#sid-filter-title", t("sidFilterLabel"));
  [["#sid-ring-wrap", "sidRingTip"], ["#sid-sync-wrap", "sidSyncTip"], ["#sid-off3-wrap", "sidOff3Tip"],
   ["#sid-cut-ping-wrap", "sidCutPingTip"], ["#sid-hr-wrap", "sidHardRestartTip"]].forEach(function(p) {
    document.querySelector(p[0])?.setAttribute("title", t(p[1]));
  });
  try { if (_sidInited) _sidRenderTable(); } catch (_) {}
  setText(".sid-tracker-row .sid-lbl", t("sidTrackerLabel"));
  setAttr("#sid-pat-add", t("sidAddPattern"));
  setAttr("#sid-pat-del", t("sidDeletePattern"));
  const sidTrackerMiniLbls = document.querySelectorAll(".sid-tracker-row .sid-mini-lbl:not(#sid-chip-lbl)");
  if (sidTrackerMiniLbls[0]) sidTrackerMiniLbls[0].textContent = t("sidPlayMode");
  if (sidTrackerMiniLbls[1]) sidTrackerMiniLbls[1].textContent = t("sidSpeed");
  const sidOctLbl = [...sidTrackerMiniLbls].find(function(el){ return el.nextElementSibling?.id === "sid-oct-down"; });
  if (sidOctLbl) sidOctLbl.textContent = t("sidOctave");
  const sidPlayModeSel = document.getElementById("sid-play-mode");
  if (sidPlayModeSel) {
    if (sidPlayModeSel.options[0]) sidPlayModeSel.options[0].textContent = t("sidPlayModeCurrent");
    if (sidPlayModeSel.options[1]) sidPlayModeSel.options[1].textContent = t("sidPlayModeAll");
    sidPlayModeSel.value = _sidPlayMode;
  }
  setAttr("#sid-oct-down", t("sidOctaveDown"));
  setAttr("#sid-speed-down", t("sidSpeedDown"));
  setAttr("#sid-speed-up", t("sidSpeedUp"));
  setAttr("#sid-oct-up", t("sidOctaveUp"));
  setAttr("#sid-row-preview", t("sidPreviewRow"));
  setAttr("#sid-virtual-keyboard", t("sidVirtualKeyboard"));
  _sidUpdatePauseButton();
  setAttr("#sid-stop", t("sidStop"));
  setAttr("#sid-vkbd-stop", t("sidStop"));
  setAttr("#sid-chip-count", t("sidChipCount"));
  setAttr("#sid-chip-addr", t("sidChipAddr"));
  setAttr("#sid-voice-copy", t("sidVoiceCopy"));
  setAttr("#sid-voice-paste", t("sidVoicePaste"));
  setAttr("#sid-clear", t("sidClearSelection"));
  setText("#sid-vkbd-title", "VA-VK");
  document.getElementById("sid-virtual-keyboard-dialog")?.setAttribute("aria-label", t("sidVirtualKeyboardTitle"));
  setText("#sid-vkbd-octave-label", t("sidOctave"));
  setAttr("#sid-vkbd-oct-down", t("sidOctaveDown"));
  setAttr("#sid-vkbd-oct-up", t("sidOctaveUp"));
  setText("#sid-vkbd-insert-label", t("sidVkbdInsert"));
  setText("#sid-vkbd-showplay-label", t("sidVkbdShowPlay"));
  setText("#sid-vkbd-octaves-label", t("sidVkbdOctaves"));
  _sidSyncDetachBtn();
  setAttr("#sid-roll-btn", t("sidRollTitle"));
  setAttr("#sid-ana-btn", t("sidAnaTitle"));
  setText("#sid-ana-title", t("sidAnaTitle"));
  setText("#sid-roll-title", t("sidRollTitle"));
  setText("#sid-roll-help", t("sidRollHelp"));
  setAttr("#sid-roll-stop", t("sidStop"));
  setAttr("#sid-roll-follow", t("sidRollFollow"));
  setAttr("#sid-roll-vzoom-out", t("sidRollZoomOut"));
  setAttr("#sid-roll-vzoom-in", t("sidRollZoomIn"));
  setAttr("#sid-tracker-attach", t("sidTrackerAttach"));
  const sidCtxCopy = document.querySelector("#sid-ctx-menu .sid-ctx-copy");
  const sidCtxCut = document.querySelector("#sid-ctx-menu .sid-ctx-cut");
  const sidCtxPaste = document.querySelector("#sid-ctx-menu .sid-ctx-paste");
  const sidCtxClear = document.querySelector("#sid-ctx-menu .sid-ctx-clear");
  if (sidCtxCopy) {
    const label = sidCtxCopy.querySelector(".sid-ctx-label");
    if (label) label.textContent = t("sidContextCopy");
  }
  if (sidCtxCut) {
    const label = sidCtxCut.querySelector(".sid-ctx-label");
    if (label) label.textContent = t("sidContextCut");
  }
  if (sidCtxPaste) {
    const label = sidCtxPaste.querySelector(".sid-ctx-label");
    if (label) label.textContent = t("sidContextPaste");
  }
  if (sidCtxClear) {
    const label = sidCtxClear.querySelector(".sid-ctx-label");
    if (label) label.textContent = t("sidContextClear");
  }
  setText("#sid-song-label", t("sidSongLabel"));
  setAttr("#sid-song-add", t("sidSongInsert"));
  setAttr("#sid-song-del", t("sidSongRemove"));
  setAttr("#sid-song-up", t("sidSongMoveLeft"));
  setAttr("#sid-song-down", t("sidSongMoveRight"));
  try { _sidBuildSongList(); } catch (e) {}
  setText("#sid-harmony-label", t("sidHarmonyLabel"));
  setText("#sid-chord-root-label", t("sidChordRoot"));
  setText("#sid-chord-type-label", t("sidChordType"));
  setText("#sid-chord-octave-label", t("sidChordOctave"));
  setAttr("#sid-chord-add", t("sidChordAdd"));
  setAttr("#sid-chord-preview", t("sidChordPreview"));
  setText("#sid-arp-label", t("sidArpLabel"));
  setAttr("#sid-arp-direction", t("sidArpDirection"));
  setAttr("#sid-arp-length", t("sidArpLength"));
  setAttr("#sid-arp-preview", t("sidArpPreview"));
  setAttr("#sid-arp-add", t("sidArpAdd"));
  const arpDirectionLabels = ["sidArpUp", "sidArpDown", "sidArpUpDown"];
  document.querySelectorAll("#sid-arp-direction option").forEach(function(option, i) {
    if (arpDirectionLabels[i]) option.textContent = t(arpDirectionLabels[i]);
  });
  const chordTypeLabels = ["sidChordMajor", "sidChordMinor", "sidChordDiminished", "sidChordAugmented", "sidChordSus2", "sidChordSus4", "sidChordDominant7", "sidChordMajor7", "sidChordMinor7", "sidChordSixth", "sidChordMinor6", "sidChordNinth", "sidChordFlat9", "sidChordSharp9", "sidChordDim7", "sidChordSus47"];
  document.querySelectorAll("#sid-chord-type option").forEach(function(option, i) {
    if (chordTypeLabels[i]) option.textContent = t(chordTypeLabels[i]);
  });
  setText('.theme-option[data-theme-opt="light"] span:not(.theme-option-dot)', t("themeLight"));
  setText('.theme-option[data-theme-opt="dark"] span:not(.theme-option-dot)', t("themeDark"));
  setAttr("#sid-editor-btn", t("sidEditorBtn"));
  setAttr("#app-new-tune-btn", t("sidNewTune"));
  ["new-program-cancel", "sample-cancel", "sid-import-sid-cancel"].forEach(id => setText("#" + id, t("cancel")));
  ["vc-diff-close", "sample-dialog-close", "support-x", "de-close", "dbe-close", "c64-chrrom-close", "ce-close", "cc-close",
    "me-close", "nc-close", "lv-close", "hg-close", "se-close", "se-sheet-close", "sid-close", "sid-roll-close", "sid-vkbd-close",
    "sid-viz-close", "hg-png-close", "vm-close", "tg-close", "tutorial-dialog-close", "to-close", "te-close"]
    .forEach(id => setAttr("#" + id, t("close")));
  setAttr("#sid-midi-input", t("sidMidiInputAria"));
  setAttr("#sid-bpm", t("sidBpmTip"));
  setAttr("#sid-undo", t("sidUndo"));
  setAttr("#sid-roll-undo", t("sidUndo"));
  setAttr("#sid-roll-redo", t("sidRedo"));
  setText("#sid-quantize-lbl", t("sidQuantize"));
  setAttr("#sid-quantize", t("sidQuantizeTip"));
  Array.from(document.getElementById("sid-quantize")?.options || []).forEach(function(o) {
    o.textContent = tf("sidQuantizeRows", { n: o.value });
  });
  setText("#sid-quantize-rec-label", t("sidQuantizeRec"));
  [["#sid-roll-cut", "sidRollCut"], ["#sid-roll-copy", "sidRollCopy"], ["#sid-roll-paste", "sidRollPaste"], ["#sid-roll-delete", "sidRollDelete"], ["#sid-roll-quantize", "sidRollQuantize"]]
    .forEach(function(p) { setAttr(p[0], t(p[1])); });
  setAttr("#sid-redo", t("sidRedo"));
  ["#sid-metronome", "#sid-roll-metronome", "#sid-vkbd-metronome"].forEach(sel => setAttr(sel, t("sidMetronome")));
  setAttr("#sid-roll .sid-roll-voices", t("sidRollVoice"));
  if (_confirmYes) _confirmYes.textContent = t("sidConfirmYes");
  if (_confirmNo) _confirmNo.textContent = t("tabCloseConfirmCancel");
  setText("#app-settings-title", t("appSettings"));
  setText("#theme-toggle-label", t("themeToggle"));
  setAttr("#theme-toggle", t("themeToggle"));
  setText("#app-language-lbl", t("appLanguage"));
  setAttr("#app-settings-btn", t("appSettings"));
  setAttr("#app-manual-btn", t("appManual"));
  setAttr("#app-about-btn", t("about"));
  const aboutDesc = document.getElementById("about-desc");
  aboutDesc.replaceChildren();
  t("aboutDescText").split("\n").forEach((line, i) => {
    if (i) aboutDesc.appendChild(document.createElement("br"));
    aboutDesc.appendChild(document.createTextNode(line));
  });
  setText("#about-license-label", t("aboutLicenseLabel"));
  setText("#about-website-label", t("aboutWebsiteLabel"));
  setText("#about-sid-credit-label", t("aboutSidCreditLabel"));
  setText("#about-repo-label", t("aboutRepoLabel"));
  setText("#about-vma-repo-label", t("aboutVmaRepoLabel"));
  setText("#about-vma-version-label", t("aboutVmaVersionLabel"));
  setText("#about-close", t("close"));
}

// Closing the window would lose the tune: the last state stays in the local storage.
const _SID_AUTOSAVE_KEY = "va-sid-editor-autosave";
let _sidAutosaved = "";
function _sidAutosave() {
  try {
    const data = String.fromCharCode(..._sidSerialize());
    if (data === _sidAutosaved) return;
    localStorage.setItem(_SID_AUTOSAVE_KEY, btoa(data));
    _sidAutosaved = data;
  } catch (e) { console.warn("SID autosave failed:", e); }
}
function _sidAutosaveStart() {
  try {
    const saved = localStorage.getItem(_SID_AUTOSAVE_KEY);
    if (saved) {
      _sidAutosaved = atob(saved);
      _sidDeserialize(Uint8Array.from(_sidAutosaved, (c) => c.charCodeAt(0)));
      _sidSetTuneTitle(localStorage.getItem("va-sid-tune-title") || "");
    }
  } catch (e) { console.warn("SID autosave could not be restored:", e); }
  setInterval(_sidAutosave, 5000);
  window.addEventListener("beforeunload", _sidAutosave);
}

// The Visual Assembler's splash: READY. is typed in, the bar runs once, then it fades away.
function _setupSplash() {
  const splash = document.getElementById("splash-screen");
  const panel = splash && splash.querySelector(".splash-panel");
  if (!panel) return;
  Promise.resolve(window.__TAURI__?.app?.getVersion?.()).then(function(version) {
    const el = document.getElementById("splash-version");
    if (el && version) el.textContent = "v" + version;
  }).catch(function() {});

  const textEl = document.getElementById("splash-ready-text");
  const cursorEl = textEl.nextElementSibling;
  // one C64 font pixel is 1/8 em: a whole number of device pixels, or the letters and the cursor box round apart
  const readyEl = textEl.parentElement, dpr = window.devicePixelRatio || 1;
  const fontPx = Math.max(1, Math.round(parseFloat(getComputedStyle(readyEl).fontSize) * dpr / 8));
  readyEl.style.fontSize = (fontPx * 8 / dpr) + "px";
  const msg = "READY.";
  let typed = 0;
  const type = function() {
    if (typed < msg.length) {
      textEl.textContent += msg[typed++];
      setTimeout(type, 80 + Math.random() * 40);
    } else {
      cursorEl.style.animation = "splash-cursor-blink 0.6s step-end infinite";
    }
  };
  cursorEl.style.animation = "none";
  setTimeout(type, 700);

  let hidden = false;
  const hide = function() {
    if (hidden) return;
    hidden = true;
    splash.classList.add("fade-out");
    setTimeout(function() { splash.remove(); }, 500);
  };
  const reveal = function() {
    panel.classList.add("ready");
    panel.querySelector(".splash-loader-bar").addEventListener("animationend", hide, { once: true });
  };
  Promise.race([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise(function(r) { setTimeout(r, 1500); })
  ]).then(function() { requestAnimationFrame(reveal); });
  // it can never get stuck
  setTimeout(hide, 8000);
}

function _setupAppSettings() {
  const dialog = document.getElementById("app-settings-dialog");
  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on("app-settings-btn", "click", () => dialog.showModal());
  on("app-settings-close", "click", () => dialog.close());
  on("app-manual-btn", "click", async () => {
    try {
      await window.electronAPI.openManual();
    } catch (e) {
      showViceToast(tf("appManualFailed", { error: String(e) }), true);
    }
  });
  const language = document.getElementById("app-language");
  language.value = currentLanguage;
  language.addEventListener("change", () => {
    currentLanguage = language.value;
    localStorage.setItem("va-sid-editor-language", currentLanguage);
    document.documentElement.lang = currentLanguage;
    _sidApplyTranslations();
    if (_sidInited) { _sidBuildInstSel(); _sidBuildSongList(); _sidBuildTracker(); }
    _sidPlayerRenderList();
  });
  on("sid-preview-engine", "change", (e) => {
    _sidPreviewEngine = e.target.value === "va-core" ? "va-core" : "resid";
    localStorage.setItem("c64va-sid-preview-engine", _sidPreviewEngine);
    if (_sidInited) _sidStop();
    _sidPlayerRenderList();
    _sidEditorEngineSync();
  });
  on("sid-preview-model", "change", (e) => {
    _sidPreviewModel = e.target.value === "6581" ? "6581" : "8580";
    localStorage.setItem("c64va-sid-preview-model", _sidPreviewModel);
    if (_sidInited) _sidStop();
    _sidPlayerRenderList();
    _sidEditorEngineSync();
  });
  const buffer = document.getElementById("sid-player-buffer");
  buffer.value = String(_sidPlayerBufferSize());
  buffer.addEventListener("change", () => localStorage.setItem("c64va-sid-player-buffer", buffer.value));
  on("sid-lcd-color", "change", (e) => {
    localStorage.setItem("c64va-sid-lcd-color", e.target.value === "red" ? "red" : "green");
    _sidLcdApplyColor();
  });
  // the SID Player and these controls need the saved values before the SID Editor first opens
  _sidLoadPreviewSettings();
}

// The web view's own menu (Refresh, Save as, More tools) stays only where it is
// useful: copy and paste in the fields that take text.
function _setupAppContextMenu() {
  const textField = "textarea, input:not([type=checkbox], [type=radio], [type=range], [type=file], [type=color])";
  document.addEventListener("contextmenu", function(e) {
    if (!e.target.closest?.(textField)) e.preventDefault();
  });
}

function _setupAbout() {
  const dialog = document.getElementById("about-dialog");
  const closeBtn = document.getElementById("about-close");
  dialog.addEventListener("dragstart", (e) => e.preventDefault());
  dialog.querySelectorAll("a[href]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    window.electronAPI?.openExternal(a.href);
  }));
  closeBtn.addEventListener("click", () => dialog.close());
  document.getElementById("app-about-btn").addEventListener("click", async () => {
    const [version, vmaVersion] = await Promise.all([
      Promise.resolve(window.__TAURI__?.app?.getVersion?.()).catch(() => null),
      Promise.resolve(window.electronAPI?.getVmaVersion?.()).catch(() => null)
    ]);
    document.getElementById("about-version").textContent = version ? "v" + version : "v?";
    document.getElementById("about-vma-version-value").textContent = vmaVersion ? "v" + vmaVersion : "v?";
    dialog.showModal();
    // the first form control would be a link: Enter would open it instead of closing the dialog
    requestAnimationFrame(() => closeBtn.focus());
  });
}

const _savedLanguage = localStorage.getItem("va-sid-editor-language");
const _sysLanguage = (navigator.language || "en").slice(0, 2);
currentLanguage = translations[_savedLanguage] ? _savedLanguage : translations[_sysLanguage] ? _sysLanguage : "en";
document.documentElement.lang = currentLanguage;
_setupFileMenus();
setupSidPlayer();
setupSidEditor();
setupDraggableEditorDialogs();
setupDialogStacking();
_setupAppSettings();
_setupAbout();
_setupAppContextMenu();
_setupThemePicker();
_setupSplash();
_sidApplyTranslations();
// The player is the app's main window: it is open at every start. setupSidPlayer restores its state in a timeout.
setTimeout(_sidPlayerShow, 0);
