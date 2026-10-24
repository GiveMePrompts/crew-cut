// Shared helpers for TV and phones.
window.CC = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  }
  const INK = { tape: 'tape', hot: 'hot', cyan: 'cyan', lilac: 'ultra' };
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };
  // tiny synthesized sound effects (no files)
  let ac = null;
  const audio = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; } catch { return null; } };
  addEventListener('pointerdown', audio, { once: true });
  function noise(ctx, dur, gain, hp) {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
    const s = ctx.createBufferSource(); s.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = ctx.createGain(); g.gain.value = gain; s.connect(f).connect(g).connect(ctx.destination); s.start();
  }
  function tone(ctx, freq, dur, gain, type = 'triangle', when = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq;
    const t = ctx.currentTime + when; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  const sfx = {
    clap() { const c = audio(); if (c) { noise(c, 0.09, 0.9, 1800); tone(c, 180, 0.08, 0.25, 'square'); } },
    pop() { const c = audio(); if (c) tone(c, 660, 0.12, 0.18); },
    ding() { const c = audio(); if (c) { tone(c, 880, 0.25, 0.14); tone(c, 1320, 0.35, 0.1, 'triangle', 0.08); } },
    fanfare() { const c = audio(); if (c) [523, 659, 784, 1047].forEach((f, i) => tone(c, f, 0.35, 0.12, 'triangle', i * 0.11)); },
  };
  function qrSvg(text, px = 8) {
    if (!window.qrcode) return '';
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: px, margin: 2, scalable: true });
  }
  function countdown(deadline, serverNow) { // seconds left, corrected for clock skew
    const skew = serverNow ? Date.now() - serverNow : 0;
    return Math.max(0, Math.ceil((deadline - (Date.now() - skew)) / 1000));
  }
  return { $, $$, esc, api, INK, store, sfx, qrSvg, countdown };
})();
