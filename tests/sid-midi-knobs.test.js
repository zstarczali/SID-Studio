const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const www = path.join(__dirname, "..", "www");
const source = fs.readFileSync(path.join(www, "sid-editor.js"), "utf8");
const css = fs.readFileSync(path.join(www, "style.css"), "utf8");
const i18n = fs.readFileSync(path.join(www, "i18n.js"), "utf8");

function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  for (let i = start; ; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
}

// A knob element with the bits the mapping code touches.
function fakeKnob(id, dialog) {
  const classes = new Set();
  const listeners = {};
  return {
    id,
    dataset: {},
    isConnected: true,
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains: name => classes.has(name),
    },
    addEventListener(type, handler) { listeners[type] = handler; },
    listeners,
    closest: sel => (sel === "dialog" ? dialog : null),
  };
}

function setup(store = {}) {
  const ctx = {
    toasts: [],
    menus: [],
    connects: 0,
    localStorage: {
      data: { ...store },
      getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
      setItem(k, v) { this.data[k] = String(v); },
      removeItem(k) { delete this.data[k]; },
    },
    document: { body: { tag: "body" } },
    showViceToast: msg => ctx.toasts.push(msg),
    t: key => key,
    tf: (key, values) => key + JSON.stringify(values),
  };
  vm.createContext(ctx);
  vm.runInContext(`
    const _SID_MIDI_KEY_CC = "c64va-sid-midi-cc";
    const _sidMidiKnobs = new Map();
    let _sidMidiCcMap = null;
    let _sidMidiLearnId = "";
    var _sidMidiAccess = null;
    function _sidMidiConnect() { connects++; }
    function _sidShowItemMenu(e, host, items) { menus.push({ host, items }); }
    ${fn("_sidMidiCcMapGet")}
    ${fn("_sidMidiCcSave")}
    ${fn("_sidMidiCcOf")}
    ${fn("_sidMidiCcText")}
    ${fn("_sidMidiKnobMark")}
    ${fn("_sidMidiKnobRegister")}
    ${fn("_sidMidiKnobMenu")}
    ${fn("_sidMidiLearnStart")}
    ${fn("_sidMidiLearnStop")}
    ${fn("_sidMidiControl")}
    ${fn("_sidMidiSettingsPersist")}
    ${fn("_sidMidiButtonRegister")}
    ${fn("_sidMidiNote")}
    ${fn("_sidMidiMapped")}
    this.mapJson = () => JSON.stringify(_sidMidiCcMapGet());
    this.learning = () => _sidMidiLearnId;
  `, ctx);
  ctx.map = () => JSON.parse(ctx.mapJson());
  return ctx;
}

function registered(ctx, id, dialog = { open: true }) {
  const knob = fakeKnob(id, dialog);
  const values = [];
  ctx._sidMidiKnobRegister(knob, pct => values.push(pct));
  return { knob, values };
}

test("MIDI Learn maps the next CC to the knob and the knob follows it", () => {
  const ctx = setup();
  const { knob, values } = registered(ctx, "sid-ed-master-vol");
  ctx._sidMidiLearnStart(knob);
  assert.equal(ctx.connects, 1, "connects MIDI when it is not connected yet");
  assert.ok(knob.classList.contains("sid-knob--learning"));
  ctx._sidMidiControl(0, 21, 64);
  assert.deepEqual(values, [], "the learning message does not move the knob");
  assert.deepEqual(ctx.map(), { "0:21": "sid-ed-master-vol" });
  assert.equal(ctx.learning(), "");
  assert.ok(!knob.classList.contains("sid-knob--learning"));
  assert.ok(knob.classList.contains("sid-knob--midi"));
  assert.equal(knob.dataset.midiCc, "21");
  assert.equal(ctx.toasts.at(-1), 'sidMidiLearned{"cc":"sidMidiCcName{\\"cc\\":21,\\"ch\\":1}"}');
  ctx._sidMidiControl(0, 21, 127);
  ctx._sidMidiControl(0, 21, 0);
  assert.deepEqual(values, [100, 0]);
  ctx._sidMidiControl(1, 21, 127);
  assert.deepEqual(values, [100, 0], "another channel is another controller");
});

