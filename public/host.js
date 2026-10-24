const { $, $$, esc, api, INK, store, sfx, qrSvg, countdown } = CC;
const ink = CrewInk.mount($('#ink'), { quality: 'tv', pointerTarget: document.body });
let S = null, room = null, lan = [], mounted = '', tick = null, premiereRunning = false, lastEvent = 0;

const host = (action, extra) => api(`/api/host/${action}`, { code: room.code, hostKey: room.hostKey, ...extra }).catch((e) => toast(e.message));
function toast(msg) { const t = document.createElement('div'); t.className = 'err pop'; t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 3500); }
const player = (id) => S.players.find((p) => p.id === id);
const fig = (p, cls = '') => {
  const c = p && p.char;
  if (!c || !c.url) return '';
  return `<img class="${c.cutout ? '' : 'square'} ${cls}" src="${esc(c.url)}" alt="${esc(p.name)}">`;
};

async function boot() {
  room = store.get('cc_host');
  const h = await fetch('/health').then((r) => r.json()).catch(() => ({}));
  lan = h.lan || [];
  if (room && !(await fetch(`/exists?code=${room.code}`).then((r) => r.ok).catch(() => false))) room = null;
  if (!room) { room = await api('/api/room'); store.set('cc_host', room); }
  const es = new EventSource(`/events?code=${room.code}`);
  es.onmessage = (e) => { S = JSON.parse(e.data); onEvent(S.event); render(); };
  es.onerror = () => { if (!S) toast('Can’t reach the Crew Cut server.'); };
}

function onEvent(ev) {
  if (!ev || ev.seq <= lastEvent) return;
  const first = lastEvent === 0; lastEvent = ev.seq; if (first) return;
  const p = ev.pid && player(ev.pid);
  const slotX = () => { const i = S.players.findIndex((x) => x.id === ev.pid); return 0.45 + (i + 0.5) * 0.13; };
  if (ev.type === 'join' && p) { ink.drop(slotX(), 0.6, INK[p.color], 0.8); sfx.pop(); }
  if (ev.type === 'charReady' && p) { ink.drop(slotX(), 0.45, INK[p.color], 1); ink.drop(slotX(), 0.7, INK[p.color], 0.7); sfx.ding(); }
  if (ev.type === 'start' || ev.type === 'lock') { ink.burst(); sfx.clap(); }
  if (ev.type === 'sceneReady') ink.drop(0.75, 0.5, 'tape', 0.8);
  if (ev.type === 'premiere' || ev.type === 'results') { ink.burst(); sfx.fanfare(); }
  if (ev.type === 'react' && p) { ink.drop(0.1 + Math.random() * 0.8, 0.85, INK[p.color], 0.7); floatEmoji(ev.emoji); }
}
function floatEmoji(e) {
  const s = document.createElement('span'); s.textContent = e;
  s.style.left = `${8 + Math.random() * 84}vw`; s.style.setProperty('--rot', `${(Math.random() - 0.5) * 50}deg`);
  $('#reacts').append(s); setTimeout(() => s.remove(), 3300);
}

function render() {
  $('#roomtag').textContent = `Room ${S.code}`; $('#roomtag').classList.remove('hidden');
  $('#mode').textContent = S.generator === 'mock' ? 'Preview mode · placeholder scenes' : 'AI scenes · ComfyUI';
  $('#mode').classList.remove('hidden');
  const key = S.phase + (S.phase === 'directing' ? S.sceneIndex : '');
  if (key !== mounted) { mounted = key; clearInterval(tick); mount(); }
  update();
}

