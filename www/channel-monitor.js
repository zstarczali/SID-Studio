/* Audio-clock telemetry: channel level curves, never the mixed stereo output. */
function _channelMonitorQueue(state, at, frames, fps) {
  if (!frames) return;
  if (fps) state.monitorClock = fps > 55 ? 1022727 : 985248;
  const queue = state.monitor || (state.monitor = []);
  frames.forEach(function(frame, i) {
    queue.push({ time: at + (fps ? i / fps : frame.offset), regs: fps ? frame : null, voices: fps ? null : frame.voices });
  });
  // Keep only the audio currently buffered, even while the monitor is closed.
  while (queue.length > 1 && queue[1].time <= _sidExtAudio.currentTime) queue.shift();
}

function _channelMonitorFrame(state) {
  const queue = state.monitor || [], time = _sidExtAudio.currentTime;
  const apply = function(frame) {
    if (!frame.regs || state.monitorFrame === frame) return;
    state.monitorEnv = state.monitorEnv || [];
    for (let b = 0; b < frame.regs.length; b += 25) {
      for (let v = 0; v < 3; v++) {
        const i = b / 25 * 3 + v;
        _sidAnaEnvStep(state.monitorEnv[i] || (state.monitorEnv[i] = { env: 0, st: 0, gate: 0 }), frame.regs, b + v * 7, false);
      }
    }
    state.monitorFrame = frame;
  };
  while (queue.length > 1 && queue[1].time <= time) { apply(queue[0]); queue.shift(); }
  const frame = queue[0];
  if (!frame || frame.time > time) return null;
  apply(frame);
  return frame;
}