test("a second learn on the same knob replaces its CC; a CC moves to the knob that learns it", () => {
  const ctx = setup();
  const a = registered(ctx, "knob-a");
  const b = registered(ctx, "knob-b");
  ctx._sidMidiLearnStart(a.knob);
  ctx._sidMidiControl(0, 21, 0);
  ctx._sidMidiLearnStart(a.knob);
  ctx._sidMidiControl(0, 22, 0);
  assert.deepEqual(ctx.map(), { "0:22": "knob-a" });
  ctx._sidMidiLearnStart(b.knob);
  ctx._sidMidiControl(0, 22, 0);
  assert.deepEqual(ctx.map(), { "0:22": "knob-b" });
  assert.equal(a.knob.dataset.midiCc, undefined);
  assert.equal(b.knob.dataset.midiCc, "22");
});

test("a knob in a closed dialog or out of the page ignores its controller", () => {
  const ctx = setup({ "c64va-sid-midi-cc": JSON.stringify({ "2:7": "vol", "0:1": "gone" }) });
  const dialog = { open: false };
  const { knob, values } = registered(ctx, "vol", dialog);
  ctx._sidMidiControl(2, 7, 127);
  assert.deepEqual(values, []);
  dialog.open = true;
  ctx._sidMidiControl(2, 7, 127);
  assert.deepEqual([...values], [100]);
  knob.isConnected = false;
  ctx._sidMidiControl(2, 7, 0);
  assert.deepEqual([...values], [100]);
  ctx._sidMidiControl(0, 1, 0); // mapped to a knob that is not registered: nothing happens
});

test("the mapping is saved and loaded; invalid stored entries are dropped", () => {
  const ctx = setup();
  const { knob } = registered(ctx, "vol");
  ctx._sidMidiLearnStart(knob);
  ctx._sidMidiControl(15, 127, 5);
  assert.deepEqual(JSON.parse(ctx.localStorage.data["c64va-sid-midi-cc"]), { "15:127": "vol" });

  const stored = { "15:127": "vol", "16:1": "x", "0:128": "y", "a:1": "z", "0:5": 7, "0:6": "", "3:9": "pan" };
  const next = setup({ "c64va-sid-midi-cc": JSON.stringify(stored) });
  assert.deepEqual(next.map(), { "15:127": "vol", "3:9": "pan" });
  const reloaded = registered(next, "vol");
  assert.equal(reloaded.knob.dataset.midiCc, "127", "the badge shows at registration");

  assert.deepEqual(setup({ "c64va-sid-midi-cc": "not json" }).map(), {});
  assert.deepEqual(setup({ "c64va-sid-midi-cc": "[1,2]" }).map(), {});
});

