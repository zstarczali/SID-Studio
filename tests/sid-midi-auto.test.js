const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const www = path.join(__dirname, "..", "www");
const source = fs.readFileSync(path.join(www, fs.existsSync(path.join(www, "sid-editor.js")) ? "sid-editor.js" : "app.js"), "utf8");

function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  for (let i = start; ; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      const body = source.slice(start, i + 1);
      return source.slice(start - 6, start) === "async " ? "async " + body : body;
    }
  }
}

function constLine(name) {
  const match = source.match(new RegExp(`const ${name} = [^;]+;`));
  assert.ok(match, name);
  return match[0];
}

function fakeInput(id, name) {
  return { id, name, manufacturer: "", onmidimessage: null };
}

// A MIDI access whose inputs the test can plug in and pull out.
function fakeAccess(inputs) {
  const map = new Map(inputs.map(input => [input.id, input]));
  return { inputs: map, onstatechange: null };
}

function setup({ store = {}, access = null, midi = true, denied = false } = {}) {
  const toasts = [];
  const select = { innerHTML: "", value: "", options: [], appendChild(o) { this.options.push(o); } };
  const ctx = {
    toasts,
    select,
    localStorage: {
      data: { ...store },
      getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
      setItem(k, v) { this.data[k] = String(v); },
      removeItem(k) { delete this.data[k]; },
    },
    navigator: midi ? { requestMIDIAccess: async () => { if (denied) throw new Error("no"); return access; } } : {},
    document: {
      getElementById: id => (id === "sid-midi-input" ? select : null),
      createElement: () => ({ value: "", textContent: "" }),
    },
    showViceToast: (msg) => toasts.push(msg),
    t: key => key,
  };
  vm.createContext(ctx);
  vm.runInContext(`
    ${constLine("_SID_MIDI_KEY_ID")}
    ${constLine("_SID_MIDI_KEY_NAME")}
    ${constLine("_SID_MIDI_KEY_AUTO")}
    var _sidMidiAccess = null, _sidMidiInputId = "", _sidMidiSaved, _sidMidiStrict;
    function _sidMidiMessage() {}
    ${fn("_sidMidiLoadSaved")}
    ${fn("_sidMidiAutoEnabled")}
    ${fn("_sidMidiSetAuto")}
    ${fn("_sidMidiSettingsPersist")}
    ${fn("_sidMidiInputLabel")}
    ${fn("_sidMidiMatchInput")}
    ${fn("_sidMidiRefreshInputs")}
    ${fn("_sidMidiSetInput")}
    ${fn("_sidMidiOpen")}
    ${fn("_sidMidiConnect")}
    ${fn("_sidMidiAutoConnect")}
    this.state = () => ({ id: _sidMidiInputId, strict: _sidMidiStrict, access: _sidMidiAccess });
  `, ctx);
  return ctx;
}

test("matching an input: by id first, then by name", () => {
  const ctx = setup();
  const access = fakeAccess([fakeInput("a", "Keystation"), fakeInput("b", "Launchkey"), fakeInput("c", "Launchkey")]);
  assert.equal(ctx._sidMidiMatchInput(access.inputs, "b", "Keystation"), "b");
  assert.equal(ctx._sidMidiMatchInput(access.inputs, "gone", "Launchkey"), "b", "the first one with the name");
  assert.equal(ctx._sidMidiMatchInput(access.inputs, "gone", "Other"), "");
  assert.equal(ctx._sidMidiMatchInput(access.inputs, "", ""), "");
});

test("Connect MIDI remembers the input's id and name and turns on the connect at start", async () => {
  const keys = fakeInput("k1", "Keystation");
  const ctx = setup({ access: fakeAccess([keys]) });
  assert.equal(await ctx._sidMidiConnect(), true);
  assert.equal(ctx.state().id, "k1");
  assert.equal(keys.onmidimessage !== null, true);
  assert.equal(ctx.localStorage.data["c64va-sid-midi-input"], "k1");
  assert.equal(ctx.localStorage.data["c64va-sid-midi-input-name"], "Keystation");
  assert.equal(ctx.localStorage.data["c64va-sid-midi-auto"], "1");
  assert.deepEqual(ctx.toasts, []);
});

