const { $, $$, esc, api, INK, store, sfx, countdown } = CC;
const ink = CrewInk.mount($('#ink'), { quality: 'phone', pointerTarget: document.body, exposure: 0.8 });
let S = null, me = store.get('cc_me'), key = '', tick = null, es = null, lastEvent = 0;
let ui = { pick: null, voted: false, selfie: null, consent: false }; // pick: null | 'presets' | 'selfie'

const mine = () => S && S.players.find((p) => p.id === me.pid);
const player = (id) => S.players.find((p) => p.id === id);
const imgOf = (p, cls = '') => (p && p.char && p.char.url ? `<img class="${p.char.cutout ? '' : 'square'} ${cls}" src="${esc(p.char.url)}" alt="${esc(p.name)}">` : '');
const avatar = (p) => (p && p.char && p.char.url ? `<img class="avatar c-${p.color}" src="${esc(p.char.url)}" alt="">` : `<span class="avatar c-${p ? p.color : 'tape'}"></span>`);
function showErr(msg) { const e = $('#err'); if (e) { e.textContent = msg; e.classList.remove('hidden'); } else alert(msg); }
function guard(fn) { return async (ev) => { const b = ev && ev.currentTarget; if (b) b.disabled = true; try { await fn(ev); } catch (e) { showErr(e.message); } finally { if (b) b.disabled = false; } }; }

// ---------- join ----------
function joinForm() {
  const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
  $('#view').innerHTML = `<div class="stack rise">
    <h2>Join the crew</h2><p class="lead">Your face. Your scenes. One movie.</p>
    <label class="f">Room code<input class="field codein" id="code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(code)}" placeholder="····"></label>
    <label class="f">Your name in the credits<input class="field" id="name" maxlength="14" autocomplete="nickname" placeholder="Supreme"></label>
    <div id="err" class="err hidden"></div>
    <button class="btn wide" id="go">I’m in</button></div>`;
  $(code ? '#name' : '#code').focus();
  $('#go').onclick = guard(async () => {
    const body = { code: $('#code').value.trim().toUpperCase(), name: $('#name').value };
    const { pid } = await api('/api/join', body);
    me = { pid, code: body.code, name: body.name.trim() };
    store.set('cc_me', me); connect();
  });
}

function squareJpeg(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height); const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src); resolve(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = reject; img.src = URL.createObjectURL(file);
  });
}

// ---------- live ----------
async function connect() {
  if (!(await fetch(`/exists?code=${me.code}`).then((r) => r.ok).catch(() => true))) { store.del('cc_me'); me = null; return joinForm(); }
  $('#who').textContent = me.name; $('#who').classList.remove('hidden');
  if (es) es.close();
  es = new EventSource(`/events?code=${me.code}&pid=${me.pid}`);
  es.onmessage = (e) => {
    S = JSON.parse(e.data);
    if (!mine()) { es.close(); store.del('cc_me'); me = null; key = ''; $('#who').classList.add('hidden'); return joinForm(); }
    onEvent(S.event); render();
  };
}
function onEvent(ev) {
  if (!ev || ev.seq <= lastEvent) return;
  const first = lastEvent === 0; lastEvent = ev.seq; if (first) return;
  const m = mine();
  if (ev.type === 'charReady' && ev.pid === me.pid) { ink.burst(); sfx.ding(); if (navigator.vibrate) navigator.vibrate(60); }
  if (ev.type === 'start' || ev.type === 'lock') { ink.drop(0.5, 0.4, INK[m.color], 1); }
  if (ev.type === 'premiere' || ev.type === 'results') ink.burst();
}

function render() {
  const m = mine(); const c = m.char;
  const isDir = S.phase === 'directing' && S.director && S.director.id === me.pid;
  $('#who').className = `tape c-${m.color}`; $('#who').style.background = 'var(--c)';
  let k;
  if (S.phase === 'lobby') {
    if (!c || ui.pick) k = `pick|${ui.pick}|${S.presets.map((p) => p.taken).join()}|${!!ui.selfie}`;
    else if (c.status === 'queued' || c.status === 'making') k = 'making';
    else if (c.status === 'failed') k = 'failed';
    else if (!c.accepted) k = `reveal|${c.url}|${c.rerollsLeft}`;
    else k = `ready|${c.url}`;
  } else k = [S.phase, S.sceneIndex, isDir, S.phase === 'voting' ? ui.voted : '', S.phase === 'results' ? (S.film && S.film.status) : ''].join('|');
  if (k !== key) { key = k; clearInterval(tick); draw(k.split('|')[0], isDir); }
  patch();
}

