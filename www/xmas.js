/* Christmas tree behind the workspace: on December 24-26 (local time) it is there on its
 * own, and Ctrl+Alt+Shift+X shows or hides it on any day. Hidden, it stays hidden (over
 * restarts and later Christmases) until the keys are pressed again; shown outside
 * Christmas, it stays until the app is restarted. The toolbar button does the same as the
 * keys; it is there on these days and whenever the tree shows.
 * A canvas under every window (pointer-events: none), drawn only while it is shown and the
 * app window is visible. Its own scope: nothing here is used by the rest of the app. */
(function () {
  "use strict";

  const BAUBLE_COLORS = ["#e63946", "#f4c430", "#3a86ff", "#c77dff", "#ff8fab", "#2ec4b6", "#fb8500"];
  const BULB_COLORS = ["#ff4d4d", "#ffd23f", "#4dd2ff", "#7cff6b", "#ff7bd5"];
  const GREETING = "Happy Christmas from VA team";

  let canvas = null, ctx = null;
  let W = 0, H = 0;
  let tree = null, baubles = [], garlands = [], gifts = [], stars = [];
  const flakes = [];
  let raf = 0, last = 0, start = 0;
  let shown = false;
  const HIDDEN_STORE = "c64va-xmas-hidden";
  let override = null; // null: by the date; true / false: the key combination decided

  function loadHidden() {
    try { return localStorage.getItem(HIDDEN_STORE) === "1"; } catch (_) { return false; }
  }

  function saveHidden(hidden) {
    try {
      if (hidden) localStorage.setItem(HIDDEN_STORE, "1");
      else localStorage.removeItem(HIDDEN_STORE);
    } catch (_) {}
  }

  if (loadHidden()) override = false;

  function isChristmas(date) {
    return date.getMonth() === 11 && date.getDate() >= 24 && date.getDate() <= 26;
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "xmas-bg";
    canvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(canvas, document.body.firstChild);
    ctx = canvas.getContext("2d");
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function halfWidthAt(y) {
    let best = 0;
    for (const t of tree.tiers) {
      if (y < t.y || y > t.y + t.h) continue;
      best = Math.max(best, t.w * (y - t.y) / t.h);
    }
    return best;
  }

  function build() {
    const size = Math.min(W * 0.9, H * 0.78);
    const cx = W / 2;
    const base = H * 0.88;
    const top = base - size * 0.92;
    const width = size * 0.42;
    const tiers = [];
    for (let i = 0; i < 5; i++) {
      tiers.push({ y: top + (i / 5) * (base - top) * 0.82, h: (base - top) * (0.30 + i * 0.03), w: width * (0.38 + i * 0.16) });
    }
    tree = { cx, top, base, size, tiers };

    baubles = [];
    const count = Math.round(size / 18);
    let tries = 0;
    while (baubles.length < count && tries++ < 4000) {
      const y = rand(top + size * 0.12, base - size * 0.06);
      const hw = halfWidthAt(y) * 0.86;
      if (hw < 8) continue;
      const x = cx + rand(-hw, hw);
      const r = rand(size * 0.014, size * 0.024);
      if (baubles.some((b) => Math.hypot(b.x - x, b.y - y) < (b.r + r) * 2.2)) continue;
      baubles.push({ x, y, r, color: BAUBLE_COLORS[baubles.length % BAUBLE_COLORS.length], phase: rand(0, Math.PI * 2) });
    }

    garlands = [];
    for (let i = 0; i < 5; i++) {
      const y0 = top + size * (0.2 + i * 0.15);
      const y1 = y0 + size * 0.06;
      const hw0 = halfWidthAt(y0) * 0.95, hw1 = halfWidthAt(y1) * 0.95;
      const dir = i % 2 ? 1 : -1;
      const a = { x: cx + dir * hw0, y: y0 }, b = { x: cx - dir * hw1, y: y1 };
      const points = [];
      for (let k = 0; k <= 40; k++) {
        const t = k / 40;
        points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * size * 0.04 });
      }
      const bulbs = [];
      for (let k = 2; k <= 38; k += 4) {
        bulbs.push({ x: points[k].x, y: points[k].y, color: BULB_COLORS[(k / 4 + i) % BULB_COLORS.length | 0], phase: rand(0, Math.PI * 2) });
      }
      garlands.push({ points, bulbs });
    }

    gifts = [];
    const gw = size * 0.11;
    const palette = [["#c1121f", "#ffd166"], ["#1d3557", "#e9c46a"], ["#2a9d8f", "#f1faee"], ["#7b2cbf", "#ffafcc"], ["#e76f51", "#264653"]];
    [-1.9, -0.95, 0.15, 1.05, 2.0].forEach((o, i) => {
      const w = gw * rand(0.8, 1.15), h = gw * rand(0.6, 0.95);
      gifts.push({ x: cx + o * gw * 0.95 - w / 2, y: base + size * 0.045 - h, w, h, box: palette[i][0], ribbon: palette[i][1] });
    });

    stars = [];
    for (let i = 0; i < 140; i++) stars.push({ x: rand(0, W), y: rand(0, H * 0.7), r: rand(0.3, 1.3), phase: rand(0, 6.3) });
  }

  function updateSnow(dt, time) {
    const wanted = Math.round(W * H / 6000);
    while (flakes.length < wanted) {
      flakes.push({ x: rand(-20, W + 20), y: rand(-H, H), r: rand(0.8, 3.2), vy: rand(20, 55), drift: rand(0.4, 1.6), phase: rand(0, 6.3) });
    }
    if (flakes.length > wanted) flakes.length = wanted;
    const wind = Math.sin(time * 0.3) * 18;
    for (const f of flakes) {
      f.y += f.vy * dt;
      f.x += (Math.sin(time * f.drift + f.phase) * 12 + wind) * dt;
      if (f.y > H + 10 || f.x < -40 || f.x > W + 40) { f.y = rand(-40, -5); f.x = rand(-20, W + 20); }
    }
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
  }

  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  // The Commodore C= logo on a white tag (a 130 x 122 drawing), see assets/commodore-logo-credit.txt.
  let logoC = null, logoFlagTop = null, logoFlagBottom = null;

  function drawLogoTag(x, y, size) {
    if (!logoC) {
      logoC = new Path2D("m 77.999911,88.1109 v 31.4724 a 61,61 0 1 1 0,-117.1666 v 31.4724 a 32,32 0 1 0 0,54.2218");
      logoFlagTop = new Path2D("M 106,58 130,34 78,34 78,58 Z");
      logoFlagBottom = new Path2D("M 106,64 130,88 78,88 78,64 Z");
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, size * 0.72, 0, Math.PI * 2);
    ctx.fill();
    const scale = size / 130;
    ctx.save();
    ctx.translate(x - (130 * scale) / 2, y - (122 * scale) / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#002255";
    ctx.fill(logoC);
    ctx.fill(logoFlagTop);
    ctx.fillStyle = "#ff0000";
    ctx.fill(logoFlagBottom);
    ctx.restore();
  }

  function star4(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.18, y - r * 0.18); ctx.lineTo(x + r, y); ctx.lineTo(x + r * 0.18, y + r * 0.18);
    ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.18, y + r * 0.18); ctx.lineTo(x - r, y); ctx.lineTo(x - r * 0.18, y - r * 0.18);
    ctx.closePath();
    ctx.fill();
  }

  function draw(time) {
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#050816"); sky.addColorStop(0.6, "#121a3a"); sky.addColorStop(1, "#1b2550");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 1.7 + s.phase));
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ground
    const { cx, base, size } = tree;
    const gy = base + size * 0.03;
    const ground = ctx.createLinearGradient(0, gy - 20, 0, H);
    ground.addColorStop(0, "#e8f0ff"); ground.addColorStop(1, "#b8c6e8");
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(0, gy + 18);
    ctx.bezierCurveTo(W * 0.3, gy - 14, W * 0.7, gy + 26, W, gy + 4);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    // trunk and tiers
    const tw = size * 0.07, th = size * 0.08;
    const trunk = ctx.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0);
    trunk.addColorStop(0, "#4a2c17"); trunk.addColorStop(0.5, "#7a4a28"); trunk.addColorStop(1, "#3d2312");
    ctx.fillStyle = trunk;
    ctx.fillRect(cx - tw / 2, base - th * 0.3, tw, th);
    tree.tiers.forEach((t, i) => {
      const sway = Math.sin(time * 0.9 + i * 0.6) * (1.5 + i * 0.4);
      const g = ctx.createLinearGradient(cx - t.w, 0, cx + t.w, 0);
      g.addColorStop(0, "#0b3d20"); g.addColorStop(0.45, "#1f7a3a"); g.addColorStop(0.55, "#23893f"); g.addColorStop(1, "#0a3219");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, t.y);
      const tips = 6 + i * 2;
      ctx.lineTo(cx + t.w + sway, t.y + t.h);
      for (let k = tips; k >= 0; k--) {
        ctx.lineTo(cx - t.w + (2 * t.w * k) / tips + sway, t.y + t.h - (k % 2 ? size * 0.018 : 0));
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      for (let k = 0; k <= tips; k += 2) {
        ctx.beginPath();
        ctx.ellipse(cx - t.w + (2 * t.w * k) / tips + sway, t.y + t.h - size * 0.004, size * 0.016, size * 0.006, 0, Math.PI, 0);
        ctx.fill();
      }
    });

    // garlands with chasing lights
    for (const gl of garlands) {
      ctx.strokeStyle = "rgba(20,20,20,0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      gl.points.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      for (const b of gl.bulbs) {
        const glow = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time * 4 - b.x * 0.05 + b.phase));
        const r = size * 0.008;
        const halo = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 5);
        halo.addColorStop(0, hexA(b.color, 0.55 * glow)); halo.addColorStop(1, hexA(b.color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(b.x, b.y, r * 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hexA(b.color, 0.45 + 0.55 * glow);
        ctx.beginPath(); ctx.ellipse(b.x, b.y + r * 0.4, r * 0.8, r * 1.2, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    // swinging baubles with a glint
    for (const b of baubles) {
      const swing = Math.sin(time * 1.6 + b.phase) * 0.12;
      const hx = b.x, hy = b.y - b.r * 1.6;
      const x = hx + Math.sin(swing) * b.r * 1.6, y = hy + Math.cos(swing) * b.r * 1.6;
      ctx.strokeStyle = "rgba(230,230,230,0.6)";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(x, y - b.r); ctx.stroke();
      ctx.fillStyle = "#c9c9c9";
      ctx.fillRect(x - b.r * 0.25, y - b.r * 1.15, b.r * 0.5, b.r * 0.3);
      const g = ctx.createRadialGradient(x - b.r * 0.35, y - b.r * 0.35, b.r * 0.1, x, y, b.r);
      g.addColorStop(0, "#ffffff"); g.addColorStop(0.25, b.color); g.addColorStop(1, shade(b.color, -0.55));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, b.r, 0, Math.PI * 2); ctx.fill();
      const glint = Math.max(0, Math.sin(time * 2.2 + b.phase * 3)) ** 8;
      if (glint > 0.02) {
        ctx.globalAlpha = glint;
        ctx.fillStyle = "#fff";
        star4(x - b.r * 0.4, y - b.r * 0.45, b.r * 0.9);
        ctx.globalAlpha = 1;
      }
    }

    // the star on top: glow, slow rays, the star itself
    const sx = cx, sy = tree.top - size * 0.015, R = size * 0.055;
    const pulse = 0.85 + 0.15 * Math.sin(time * 2.4);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 4 * pulse);
    glow.addColorStop(0, "rgba(255,230,120,0.55)"); glow.addColorStop(1, "rgba(255,230,120,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, R * 4 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(time * 0.25);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      const ray = ctx.createLinearGradient(0, 0, R * 3.2, 0);
      ray.addColorStop(0, "rgba(255,240,170,0.35)"); ray.addColorStop(1, "rgba(255,240,170,0)");
      ctx.fillStyle = ray;
      ctx.beginPath(); ctx.moveTo(0, -R * 0.08); ctx.lineTo(R * 3.2 * pulse, 0); ctx.lineTo(0, R * 0.08); ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.sin(time * 0.8) * 0.08);
    const sg = ctx.createRadialGradient(0, -R * 0.2, R * 0.1, 0, 0, R);
    sg.addColorStop(0, "#fffbe0"); sg.addColorStop(0.5, "#ffd23f"); sg.addColorStop(1, "#e09f00");
    ctx.fillStyle = sg;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? R * 0.45 : R;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // gifts
    for (const g of gifts) {
      const grad = ctx.createLinearGradient(g.x, g.y, g.x + g.w, g.y + g.h);
      grad.addColorStop(0, shade(g.box, 0.15)); grad.addColorStop(1, shade(g.box, -0.35));
      ctx.fillStyle = grad;
      ctx.fillRect(g.x, g.y, g.w, g.h);
      ctx.fillStyle = g.ribbon;
      ctx.fillRect(g.x + g.w * 0.44, g.y, g.w * 0.12, g.h);
      ctx.fillRect(g.x, g.y + g.h * 0.4, g.w, g.h * 0.14);
      const bx = g.x + g.w / 2;
      ctx.beginPath();
      ctx.ellipse(bx - g.w * 0.13, g.y - g.h * 0.08, g.w * 0.14, g.h * 0.09, -0.5, 0, Math.PI * 2);
      ctx.ellipse(bx + g.w * 0.13, g.y - g.h * 0.08, g.w * 0.14, g.h * 0.09, 0.5, 0, Math.PI * 2);
      ctx.fill();
      drawLogoTag(bx, g.y + g.h * 0.47, Math.min(g.w, g.h) * 0.5);
    }

    // the greeting, on the snow under the gifts
    const textY = (base + size * 0.045 + H) / 2;
    const textPx = Math.round(Math.min(W * 0.055, (H - base - size * 0.045) * 0.72));
    ctx.font = `700 ${textPx}px "VA Christmas", cursive`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, textPx * 0.09);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.strokeText(GREETING, cx, textY);
    ctx.fillStyle = "#b3122a";
    ctx.fillText(GREETING, cx, textY);

    // snow in front of everything
    ctx.fillStyle = "#fff";
    for (const f of flakes) {
      ctx.globalAlpha = 0.5 + f.r / 6.4;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    raf = 0;
    if (!shown || document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const time = (now - start) / 1000;
    updateSnow(dt, time);
    draw(time);
    raf = requestAnimationFrame(frame);
  }

  function run() {
    if (!raf && shown && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function syncButton() {
    const btn = document.getElementById("xmas-toggle-btn");
    if (!btn) return;
    btn.hidden = !(shown || isChristmas(new Date()));
    btn.classList.toggle("main-tb-btn--active", shown);
    btn.setAttribute("aria-pressed", String(shown));
  }

  function toggle() {
    override = !shown;
    saveHidden(!override);
    apply();
  }

  function apply() {
    const want = override !== null ? override : isChristmas(new Date());
    if (want === shown) { syncButton(); return; }
    shown = want;
    if (shown) {
      ensureCanvas();
      canvas.hidden = false;
      document.body.classList.add("xmas-on");
      // the canvas does not ask for a font by itself
      document.fonts?.load('700 48px "VA Christmas"').catch(function () {});
      if (!start) start = performance.now();
      resize();
      run();
    } else if (canvas) {
      canvas.hidden = true;
      document.body.classList.remove("xmas-on");
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    syncButton();
  }

  window.addEventListener("keydown", function (e) {
    if (e.code !== "KeyX" || !e.ctrlKey || !e.altKey || !e.shiftKey || e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }, true);
  window.addEventListener("resize", function () { if (shown) resize(); });
  document.addEventListener("visibilitychange", run);
  // an app left open over midnight on the 23rd or the 26th
  setInterval(apply, 60000);

  function init() {
    document.getElementById("xmas-toggle-btn")?.addEventListener("click", toggle);
    apply();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // for the tests
  window.__vaXmas = { isChristmas, isShown: () => shown };
})();
