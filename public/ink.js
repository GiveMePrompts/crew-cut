/* ink.js - Crew Cut live background.
 * Stable-fluids ink in deep ultramarine water, adapted from the GiveMePrompts Lab "Fluid ink" piece.
 * Velocity + pressure on a coarse grid, dye on a finer grid with limited MacCormack advection.
 * Usage: const ink = CrewInk.mount(canvasEl, { quality: 'tv' | 'phone' });
 *        ink.drop(x, y, 'hot' | 'tape' | 'ultra' | 'cyan', power)  // x,y in 0..1, origin top-left
 *        ink.burst()   ink.stir(on)
 * Falls back to a static CSS gradient when WebGL2 float targets are missing or ?ink=0 is set.
 */
(function () {
  'use strict';
  const HEAD = '#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n';
  const VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

  const SPLAT = HEAD + `in vec2 vUv; out vec4 o;
uniform sampler2D uTarget; uniform vec2 uPoint, uDir; uniform vec3 uColor; uniform float uRad, uAsp, uStr, uDye;
void main(){
  vec2 p = (vUv - uPoint) * vec2(uAsp, 1.0);
  vec2 d = normalize(uDir + vec2(1e-5, 0.0));
  float a = dot(p, d), b = dot(p, vec2(-d.y, d.x));
  float g = exp(-(a * a / uStr + b * b) / uRad);
  vec4 base = texture(uTarget, vUv);
  if (uDye > 0.5) o = vec4(base.rgb + uColor * g, base.a + (uColor.r + uColor.g + uColor.b) * 0.3333 * g);
  else o = vec4(base.xyz + uColor * g, 1.0);
}`;
  const CURL = HEAD + `in vec2 vUv; out vec4 o; uniform sampler2D uVel; uniform vec2 uTexel;
void main(){ float L = texture(uVel, vUv - vec2(uTexel.x,0.)).y, R = texture(uVel, vUv + vec2(uTexel.x,0.)).y, T = texture(uVel, vUv + vec2(0.,uTexel.y)).x, B = texture(uVel, vUv - vec2(0.,uTexel.y)).x; o = vec4(0.5*(R-L-T+B),0.,0.,1.); }`;
  const VORT = HEAD + `in vec2 vUv; out vec4 o; uniform sampler2D uVel, uCurl; uniform vec2 uTexel; uniform float uCurlK, uDt;
void main(){ float L = texture(uCurl, vUv - vec2(uTexel.x,0.)).x, R = texture(uCurl, vUv + vec2(uTexel.x,0.)).x, T = texture(uCurl, vUv + vec2(0.,uTexel.y)).x, B = texture(uCurl, vUv - vec2(0.,uTexel.y)).x, C = texture(uCurl, vUv).x;
  vec2 f = 0.5*vec2(abs(T)-abs(B), abs(R)-abs(L)); f /= length(f)+1e-4; f *= uCurlK*C; f.y *= -1.;
  o = vec4(clamp(texture(uVel, vUv).xy + f*uDt, vec2(-1500.), vec2(1500.)), 0., 1.); }`;
  const DIV = HEAD + `in vec2 vUv; out vec4 o; uniform sampler2D uVel; uniform vec2 uTexel;
void main(){ float L = texture(uVel, vUv - vec2(uTexel.x,0.)).x, R = texture(uVel, vUv + vec2(uTexel.x,0.)).x, T = texture(uVel, vUv + vec2(0.,uTexel.y)).y, B = texture(uVel, vUv - vec2(0.,uTexel.y)).y; vec2 c = texture(uVel, vUv).xy;
  if (vUv.x - uTexel.x < 0.) L = -c.x; if (vUv.x + uTexel.x > 1.) R = -c.x; if (vUv.y + uTexel.y > 1.) T = -c.y; if (vUv.y - uTexel.y < 0.) B = -c.y;
  o = vec4(0.5*(R-L+T-B),0.,0.,1.); }`;
  const PRES = HEAD + `in vec2 vUv; out vec4 o; uniform sampler2D uP, uDiv; uniform vec2 uTexel;
void main(){ float L = texture(uP, vUv - vec2(uTexel.x,0.)).x, R = texture(uP, vUv + vec2(uTexel.x,0.)).x, T = texture(uP, vUv + vec2(0.,uTexel.y)).x, B = texture(uP, vUv - vec2(0.,uTexel.y)).x; o = vec4((L+R+B+T-texture(uDiv, vUv).x)*0.25,0.,0.,1.); }`;
  const GRAD = HEAD + `in vec2 vUv; out vec4 o; uniform sampler2D uP, uVel; uniform vec2 uTexel;
void main(){ float L = texture(uP, vUv - vec2(uTexel.x,0.)).x, R = texture(uP, vUv + vec2(uTexel.x,0.)).x, T = texture(uP, vUv + vec2(0.,uTexel.y)).x, B = texture(uP, vUv - vec2(0.,uTexel.y)).x; o = vec4(texture(uVel, vUv).xy - vec2(R-L, T-B), 0., 1.); }`;
  const SCALE = HEAD + `in vec2 vUv; out vec4 o; uniform sampler2D uTex; uniform float uK; void main(){ o = vec4(texture(uTex, vUv).xyz*uK, 1.); }`;
  const ADV = HEAD + `in vec2 vUv; out vec4 o; uniform sampler2D uVel, uSrc; uniform vec2 uVelTexel; uniform float uDt, uSign, uK;
void main(){ vec2 v = texture(uVel, vUv).xy; o = texture(uSrc, vUv - uSign*uDt*v*uVelTexel)*uK; }`;
  const MAC = HEAD + `in vec2 vUv; out vec4 o; uniform sampler2D uVel, uOrig, uFwd, uBack; uniform vec2 uVelTexel, uTexel; uniform float uDt, uDecay, uThin, uThinTo;
void main(){ vec2 c = vUv - uDt*texture(uVel, vUv).xy*uVelTexel; vec4 f = texture(uFwd, vUv), b = texture(uBack, vUv);
  vec4 s0 = texture(uOrig, c+vec2(-uTexel.x,0.)), s1 = texture(uOrig, c+vec2(uTexel.x,0.)), s2 = texture(uOrig, c+vec2(0.,-uTexel.y)), s3 = texture(uOrig, c+vec2(0.,uTexel.y));
  vec4 r = clamp(f + 0.5*(texture(uOrig, vUv)-b), min(min(s0,s1),min(s2,s3)), max(max(s0,s1),max(s2,s3)));
  float k = uDecay - uThin*(1.-smoothstep(0.004, uThinTo, max(r.a,0.))); o = max(r*k, vec4(0.)); }`;
  const BLUR = HEAD + `in vec2 vUv; out vec4 o; uniform sampler2D uTex; uniform vec2 uDir;
void main(){ vec4 s = texture(uTex, vUv)*0.2270270270; s += (texture(uTex, vUv+uDir*1.3846153846)+texture(uTex, vUv-uDir*1.3846153846))*0.3162162162; s += (texture(uTex, vUv+uDir*3.2307692308)+texture(uTex, vUv-uDir*3.2307692308))*0.0702702703; o = s; }`;
  /* display: hue-preserving pigment over deep ultramarine water, edge light + bloom, vignette, grain */
  const SHOW = HEAD + `in vec2 vUv; out vec4 o;
uniform sampler2D uDye, uBlur; uniform vec2 uTexel; uniform vec3 uBase; uniform float uTime, uExposure, uBloom, uAsp;
float h21(vec2 p){ p = fract(p*vec2(233.34,851.73)); p += dot(p, p+23.45); return fract(p.x*p.y); }
void main(){
  vec4 D = texture(uDye, vUv); vec3 pig = max(D.rgb, 0.); float d = max(D.a - 0.05, 1e-5);
  float m = max(max(pig.r,pig.g),pig.b)+1e-5; vec3 hue = pow(pig/m, vec3(1.35)); hue /= max(max(hue.r,hue.g),hue.b)+1e-5;
  float body = 1. - exp(-d*1.15), core = smoothstep(0.55, 3., d), lum = body*(1.-0.45*core);
  float dL = texture(uDye, vUv-vec2(uTexel.x,0.)).a, dR = texture(uDye, vUv+vec2(uTexel.x,0.)).a, dB = texture(uDye, vUv-vec2(0.,uTexel.y)).a, dT = texture(uDye, vUv+vec2(0.,uTexel.y)).a;
  float edge = clamp(length(vec2(dR-dL, dT-dB))*5., 0., 1.);
  vec3 col = hue*lum*1.05 + hue*edge*0.55*smoothstep(0.02, 0.4, body);
  vec4 B = texture(uBlur, vUv); vec3 bh = max(B.rgb,0.); col += (bh/(max(max(bh.r,bh.g),bh.b)+1e-5))*(1.-exp(-B.a*0.9))*uBloom;
  col *= uExposure;
  vec2 c = vUv-0.5; c.x *= uAsp; float vig = smoothstep(1.25, 0.25, length(c));
  vec3 water = uBase*(0.55 + 0.45*vig);
  vec3 outc = water + col*vig;
  outc += (h21(gl_FragCoord.xy + uTime*61.)-0.5)*(1.6/255.);
  o = vec4(max(outc, 0.), 1.);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function Prog(gl, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.p = p; this.gl = gl; this.c = {};
  }
  Prog.prototype.loc = function (n) { if (!(n in this.c)) this.c[n] = this.gl.getUniformLocation(this.p, n); return this.c[n]; };
  function rt(gl, w, h, fmt) {
    const F = { rgba: [gl.RGBA16F, gl.RGBA], rg: [gl.RG16F, gl.RG], r: [gl.R16F, gl.RED] }[fmt];
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, F[0], w, h, 0, F[1], gl.HALF_FLOAT, null);
    const f = fmt === 'r' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo');
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h, texel: [1 / w, 1 / h] };
  }
  function ping(gl, w, h, fmt) { let a = rt(gl, w, h, fmt), b = rt(gl, w, h, fmt); return { texel: a.texel, get read() { return a; }, get write() { return b; }, swap() { const t = a; a = b; b = t; } }; }
  function pass(gl, prog, uni, target) {
    gl.useProgram(prog.p); let unit = 0;
    for (const k in uni) {
      const v = uni[k], loc = prog.loc(k); if (loc === null) continue;
      if (v instanceof WebGLTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v); gl.uniform1i(loc, unit++); }
      else if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else gl.uniform3f(loc, v[0], v[1], v[2]);
    }
    if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.viewport(0, 0, target.w, target.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function hsv(h, s, v) { h = ((h % 1) + 1) % 1; const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; }

  // Crew Cut palette as ink hues
  const HUES = { ultra: 0.66, hot: 0.935, tape: 0.125, cyan: 0.52 };
  const KEYS = Object.keys(HUES);
  const BASE = [0.035, 0.04, 0.2]; // deep ultramarine water

  function mount(canvas, opts) {
    opts = opts || {};
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const off = /[?&]ink=0/.test(location.search);
    const api = { ok: false, drop() {}, burst() {}, stir() {} };
    if (off) { canvas.classList.add('ink-fallback'); return api; }
    let gl;
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('no float targets');
      gl.getExtension('OES_texture_float_linear');
    } catch (e) { canvas.classList.add('ink-fallback'); return api; }

    const phone = opts.quality === 'phone';
    const P = { curl: 24, velDiss: 0.35, presK: 0.8, iters: phone ? 14 : 20, decay: 0.9965, thin: 0.0062, thinTo: 0.3 };
    let pr, vel, pres, div, curl, dye, t1, t2, b1, b2, asp = 1, vw = 1, vh = 1, bw = 1, bh = 1, ambient = true;
    let rs = (Date.now() & 0xffff) | 1;
    const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };

    function build() {
      const dpr = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2);
      let cw = Math.max(2, Math.round(canvas.clientWidth * dpr)), ch = Math.max(2, Math.round(canvas.clientHeight * dpr));
      const cap = phone ? 1100 : 1920, m = Math.max(cw, ch); if (m > cap) { const k = cap / m; cw = Math.round(cw * k); ch = Math.round(ch * k); }
      canvas.width = cw; canvas.height = ch; asp = cw / ch;
      const vS = phone ? 64 : 112, dS = phone ? 300 : 560;
      vh = vS; vw = Math.round(vS * asp); const dh = dS, dw = Math.round(dS * asp);
      if (!pr) pr = { splat: new Prog(gl, SPLAT), curl: new Prog(gl, CURL), vort: new Prog(gl, VORT), div: new Prog(gl, DIV), pres: new Prog(gl, PRES), grad: new Prog(gl, GRAD), scale: new Prog(gl, SCALE), adv: new Prog(gl, ADV), mac: new Prog(gl, MAC), blur: new Prog(gl, BLUR), show: new Prog(gl, SHOW) };
      vel = ping(gl, vw, vh, 'rg'); pres = ping(gl, vw, vh, 'r'); div = rt(gl, vw, vh, 'r'); curl = rt(gl, vw, vh, 'r');
      dye = ping(gl, dw, dh, 'rgba'); t1 = rt(gl, dw, dh, 'rgba'); t2 = rt(gl, dw, dh, 'rgba');
      bw = Math.max(2, Math.round(cw / 6)); bh = Math.max(2, Math.round(ch / 6)); b1 = rt(gl, bw, bh, 'rgba'); b2 = rt(gl, bw, bh, 'rgba');
      seed();
    }
    function splatVel(x, y, vx, vy, rad, str) { const l = Math.hypot(vx, vy) || 1; pass(gl, pr.splat, { uTarget: vel.read.tex, uPoint: [x, y], uDir: [vx / l, vy / l], uColor: [vx, vy, 0], uRad: rad, uAsp: asp, uStr: str || 1, uDye: 0 }, vel.write); vel.swap(); }
    function splatDye(x, y, rgb, rad, dx, dy, str) { pass(gl, pr.splat, { uTarget: dye.read.tex, uPoint: [x, y], uDir: [dx || 0, dy || -1], uColor: rgb, uRad: rad, uAsp: asp, uStr: str || 1, uDye: 1 }, dye.write); dye.swap(); }
    const rgbFor = (h, k) => hsv(h, 0.95, 1).map((v) => v * k * 2.7);
    function step(dt) {
      const vt = vel.read.texel;
      pass(gl, pr.curl, { uVel: vel.read.tex, uTexel: vt }, curl);
      pass(gl, pr.vort, { uVel: vel.read.tex, uCurl: curl.tex, uTexel: vt, uCurlK: P.curl, uDt: dt }, vel.write); vel.swap();
      pass(gl, pr.div, { uVel: vel.read.tex, uTexel: vt }, div);
      pass(gl, pr.scale, { uTex: pres.read.tex, uK: P.presK }, pres.write); pres.swap();
      for (let i = 0; i < P.iters; i++) { pass(gl, pr.pres, { uP: pres.read.tex, uDiv: div.tex, uTexel: vt }, pres.write); pres.swap(); }
      pass(gl, pr.grad, { uP: pres.read.tex, uVel: vel.read.tex, uTexel: vt }, vel.write); vel.swap();
      pass(gl, pr.adv, { uVel: vel.read.tex, uSrc: vel.read.tex, uVelTexel: vt, uDt: dt, uSign: 1, uK: 1 / (1 + P.velDiss * dt) }, vel.write); vel.swap();
      pass(gl, pr.adv, { uVel: vel.read.tex, uSrc: dye.read.tex, uVelTexel: vt, uDt: dt, uSign: 1, uK: 1 }, t1);
      pass(gl, pr.adv, { uVel: vel.read.tex, uSrc: t1.tex, uVelTexel: vt, uDt: dt, uSign: -1, uK: 1 }, t2);
      pass(gl, pr.mac, { uVel: vel.read.tex, uOrig: dye.read.tex, uFwd: t1.tex, uBack: t2.tex, uVelTexel: vt, uTexel: dye.read.texel, uDt: dt, uDecay: P.decay, uThin: P.thin, uThinTo: P.thinTo }, dye.write); dye.swap();
    }
    function paint(t) {
      pass(gl, pr.blur, { uTex: dye.read.tex, uDir: [1.6 / bw, 0] }, b1); pass(gl, pr.blur, { uTex: b1.tex, uDir: [0, 1.6 / bh] }, b2);
      pass(gl, pr.blur, { uTex: b2.tex, uDir: [2.6 / bw, 0] }, b1); pass(gl, pr.blur, { uTex: b1.tex, uDir: [0, 2.6 / bh] }, b2);
      pass(gl, pr.show, { uDye: dye.read.tex, uBlur: b2.tex, uTexel: dye.read.texel, uBase: BASE, uTime: t, uExposure: opts.exposure || 0.92, uBloom: 0.4, uAsp: asp }, null);
    }
    function drop(x, y, key, power) {
      if (!pr) return;
      const s = power == null ? 0.7 : power, h = HUES[key] != null ? HUES[key] : HUES[KEYS[Math.floor(rnd() * 4)]];
      const ang = rnd() * Math.PI * 2, dx = Math.cos(ang), dy = Math.sin(ang), r = 0.004 + 0.003 * s;
      const yy = 1 - y; // callers use top-left origin
      splatDye(x, yy, rgbFor(h + (rnd() - 0.5) * 0.03, 0.42 + 0.6 * s), r, dx, dy, 3);
      splatVel(x, yy, dx * (120 + 300 * s), dy * (120 + 300 * s), r * 1.6, 3);
      if (reduced) { for (let i = 0; i < 90; i++) step(1 / 60); paint(0); }
    }
    function seed() {
      [[0.25, 0.4, 'ultra'], [0.72, 0.3, 'hot'], [0.55, 0.72, 'tape'], [0.35, 0.78, 'cyan'], [0.82, 0.68, 'ultra']].forEach((p) => drop(p[0], p[1], p[2], 0.6));
      for (let i = 0; i < (phone ? 120 : 200); i++) step(1 / 60);
      paint(0);
    }
    api.drop = drop;
    api.burst = () => { for (let i = 0; i < 7; i++) drop(0.12 + rnd() * 0.76, 0.15 + rnd() * 0.7, KEYS[i % 4], 0.9); };
    api.stir = (on) => { ambient = on !== false; };

    // touch to stir (phones + TV mouse). Ignores taps that land on UI.
    let down = false, lx = 0, ly = 0, lt = 0;
    const target = opts.pointerTarget || canvas;
    const uvOf = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    target.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('button,a,input,label,video,.no-ink')) return; down = true; const p = uvOf(e); lx = p[0]; ly = p[1]; lt = performance.now(); drop(p[0], p[1], null, 0.55); });
    target.addEventListener('pointermove', (e) => {
      if (!down || !pr) return; const now = performance.now(), p = uvOf(e), dt = Math.max(8, now - lt) / 1000;
      const vx = (p[0] - lx) / dt, vy = -(p[1] - ly) / dt, sp = Math.hypot(vx, vy);
      if (sp > 0.02) { const t = Math.min(sp * vh, 700); splatVel(p[0], 1 - p[1], (vx / sp) * t, (vy / sp) * t, 0.0018, 4); splatDye(p[0], 1 - p[1], rgbFor(HUES[KEYS[Math.floor(now / 900) % 4]], 0.12), 0.0009, vx / sp, vy / sp, 4); }
      lx = p[0]; ly = p[1]; lt = now;
    });
    addEventListener('pointerup', () => (down = false)); addEventListener('pointercancel', () => (down = false));

    try { build(); } catch (e) { canvas.classList.add('ink-fallback'); return api; }
    api.ok = true;
    let rsz; addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { try { build(); } catch (_) {} }, 200); }, { passive: true });
    if (reduced) return api;
    let acc = 0, prev = performance.now(), nextAmb = prev + 1200;
    (function frame(now) {
      requestAnimationFrame(frame);
      if (document.hidden) { prev = now; return; }
      acc += Math.min((now - prev) / 1000, 0.05); prev = now;
      let n = 0; while (acc >= 1 / 60 && n < 2) { step(1 / 60); acc -= 1 / 60; n++; } if (n === 2) acc = 0;
      if (ambient && now > nextAmb) { const a = rnd() * 6.283, r = 0.1 + rnd() * 0.35; drop(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r * 0.8, KEYS[Math.floor(rnd() * 4)], 0.35 + rnd() * 0.35); nextAmb = now + 1600 + rnd() * 2200; }
      paint(now / 1000);
    })(prev);
    return api;
  }
  window.CrewInk = { mount, colors: KEYS };
})();