(function() {
  const dialog = document.getElementById('channel-monitor');
  const cardElement = dialog.querySelector('.channel-monitor-card');
  const rows = dialog.querySelector('.channel-monitor-rows');
  let raf = 0, source = null, cards = [], lastDraw = 0;
  _sidSetupResizeHandle(cardElement);
  try {
    const saved = JSON.parse(localStorage.getItem('c64va-channel-monitor-size') || '{}');
    if (saved.w > 0) cardElement.style.width = saved.w + 'px';
    if (saved.h > 0) cardElement.style.height = saved.h + 'px';
  } catch (_) {}
  new ResizeObserver(function() {
    if (!dialog.open) return;
    try { localStorage.setItem('c64va-channel-monitor-size', JSON.stringify({ w: cardElement.offsetWidth, h: cardElement.offsetHeight })); } catch (_) {}
  }).observe(cardElement);
  const buttons = [];
  ['websid-play-viz', 'sid-ana-btn'].forEach(function(id) {
    const anchor = document.getElementById(id);
    if (!anchor) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = id === 'websid-play-viz' ? 'websid-play-tool' : 'ce-tool-btn';
    button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8h2l2-5 3 10 3-10 2 5h2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    button.setAttribute('aria-label', t('channelMonitorTitle'));
    button.classList.add('channel-monitor-toggle');
    button.setAttribute('aria-pressed', 'false');
    anchor.after(button); buttons.push(button);
    button.addEventListener('click', function() {
      if (dialog.open) { close(); return; }
      show();
    });
  });
  function saveOpen() {
    try { localStorage.setItem('c64va-channel-monitor-open', JSON.stringify(dialog.open)); } catch (_) {}
  }
  function show() {
    dialog.querySelector('#channel-monitor-title').textContent = t('channelMonitorTitle');
    dialog.querySelector('#channel-monitor-close').setAttribute('aria-label', t('close'));
    dialog._applyPosition?.();
    let modal = false;
    try { modal = !!document.querySelector("dialog[open]:modal"); } catch (_) {}
    if (!dialog.open) { if (modal) dialog.showModal(); else dialog.show(); }
    syncButtons();
    _sidAnaAttach();
    if (!raf) raf = requestAnimationFrame(draw);
    saveOpen();
  }
  function syncButtons() {
    buttons.forEach(b => {
      b.setAttribute('aria-pressed', String(dialog.open));
      b.classList.toggle('websid-play-tool--active', dialog.open);
      b.classList.toggle('sid-metronome-on', dialog.open);
    });
  }
  function closed() {
    cancelAnimationFrame(raf); raf = 0;
    syncButtons();
    saveOpen();
    _sidAnaAttach();
  }
  function close() { dialog.close(); closed(); }
  dialog.addEventListener('close', closed);
  dialog.addEventListener('toggle', function() { syncButtons(); saveOpen(); });
  syncButtons();
  try {
    if (localStorage.getItem('c64va-channel-monitor-open') === 'true') setTimeout(show, 0);
  } catch (_) {}
  document.getElementById('channel-monitor-close').addEventListener('click', close);
  dialog.addEventListener('keydown', function(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  function sidVoices(regs, clock = 985248) {
    const result = [];
    for (let chip = 0; chip * 25 < regs.length; chip++) {
      for (let v = 0; v < 3; v++) {
        const b = chip * 25 + v * 7, ctl = regs[b + 4];
        const hz = (regs[b] | regs[b + 1] << 8) * clock / 16777216;
        const midi = hz > 0 ? Math.round(69 + 12 * Math.log2(hz / 440)) : -1;
        const env = _sidAna.env[chip * 3 + v];
        const silent = (ctl & 8) || (v === 2 && (regs[chip * 25 + 24] & 128) && !(regs[chip * 25 + 23] & 4));
        const level = !silent && (ctl & 0xf0) ? (env ? env.env : (ctl & 1 ? (regs[b + 6] >> 4) / 15 : 0)) * (regs[chip * 25 + 24] & 15) / 15 : 0;
        result.push({ note: level > .001 && midi >= 0 ? ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1) : '—', level });
      }
    }
    return result;
  }
  function draw(now) {
    raf = 0;
    if (!dialog.open) return;
    const ext = _sidExternalCore;
    const current = ext || _sidWaPlay;
    if (source !== current) { source = current; cards = []; rows.replaceChildren(); }
    let voices = [];
    if (ext && ext.active) {
      const frame = _channelMonitorFrame(ext);
      if (frame?.regs) {
        const saved = _sidAna.env; _sidAna.env = ext.monitorEnv;
        voices = sidVoices(frame.regs, ext.monitorClock); _sidAna.env = saved;
      } else if (frame) voices = frame.voices;
    } else if (_sidWaPlay) {
      _sidAnaAttach(); _sidAnaAdvance(now);
      if (_sidAna.last) voices = sidVoices(_sidAna.last);
    }
    if (!voices.length) rows.dataset.empty = t('channelMonitorIdle'); else rows.dataset.empty = '';
    if (now - lastDraw > 20) {
      lastDraw = now;
      voices.forEach(function(voice, i) {
        let card = cards[i];
        if (!card) {
          const el = document.createElement('div'); el.className = 'channel-monitor-row';
          el.innerHTML = '<span></span><b></b><canvas width="600" height="64"></canvas>';
          rows.appendChild(el); card = cards[i] = { el, values: Array(180).fill(0), note: '—' };
        }
        if (voice.note && !/^(\.+|---|\s*)$/.test(voice.note)) card.note = voice.note;
        const level = Math.max(0, Math.min(1, voice.level || 0));
        card.el.querySelector('span').textContent = (ext?.kind === 'mod' ? 'MOD ' : 'SID ') + (i + 1);
        card.el.querySelector('b').textContent = level > .001 ? card.note : '—';
        card.values.push(level); card.values.shift();
        const ctx = card.el.querySelector('canvas').getContext('2d');
        ctx.clearRect(0, 0, 600, 64); ctx.strokeStyle = getComputedStyle(cardElement).getPropertyValue('--panel-border').trim(); ctx.beginPath(); ctx.moveTo(0, 62); ctx.lineTo(600, 62); ctx.stroke();
        ctx.strokeStyle = 'hsl(' + (140 + i * 37) % 360 + ' 80% 65%)'; ctx.lineWidth = 2; ctx.beginPath();
        card.values.forEach((v, x) => ctx.lineTo(x * 600 / 179, 62 - v * 58)); ctx.stroke();
      });
      cards.forEach((card, i) => { card.el.hidden = i >= voices.length; });
    }
    raf = requestAnimationFrame(draw);
  }
})();
