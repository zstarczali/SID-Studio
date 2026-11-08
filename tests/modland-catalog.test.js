// Modland in the SID Player: the catalog (the playable lines the backend keeps),
// the search, the module names, and the playlist keeping Modland modules without their bytes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appJs = fs.readFileSync(path.join(__dirname, "..", "www", "sid-editor.js"), "utf8");

function slice(from, to) {
  const start = appJs.indexOf(from);
  const end = appJs.indexOf(to, start);
  assert.ok(start > 0 && end > start, "not found: " + from);
  return appJs.slice(start, end);
}

function load() {
  const context = { btoa: (s) => Buffer.from(s, "latin1").toString("base64"), atob: (s) => Buffer.from(s, "base64").toString("latin1") };
  vm.createContext(context);
  vm.runInContext([
    slice("const _MODLAND_RESULT_LIMIT", "let _modlandEntries"),
    slice("function _hvscRandom", "let _hvscEntries"),
    slice("const _MOD_EXTENSIONS", "const _MOD_CHUNK_SECONDS"),
    slice("function _sidIsModuleName", "function _modCall"),
    slice("const _SID_PLAYLIST_FORMAT", "function _sidPlayerLoadPlaylist"),
    "var _sidPlaylist = [], _sidPlaylistIndex = 0;",
    "this.m = { parse: _modlandParseCatalog, search: _modlandSearch, random: _hvscRandom, isModule: _sidIsModuleName, title: _sidModuleTitle,",
    "  info: _sidModInfo, toJson: _sidPlaylistToJson, fromJson: _sidPlaylistFromJson, set: function(list, i) { _sidPlaylist = list; _sidPlaylistIndex = i; } };",
  ].join("\n"), context);
  return context.m;
}

const CATALOG = [
  "59364\tProtracker/Lizardking/1942.mod",
  "50000\tProtracker/Lizardking/11l.kintro#3.short.mod",
  "307068\tFasttracker 2/Jugi/onward.xm",
  "248710\tAsylum/Todd Parsons/coop-Kirk Winterrowd/crusader - no remorse - m07.amf",
  "12402\tFuture Composer 1.4/Jesper Kyd/x-out ingame.fc",
  "71136\tOctaMED MMD0/_unknown/funky.mmd0",
  "160496\tScreamtracker 3/Purple Motion/Game Music/second reality.s3m",
  "",
].join("\r\n");

test("catalog lines: format, composer, co-author or album, title, extension, size", () => {
  const m = load();
  const e = m.parse(CATALOG);
  assert.equal(e.length, 7);
  assert.deepEqual([e[0].f, e[0].a, e[0].t, e[0].x, e[0].s], ["Protracker", "Lizardking", "1942", "MOD", 59364]);
  assert.equal(e[1].t, "11l.kintro#3.short", "only the last dot ends the title");
  assert.equal(e[3].a, "Todd Parsons & Kirk Winterrowd");
  assert.equal(e[3].g, "");
  assert.equal(e[5].a, "", "_unknown has no composer");
  assert.equal(e[6].g, "Game Music", "a third folder that is no coop- is the album");
  assert.equal(e[6].p, "Screamtracker 3/Purple Motion/Game Music/second reality.s3m");
});

test("search: all words in the path, titles first; composer and format fields", () => {
  const m = load();
  const e = m.parse(CATALOG);
  assert.deepEqual(Array.from(m.search(e, "x").items), [], "at least 2 characters");
  assert.deepEqual(Array.from(m.search(e, "lizard").items, (x) => x.t), ["11l.kintro#3.short", "1942"]);
  assert.deepEqual(Array.from(m.search(e, "1942").items, (x) => x.t), ["1942"]);
  assert.deepEqual(Array.from(m.search(e, "purple reality").items, (x) => x.t), ["second reality"]);
  assert.deepEqual(Array.from(m.search(e, "kirk", 300, "composer").items, (x) => x.f), ["Asylum"]);
  assert.deepEqual(Array.from(m.search(e, "ark", 300, "composer").items), [], "a composer word has to start with the query");
  assert.deepEqual(Array.from(m.search(e, "octamed", 300, "format").items, (x) => x.t), ["funky"]);
  assert.equal(m.search(e, "tracker", 300, "format").total, 4, "Protracker twice, Fasttracker 2, Screamtracker 3");
  assert.equal(m.search(e, "mod", 1).items.length, 1);
  assert.equal(m.search(e, "mod", 1).total, 2, "the total counts every hit (the two .mod files)");
  assert.equal(m.random(e, 3).length, 3);
});