test("the right-click menu: learn / cancel, remove one, remove all", () => {
  const ctx = setup();
  const dialog = { open: true };
  const { knob } = registered(ctx, "vol", dialog);
  let stopped = false, prevented = false;
  knob.listeners.contextmenu({ stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
  assert.ok(stopped);
  let menu = ctx.menus.at(-1);
  assert.equal(menu.host, dialog);
  assert.deepEqual([...menu.items].map(i => i.label), ["sidMidiLearn", "sidMidiUnmapNone", "sidMidiUnmapAll"]);
  assert.equal(menu.items[1].disabled, true);
  assert.equal(menu.items[2].disabled, true);
  menu.items[0].run();
  assert.equal(ctx.learning(), "vol");
  ctx._sidMidiKnobMenu({}, knob);
  assert.equal(ctx.menus.at(-1).items[0].label, "sidMidiLearnCancel");
  ctx.menus.at(-1).items[0].run();
  assert.equal(ctx.learning(), "");
  ctx._sidMidiLearnStart(knob);
  ctx._sidMidiControl(0, 21, 0);
  ctx._sidMidiKnobMenu({}, knob);
  menu = ctx.menus.at(-1);
  assert.match(menu.items[1].label, /^sidMidiUnmap\{/);
  assert.equal(menu.items[1].disabled, false);
  menu.items[1].run();
  assert.deepEqual(ctx.map(), {});
  assert.equal(knob.dataset.midiCc, undefined);
  ctx._sidMidiLearnStart(knob);
  ctx._sidMidiControl(0, 21, 0);
  ctx._sidMidiKnobMenu({}, knob);
  ctx.menus.at(-1).items[2].run();
  assert.deepEqual(ctx.map(), {});
  assert.equal(ctx.localStorage.data["c64va-sid-midi-cc"], "{}");
  assert.equal(prevented, false, "the menu helper prevents the default, not the knob");
});

test("Control Change messages go to the knobs, never to the notes", () => {
  const body = fn("_sidMidiMessage");
  const cc = body.indexOf("command === 0xB0");
  assert.ok(cc > 0 && cc < body.indexOf("const midiNote"), "CC is handled before the notes");
  assert.match(body, /_sidMidiControl\(data\[0\] & 0x0f, data\[1\], data\[2\]\);\s*return;/);
});

test("every knob binding registers for MIDI, the virtual keyboard's instrument knob too", () => {
  assert.ok(fn("_sidKnobBind").includes("_sidMidiKnobRegister(knob, set);"));
  assert.ok(fn("_sidVkbdInstKnobBind").includes("_sidMidiKnobRegister(knob,"));
  assert.ok(css.includes(".sid-knob--midi::after") && css.includes("attr(data-midi-cc)"));
  assert.ok(css.includes(".sid-knob--learning"));
  for (const key of ["sidMidiLearn", "sidMidiLearnCancel", "sidMidiLearnHint", "sidMidiLearned", "sidMidiCcName", "sidMidiUnmap", "sidMidiUnmapNone", "sidMidiUnmapAll"]) {
    assert.equal(i18n.split(`"${key}":`).length - 1, 7, key + " in all 7 languages");
  }
});

function button(ctx, id, dialog = { open: true }) {
  const listeners = {};
  const classes = new Set();
  const b = {
    id, isConnected: true, dataset: {}, disabled: false, clicks: 0,
    parentElement: { addEventListener() {} },
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) },
    addEventListener: (type, f) => { listeners[type] = f; },
    closest: sel => (sel === "dialog" ? dialog : null),
    click() { this.clicks++; },
    fire: (type, e) => listeners[type](e),
  };
  ctx._sidMidiButtonRegister(b);
  return b;
}

test("a button learns a CC (transport button) and is pressed once per press", () => {
  const ctx = setup();
  const play = button(ctx, "sid-play");
  play.fire("contextmenu", { preventDefault() {}, stopPropagation() {} });
  assert.equal(ctx.menus[0].items[0].label, "sidMidiLearnButton");
  ctx.menus[0].items[0].run();
  assert.equal(ctx.toasts.at(-1), "sidMidiLearnButtonHint");
  ctx._sidMidiControl(0, 41, 127);
  ctx._sidMidiControl(0, 41, 0);
  assert.equal(play.clicks, 0, "the learning press does not click");
  assert.equal(play.dataset.midiCc, "41");
  ctx._sidMidiControl(0, 41, 127);
  ctx._sidMidiControl(0, 41, 127);
  ctx._sidMidiControl(0, 41, 0);
  ctx._sidMidiControl(0, 41, 127);
  assert.equal(play.clicks, 2, "held is one press");
  play.disabled = true;
  ctx._sidMidiControl(0, 41, 0); ctx._sidMidiControl(0, 41, 127);
  assert.equal(play.clicks, 2, "a disabled button is not pressed");
});

test("a button learns a note (pad); the note no longer plays and the mapping is saved", () => {
  const ctx = setup();
  const rec = button(ctx, "sid-record");
  assert.equal(ctx._sidMidiNote(9, 36, true), false, "an unmapped note plays");
  ctx._sidMidiLearnStart(rec);
  assert.equal(ctx._sidMidiNote(9, 36, true), true);
  assert.equal(ctx._sidMidiNote(9, 36, false), true);
  assert.equal(rec.clicks, 0);
  assert.equal(rec.dataset.midiCc, "n36");
  assert.deepEqual(ctx.map(), { "n:9:36": "sid-record" });
  assert.equal(ctx._sidMidiNote(9, 36, true), true);
  assert.equal(ctx._sidMidiNote(9, 36, false), true);
  assert.equal(rec.clicks, 1);
  const { knob } = registered(ctx, "sid-pw");
  ctx._sidMidiLearnStart(knob);
  assert.equal(ctx._sidMidiNote(0, 60, true), false, "a knob learns only from CCs");
});

test("saved note mappings load back; the transport and undo buttons are registered", () => {
  const ctx = setup({ "c64va-sid-midi-cc": JSON.stringify({ "n:9:36": "sid-stop", "n:16:1": "bad" }) });
  const stop = button(ctx, "sid-stop");
  assert.deepEqual(ctx.map(), { "n:9:36": "sid-stop" });
  ctx._sidMidiNote(9, 36, true);
  assert.equal(stop.clicks, 1);
  const setupBody = fn("setupSidEditor");
  for (const id of ["sid-play", "sid-stop", "sid-record", "sid-undo", "sid-roll-play", "sid-vkbd-record"]) assert.ok(setupBody.includes(`"${id}"`), id);
  assert.match(setupBody, /_sidMidiButtonRegister\(/);
  assert.match(fn("_sidMidiMessage"), /_sidMidiNote\(/);
});

test("MIDI settings: kept in the config file; at start the file wins, or the local copy goes there", async () => {
  const ctx = setup({ "c64va-sid-midi-cc": JSON.stringify({ "0:21": "sid-ed-master-vol" }), "c64va-sid-midi-auto": "1" });
  ctx.saved = [];
  ctx.fileSettings = null;
  vm.runInContext(`
    const _SID_MIDI_KEY_ID = "c64va-sid-midi-input";
    const _SID_MIDI_KEY_NAME = "c64va-sid-midi-input-name";
    const _SID_MIDI_KEY_AUTO = "c64va-sid-midi-auto";
    var _sidMidiSaved = { id: "old", name: "old" };
    var window = { electronAPI: {
      getMidiSettings: async () => fileSettings,
      saveMidiSettings: async s => { saved.push(JSON.parse(JSON.stringify(s))); },
    } };
    ${fn("_sidMidiSettingsGet")}
    ${fn("_sidMidiSettingsApply")}
    async ${fn("_sidMidiSettingsRestore").replace(/^async /, "")}
    this.savedInput = () => _sidMidiSaved;
  `, ctx);
  const { knob, values } = registered(ctx, "sid-ed-master-vol");
  // no settings in the file yet: the local ones are copied there
  await ctx._sidMidiSettingsRestore();
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.saved.at(-1))), { cc: { "0:21": "sid-ed-master-vol" }, input: "", inputName: "", auto: true });
  // a learn saves the file
  ctx._sidMidiLearnStart(knob); ctx._sidMidiControl(0, 30, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.saved.at(-1).cc)), { "0:30": "sid-ed-master-vol" });
  // the file's settings replace the local copy at start
  ctx.fileSettings = { cc: { "2:7": "sid-ed-master-vol" }, input: "x1", inputName: "Keystation", auto: false };
  await ctx._sidMidiSettingsRestore();
  assert.equal(knob.dataset.midiCc, "7");
  assert.equal(ctx.localStorage.data["c64va-sid-midi-input-name"], "Keystation");
  assert.equal("c64va-sid-midi-auto" in ctx.localStorage.data, false);
  assert.equal(ctx.savedInput(), undefined, "the remembered input is read again");
  ctx._sidMidiControl(2, 7, 127);
  assert.deepEqual([...values], [100]);
  const setupBody = fn("setupSidEditor");
  assert.match(setupBody, /_sidMidiSettingsRestore\(\)\.then\(function\(\) \{ _sidMidiAutoConnect\(\); \}\)/);
});
