/* Tracker modules for the SID Player: libopenmpt (lib/libopenmpt, WebAssembly) in a
 * worker, so its Emscripten globals stay out of the page and rendering does not
 * hold up the UI. Requests: { id, cmd, … } → { id, ok, result } or { id, ok: false, error }.
 *   open   { bytes: ArrayBuffer, song }  song: subsong index, -1 = the module's default;
 *          → subsongs, lengths, metadata and the loudness (for the volume normalization)
 *   render { frames, rate }              → { pcm: interleaved stereo Float32Array, frames }
 *   seek   { seconds }                   → the position reached
 *   close
 * The build exports no memory views, so the wasm is instantiated here and its
 * exported WebAssembly.Memory read directly (instantiateWasm). */
"use strict";

let lib = null;
let memory = null;
let mod = 0;
let bufL = 0;
let bufR = 0;
let bufFrames = 0;
let monitorNotes = [];

function libReady(base) {
  return new Promise(function(resolve, reject) {
    self.libopenmpt = {
      print: function() {},
      printErr: function() {},
      instantiateWasm: function(imports, done) {
        fetch(base + "libopenmpt.wasm")
          .then(function(r) { if (!r.ok) throw new Error("libopenmpt.wasm: HTTP " + r.status); return r.arrayBuffer(); })
          .then(function(buf) { return WebAssembly.instantiate(buf, imports); })
          .then(function(res) {
            memory = Object.values(res.instance.exports).find(function(v) { return v instanceof WebAssembly.Memory; });
            done(res.instance);
          })
          .catch(reject);
        return {};
      },
      onRuntimeInitialized: function() { lib = self.libopenmpt; resolve(); },
    };
    try { importScripts(base + "libopenmpt.js"); } catch (e) { reject(e); }
  });
}

function u8() {
  return new Uint8Array(memory.buffer);
}

function cString(ptr) {
  if (!ptr) return "";
  const b = u8();
  let end = ptr;
  while (b[end]) end++;
  return new TextDecoder().decode(b.subarray(ptr, end));
}

function withCString(text, fn) {
  const enc = new TextEncoder().encode(text + "\0");
  const ptr = lib._malloc(enc.length);
  u8().set(enc, ptr);
  try { return fn(ptr); } finally { lib._free(ptr); }
}

function libString(ptr) {
  const text = cString(ptr);
  if (ptr) lib._openmpt_free_string(ptr);
  return text;
}

function metadata(key) {
  return withCString(key, function(k) { return libString(lib._openmpt_module_get_metadata(mod, k)); }).trim();
}

function closeModule() {
  if (mod) lib._openmpt_module_destroy(mod);
  mod = 0;
}

function openModule(bytes, song) {
  closeModule();
  monitorNotes = [];
  const data = new Uint8Array(bytes);
  const ptr = lib._malloc(Math.max(1, data.length));
  u8().set(data, ptr);
  try {
    mod = lib._openmpt_module_create_from_memory(ptr, data.length, 0, 0, 0);
  } finally {
    lib._free(ptr);
  }
  if (!mod) throw new Error("not a module libopenmpt can play");
  const subsongs = Math.max(1, lib._openmpt_module_get_num_subsongs(mod));
  const durations = [];
  for (let i = 0; i < subsongs; i++) {
    if (subsongs > 1) lib._openmpt_module_select_subsong(mod, i);
    durations.push(Math.max(0, lib._openmpt_module_get_duration_seconds(mod)));
  }
  const chosen = Number.isInteger(song) && song >= 0 && song < subsongs ? song : 0;
  lib._openmpt_module_select_subsong(mod, subsongs > 1 ? chosen : -1);
  const level = loudness();
  // back to the start of the song the scan has played through
  lib._openmpt_module_select_subsong(mod, subsongs > 1 ? chosen : -1);
  lib._openmpt_module_set_position_seconds(mod, 0);
  return {
    subsongs, song: chosen, durations, loudness: level.loudness, peak: level.peak,
    title: metadata("title"), artist: metadata("artist"), date: metadata("date"),
    type: metadata("type"), typeLong: metadata("type_long"), tracker: metadata("tracker"),
    version: libString(withCString("library_version", function(k) { return lib._openmpt_get_string(k); })),
  };
}