test("module names: extensions and the Amiga prefix form", () => {
  const m = load();
  ["1942.mod", "onward.XM", "a.s3m", "b.it", "x.mmd1", "y.okta", "mod.thunderdome", "MED.funky", "dir/z.669"].forEach((n) => assert.ok(m.isModule(n), n));
  ["tune.sid", "song.bin", "readme.txt", "mod", ".mod"].forEach((n) => assert.ok(!m.isModule(n), n));
  assert.equal(m.title("1942.mod"), "1942");
  assert.equal(m.title("mod.thunderdome"), "thunderdome");
  assert.equal(m.title("c:/x/second reality.s3m"), "second reality");
  assert.deepEqual(JSON.parse(JSON.stringify(m.info({ name: "1942.mod", author: "Lizardking" }))),
    { title: "1942", author: "Lizardking", released: "", songs: 1, startSong: 1, module: true });
});

test("playlist: Modland modules are kept by path in localStorage, with their bytes in a file", () => {
  const m = load();
  const sid = { name: "a.sid", bytes: new Uint8Array([80, 83, 73, 68]), info: { songs: 1 }, song: 1, lengths: null, hvsc: null, modland: null };
  const ml = { name: "1942.mod", bytes: new Uint8Array([1, 2, 3]), info: { module: true, songs: 2, title: "1942", author: "Lizardking" }, song: 2, lengths: [1000, 2000], modland: "Protracker/Lizardking/1942.mod" };
  const dropped = { name: "own.xm", bytes: new Uint8Array([4, 5]), info: { module: true, songs: 1 }, song: 1, lengths: null, modland: null };
  const unfetched = { name: "x.mod", bytes: null, info: { module: true, songs: 1, title: "x" }, song: 1, lengths: null, modland: "Protracker/A/x.mod" };
  m.set([sid, ml, dropped, unfetched], 1);
  const file = m.toJson("file");
  assert.equal(file.items.length, 4);
  assert.ok(file.items[1].data && file.items[2].data, "a playlist file carries the modules");
  assert.equal(file.items[3].data, undefined, "nothing to carry before the first play");
  const local = m.toJson("local");
  assert.ok(local.items[0].data, "SID tunes keep their bytes");
  assert.equal(local.items[1].data, undefined, "the Modland module comes back from the cache");
  assert.equal(local.items[1].modland, "Protracker/Lizardking/1942.mod");
  assert.equal(local.items[1].songs, 2);
  assert.ok(local.items[2].data, "a dropped module keeps its bytes");
  const small = m.toJson("small");
  assert.equal(small.items.length, 3, "the dropped module goes when localStorage is full");
  assert.ok(small.items.every((it) => it.data === undefined || it.name === "a.sid"));
  const back = m.fromJson(JSON.parse(JSON.stringify(local)));
  assert.equal(back.entries.length, 4);
  assert.equal(back.current, 1);
  assert.deepEqual([back.entries[1].modland, back.entries[1].bytes, back.entries[1].title, back.entries[1].author, back.entries[1].songs],
    ["Protracker/Lizardking/1942.mod", null, "1942", "Lizardking", 2]);
  assert.deepEqual(Array.from(back.entries[2].bytes), [4, 5]);
  assert.equal(m.fromJson({ format: "va-sid-playlist", items: [{ name: "x.mod" }] }).entries.length, 0, "neither bytes nor a Modland path");
});

// The Top 50 buttons (Classics in the code): fixed lists of HVSC and Modland paths, from the Remix64 statistics and charts.
function loadClassics() {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    slice("const _HVSC_CLASSICS", "let _hvscListing"),
    slice("function _sidClassicEntries", "function _hvscShowClassics"),
    slice("const _MODLAND_CLASSICS", "let _modlandListing"),
    "this.c = { hvsc: _HVSC_CLASSICS, modland: _MODLAND_CLASSICS, entries: _sidClassicEntries };",
  ].join("\n"), context);
  return context.c;
}

