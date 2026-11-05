// The Christmas background (www/xmas.js): the days it shows by itself and the hidden key combination.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const www = path.join(__dirname, "..", "www");

function load(now, store = {}) {
  const listeners = {};
  const button = {
    hidden: true, active: false, pressed: null,
    classList: { toggle(name, on) { button.active = on; } },
    setAttribute(name, value) { if (name === "aria-pressed") button.pressed = value; },
    addEventListener(type, fn) { button.click = fn; },
  };
  const body = { classList: { add() {}, remove() {} }, firstChild: null, insertBefore() {} };
  const gradient = { addColorStop() {} };
  const ctx2d = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (k === "createLinearGradient" || k === "createRadialGradient") ? () => gradient : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const RealDate = Date;
  const context = {
    Math, Promise, console,
    Date: class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setInterval() { return 1; },
    document: {
      body, readyState: "complete", hidden: false, addEventListener() {},
      getElementById: (id) => (id === "xmas-toggle-btn" ? button : null),
      createElement: () => ({ setAttribute() {}, getContext: () => ctx2d }),
    },
    innerWidth: 1000, innerHeight: 700, devicePixelRatio: 1,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(www, "xmas.js"), "utf8"), context);
  return { x: context.__vaXmas, listeners, button };
}

const combo = (over) => Object.assign({ code: "KeyX", ctrlKey: true, altKey: true, shiftKey: true, repeat: false, preventDefault() {}, stopPropagation() {} }, over);

test("it shows by itself on December 24, 25 and 26 only", () => {
  const { x } = load(new Date(2026, 11, 25, 12));
  assert.equal(x.isShown(), true);
  [[11, 24], [11, 25], [11, 26]].forEach(([m, d]) => assert.equal(x.isChristmas(new Date(2026, m, d)), true, d));
  [[11, 23], [11, 27], [0, 25], [10, 25]].forEach(([m, d]) => assert.equal(x.isChristmas(new Date(2026, m, d)), false, m + "/" + d));
  assert.equal(load(new Date(2026, 10, 5, 12)).x.isShown(), false);
});

test("Ctrl+Alt+Shift+X shows and hides it on any day; other keys do not", () => {
  const { x, listeners } = load(new Date(2026, 5, 1, 12));
  const key = listeners.keydown;
  key(combo({ shiftKey: false }));
  key(combo({ code: "KeyZ" }));
  key(combo({ repeat: true }));
  assert.equal(x.isShown(), false);
  key(combo());
  assert.equal(x.isShown(), true);
  key(combo());
  assert.equal(x.isShown(), false);
});

test("hidden with the keys, it stays hidden over restarts and later Christmases, until the keys again", () => {
  const store = {};
  const christmas = new Date(2026, 11, 25, 12);
  const first = load(christmas, store);
  assert.equal(first.x.isShown(), true);
  first.listeners.keydown(combo());
  assert.equal(first.x.isShown(), false);
  assert.equal(load(christmas, store).x.isShown(), false, "after a restart");
  const nextYear = load(new Date(2027, 11, 24, 12), store);
  assert.equal(nextYear.x.isShown(), false, "the next Christmas");
  nextYear.listeners.keydown(combo());
  assert.equal(nextYear.x.isShown(), true);
  assert.equal(load(christmas, store).x.isShown(), true, "the date decides again");
});

test("shown outside Christmas, it is gone after a restart; blocked storage does no harm", () => {
  const store = {};
  const june = new Date(2026, 5, 1, 12);
  const first = load(june, store);
  first.listeners.keydown(combo());
  assert.equal(first.x.isShown(), true);
  assert.equal(load(june, store).x.isShown(), false);
  const blocked = new Proxy({}, { has: () => { throw new Error("blocked"); } });
  assert.equal(load(new Date(2026, 11, 25, 12), blocked).x.isShown(), true);
});

test("the toolbar button: there at Christmas and whenever the tree shows, and does what the keys do", () => {
  const store = {};
  const christmas = load(new Date(2026, 11, 25, 12), store);
  assert.equal(christmas.button.hidden, false);
  assert.equal(christmas.button.pressed, "true");
  christmas.button.click();
  assert.equal(christmas.x.isShown(), false);
  assert.equal(christmas.button.hidden, false, "at Christmas it stays, to bring the tree back");
  assert.equal(christmas.button.pressed, "false");
  assert.equal(load(new Date(2026, 11, 25, 12), store).x.isShown(), false, "hidden over a restart, like with the keys");
  christmas.button.click();
  assert.equal(christmas.x.isShown(), true);
  assert.equal(store["c64va-xmas-hidden"], undefined);

  const june = load(new Date(2026, 5, 1, 12), {});
  assert.equal(june.button.hidden, true, "no sign of it on other days");
  june.listeners.keydown(combo());
  assert.equal(june.button.hidden, false, "until the keys show the tree");
  june.button.click();
  assert.equal(june.x.isShown(), false);
  assert.equal(june.button.hidden, true);
});

test("the greeting and its bundled font", () => {
  assert.ok(fs.readFileSync(path.join(www, "xmas.js"), "utf8").includes('"Happy Christmas from VA team"'));
  assert.ok(fs.existsSync(path.join(www, "assets/fonts/MountainsofChristmas-Bold.ttf")));
  assert.ok(fs.existsSync(path.join(www, "assets/fonts/MountainsofChristmas-LICENSE.txt")));
  assert.ok(fs.readFileSync(path.join(www, "xmas.js"), "utf8").includes("drawLogoTag(bx,"), "the C= logo on every gift");
  assert.match(fs.readFileSync(path.join(www, "assets/commodore-logo-credit.txt"), "utf8"), /Alien426[\s\S]*CC BY-SA 4\.0/);
  assert.ok(fs.readFileSync(path.join(www, "style.css"), "utf8").includes('font-family: "VA Christmas"'));
  assert.ok(fs.readFileSync(path.join(www, "index.html"), "utf8").includes('<script src="xmas.js"></script>'));
});
