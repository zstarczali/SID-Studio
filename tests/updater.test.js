// Check for update: the toolbar button, the check at start, Skip this version, the install.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const source = read("www/sid-editor.js");

function fnSource(name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  assert.notEqual(start, -1, name);
  let depth = 0, seen = false, paren = 0;
  for (let i = source.indexOf("(", start); ; i++) {
    const c = source[i];
    if (!seen && c === "(") paren++;
    else if (!seen && c === ")") paren--;
    else if (!seen && c === "{" && paren === 0) { seen = true; depth = 1; }
    else if (seen && c === "{") depth++;
    else if (seen && c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
}

function element() {
  const classes = new Set();
  return {
    hidden: false, disabled: false, open: false, textContent: "", style: {}, attrs: {},
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) },
    setAttribute(k, v) { this.attrs[k] = v; },
    showModal() { this.open = true; this.shown = (this.shown || 0) + 1; },
    close() { this.open = false; },
  };
}

function app(api, stored = {}) {
  const els = {};
  const calls = [];
  const context = {
    window: { electronAPI: api },
    document: { getElementById: (id) => (els[id] = els[id] || element()) },
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => { stored[k] = v; } },
    t: (k) => k,
    tf: (k, v) => `${k}:${JSON.stringify(v)}`,
    _sidAutosave: () => calls.push("tune"),
    _sidPlayerPersist: () => calls.push("playlist"),
  };
  vm.createContext(context);
  const names = ["_updateEls", "_updateSetProgress", "_updateShow", "_updateLatestLabel", "_updateSkipId", "_updateSyncButton",
    "_updateShowAvailable", "checkForAppUpdate", "_updateInstall"];
  vm.runInContext(`const _UPDATE_SKIP_KEY = "skip"; let _updateBusy = false; let _updateInfo = null;\n`
    + names.map(fnSource).join("\n")
    + "\nthis.check = checkForAppUpdate; this.install = _updateInstall;", context);
  return { context, els, calls, stored };
}

const newer = { supported: true, currentVersion: "1.4.0", latestVersion: "1.4.1", updateAvailable: true, hotfix: 0 };
const same = { supported: true, currentVersion: "1.4.0", latestVersion: "1.4.0", updateAvailable: false, hotfix: 0 };

test("the check at start is silent unless there is something new", async () => {
  const quiet = app({ checkForUpdate: async () => same });
  await quiet.context.check({ silent: true });
  assert.equal(quiet.els["update-dialog"].open, false);
  assert.equal(quiet.els["app-update-btn"].classList.has("main-tb-btn--active"), false);

  const failing = app({ checkForUpdate: async () => { throw new Error("offline"); } });
  await failing.context.check({ silent: true });
  assert.equal(failing.els["update-dialog"]?.open ?? false, false, "no error at start without a network");

  const found = app({ checkForUpdate: async () => newer });
  await found.context.check({ silent: true });
  assert.equal(found.els["update-dialog"].open, true);
  assert.equal(found.els["update-install"].hidden, false);
  assert.equal(found.els["app-update-btn"].classList.has("main-tb-btn--active"), true);
  assert.match(found.els["app-update-btn"].attrs["aria-label"], /1\.4\.1/);
});

test("the button always answers", async () => {
  const upToDate = app({ checkForUpdate: async () => same });
  await upToDate.context.check();
  assert.equal(upToDate.els["update-dialog"].open, true);
  assert.match(upToDate.els["update-msg"].textContent, /updateUpToDate/);
  assert.equal(upToDate.els["update-install"].hidden, true);

  const failing = app({ checkForUpdate: async () => { throw new Error("offline"); } });
  await failing.context.check();
  assert.match(failing.els["update-msg"].textContent, /updateCheckFailed.*offline/);
  assert.equal(failing.els["update-progress-wrap"].hidden, true);
});

test("a skipped version asks no more at start, but the button still offers it and stays lit", async () => {
  const skipped = app({ checkForUpdate: async () => newer }, { skip: "1.4.1" });
  await skipped.context.check({ silent: true });
  assert.equal(skipped.els["update-dialog"].open, false);
  assert.equal(skipped.els["app-update-btn"].classList.has("main-tb-btn--active"), true);
  await skipped.context.check();
  assert.equal(skipped.els["update-dialog"].open, true);
  assert.equal(skipped.els["update-install"].hidden, false);

  const hotfix = app({ checkForUpdate: async () => ({ ...newer, hotfix: 2 }) }, { skip: "1.4.1" });
  await hotfix.context.check({ silent: true });
  assert.equal(hotfix.els["update-dialog"].open, true, "a later hotfix of a skipped version is offered");
});

test("installing saves the tune first and sends only the version", async () => {
  const sent = [];
  const a = app({
    checkForUpdate: async () => newer,
    downloadAndInstallUpdate: async (...args) => { sent.push(args); return { restarting: true }; },
  });
  await a.context.check();
  await a.context.install();
  assert.deepEqual(a.calls, ["tune", "playlist"]);
  assert.equal(sent.length, 1);
  assert.deepEqual(Array.from(sent[0]), ["1.4.1", 0]);
  assert.equal(a.els["update-msg"].textContent, "updateRestarting");
  assert.equal(a.els["update-close"].disabled, false);
});

test("a failed install can be tried again", async () => {
  const a = app({
    checkForUpdate: async () => newer,
    downloadAndInstallUpdate: async () => { throw new Error("disk full"); },
  });
  await a.context.check();
  await a.context.install();
  assert.match(a.els["update-msg"].textContent, /updateFailed.*disk full/);
  assert.equal(a.els["update-install"].hidden, false);
  assert.equal(a.els["update-close"].disabled, false);
  assert.equal(a.els["update-progress-wrap"].hidden, true);
});

test("the wiring: button, dialog, check at start, commands, texts", () => {
  const html = read("www/index.html");
  for (const id of ["app-update-btn", "update-dialog", "update-install", "update-skip", "update-close", "update-server", "update-server-default"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(html.match(/<button id="app-update-btn"[^>]*>/)[0], /\btitle=/, "the custom tooltip only");
  assert.match(source, /setTimeout\(\(\) => checkForAppUpdate\(\{ silent: true \}\), 6000\)/);
  assert.match(source, /_setupUpdater\(\);/);

  const lib = read("src-tauri/src/lib.rs");
  for (const c of ["check_for_update", "download_and_install_update", "get_update_server", "set_update_server"]) {
    assert.match(lib, new RegExp(`updater::${c}`), c);
    assert.match(read("www/tauri-bridge.js"), new RegExp(`"${c}"`), c);
  }

  assert.match(read("src-tauri/src/updater.rs"), /UPDATE_DOWNLOADS: &str = "downloads\/SIDS\/"/);

  const context = {};
  vm.createContext(context);
  vm.runInContext(read("www/i18n.js") + "\n;this.__t = translations;", context);
  for (const lang of ["hu", "en", "es", "de", "nl", "pl", "it"]) {
    for (const key of ["checkForUpdate", "updateAvailableMsg", "updateServerNote", "updateStatusAvailable", "updateHotfixMsg"]) {
      assert.equal(typeof context.__t[lang][key], "string", `${lang} ${key}`);
    }
    assert.doesNotMatch(context.__t[lang].updateAvailableMsg, /Visual Assembler/, lang);
    assert.match(context.__t[lang].updateAvailableMsg, /VA SID Studio/, lang);
    assert.match(context.__t[lang].updateServerNote, /downloads\/SIDS\//, lang);
  }
});
