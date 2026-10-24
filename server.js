// Crew Cut server. Node 18+ and ffmpeg. Real generation (GENERATOR=comfy) also needs `npm install` and Node 22+.
// TV opens /, phones open /play. State streams to everyone over SSE.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { GENRES, keyframePrompt, motionPrompt } = require('./generators/prompts');
const { ff, card, drawText } = require('./generators/ff');

const PORT = Number(process.env.PORT || 3000);
const GEN = require(`./generators/${process.env.GENERATOR || 'mock'}`);
const VOTE_SECONDS = Number(process.env.VOTE_SECONDS || 40);
const MAX_PLAYERS = 4;
const REROLLS = 2;
const ROOM_TTL_MS = 6 * 3600 * 1000;
const DATA = path.join(__dirname, 'data', 'rooms');
const PUB = path.join(__dirname, 'public');
const PRESETS = [
  { id: 'supreme', name: 'Supreme' }, { id: 'dre', name: 'Dre' }, { id: 'mika', name: 'Mika' }, { id: 'lou', name: 'Lou' },
];
const COLORS = ['tape', 'hot', 'cyan', 'lilac'];
fs.mkdirSync(DATA, { recursive: true });

const rooms = new Map();
const rid = (n = 8) => crypto.randomBytes(n).toString('hex').slice(0, n);
const newCode = () => {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join('');
  while (rooms.has(c));
  return c;
};
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- one GPU queue for the whole server (characters + scenes) ----------
let gpu = Promise.resolve();
let queued = 0;
function enqueue(fn) {
  queued++;
  const p = gpu.then(fn).finally(() => { queued--; });
  gpu = p.catch(() => {});
  return p;
}

// ---------- rooms ----------
function createRoom() {
  const code = newCode();
  const room = {
    code, hostKey: rid(16), created: Date.now(), phase: 'lobby', genre: 'heist', directSeconds: 45,
    players: [], sceneIndex: 0, directorOrder: [], deadline: null, timer: null, renders: [],
    votes: {}, results: null, film: null, clients: new Set(), dir: path.join(DATA, code), event: null, eventSeq: 0,
  };
  fs.mkdirSync(room.dir, { recursive: true });
  rooms.set(code, room);
  return room;
}
setInterval(() => {
  for (const [code, r] of rooms) if (Date.now() - r.created > ROOM_TTL_MS && r.clients.size === 0) {
    rooms.delete(code); fs.rm(r.dir, { recursive: true, force: true }, () => {});
  }
}, 600000).unref();

const ready = (p) => p.char && p.char.status === 'ready' && p.char.accepted;
const charUrl = (room, p) => (p.char && p.char.status === 'ready' ? (p.char.preset ? `/img/${p.char.preset}.png` : `/media/${room.code}/${p.char.file}?v=${p.char.v}`) : null);

function publicState(room) {
  const g = GENRES[room.genre];
  const scene = g.scenes[room.sceneIndex];
  const dirId = room.directorOrder[room.sceneIndex % (room.directorOrder.length || 1)];
  const director = room.players.find((p) => p.id === dirId);
  const showTwists = ['premiere', 'voting', 'results'].includes(room.phase);
  return {
    code: room.code, phase: room.phase, genre: room.genre, directSeconds: room.directSeconds, generator: GEN.name,
    genres: Object.entries(GENRES).map(([k, v]) => ({ id: k, label: v.label, blurb: v.blurb })),
    title: g.title(room.players[0] ? room.players[0].name : 'crew'),
    presets: PRESETS.map((p) => ({ ...p, img: `/img/${p.id}.png`, taken: room.players.some((x) => x.char && x.char.preset === p.id) })),
    players: room.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, connected: p.connected !== false,
      char: p.char ? { status: p.char.status, progress: p.char.progress || 0, url: charUrl(room, p), cutout: !!p.char.cutout, preset: p.char.preset || null, accepted: !!p.char.accepted, rerollsLeft: p.char.rerollsLeft, error: p.char.error || null } : null,
      ready: ready(p),
    })),
    maxPlayers: MAX_PLAYERS, sceneCount: g.scenes.length, sceneIndex: room.sceneIndex,
    director: room.phase === 'directing' && director ? { id: director.id, name: director.name } : null,
    scene: room.phase === 'directing' ? { title: scene.title, ask: scene.ask, castCount: scene.cast, shots: scene.shots.map((s) => ({ id: s.id, label: s.label })) } : null,
    deadline: room.deadline, now: Date.now(),
    renders: room.renders.map((r) => ({
      sceneIndex: r.sceneIndex, title: r.title, status: r.status, progress: r.progress, error: r.error || null,
      videoUrl: r.status === 'done' ? `/media/${room.code}/scene${r.sceneIndex + 1}.mp4` : null,
      directorId: r.directorId, directorName: r.directorName, shotLabel: r.shotLabel,
      cast: r.cast.map((c) => ({ id: c.id, name: c.name })), twist: showTwists ? r.twist : null,
    })),
    queue: queued, votedCount: Object.keys(room.votes).length,
    results: room.phase === 'results' ? room.results : null,
    film: room.film, event: room.event,
  };
}