// The song's loudness for the volume normalization: the whole song rendered in mono at
// 11 kHz (a 6-minute module takes about 0.2 s), its power in 0.4 s blocks, silent blocks
// (below -60 dB) and those 10 dB under the average left out, as the loudness meters do.
// Returns { loudness: dB or null for silence, peak }.
function loudness() {
  const rate = 11025, block = Math.round(rate * 0.4), chunk = 8192, limit = rate * 1800;
  const buf = lib._malloc(chunk * 4);
  const blocks = [];
  let sum = 0, filled = 0, total = 0, peak = 0;
  try {
    while (total < limit) {
      const got = lib._openmpt_module_read_float_mono(mod, rate, chunk, buf);
      if (got <= 0) break;
      const f = new Float32Array(memory.buffer, buf, got);
      for (let i = 0; i < got; i++) {
        const v = f[i];
        sum += v * v;
        if (v > peak) peak = v; else if (-v > peak) peak = -v;
        if (++filled === block) { blocks.push(sum / block); sum = 0; filled = 0; }
      }
      total += got;
    }
  } finally {
    lib._free(buf);
  }
  if (filled > block / 4) blocks.push(sum / filled);
  const loud = blocks.filter(function(p) { return p > 1e-6; });
  if (!loud.length) return { loudness: null, peak };
  const mean = loud.reduce(function(a, p) { return a + p; }, 0) / loud.length;
  const kept = loud.filter(function(p) { return p >= mean * 0.1; });
  const power = kept.reduce(function(a, p) { return a + p; }, 0) / kept.length;
  return { loudness: 10 * Math.log10(power), peak };
}

function render(frames, rate) {
  if (!mod) throw new Error("no module");
  frames = Math.max(1, Math.min(1 << 16, frames | 0));
  if (frames > bufFrames) {
    if (bufL) { lib._free(bufL); lib._free(bufR); }
    bufL = lib._malloc(frames * 4);
    bufR = lib._malloc(frames * 4);
    bufFrames = frames;
  }
  // libopenmpt can return fewer frames than asked before the end: read on until full or ended
  const pcm = new Float32Array(frames * 2);
  let done = 0;
  const monitor = [];
  while (done < frames) {
    const got = lib._openmpt_module_read_float_stereo(mod, rate, Math.min(frames - done, Math.max(1, Math.round(rate / 50))), bufL, bufR);
    if (got <= 0) break;
    const left = new Float32Array(memory.buffer, bufL, got);
    const right = new Float32Array(memory.buffer, bufR, got);
    for (let i = 0; i < got; i++) {
      pcm[(done + i) * 2] = left[i];
      pcm[(done + i) * 2 + 1] = right[i];
    }
    const pattern = lib._openmpt_module_get_current_pattern(mod);
    const row = lib._openmpt_module_get_current_row(mod);
    const voices = [];
    for (let c = 0; c < lib._openmpt_module_get_num_channels(mod); c++) {
      const note = libString(lib._openmpt_module_format_pattern_row_channel_command(mod, pattern, row, c, 0));
      if (note && !/^(\.+|---|\s*)$/.test(note)) monitorNotes[c] = note;
      voices.push({ note: monitorNotes[c] || "—", level: lib._openmpt_module_get_current_channel_vu_mono(mod, c) });
    }
    monitor.push({ offset: done / rate, voices });
    done += got;
  }
  return { pcm: done === frames ? pcm : pcm.slice(0, done * 2), frames: done, monitor };
}

let ready = null;

function handle(msg) {
  const base = msg.base || "lib/libopenmpt/";
  ready = ready || libReady(base);
  return ready.then(function() {
    switch (msg.cmd) {
      case "open": return openModule(msg.bytes, msg.song);
      case "render": return render(msg.frames, msg.rate);
      case "seek": monitorNotes = []; if (!mod) throw new Error("no module"); return lib._openmpt_module_set_position_seconds(mod, Math.max(0, Number(msg.seconds) || 0));
      case "close": closeModule(); return true;
      default: throw new Error("unknown command: " + msg.cmd);
    }
  });
}

// requests run one after the other: a render never overlaps an open or a seek
let chain = Promise.resolve();

self.onmessage = function(e) {
  const msg = e.data || {};
  chain = chain.then(function() { return handle(msg); }).then(function(result) {
    const transfer = result && result.pcm ? [result.pcm.buffer] : [];
    self.postMessage({ id: msg.id, ok: true, result }, transfer);
  }, function(err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
  });
};