function mount() {
  const v = $('#view'); const ctl = $('#hostctl'); ctl.innerHTML = '';
  if (S.phase === 'lobby') {
    premiereRunning = false;
    const joinUrl = `${lan[0] || location.origin}/play?code=${S.code}`;
    v.innerHTML = `<div class="lobby rise">
      <div class="glass joincard">
        <h2>Grab your phone.<br>You’re in this movie.</h2>
        <div class="joinrow"><div class="qr" aria-label="QR code to join">${qrSvg(joinUrl)}</div>
          <div class="stack"><span class="muted">Scan or go to</span><span class="tape url">${esc(joinUrl.replace(/^https?:\/\//, ''))}</span><span class="muted">Room code</span><div class="codebig">${esc(S.code)}</div></div></div>
        <div class="settings">
          <span class="lbl">Genre</span><div class="chips" id="genres"></div><p class="blurb" id="blurb"></p>
          <span class="lbl">Director’s clock</span><div class="chips" id="clock"></div>
        </div>
      </div>
      <div class="stage"><div class="row" style="justify-content:space-between"><h3>The cast</h3><span class="muted" id="castnote"></span></div>
        <div><div class="slots" id="slots"></div><div class="floor"></div></div></div>
    </div>`;
    $('#genres').innerHTML = S.genres.map((g, i) => `<button class="chip hot" style="--r:${[-2, 1.5, -1][i % 3]}deg" data-genre="${g.id}">${esc(g.label)}</button>`).join('');
    $('#clock').innerHTML = [30, 45, 60, 90].map((s) => `<button class="chip" data-secs="${s}">${s}s</button>`).join('');
    $$('[data-genre]').forEach((b) => (b.onclick = () => host('settings', { genre: b.dataset.genre })));
    $$('[data-secs]').forEach((b) => (b.onclick = () => host('settings', { directSeconds: b.dataset.secs })));
    ctl.innerHTML = '<button class="btn" id="start">Start the shoot</button>';
    $('#start').onclick = () => host('start');
  } else if (S.phase === 'directing' || S.phase === 'wrap') {
    v.innerHTML = `<div class="direct rise"><div id="now"></div>
      <div><div class="striphead"><span class="tape">Dailies</span><span class="muted" id="qnote"></span></div><div class="strip"><div class="frames" id="frames"></div></div></div></div>`;
    $('#frames').innerHTML = Array.from({ length: S.sceneCount }, (_, i) => `<div class="frame" data-i="${i}"></div>`).join('');
    const d = S.director && player(S.director.id);
    $('#now').innerHTML = S.phase === 'wrap'
      ? `<span class="tape hot">That’s a wrap</span><h2>Rendering the final cut</h2><p class="who">The premiere starts the second every scene is in.</p>`
      : `<span class="tape">Scene ${S.sceneIndex + 1} of ${S.sceneCount}</span><h2>${esc(S.scene.title)}</h2>
         <div class="dirfig"><div class="fig bob">${fig(d)}</div><div class="who"><span><span class="tape ${esc(d ? 'c-' + d.color : '')}" style="background:var(--c)">${esc(S.director.name)}</span> is directing.</span><span class="muted">Phones down. No peeking.</span><div class="leader" id="leader"><span id="secs"></span></div></div></div>`;
    if (S.phase === 'directing') {
      const upd = () => { const s = countdown(S.deadline, S.now); const el = $('#secs'); if (!el) return; el.textContent = s; $('#leader').style.setProperty('--p', Math.min(1, s / S.directSeconds)); };
      upd(); tick = setInterval(upd, 250);
    }
  } else if (S.phase === 'premiere') {
    if (!premiereRunning) premiere();
  } else if (S.phase === 'voting') {
    premiereRunning = false;
    v.innerHTML = `<div class="center stack rise" style="justify-items:center"><span class="tape hot">Awards night</span>
      <h2 style="font-size:clamp(3rem,8vw,8rem)">Vote on your phones</h2><p style="font-size:1.6rem" id="votes"></p><div class="leader"><span id="secs"></span></div></div>`;
    const upd = () => { const el = $('#secs'); if (el) el.textContent = countdown(S.deadline, S.now); };
    upd(); tick = setInterval(upd, 250);
  } else if (S.phase === 'results') {
    v.innerHTML = `<div class="center rise"><span class="tape">${esc(S.title)}</span><h2 style="font-size:clamp(3rem,6vw,6rem);margin-top:1vh">And the award goes to…</h2>
      <div class="awards" id="awards"></div><div class="filmrow" id="film"></div></div>`;
    ctl.innerHTML = '<button class="btn" id="again">Shoot another</button>';
    $('#again').onclick = () => host('again');
  }
}