function broadcast(room, event) {
  if (event) room.event = { ...event, seq: ++room.eventSeq };
  const msg = `data: ${JSON.stringify(publicState(room))}\n\n`;
  for (const res of room.clients) res.write(msg);
}

// ---------- characters ----------
function makeCharacter(room, p, selfieB64) {
  const v = (p.char && p.char.v || 0) + 1;
  const selfiePath = path.join(room.dir, `${p.id}_selfie.jpg`);
  if (selfieB64) fs.writeFileSync(selfiePath, Buffer.from(selfieB64, 'base64'));
  const file = `${p.id}_char${v}.png`;
  p.char = { status: 'queued', progress: 0, v, file, accepted: false, rerollsLeft: p.char && p.char.rerollsLeft != null ? p.char.rerollsLeft : REROLLS };
  broadcast(room);
  enqueue(async () => {
    if (!p.char || p.char.v !== v) return;
    p.char.status = 'making'; broadcast(room);
    try {
      const r = await GEN.character({ selfiePath, outPath: path.join(room.dir, file), seed: crypto.randomInt(1, 2 ** 31) }, (pr) => { if (p.char && p.char.v === v) { p.char.progress = pr; broadcast(room); } });
      if (!p.char || p.char.v !== v) return;
      Object.assign(p.char, { status: 'ready', progress: 100, cutout: r.cutout });
      broadcast(room, { type: 'charReady', pid: p.id });
    } catch (e) {
      console.error(`[${room.code}] character failed:`, e.message);
      if (p.char && p.char.v === v) Object.assign(p.char, { status: 'failed', error: 'Couldn’t make your character. Try again or pick a preset.' });
      broadcast(room);
    }
  });
}