test("classics: well-formed paths, playable Modland formats, no duplicates, catalog order", () => {
  const c = loadClassics();
  assert.equal(c.hvsc.length, 50);
  assert.equal(c.modland.length, 50);
  c.hvsc.forEach((p) => assert.match(p, /^\/MUSICIANS\/[A-Z0-9]\/[^/]+\/[^/]+\.sid$/, p));
  const rs = fs.readFileSync(path.join(__dirname, "..", "src-tauri", "src", "modland.rs"), "utf8");
  const playable = new Set(rs.split("pub const PLAYABLE: &[&str] = &[")[1].split("];")[0].match(/"[^"]+"/g).map((q) => q.slice(1, -1)));
  c.modland.forEach((p) => assert.ok(playable.has(p.split("/")[0]) && p.split("/").length >= 3, p));
  assert.equal(new Set(c.hvsc).size, c.hvsc.length);
  assert.equal(new Set(c.modland).size, c.modland.length);
  const entries = [{ p: c.modland[2] }, { p: "Protracker/X/y.mod" }, { p: c.modland[0] }];
  assert.deepEqual(Array.from(c.entries(entries, c.modland), (e) => e.p), [c.modland[0], c.modland[2]], "the selection's order, missing ones left out");
});

// With the real catalogs: HVSC_SONGLENGTHS=…/Songlengths.md5 MODLAND_ALLMODS=…/allmods.txt npm test
test("classics: every path is in the real catalogs", { skip: !process.env.HVSC_SONGLENGTHS || !process.env.MODLAND_ALLMODS }, () => {
  const c = loadClassics();
  const hvsc = new Set(fs.readFileSync(process.env.HVSC_SONGLENGTHS, "latin1").split(/\r?\n/).filter((l) => l.startsWith("; /")).map((l) => l.slice(2).trim()));
  const modland = new Set(fs.readFileSync(process.env.MODLAND_ALLMODS, "latin1").split(/\r?\n/).map((l) => l.split("\t")[1]).filter(Boolean));
  assert.deepEqual(Array.from(c.hvsc.filter((p) => !hvsc.has(p))), []);
  assert.deepEqual(Array.from(c.modland.filter((p) => !modland.has(p))), []);
});

test("volume normalization: gain to the target loudness, at most 12 dB, no clipping peaks", () => {
  const context = { Math, Number };
  vm.createContext(context);
  vm.runInContext([slice("const _PLAYER_NORM_TARGET_DB", "let _playerNormalize"), slice("function _playerNormGain", "// Loudness of audio rendered"),
    "this.gain = _playerNormGain;"].join("\n"), context);
  const db = (g) => Math.round(20 * Math.log10(g) * 10) / 10;
  assert.equal(db(context.gain({ loudness: -26, peak: 0.3 })), 8, "a quiet song is raised to -18 dB");
  assert.equal(db(context.gain({ loudness: -12, peak: 0.9 })), -6, "a loud one is lowered");
  assert.equal(db(context.gain({ loudness: -40, peak: 0.05 })), 12, "at most +12 dB");
  assert.equal(db(context.gain({ loudness: 0, peak: 1 })), -12, "at most -12 dB");
  assert.equal(db(context.gain({ loudness: -26, peak: 0.6 })), 3.5, "the peak limits the boost (0.9 / 0.6)");
  assert.equal(context.gain({ loudness: null, peak: 0 }), 1, "silence keeps its level");
  assert.equal(context.gain(null), 1);
});

test("volume normalization of a SID tune: a boost the new peak no longer allows drops at once, other changes glide", () => {
  const context = { Math, Infinity };
  vm.createContext(context);
  vm.runInContext(slice("function _playerNormGlide", "function _playerSetNormalize") + "\nthis.glide = _playerNormGlide;", context);
  const calls = [];
  const param = { setTargetAtTime: (value, time, tau) => calls.push({ value, time, tau }) };

  // quiet intro raised 4x (peak 0.2), then a loud part: the peak 0.6 allows only 1.5x
  context.glide(param, 4, 1.5, 0.6, 10, 2);
  assert.equal(calls[0].value, 1.5);
  assert.ok(calls[0].tau < 0.01, "fast: " + calls[0].tau);
  assert.ok(calls[0].time <= 10 && calls[0].time >= 9.9, "just before the loud audio: " + calls[0].time);

  // within what the peak allows: a slow glide from the audio's start
  context.glide(param, 1.5, 1.2, 0.6, 12, 2);
  assert.deepEqual({ ...calls[1] }, { value: 1.2, time: 12, tau: 2 });

  // raising the gain is always slow
  context.glide(param, 1.2, 2, 0.3, 14, 2);
  assert.equal(calls[2].tau, 2);

  // a loud tune not boosted (gain 1, peak near full scale) is lowered slowly
  context.glide(param, 1, 0.7, 0.95, 16, 2);
  assert.equal(calls[3].tau, 2);

  // audio already due starts from now, not in the past
  context.glide(param, 1, 0.8, 0.5, 1, 2);
  assert.equal(calls[4].time, 2);
});

test("loudness meter of rendered pieces: blocks of the mono mix, silence and quiet blocks left out", () => {
  const context = { Math, Number };
  vm.createContext(context);
  vm.runInContext(slice("function _normMeterNew", "// The player's normalization gain stage") + "\nthis.m = { create: _normMeterNew, add: _normMeterAdd, loudness: _normLoudness };", context);
  const m = context.m;
  const rate = 1000; // 400-frame blocks
  const sine = (frames, amp, channels) => {
    const pcm = new Float32Array(frames * channels);
    for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) pcm[i * channels + c] = amp * Math.sin(i * 0.3);
    return pcm;
  };
  const meter = m.create();
  m.add(meter, sine(1000, 0.5, 2), 2, rate); // pieces of any length go on filling the blocks
  m.add(meter, sine(600, 0.5, 2), 2, rate);
  assert.equal(meter.blocks.length, 4);
  assert.equal(meter.frames, 1600);
  assert.ok(Math.abs(meter.peak - 0.5) < 0.01);
  const db = m.loudness(meter.blocks);
  assert.ok(Math.abs(db - 20 * Math.log10(0.5 / Math.SQRT2)) < 0.3, "a sine of 0.5: about -9 dB, " + db);
  m.add(meter, new Float32Array(4000 * 2), 2, rate); // a long silence changes nothing
  assert.equal(m.loudness(meter.blocks), db);
  m.add(meter, sine(400, 0.01, 2), 2, rate); // a block 34 dB lower is left out too
  assert.equal(m.loudness(meter.blocks), db);
  assert.equal(m.loudness([]), null);
  // a mono mix: opposite channels cancel
  const anti = m.create();
  const pcm = new Float32Array(800);
  for (let i = 0; i < 400; i++) { pcm[i * 2] = 0.5; pcm[i * 2 + 1] = -0.5; }
  m.add(anti, pcm, 2, rate);
  assert.equal(m.loudness(anti.blocks), null);
});