function update() {
  if (S.phase === 'lobby') {
    $$('[data-genre]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.genre === S.genre));
    $$('[data-secs]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.secs) === S.directSeconds));
    $('#blurb').textContent = (S.genres.find((g) => g.id === S.genre) || {}).blurb || '';
    const readyN = S.players.filter((p) => p.ready).length;
    $('#castnote').textContent = `${readyN} of ${S.players.length || 0} ready · 2–4 players`;
    $('#start').disabled = readyN < 2;
    const html = Array.from({ length: S.maxPlayers }, (_, i) => {
      const p = S.players[i];
      if (!p) return `<div class="slot"><div class="fig"><div class="ghost">?</div></div><span class="tape paper name">Open spot</span><span class="status muted">Waiting…</span></div>`;
      const c = p.char;
      let body, status;
      if (!c) { body = '<div class="ghost">🎬</div>'; status = 'Making their character…'; }
      else if (c.status === 'ready') { body = fig(p, c.accepted ? 'bob' : ''); status = c.accepted ? 'Ready' : 'Checking the look…'; }
      else if (c.status === 'failed') { body = '<div class="ghost">!</div>'; status = 'Retrying…'; }
      else { body = `<div class="making"><div class="inkspin"></div><b>${c.progress || 0}%</b></div>`; status = c.status === 'queued' ? 'In line for the artist…' : 'Drawing their character…'; }
      return `<div class="slot" data-pid="${p.id}"><div class="fig">${body}</div><span class="tape name c-${p.color}" style="background:var(--c)">${esc(p.name)}</span><span class="status"><span class="dot ${p.connected ? '' : 'off'}"></span> ${status}</span></div>`;
    }).join('');
    if ($('#slots').dataset.h !== html) { $('#slots').innerHTML = html; $('#slots').dataset.h = html; }
  }
  if (S.phase === 'directing' || S.phase === 'wrap') {
    $('#qnote').textContent = S.queue > 1 ? `${S.queue} jobs in the render queue` : '';
    $$('.frame').forEach((f) => {
      const i = Number(f.dataset.i); const r = S.renders.find((x) => x.sceneIndex === i);
      const st = r ? `${r.status}:${r.status === 'rendering' || r.status === 'queued' ? r.progress : ''}` : (i === S.sceneIndex && S.phase === 'directing' ? 'now' : 'empty');
      if (f.dataset.st === st) return; f.dataset.st = st;
      const title = r ? r.title : `Scene ${i + 1}`;
      if (!r) f.innerHTML = `<span class="lbl tape paper">${esc(title)}</span><span class="pct">${st === 'now' ? '🎬' : ''}</span>`;
      else if (r.status === 'done') f.innerHTML = `<video src="${esc(r.videoUrl)}" muted autoplay loop playsinline></video><span class="lbl tape">${esc(title)} ✓</span>`;
      else if (r.status === 'failed') f.innerHTML = `<span class="lbl tape hot">${esc(title)}</span><span>Lost on set</span>`;
      else f.innerHTML = `<span class="lbl tape paper">${esc(title)}</span><span class="pct">${r.status === 'queued' ? '⏳' : r.progress + '%'}</span><div class="bar"><i style="width:${r.progress}%"></i></div>`;
    });
  }
  if (S.phase === 'voting') $('#votes').textContent = `${S.votedCount} of ${S.players.length} votes in`;
  if (S.phase === 'results') {
    const a = (label, w, r) => { const p = w && player(w.id); return `<div class="award pop" style="--r:${r}deg"><h3>${label}</h3><div class="n">${esc(w ? w.name : 'No votes')}</div>${w ? `<span>${w.votes} vote${w.votes === 1 ? '' : 's'}</span>` : ''}<div class="fig">${fig(p)}</div></div>`; };
    const html = a('Best director', S.results && S.results.bestDirector, -3) + a('Best performance', S.results && S.results.bestPerformance, 2.5);
    if ($('#awards').dataset.h !== html) { $('#awards').innerHTML = html; $('#awards').dataset.h = html; }
    const f = S.film || {};
    const fh = f.status === 'ready' ? `<div class="qr">${qrSvg((lan[0] || location.origin) + f.vertical)}</div><div class="stack" style="text-align:left"><b style="font-size:1.4rem">Your movie is ready.</b><span class="muted">Download it on your phones, or scan to grab the vertical cut.</span></div>`
      : f.status === 'failed' ? '<span class="err">Export failed. Check the server window.</span>' : '<div class="inkspin"></div><span>Cutting your movie…</span>';
    if ($('#film').dataset.h !== fh) { $('#film').innerHTML = fh; $('#film').dataset.h = fh; }
  }
}

async function premiere() {
  premiereRunning = true;
  const v = $('#view');
  $('#hostctl').innerHTML = '<button class="btn ghost small" id="skip">Skip to voting</button>';
  $('#skip').onclick = () => host('vote');
  v.innerHTML = `<div class="marquee rise"><div class="bulbs"><span class="tape">Now showing</span><h2>${esc(S.title)}</h2></div></div><div class="screen" id="screen"></div>`;
  const screen = $('#screen');
  const card = (html, ms) => new Promise((res) => { screen.innerHTML = `<div class="titlecard">${html}</div>`; setTimeout(res, ms); });
  await card(`<div><span class="tape">A Crew Cut picture</span><h3>${esc(S.title)}</h3><p>Starring ${esc(S.players.map((p) => p.name).join(', '))}</p></div>`, 3500);
  for (const r of S.renders.slice().sort((a, b) => a.sceneIndex - b.sceneIndex)) {
    if (S.phase !== 'premiere') return;
    if (r.status !== 'done') { await card(`<div><h3>${esc(r.title)}</h3><p>This scene got lost on set.</p></div>`, 2500); continue; }
    await new Promise((res) => {
      screen.innerHTML = `<video src="${esc(r.videoUrl)}" autoplay muted playsinline></video>
        <div class="lower"><span class="tape">${esc(r.title)} · dir. ${esc(r.directorName)}</span>${r.twist ? `<span class="tape hot">Twist: ${esc(r.twist)}</span>` : ''}</div>`;
      const vid = screen.querySelector('video');
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      vid.onended = fin; vid.onerror = () => setTimeout(fin, 3000); setTimeout(fin, 20000);
    });
  }
  await card('<div><h3>The end</h3><p>Vote on your phones</p><p class="muted" style="margin-top:1vh">Made with Crew Cut by GiveMePrompts</p></div>', 2800);
  premiereRunning = false;
  if (S.phase === 'premiere') host('vote');
}

boot();
