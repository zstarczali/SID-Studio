const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'www', name), 'utf8');

test('monitor schedules SID frames and MOD telemetry against the audio clock', () => {
  const ctx = { _sidExtAudio: { currentTime: 10 } };
  vm.createContext(ctx);
  vm.runInContext(read('channel-monitor.js').split('(function()')[0], ctx);
  const state = {};
  ctx._channelMonitorQueue(state, 10, [[1], [2], [3]], 50);
  assert.equal(state.monitor[1].time, 10.02);
  assert.equal(state.monitor[1].regs[0], 2);
  ctx._sidExtAudio.currentTime = 11;
  ctx._channelMonitorQueue(state, 11, [{ offset: 0, voices: [{ note: 'C-4', level: .5 }] }]);
  assert.equal(state.monitor.length, 1);
  assert.equal(state.monitor[0].voices[0].note, 'C-4');
});

test('explicit resize grip uses pointer capture and stops resizing on release', () => {
  const handlers = {};
  const grip = { setAttribute() {}, addEventListener(name, fn) { handlers[name] = fn; }, setPointerCapture(id) { this.capture = id; } };
  let savedSize;
  const element = { id: "sid-ana", get offsetWidth() { return parseInt(this.style.width) || 500; }, get offsetHeight() { return parseInt(this.style.height) || 300; }, style: {}, querySelector() { return null; }, appendChild() {}, getBoundingClientRect() { return { left: 20, top: 30, width: 500, height: 300 }; } };
  const ctx = { _sidAnaSave(size) { savedSize = size; }, document: { createElement() { return grip; } }, window: { innerWidth: 1200, innerHeight: 800 } };
  vm.createContext(ctx);
  vm.runInContext(read('sid-editor.js').split('function _sidSetupResizeHandle(element) {')[1].split('function setupSidVisualizer()')[0].replace(/^/, 'function _sidSetupResizeHandle(element) {'), ctx);
  ctx._sidSetupResizeHandle(element);
  handlers.pointerdown({ button: 0, clientX: 520, clientY: 330, pointerId: 7, preventDefault() {}, stopPropagation() {} });
  handlers.pointermove({ clientX: 620, clientY: 380 });
  assert.equal(grip.capture, 7);
  assert.equal(element.style.width, '600px');
  assert.equal(element.style.height, '350px');
  handlers.pointerup();
  assert.equal(savedSize.width, 600);
  assert.equal(savedSize.height, 350);
  handlers.pointermove({ clientX: 900, clientY: 600 });
  assert.equal(element.style.width, '600px');
});

test('both SIDs keep independent envelopes and a shared frame advances only once', () => {
  const ctx = { _sidExtAudio: { currentTime: 2 }, _sidAnaEnvStep(env, regs, b) { env.env += (regs[b + 4] & 1) ? .1 : 0; } };
  vm.createContext(ctx);
  vm.runInContext(read('channel-monitor.js').split('(function()')[0], ctx);
  const regs = Array(50).fill(0);
  regs[4] = 1; regs[25 + 11] = 1;
  const state = { monitor: [{ time: 1, regs }] };
  assert.equal(ctx._channelMonitorFrame(state).regs.length, 50);
  assert.equal(state.monitorEnv.length, 6);
  assert.equal(state.monitorEnv[0].env, .1);
  assert.equal(state.monitorEnv[4].env, .1);
  assert.equal(state.monitorEnv[3].env, 0);
  ctx._channelMonitorFrame(state);
  assert.equal(state.monitorEnv[0].env, .1);
});

test('channel buttons start closed even when the spectrum is active, and follow their own dialog', () => {
  function element() {
    const el = { className: '', attrs: {}, events: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, fn) { this.events[k] = fn; } };
    el.classList = {
      contains(k) { return el.className.split(' ').includes(k); },
      add(...keys) { el.className = [...new Set([...el.className.split(' '), ...keys])].join(' '); },
      remove(...keys) { el.className = el.className.split(' ').filter(k => !keys.includes(k)).join(' '); },
      toggle(k, on) { if (on) this.add(k); else this.remove(k); }
    };
    return el;
  }
  const card = element(), rows = element(), title = element(), close = element(), dialog = element();
  dialog.open = false;
  dialog.querySelector = selector => ({ '.channel-monitor-card': card, '.channel-monitor-rows': rows, '#channel-monitor-title': title, '#channel-monitor-close': close })[selector];
  dialog.show = dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  const buttons = [];
  const anchor = element(); anchor.className = 'websid-play-tool websid-play-tool--active sid-metronome-on';
  anchor.after = b => buttons.push(b);
  const stored = new Map(), timers = [];
  const ctx = {
    setTimeout(fn) { timers.push(fn); },
    document: { getElementById(id) { return ({ 'channel-monitor': dialog, 'channel-monitor-close': close, 'websid-play-viz': anchor, 'sid-ana-btn': anchor })[id]; }, createElement: element, querySelector() { return null; } },
    localStorage: { getItem(k) { return stored.get(k) || null; }, setItem(k, v) { stored.set(k, v); } }, ResizeObserver: function() { this.observe = () => {}; },
    _sidSetupResizeHandle() {}, _sidAnaAttach() {}, t: k => k,
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}
  };
  vm.createContext(ctx);
  vm.runInContext(read('channel-monitor.js'), ctx);
  for (const b of buttons) {
    assert.equal(b.attrs['aria-pressed'], 'false');
    assert.equal(b.classList.contains('websid-play-tool--active'), false);
  }
  buttons[0].events.click();
  assert.equal(dialog.open, true);
  assert.ok(buttons.every(b => b.attrs['aria-pressed'] === 'true'));
  buttons[1].events.click();
  assert.equal(dialog.open, false);
  assert.ok(buttons.every(b => b.attrs['aria-pressed'] === 'false'));
  buttons[0].events.click(); dialog.close(); dialog.events.close();
  assert.ok(buttons.every(b => !b.classList.contains('websid-play-tool--active')));
  assert.equal(stored.get('c64va-channel-monitor-open'), 'false');
  buttons[0].events.click();
  assert.equal(stored.get('c64va-channel-monitor-open'), 'true');
  // Restart while the window is open: its saved state survives the old DOM.
  dialog.open = false; buttons.length = 0;
  vm.runInContext(read('channel-monitor.js'), ctx);
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal(dialog.open, true);
  assert.ok(buttons.every(b => b.attrs['aria-pressed'] === 'true'));
  close.events.click();
  assert.equal(stored.get('c64va-channel-monitor-open'), 'false');
  buttons.length = 0;
  vm.runInContext(read('channel-monitor.js'), ctx);
  assert.equal(timers.length, 0);
  assert.equal(dialog.open, false);
});