test("the player's title: MOD Player while a module plays, SID Player while a SID tune does, else by the Modland panel", () => {
  const title = { textContent: "" };
  const context = {
    document: { getElementById: (id) => (id === "websid-play-title" ? title : null) },
    t: (key) => key,
  };
  vm.createContext(context);
  vm.runInContext(slice("function _sidPlayerTitleSync", "function _modlandSetOpen")
    + "\nvar _sidExtStatus = 'stopped', _sidExternalCore = null, panel = false;"
    + "\nfunction _modlandOpen() { return panel; }"
    + "\nthis.set = function(status, kind, open) { _sidExtStatus = status; _sidExternalCore = kind ? { kind: kind } : null; panel = open; _sidPlayerTitleSync(); };", context);
  context.set("stopped", null, false);
  assert.equal(title.textContent, "sidPlayerTitle");
  context.set("stopped", null, true);
  assert.equal(title.textContent, "modPlayerTitle", "the Modland panel open, nothing playing");
  context.set("playing", "mod", false);
  assert.equal(title.textContent, "modPlayerTitle", "a module playing, whatever panel is open");
  context.set("paused", "mod", false);
  assert.equal(title.textContent, "modPlayerTitle");
  context.set("playing", "sid", true);
  assert.equal(title.textContent, "sidPlayerTitle", "a SID tune playing, even with the Modland panel open");
});
