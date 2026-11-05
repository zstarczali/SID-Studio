// The toolbar's Exit button.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  for (let i = start; ; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
}

function run(windowObject) {
  const calls = [];
  const context = { window: windowObject, _sidAutosave: () => calls.push("tune"), _sidPlayerPersist: () => calls.push("playlist") };
  vm.createContext(context);
  vm.runInContext(fnSource(read("www/sid-editor.js"), "_appExit") + "\nthis.exit = _appExit;", context);
  context.exit();
  return calls;
}

test("Exit saves the tune and the playlist, then closes the window", () => {
  const order = [];
  const calls = run({ __TAURI__: { window: { getCurrentWindow: () => ({ close: () => order.push("close") }) } } });
  assert.deepEqual(calls, ["tune", "playlist"]);
  assert.deepEqual(order, ["close"]);
  let plain = 0;
  run({ close: () => plain++ });
  assert.equal(plain, 1, "outside the desktop app: the page's own close");
});

test("the button, its permission and its label in the seven languages", () => {
  const toolbar = read("www/index.html").split("</header>")[0];
  assert.ok(toolbar.includes('id="app-exit-btn"'));
  assert.ok(JSON.parse(read("src-tauri/capabilities/default.json")).permissions.includes("core:window:allow-close"));
  assert.equal((read("www/i18n.js").match(/"appExit": /g) || []).length, 7);
});