// ---------- game flow ----------
function startGame(room) {
  room.players = room.players.filter(ready);
  room.directorOrder = shuffle(room.players.map((p) => p.id));
  Object.assign(room, { sceneIndex: 0, renders: [], votes: {}, results: null, film: null });
  beginDirecting(room, { type: 'start' });
}
function beginDirecting(room, event) {
  room.phase = 'directing';
  room.deadline = Date.now() + room.directSeconds * 1000;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => autoDirect(room), room.directSeconds * 1000 + 600);
  broadcast(room, event);
}
function autoDirect(room) {
  if (room.phase !== 'directing') return;
  const scene = GENRES[room.genre].scenes[room.sceneIndex];
  lockScene(room, { shotId: scene.shots[crypto.randomInt(scene.shots.length)].id, castIds: shuffle(room.players.map((p) => p.id)).slice(0, scene.cast), twist: '' }, true);
}
function lockScene(room, { shotId, castIds, twist }, auto = false) {
  const g = GENRES[room.genre];
  const scene = g.scenes[room.sceneIndex];
  const shot = scene.shots.find((s) => s.id === shotId) || scene.shots[0];
  const cast = [...new Set(castIds || [])].map((cid) => room.players.find((p) => p.id === cid)).filter(Boolean).slice(0, scene.cast);
  if (!cast.length) cast.push(room.players[0]);
  const directorId = room.directorOrder[room.sceneIndex % room.directorOrder.length];
  const director = room.players.find((p) => p.id === directorId);
  const cleanTwist = clean(twist, 80);
  const r = {
    sceneIndex: room.sceneIndex, title: scene.title, status: 'queued', progress: 0, auto,
    directorId, directorName: director ? director.name : '?', shotLabel: shot.label, twist: cleanTwist,
    cast: cast.map((p) => ({ id: p.id, name: p.name, characterPath: p.char.preset ? path.join(PUB, 'img', `${p.char.preset}.png`) : path.join(room.dir, p.char.file) })),
  };
  r.prompts = { keyframe: keyframePrompt({ genre: room.genre, scene, shot, cast: r.cast, twist: cleanTwist }), motion: motionPrompt({ shot, twist: cleanTwist }) };
  room.renders.push(r);
  enqueue(() => renderScene(room, r));
  clearTimeout(room.timer);
  room.deadline = null;
  const ev = { type: 'lock', sceneIndex: r.sceneIndex, auto };
  if (room.sceneIndex + 1 < g.scenes.length) { room.sceneIndex += 1; beginDirecting(room, ev); }
  else { room.phase = 'wrap'; broadcast(room, ev); maybePremiere(room); }
}
async function renderScene(room, r) {
  r.status = 'rendering'; broadcast(room);
  try {
    await GEN.scene({ ...r, roomCode: room.code, genre: room.genre, outDir: room.dir }, (p) => { r.progress = p; broadcast(room); });
    Object.assign(r, { status: 'done', progress: 100 });
    broadcast(room, { type: 'sceneReady', sceneIndex: r.sceneIndex });
  } catch (e) {
    Object.assign(r, { status: 'failed', error: e.message });
    console.error(`[${room.code}] scene ${r.sceneIndex + 1} failed:`, e.message);
    broadcast(room);
  }
  maybePremiere(room);
}
function maybePremiere(room) {
  const total = GENRES[room.genre].scenes.length;
  if (room.phase === 'wrap' && room.renders.length === total && room.renders.every((r) => ['done', 'failed'].includes(r.status))) {
    room.phase = 'premiere';
    broadcast(room, { type: 'premiere' });
    exportFilm(room);
  }
}
function openVoting(room) {
  if (room.phase !== 'premiere') return;
  room.phase = 'voting'; room.votes = {};
  room.deadline = Date.now() + VOTE_SECONDS * 1000;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => closeVoting(room), VOTE_SECONDS * 1000 + 500);
  broadcast(room, { type: 'voting' });
}
function closeVoting(room) {
  if (room.phase !== 'voting') return;
  clearTimeout(room.timer);
  const tally = (key) => {
    const counts = {};
    for (const v of Object.values(room.votes)) if (v[key]) counts[v[key]] = (counts[v[key]] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const p = top && room.players.find((x) => x.id === top[0]);
    return p ? { id: p.id, name: p.name, votes: top[1] } : null;
  };
  room.results = { bestDirector: tally('bestDirector'), bestPerformance: tally('bestPerformance') };
  room.phase = 'results'; room.deadline = null;
  broadcast(room, { type: 'results' });
}

// ---------- film export: title card, scenes with lower thirds, end card; 16:9 + 9:16 ----------
async function exportFilm(room) {
  const done = room.renders.filter((r) => r.status === 'done').sort((a, b) => a.sceneIndex - b.sceneIndex);
  if (!done.length) { room.film = { status: 'failed', error: 'No scenes rendered' }; return broadcast(room); }
  room.film = { status: 'stitching' }; broadcast(room);
  const d = room.dir;
  const title = GENRES[room.genre].title(room.players[0].name);
  try {
    const parts = [];
    parts.push(await card(path.join(d, 'x_title.mp4'), d, [
      { text: 'A CREW CUT PICTURE', size: 34, display: false, color: '0xFFC72C', y: 'h/2-150' },
      { text: title.toUpperCase(), size: 120, y: '(h-th)/2' },
      { text: `Starring ${room.players.map((p) => p.name).join(', ')}`, size: 34, display: false, y: 'h/2+110' },
    ], 3));
    for (const r of done) {
      const out = path.join(d, `x_scene${r.sceneIndex + 1}.mp4`);
      const lines = [drawText(d, `${r.title.toUpperCase()}  ·  DIR. ${r.directorName.toUpperCase()}`, { size: 34, color: 'black', box: '0xFFC72C', x: '40', y: 'h-150' })];
      if (r.twist) lines.push(drawText(d, `Twist: ${r.twist}`, { size: 30, display: false, color: 'white', box: '0xFF2E88', x: '40', y: 'h-90' }));
      await ff(['-y', '-i', path.join(d, `scene${r.sceneIndex + 1}.mp4`), '-vf', `scale=1280:720,${lines.join(',')},format=yuv420p`, '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-an', out]);
      parts.push(out);
    }
    const w = room.results || {};
    parts.push(await card(path.join(d, 'x_end.mp4'), d, [
      { text: 'THE END', size: 140, y: '(h-th)/2-40' },
      { text: 'Made with Crew Cut by GiveMePrompts', size: 32, display: false, color: '0xFFC72C', y: 'h/2+90' },
    ], 3));
    const list = path.join(d, 'list.txt');
    fs.writeFileSync(list, parts.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'));
    await ff(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(d, 'film.mp4')]);
    await ff(['-y', '-i', path.join(d, 'film.mp4'), '-filter_complex',
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.08[bg];[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-movflags', '+faststart', '-an', path.join(d, 'film_vertical.mp4')]);
    for (const f of fs.readdirSync(d)) if (f.startsWith('.txt') || f.startsWith('x_')) fs.rmSync(path.join(d, f), { force: true });
    room.film = { status: 'ready', wide: `/media/${room.code}/film.mp4`, vertical: `/media/${room.code}/film_vertical.mp4` };
  } catch (e) {
    room.film = { status: 'failed', error: e.message };
    console.error(`[${room.code}] export failed`, e.message);
  }
  broadcast(room, { type: 'filmReady' });
}

function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function lanUrls() { return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`); }

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readJson(req, limit = 4e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Photo too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('bad json')); } });
  });
}
function serveFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache ? 'public, max-age=3600' : 'no-store' };
    const range = req.headers.range;
    if (range && type === 'video/mp4') { // iOS Safari needs range requests for video
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = Number(s); const end = e ? Math.min(Number(e), st.size - 1) : st.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}
const roomOf = (code) => rooms.get(String(code || '').toUpperCase());
const playerOf = (room, pid) => room.players.find((p) => p.id === pid);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET') {
      if (p === '/') return serveFile(req, res, path.join(PUB, 'host.html'));
      if (p === '/play') return serveFile(req, res, path.join(PUB, 'play.html'));
      if (p === '/health') return send(res, 200, { ok: true, generator: GEN.name, lan: lanUrls(), queue: queued });
      if (p === '/exists') return send(res, roomOf(url.searchParams.get('code')) ? 200 : 404, {});
      if (p === '/events') {
        const room = roomOf(url.searchParams.get('code'));
        if (!room) return send(res, 404, { error: 'room not found' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const pl = playerOf(room, url.searchParams.get('pid'));
        if (pl) { pl.connected = true; pl.conns = (pl.conns || 0) + 1; }
        room.clients.add(res);
        res.write(`data: ${JSON.stringify(publicState(room))}\n\n`);
        if (pl) broadcast(room);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => {
          clearInterval(ping); room.clients.delete(res);
          if (pl && --pl.conns <= 0) { pl.connected = false; broadcast(room); }
        });
        return;
      }
      const m = p.match(/^\/media\/([A-Z0-9]{4})\/([\w.-]+\.(?:jpg|png|mp4))$/);
      if (m) return serveFile(req, res, path.join(DATA, m[1], m[2]));
      const file = path.normalize(path.join(PUB, p));
      if (file.startsWith(PUB + path.sep)) return serveFile(req, res, file, true);
      return send(res, 404, { error: 'not found' });
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    const body = await readJson(req);
    if (p === '/api/room') { const room = createRoom(); return send(res, 200, { code: room.code, hostKey: room.hostKey }); }
    const room = roomOf(body.code);
    if (!room) return send(res, 404, { error: 'Room not found. Check the code on the TV.' });

    if (p === '/api/join') {
      if (room.phase !== 'lobby') return send(res, 409, { error: 'This shoot already started. Catch the next one.' });
      if (room.players.length >= MAX_PLAYERS) return send(res, 409, { error: 'The cast is full (4 max).' });
      const name = clean(body.name, 14);
      if (!name) return send(res, 400, { error: 'Add a name for the credits.' });
      if (room.players.some((x) => x.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'Someone already took that name.' });
      const used = new Set(room.players.map((x) => x.color));
      const pl = { id: rid(8), name, color: COLORS.find((c) => !used.has(c)) || 'tape', char: null };
      room.players.push(pl);
      broadcast(room, { type: 'join', pid: pl.id });
      return send(res, 200, { pid: pl.id, color: pl.color });
    }

    const pl = playerOf(room, body.pid);
    if (p === '/api/character') {
      if (!pl) return send(res, 403, { error: 'Not in this room.' });
      if (room.phase !== 'lobby') return send(res, 409, { error: 'Shoot already started.' });
      if (body.preset) {
        const pr = PRESETS.find((x) => x.id === body.preset);
        if (!pr) return send(res, 400, { error: 'Unknown character.' });
        if (room.players.some((x) => x !== pl && x.char && x.char.preset === pr.id)) return send(res, 409, { error: `${pr.name} is taken.` });
        pl.char = { status: 'ready', preset: pr.id, cutout: true, accepted: true, v: 0, rerollsLeft: 0 };
        broadcast(room, { type: 'charReady', pid: pl.id });
        return send(res, 200, { ok: true });
      }
      if (body.reroll) {
        if (!pl.char || pl.char.preset || !fs.existsSync(path.join(room.dir, `${pl.id}_selfie.jpg`))) return send(res, 400, { error: 'Take a selfie first.' });
        if (pl.char.rerollsLeft <= 0) return send(res, 409, { error: 'No rerolls left.' });
        pl.char.rerollsLeft -= 1;
        makeCharacter(room, pl, null);
        return send(res, 200, { ok: true });
      }
      if (!body.consent) return send(res, 400, { error: 'Confirm the selfie is you first.' });
      const m = String(body.selfie || '').match(/^data:image\/jpeg;base64,(.+)$/);
      if (!m) return send(res, 400, { error: 'Take a selfie first.' });
      makeCharacter(room, pl, m[1]);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/accept') {
      if (!pl || !pl.char || pl.char.status !== 'ready') return send(res, 400, { error: 'Your character isn’t ready yet.' });
      pl.char.accepted = true;
      broadcast(room, { type: 'charAccepted', pid: pl.id });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/leave') {
      if (pl && room.phase === 'lobby') { room.players = room.players.filter((x) => x !== pl); broadcast(room); }
      return send(res, 200, { ok: true });
    }
    if (p === '/api/direct') {
      if (room.phase !== 'directing') return send(res, 409, { error: 'Not directing right now.' });
      if (body.pid !== room.directorOrder[room.sceneIndex % room.directorOrder.length]) return send(res, 403, { error: 'It’s not your turn.' });
      lockScene(room, body);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/vote') {
      if (room.phase !== 'voting') return send(res, 409, { error: 'Voting is closed.' });
      if (!pl) return send(res, 403, { error: 'Not in this room.' });
      if (!room.players.some((x) => x.id === body.bestDirector) || !room.players.some((x) => x.id === body.bestPerformance)) return send(res, 400, { error: 'Pick both awards.' });
      room.votes[pl.id] = { bestDirector: body.bestDirector, bestPerformance: body.bestPerformance };
      if (Object.keys(room.votes).length >= room.players.length) closeVoting(room);
      else broadcast(room, { type: 'vote' });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/react') { // phones can throw ink at the TV during the premiere
      if (pl && ['premiere', 'voting', 'results', 'wrap'].includes(room.phase)) broadcast(room, { type: 'react', pid: pl.id, color: pl.color, emoji: ['🔥', '😂', '😱', '👏'].includes(body.emoji) ? body.emoji : '🔥' });
      return send(res, 200, { ok: true });
    }

    if (p.startsWith('/api/host/')) {
      if (body.hostKey !== room.hostKey) return send(res, 403, { error: 'Host only.' });
      const action = p.slice('/api/host/'.length);
      if (action === 'settings' && room.phase === 'lobby') {
        if (GENRES[body.genre]) room.genre = body.genre;
        if ([30, 45, 60, 90].includes(Number(body.directSeconds))) room.directSeconds = Number(body.directSeconds);
      } else if (action === 'start' && room.phase === 'lobby') {
        if (room.players.filter(ready).length < 2) return send(res, 400, { error: 'Need at least 2 players with characters.' });
        startGame(room); return send(res, 200, { ok: true });
      } else if (action === 'vote') openVoting(room);
      else if (action === 'again') { clearTimeout(room.timer); Object.assign(room, { phase: 'lobby', renders: [], film: null, results: null, votes: {}, deadline: null }); }
      else if (action === 'kick' && room.phase === 'lobby') room.players = room.players.filter((x) => x.id !== body.pid);
      broadcast(room, { type: action });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`\n  CREW CUT  (generator: ${GEN.name})\n  TV:     http://localhost:${PORT}\n  Phones: ${lanUrls().map((u) => u + '/play').join('  ') || '(connect phones to the same Wi-Fi)'}\n`));
}
module.exports = { server };