test("picking No MIDI input forgets the input and turns off the connect at start", async () => {
  const ctx = setup({ access: fakeAccess([fakeInput("k1", "Keystation")]) });
  await ctx._sidMidiConnect();
  ctx._sidMidiSetInput("", { user: true });
  assert.equal(ctx.localStorage.data["c64va-sid-midi-auto"], undefined);
  assert.equal(ctx.localStorage.data["c64va-sid-midi-input"], "");
  // a device plugged in afterwards is not selected by itself
  const access = ctx.state().access;
  access.inputs.set("k2", fakeInput("k2", "Launchkey"));
  access.onstatechange();
  assert.equal(ctx.state().id, "");
  // and the next start does not connect
  const next = setup({ store: ctx.localStorage.data, access: fakeAccess([fakeInput("k1", "Keystation")]) });
  assert.equal(await next._sidMidiAutoConnect(), false);
  assert.equal(next.state().access, null);
});

test("picking an input in the list remembers it and turns the connect at start back on", async () => {
  const ctx = setup({ access: fakeAccess([fakeInput("k1", "Keystation"), fakeInput("k2", "Launchkey")]) });
  await ctx._sidMidiConnect();
  ctx._sidMidiSetInput("", { user: true });
  ctx._sidMidiSetInput("k2", { user: true });
  assert.equal(ctx.localStorage.data["c64va-sid-midi-auto"], "1");
  assert.equal(ctx.localStorage.data["c64va-sid-midi-input-name"], "Launchkey");
});

test("the start connects to the remembered input, found by name when its id changed", async () => {
  const keys = fakeInput("new-id", "Keystation");
  const ctx = setup({
    store: { "c64va-sid-midi-auto": "1", "c64va-sid-midi-input": "old-id", "c64va-sid-midi-input-name": "Keystation" },
    access: fakeAccess([fakeInput("x", "Other"), keys]),
  });
  assert.equal(await ctx._sidMidiAutoConnect(), true);
  assert.equal(ctx.state().id, "new-id");
  assert.equal(ctx.select.value, "new-id");
  assert.equal(ctx.select.options.length, 2);
  assert.equal(ctx.localStorage.data["c64va-sid-midi-input"], "new-id");
  assert.deepEqual(ctx.toasts, []);
});

test("the start without the device stays quiet, selects nothing else, and picks the device up when it is plugged in", async () => {
  const access = fakeAccess([fakeInput("x", "Other")]);
  const ctx = setup({
    store: { "c64va-sid-midi-auto": "1", "c64va-sid-midi-input": "k1", "c64va-sid-midi-input-name": "Keystation" },
    access,
  });
  assert.equal(await ctx._sidMidiAutoConnect(), true);
  assert.equal(ctx.state().id, "", "no other input stands in");
  assert.equal(ctx.select.value, "");
  assert.deepEqual(ctx.toasts, [], "no toast");
  assert.equal(ctx.localStorage.data["c64va-sid-midi-input"], "k1", "still remembered");
  assert.equal(ctx.localStorage.data["c64va-sid-midi-input-name"], "Keystation");
  assert.equal(typeof access.onstatechange, "function");
  // plugged in later, with a new id
  const keys = fakeInput("k9", "Keystation");
  access.inputs.set("k9", keys);
  access.onstatechange();
  assert.equal(ctx.state().id, "k9");
  assert.equal(keys.onmidimessage !== null, true);
  // pulled out again: none, but still remembered
  access.inputs.delete("k9");
  access.onstatechange();
  assert.equal(ctx.state().id, "");
  assert.equal(ctx.localStorage.data["c64va-sid-midi-input-name"], "Keystation");
});

test("the start is quiet without Web MIDI or when access is refused", async () => {
  const store = { "c64va-sid-midi-auto": "1", "c64va-sid-midi-input": "k1" };
  const none = setup({ store, midi: false });
  assert.equal(await none._sidMidiAutoConnect(), false);
  const denied = setup({ store, denied: true });
  assert.equal(await denied._sidMidiAutoConnect(), false);
  assert.deepEqual([...none.toasts, ...denied.toasts], []);
  // the button still says so
  await none._sidMidiConnect();
  assert.deepEqual(none.toasts, ["sidMidiUnavailable"]);
});

test("without the remembered flag the start does not ask for MIDI", async () => {
  let asked = false;
  const ctx = setup({ store: { "c64va-sid-midi-input": "k1" } });
  ctx.navigator.requestMIDIAccess = async () => { asked = true; return fakeAccess([]); };
  assert.equal(await ctx._sidMidiAutoConnect(), false);
  assert.equal(asked, false);
});

test("setupSidEditor starts the automatic connect and the list change is a user pick", () => {
  const setupBody = fn("setupSidEditor");
  assert.ok(setupBody.includes("_sidMidiAutoConnect();"));
  assert.ok(setupBody.includes('_sidMidiSetInput(e.target.value, { user: true })'));
});
