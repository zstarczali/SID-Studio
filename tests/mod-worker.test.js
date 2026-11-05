// The libopenmpt worker of the SID Player (www/mod-worker.js) with the bundled
// libopenmpt, on a Protracker module built here: one pattern, a looped square wave.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const www = path.join(__dirname, "..", "www");

// 4 channels, 1 pattern of 64 rows at speed 6 (= 7.68 s), C-2 on channel 0 in row 0
function protrackerModule() {
  const head = Buffer.alloc(20 + 31 * 30 + 2 + 128 + 4);
  head.write("va test", 0, "latin1");
  const s = 20; // sample 1
  head.write("square", s, "latin1");
  head.writeUInt16BE(32, s + 22); // length in words
  head[s + 24] = 0; // finetune
  head[s + 25] = 64; // volume
  head.writeUInt16BE(0, s + 26); // repeat start
  head.writeUInt16BE(32, s + 28); // repeat length
  for (let i = 1; i < 31; i++) head.writeUInt16BE(1, 20 + i * 30 + 28);
  const order = 20 + 31 * 30;
  head[order] = 1; // song length
  head[order + 1] = 127;
  head.write("M.K.", order + 2 + 128, "latin1");
  const pattern = Buffer.alloc(64 * 4 * 4);
  const period = 428, sample = 1;
  pattern[0] = (sample & 0xf0) | (period >> 8);
  pattern[1] = period & 0xff;
  pattern[2] = (sample & 0x0f) << 4;
  const wave = Buffer.alloc(64);
  for (let i = 0; i < 64; i++) wave[i] = i < 32 ? 0x50 : 0xb0;
  return Buffer.concat([head, pattern, wave]);
}

function loadWorker() {
  const posted = [];
  const ctx = {
    TextDecoder, TextEncoder, WebAssembly, Promise, Object, Uint8Array, Float32Array, Math, Number, String, Error, performance, setTimeout, clearTimeout, crypto: globalThis.crypto, Date, Array, Symbol, BigInt, BigInt64Array, Int8Array, Int16Array, Int32Array, Uint16Array, Uint32Array, Float64Array, DataView, ArrayBuffer, JSON, RegExp, Map, Set, isNaN, isFinite, parseInt, parseFloat,
    console: { log() {}, error() {}, warn() {} },
    fetch: async (url) => {
      const file = path.join(www, url);
      return { ok: true, status: 200, arrayBuffer: async () => { const b = fs.readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } };
    },
    postMessage: (msg) => posted.push(msg),
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.importScripts = (url) => vm.runInContext(fs.readFileSync(path.join(www, url), "utf8"), ctx, { filename: url });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(www, "mod-worker.js"), "utf8"), ctx, { filename: "mod-worker.js" });
  let id = 0;
  const call = (cmd, data) => new Promise((resolve, reject) => {
    const my = ++id;
    ctx.onmessage({ data: Object.assign({ id: my, cmd }, data) });
    const wait = () => {
      const msg = posted.find((m) => m.id === my);
      if (!msg) return setTimeout(wait, 5);
      if (msg.ok) resolve(msg.result); else reject(new Error(msg.error));
    };
    wait();
  });
  return call;
}

test("the worker opens a module: subsongs, length, title, type", async () => {
  const call = loadWorker();
  const bytes = protrackerModule();
  const info = await call("open", { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), song: -1 });
  assert.equal(info.subsongs, 1);
  assert.equal(info.title, "va test");
  assert.equal(info.type, "mod");
  assert.match(info.typeLong, /ProTracker/);
  assert.ok(Math.abs(info.durations[0] - 7.68) < 0.05, "64 rows at speed 6: " + info.durations[0]);
  assert.match(info.version, /^0\.8\./);
  // the loudness scan: a full-volume square wave on one of four channels
  assert.ok(info.loudness < -3 && info.loudness > -30, "loudness: " + info.loudness);
  assert.ok(info.peak > 0.05 && info.peak <= 1, "peak: " + info.peak);
});

test("a silent module has no loudness, and the scan leaves the song at its start", async () => {
  const call = loadWorker();
  const bytes = protrackerModule();
  bytes[20 + 25] = 0; // sample 1 volume 0
  const info = await call("open", { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), song: -1 });
  assert.equal(info.loudness, null);
  const out = await call("render", { frames: 48000, rate: 48000 });
  assert.equal(out.frames, 48000, "rendering starts again from the beginning after the scan");
});

test("render gives interleaved stereo with sound, then nothing at the end", async () => {
  const call = loadWorker();
  const bytes = protrackerModule();
  await call("open", { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), song: -1 });
  const out = await call("render", { frames: 4800, rate: 48000 });
  assert.equal(out.frames, 4800);
  assert.equal(out.pcm.length, 9600);
  const peak = out.pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak > 0.05, "the note sounds: " + peak);
  // Amiga panning: channel 0 is hard left
  let left = 0, right = 0;
  for (let i = 0; i < out.frames; i++) { left += Math.abs(out.pcm[i * 2]); right += Math.abs(out.pcm[i * 2 + 1]); }
  assert.ok(left > right, "channel 0 on the left");
  let total = out.frames;
  for (let n = 0; n < 200; n++) {
    const more = await call("render", { frames: 48000, rate: 48000 });
    total += more.frames;
    if (!more.frames) break;
  }
  // plays once: 7.68 s, plus the short fade-out libopenmpt renders after the last row
  assert.ok(total / 48000 >= 7.67 && total / 48000 < 7.9, "plays once, 7.68 s: " + total / 48000);
});

test("seek moves the position; a bad file is refused", async () => {
  const call = loadWorker();
  const bytes = protrackerModule();
  await call("open", { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), song: -1 });
  const reached = await call("seek", { seconds: 5 });
  assert.ok(Math.abs(reached - 5) < 0.2, "seek to 5 s: " + reached);
  let rest = 0;
  for (let n = 0; n < 20; n++) { const more = await call("render", { frames: 48000, rate: 48000 }); rest += more.frames; if (!more.frames) break; }
  const restSeconds = rest / 48000 - (7.68 - reached);
  assert.ok(restSeconds >= -0.01 && restSeconds < 0.22, "the rest after the seek: " + rest / 48000 + " from " + reached);
  await assert.rejects(call("open", { bytes: new Uint8Array(64).buffer, song: -1 }), /not a module/);
  await assert.rejects(call("render", { frames: 100, rate: 48000 }), /no module/);
});