function draw(view, isDir) {
  const v = $('#view'); const m = mine(); const c = m.char;
  if (S.phase !== 'voting') ui.voted = false;
  if (view === 'pick') {
    if (ui.pick === 'presets') {
      v.innerHTML = `<div class="stack rise"><h2>Pick your look</h2><p class="lead">Play as one of the Crew Cut originals.</p>
        <div class="presets">${S.presets.map((p) => `<button class="preset" data-preset="${p.id}" ${p.taken ? 'disabled' : ''}><img src="${esc(p.img)}" alt=""><span class="tape paper">${esc(p.name)}${p.taken ? ' · taken' : ''}</span></button>`).join('')}</div>
        <div id="err" class="err hidden"></div><button class="btn ghost wide" id="back">Use my selfie instead</button></div>`;
      $$('[data-preset]').forEach((b) => (b.onclick = guard(async () => { await api('/api/character', { code: me.code, pid: me.pid, preset: b.dataset.preset }); ui.pick = null; sfx.pop(); })));
      $('#back').onclick = () => { ui.pick = 'selfie'; key = ''; render(); };
      return;
    }
    v.innerHTML = `<div class="stack rise"><h2>Make your character</h2><p class="lead">Snap a selfie and we’ll draw you into the Crew Cut world.</p>
      <div class="selfie"><label class="shot" for="cam" aria-label="Take a selfie">${ui.selfie ? `<img src="${ui.selfie}" alt="Your selfie">` : '📸'}</label>
        <input type="file" id="cam" accept="image/*" capture="user" class="hidden"><span class="muted">${ui.selfie ? 'Tap to retake' : 'Tap to take a selfie'}</span></div>
      <label class="consent"><input type="checkbox" id="consent" ${ui.consent ? 'checked' : ''}><span>This is me, and I’m OK with my face being used in this game’s movie.</span></label>
      <div id="err" class="err hidden"></div>
      <button class="btn wide" id="draw" ${ui.selfie ? '' : 'disabled'}>Draw me</button>
      <button class="btn ghost wide" id="presets">Pick a Crew Cut original</button>
      ${c && c.status === 'ready' ? '<button class="btn ghost wide" id="keep">Keep my current look</button>' : ''}</div>`;
    if ($('#keep')) $('#keep').onclick = () => { ui.pick = null; key = ''; render(); };
    $('#cam').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { ui.selfie = await squareJpeg(f, 768); key = ''; render(); } catch { showErr('Couldn’t read that photo. Try again.'); } };
    $('#consent').onchange = (e) => (ui.consent = e.target.checked);
    $('#draw').onclick = guard(async () => { if (!ui.consent) throw new Error('Tick the box to confirm it’s you.'); await api('/api/character', { code: me.code, pid: me.pid, selfie: ui.selfie, consent: true }); ui.pick = null; key = ''; sfx.pop(); });
    $('#presets').onclick = () => { ui.pick = 'presets'; key = ''; render(); };
    return;
  }
  if (view === 'making') {
    const tips = ['Inking your outline…', 'Picking your fit…', 'Mixing your colors…', 'Teaching you to act…', 'Almost camera-ready…'];
    v.innerHTML = `<div class="making rise"><div class="inkspin"></div><div class="pct" id="pct">0%</div><h2 style="font-size:2.2rem">Drawing you</h2><p class="lead" id="tip">${tips[0]}</p><p class="muted" id="line"></p></div>`;
    let t = 0; tick = setInterval(() => { const el = $('#tip'); if (el) el.textContent = tips[++t % tips.length]; }, 2200);
    return;
  }
  if (view === 'failed') {
    v.innerHTML = `<div class="stack rise"><h2>Take two</h2><div class="err">${esc(c.error || 'Something went wrong drawing you.')}</div>
      <button class="btn wide" id="retry">Try another selfie</button><button class="btn ghost wide" id="presets">Pick a Crew Cut original</button></div>`;
    $('#retry').onclick = () => { ui.selfie = null; ui.pick = 'selfie'; key = ''; render(); };
    $('#presets').onclick = () => { ui.pick = 'presets'; key = ''; render(); };
    return;
  }
  if (view === 'reveal') {
    v.innerHTML = `<div class="reveal rise"><span class="tape hot">Meet your character</span><div class="fig pop">${imgOf(m)}</div>
      <div id="err" class="err hidden"></div>
      <button class="btn wide" id="ok">That’s me. Lock it in</button>
      <div class="row" style="width:100%"><button class="btn ghost" style="flex:1" id="redo" ${c.rerollsLeft > 0 ? '' : 'disabled'}>Redraw (${c.rerollsLeft} left)</button><button class="btn ghost" style="flex:1" id="presets">Originals</button></div></div>`;
    $('#ok').onclick = guard(async () => { await api('/api/accept', { code: me.code, pid: me.pid }); sfx.ding(); });
    $('#redo').onclick = guard(async () => { await api('/api/character', { code: me.code, pid: me.pid, reroll: true }); });
    $('#presets').onclick = () => { ui.pick = 'presets'; key = ''; render(); };
    return;
  }
  if (view === 'ready') {
    v.innerHTML = `<div class="wait rise"><div class="fig bob">${imgOf(m)}</div><h2>You’re on the call sheet</h2><p class="lead">Waiting for the host to start the shoot.</p><div class="mini" id="mini"></div><span class="muted" id="count"></span>
      <div class="row"><button class="btn ghost small" id="change">Change my look</button><button class="btn ghost small" id="leave">Leave</button></div></div>`;
    $('#change').onclick = () => { ui.pick = 'selfie'; key = ''; render(); };
    $('#leave').onclick = guard(async () => { await api('/api/leave', { code: me.code, pid: me.pid }); });
    return;
  }
  if (S.phase === 'directing' && isDir) return director();
  if (S.phase === 'directing') {
    v.innerHTML = `<div class="wait rise"><div class="fig bob">${imgOf(player(S.director.id))}</div><span class="tape">Scene ${S.sceneIndex + 1} of ${S.sceneCount}</span>
      <h2>${esc(S.director.name)} is directing</h2><p class="lead">${esc(S.scene.title)}. No peeking. You might be in it.</p></div>`;
    return;
  }
  if (['wrap', 'premiere'].includes(S.phase) || (S.phase === 'voting' && ui.voted)) {
    const title = S.phase === 'wrap' ? 'That’s a wrap' : S.phase === 'premiere' ? 'Premiere’s on' : 'Vote cast';
    const sub = S.phase === 'wrap' ? 'Last scenes are rendering. Eyes on the TV.' : S.phase === 'premiere' ? 'Watch the TV. Throw some ink at the screen.' : 'Waiting on the rest of the crew. Keep heckling.';
    v.innerHTML = `<div class="wait rise"><h2>${title}</h2><p class="lead">${sub}</p>
      <div class="pad">${['🔥', '😂', '😱', '👏'].map((e) => `<button data-e="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div></div>`;
    $$('[data-e]').forEach((b) => (b.onclick = () => { api('/api/react', { code: me.code, pid: me.pid, emoji: b.dataset.e }).catch(() => {}); ink.drop(0.3 + Math.random() * 0.4, 0.75, INK[mine().color], 0.6); if (navigator.vibrate) navigator.vibrate(25); }));
    return;
  }
  if (S.phase === 'voting') return vote();
  if (S.phase === 'results') return results();
}

