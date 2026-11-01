const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const PDF = "docs/VA SID Studio Manual.pdf";

test("the installers carry the manual PDF the backend opens", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.equal(conf.bundle.resources["../" + PDF], PDF);
  assert.ok(fs.statSync(path.join(root, PDF)).size > 0);
  assert.ok(read("src-tauri/src/lib.rs").includes(`.resolve("${PDF}", tauri::path::BaseDirectory::Resource)`));
});

test("the button reaches the backend command", () => {
  const lib = read("src-tauri/src/lib.rs");
  assert.match(lib, /fn open_manual\(/);
  assert.match(lib, /generate_handler!\[[\s\S]*\bopen_manual,/);
  assert.ok(read("www/tauri-bridge.js").includes('openManual: () => invoke("open_manual")'));
  assert.ok(read("www/index.html").includes('id="app-manual-btn"'));
  assert.match(read("www/sid-editor.js"), /on\("app-manual-btn", "click"/);
});

test("the button's texts exist in every language", () => {
  const src = read("www/i18n.js");
  const count = (key) => src.split(`"${key}":`).length - 1;
  assert.equal(count("appSettings"), 7);
  assert.equal(count("appManual"), 7);
  assert.equal(count("appManualFailed"), 7);
});
