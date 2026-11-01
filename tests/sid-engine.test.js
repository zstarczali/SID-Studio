const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const www = path.join(__dirname, "..", "www");
const read = (file) => fs.readFileSync(path.join(www, file), "utf8");
const editor = read("sid-editor.js");

function fnSource(name) {
  const start = editor.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  let depth = 0;
  for (let i = editor.indexOf("{", start); i < editor.length; i++) {
    if (editor[i] === "{") depth++;
    if (editor[i] === "}" && --depth === 0) return editor.slice(start, i + 1);
  }
  throw new Error(`Unterminated ${name}`);
}

test("the WebSID player is gone from the app", () => {
  assert.ok(!fs.existsSync(path.join(www, "lib", "websid")));
  const html = read("index.html");
  assert.ok(!html.includes("lib/websid"), "script tags");
  assert.ok(!html.includes('value="websid"'), "engine option");
  assert.ok(!html.includes("wothke"), "About credit");
  assert.ok(!/ScriptNodePlayer|SIDBackendAdapter|_webSid|_sidStream/.test(editor));
});

test("the SID engine: reSID by default, VA SID Core by choice, a saved WebSID falls back", () => {
  assert.ok(editor.includes('var _sidPreviewEngine = "resid";'));
  const load = (saved) => {
    const ctx = {
      _sidPreviewEngine: "resid", _sidPreviewModel: "8580",
      localStorage: { getItem: (key) => (key === "c64va-sid-preview-engine" ? saved : null) },
      document: { getElementById: () => null },
      _sidEditorEngineSync() {}, _sidLcdApplyColor() {},
    };
    vm.createContext(ctx);
    vm.runInContext(`${fnSource("_sidLoadPreviewSettings")}; _sidLoadPreviewSettings();`, ctx);
    return ctx._sidPreviewEngine;
  };
  assert.equal(load(null), "resid");
  assert.equal(load("websid"), "resid");
  assert.equal(load("va-core"), "va-core");
  assert.equal(load("resid"), "resid");
});

test("the engine's name follows the setting, and the backend gets it", async () => {
  const payloads = [];
  const ctx = {
    Math, Array, Promise,
    _sidPreviewEngine: "resid", _sidPreviewModel: "6581", _VA_SID_CORE_VERSION: "1.2",
    window: { electronAPI: { renderSidPreview: (payload) => { payloads.push(payload); return Promise.resolve("x"); } } },
    _sidDecodePcm16: () => new Float32Array(4),
  };
  vm.createContext(ctx);
  vm.runInContext(`${fnSource("_sidEngineLabel")}; ${fnSource("_sidRenderNativeFrames")};`, ctx);
  await vm.runInContext(`_sidRenderNativeFrames([new Array(26).fill(0)], 44100)`, ctx);
  assert.equal(payloads[0].engine, "resid");
  assert.equal(vm.runInContext("_sidEngineLabel()", ctx), "reSID (MOS 6581)");
  ctx._sidPreviewEngine = "va-core";
  await vm.runInContext(`_sidRenderNativeFrames([new Array(26).fill(0)], 44100)`, ctx);
  assert.equal(payloads[1].engine, "va-core");
  assert.equal(vm.runInContext("_sidEngineLabel()", ctx), "VA SID Core v1.2 (MOS 6581)");
});

test("the backend's engine names match the setting's values", () => {
  const rust = fs.readFileSync(path.join(__dirname, "..", "src-tauri", "src", "sid_chip.rs"), "utf8");
  assert.ok(rust.includes('name.eq_ignore_ascii_case("resid")'));
  const html = read("index.html");
  assert.ok(html.includes('<option value="resid">') && html.includes('<option value="va-core">'));
});

test("the new SID texts exist in all seven languages", () => {
  const i18n = read("i18n.js");
  for (const key of ["sidPreviewEngineResid", "sidPlayerNeedsDesktop"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 7, key);
  }
  assert.ok(!i18n.includes("sidPreviewEngineWebSid"));
});