function patch() {
  const m = mine();
  if ($('#pct') && m.char) { $('#pct').textContent = `${m.char.progress || 0}%`; $('#line').textContent = m.char.status === 'queued' ? 'You’re in line for the artist' : ''; }
  if ($('#mini')) { $('#mini').innerHTML = S.players.map(avatar).join(''); $('#count').textContent = `${S.players.filter((p) => p.ready).length} of ${S.players.length} ready`; }
}

function director() {
  const sc = S.scene; let shot = sc.shots[0].id; let cast = [];
  $('#view').innerHTML = `
    <div class="clapper snap"><div class="sticks"></div><div class="slate">
      <div class="row"><span class="k">Scene</span><span class="v">${S.sceneIndex + 1} of ${S.sceneCount}</span></div>
      <div class="row"><span class="k">Title</span><span class="v">${esc(sc.title)}</span></div>
      <div class="row"><span class="k">Director</span><span class="v">${esc(me.name)}</span></div></div></div>
    <div class="row" style="justify-content:space-between"><span class="tape hot">Secret · you’re directing</span><span class="timer" id="secs"></span></div>
    <div class="stack"><span class="tape" style="justify-self:start">Pick the shot</span>
      <div class="chips">${sc.shots.map((s, i) => `<button class="chip" style="--r:${[-1.5, 1, -0.5][i]}deg" data-shot="${s.id}" aria-pressed="${i === 0}">${esc(s.label)}</button>`).join('')}</div></div>
    <div class="stack"><span class="tape" style="justify-self:start">${esc(sc.ask)}</span>
      <div class="castpick">${S.players.map((p) => `<button data-cast="${p.id}" aria-pressed="false">${avatar(p)}<span>${esc(p.name)}</span></button>`).join('')}</div></div>
    <label class="f"><span class="tape" style="justify-self:start">Add a twist</span>
      <input class="field" id="twist" maxlength="80" placeholder="${esc(['Somebody forgot the plan', 'Dre forgot the money bag', 'The bag is full of glitter'][S.sceneIndex % 3])}"></label>
    <div id="err" class="err hidden"></div>
    <button class="btn wide" id="lock">🎬 Lock it in</button>`;
  sfx.clap(); if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
  $$('[data-shot]').forEach((b) => (b.onclick = () => { shot = b.dataset.shot; $$('[data-shot]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  $$('[data-cast]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.cast; cast = cast.includes(id) ? cast.filter((x) => x !== id) : [...cast, id].slice(-sc.castCount);
    $$('[data-cast]').forEach((x) => x.setAttribute('aria-pressed', cast.includes(x.dataset.cast)));
  }));
  $('#lock').onclick = guard(async () => {
    if (!cast.length) throw new Error('Pick who’s in the scene.');
    await api('/api/direct', { code: me.code, pid: me.pid, shotId: shot, castIds: cast, twist: $('#twist').value });
    sfx.clap();
  });
  const upd = () => { const el = $('#secs'); if (el) { const s = countdown(S.deadline, S.now); el.textContent = `0:${String(s).padStart(2, '0')}`; el.style.color = s <= 10 ? 'var(--hot)' : ''; } };
  upd(); tick = setInterval(upd, 250);
}

function vote() {
  const dirs = [...new Set(S.renders.map((r) => r.directorId))].map(player).filter(Boolean);
  let bd = null, bp = null;
  const pick = (list, attr) => `<div class="castpick">${list.map((p) => `<button ${attr}="${p.id}" aria-pressed="false">${avatar(p)}<span>${esc(p.name)}</span></button>`).join('')}</div>`;
  $('#view').innerHTML = `<div class="stack rise"><h2>Awards night</h2>
    <div class="stack"><span class="tape hot" style="justify-self:start">Best director</span>${pick(dirs, 'data-bd')}</div>
    <div class="stack"><span class="tape hot" style="justify-self:start">Best performance</span>${pick(S.players, 'data-bp')}</div>
    <div id="err" class="err hidden"></div><button class="btn wide" id="send">Cast my vote</button></div>`;
  const wire = (attr, set) => $$(`[${attr}]`).forEach((b) => (b.onclick = () => { set(b.getAttribute(attr)); $$(`[${attr}]`).forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  wire('data-bd', (x) => (bd = x)); wire('data-bp', (x) => (bp = x));
  $('#send').onclick = guard(async () => {
    if (!bd || !bp) throw new Error('Pick both awards.');
    await api('/api/vote', { code: me.code, pid: me.pid, bestDirector: bd, bestPerformance: bp });
    ui.voted = true; key = ''; render();
  });
}

function results() {
  const r = S.results || {}; const f = S.film || {};
  const row = (label, w) => `<div class="row" style="justify-content:space-between"><span class="tape hot">${label}</span><span class="row">${w ? avatar(player(w.id)) : ''}<b>${esc(w ? w.name : 'No votes')}</b></span></div>`;
  $('#view').innerHTML = `<div class="stack rise"><h2>${esc(S.title)}</h2>
    <div class="sheet card stack">${row('Best director', r.bestDirector)}${row('Best performance', r.bestPerformance)}</div>
    ${f.status === 'ready'
      ? `<button class="btn hot wide" id="share">Share the movie</button>
         <a class="btn wide" href="${esc(f.vertical)}" download="crew-cut-${esc(S.code)}.mp4">Download for stories (9:16)</a>
         <a class="btn ghost wide" href="${esc(f.wide)}" download="crew-cut-${esc(S.code)}-wide.mp4">Download widescreen</a>`
      : f.status === 'failed' ? '<div class="err">The export failed on the server.</div>' : '<div class="row"><div class="inkspin" style="width:40px;height:40px"></div><span>Cutting your movie…</span></div>'}
    <div id="err" class="err hidden"></div></div>`;
  const sh = $('#share');
  if (sh) sh.onclick = guard(async () => {
    const blob = await fetch(f.vertical).then((x) => x.blob());
    const file = new File([blob], `crew-cut-${S.code}.mp4`, { type: 'video/mp4' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: S.title, text: `${S.title} · made with Crew Cut #OpenSourceHiggsfield` });
    else { const a = document.createElement('a'); a.href = f.vertical; a.download = file.name; a.click(); }
  });
}

if (me) connect(); else joinForm();
