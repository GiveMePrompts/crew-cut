// End-to-end simulation: 4 fake phones play a full game against a running server.
// Usage: node test/sim.js [baseUrl]
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2] || 'http://localhost:3000';
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; };
const rejects = async (p, b, msg) => { try { await post(p, b); ok(false, msg); } catch (e) { ok(true, `${msg} (${e.message})`); } };
const state = async (code) => {
  const r = await fetch(`${BASE}/events?code=${code}`); const rd = r.body.getReader(); let buf = '';
  while (!buf.includes('\n\n')) buf += new TextDecoder().decode((await rd.read()).value);
  rd.cancel(); return JSON.parse(buf.split('data: ')[1].split('\n\n')[0]);
};
const until = async (code, fn, label, ms = 180000) => { const t = Date.now(); for (;;) { const s = await state(code); if (fn(s)) return s; if (Date.now() - t > ms) throw new Error('timeout: ' + label); await new Promise((r) => setTimeout(r, 400)); } };
const selfie = (n) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, n + '.jpg')).toString('base64');

(async () => {
  const { code, hostKey } = await post('/api/room', {});
  console.log('room', code);
  const P = {};
  await rejects('/api/join', { code, name: 'pornstar' }, 'unsafe name rejected');
  for (const n of ['Supreme', 'Dre', 'Mika', 'Lou']) P[n] = (await post('/api/join', { code, name: n })).pid;
  await rejects('/api/join', { code, name: 'Fifth' }, 'room caps at 4');
  await rejects('/api/character', { code, pid: P.Supreme, selfie: selfie('supreme'), consent: false }, 'selfie without consent rejected');
  await rejects('/api/host/start', { code, hostKey }, 'cannot start without ready characters');
  // two selfie players, two presets; one preset conflict
  await post('/api/character', { code, pid: P.Supreme, selfie: selfie('supreme'), consent: true });
  await post('/api/character', { code, pid: P.Dre, selfie: selfie('dre'), consent: true });
  await post('/api/character', { code, pid: P.Mika, preset: 'mika' });
  await rejects('/api/character', { code, pid: P.Lou, preset: 'mika' }, 'preset can only be taken once');
  await post('/api/character', { code, pid: P.Lou, preset: 'lou' });
  let s = await until(code, (s) => s.players.filter((p) => p.char && p.char.status === 'ready').length === 4, 'characters');
  ok(s.players.find((p) => p.name === 'Supreme').char.url.includes('_char1.png'), 'selfie character generated');
  await post('/api/character', { code, pid: P.Supreme, reroll: true });
  s = await until(code, (s) => { const c = s.players.find((p) => p.name === 'Supreme').char; return c.status === 'ready' && c.url.includes('_char2'); }, 'reroll');
  ok(s.players.find((p) => p.name === 'Supreme').char.rerollsLeft === 1, 'reroll counted');
  for (const n of ['Supreme', 'Dre']) await post('/api/accept', { code, pid: P[n] });
  await post('/api/host/settings', { code, hostKey, genre: 'horror', directSeconds: 30 });
  s = await state(code); ok(s.genre === 'horror' && s.directSeconds === 30, 'host settings applied');
  await post('/api/host/start', { code, hostKey });
  for (let i = 0; i < 3; i++) {
    s = await until(code, (s) => s.phase === 'directing' && s.sceneIndex === i, 'directing ' + i);
    const dir = s.director.id; const other = Object.values(P).find((p) => p !== dir);
    await rejects('/api/direct', { code, pid: other, shotId: s.scene.shots[1].id, castIds: [dir] }, `scene ${i + 1}: non-director blocked`);
    if (i === 0) await rejects('/api/direct', { code, pid: dir, shotId: s.scene.shots[0].id, castIds: [P.Dre], twist: 'everyone gets naked' }, 'unsafe twist rejected');
    await post('/api/direct', { code, pid: dir, shotId: s.scene.shots[i % 3].id, castIds: [P.Dre, P.Lou], twist: ['Dre forgot the flashlight', 'Lou hears it first', ''][i] });
    const after = await state(code);
    ok(!after.renders.some((r) => r.twist), `scene ${i + 1}: twist hidden before premiere`);
  }
  const prem = await until(code, (s) => s.phase === 'premiere', 'premiere');
  ok(prem.renders.every((r) => r.status === 'done'), 'all scenes rendered: ' + prem.renders.map((r) => r.status).join(','));
  ok(prem.renders[0].twist === 'Dre forgot the flashlight', 'twists revealed at premiere');
  await post('/api/react', { code, pid: P.Lou, emoji: '🔥' });
  await post('/api/host/vote', { code, hostKey });
  await rejects('/api/vote', { code, pid: P.Lou, bestDirector: 'nobody', bestPerformance: P.Dre }, 'invalid vote rejected');
  for (const n of Object.keys(P)) await post('/api/vote', { code, pid: P[n], bestDirector: prem.renders[0].directorId, bestPerformance: P.Dre });
  const res = await until(code, (s) => s.phase === 'results', 'results');
  ok(res.results.bestPerformance.name === 'Dre', 'awards tallied');
  const fin = await until(code, (s) => s.film && s.film.status !== 'stitching', 'film');
  ok(fin.film.status === 'ready', 'film exported: ' + JSON.stringify(fin.film));
  for (const u of [fin.film.wide, fin.film.vertical]) { const r = await fetch(BASE + u, { headers: { Range: 'bytes=0-99' } }); ok(r.status === 206, `${u} serves byte ranges`); }
  await post('/api/host/again', { code, hostKey });
  s = await state(code); ok(s.phase === 'lobby' && s.players.length === 4, 'shoot another keeps the cast');
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('SIM FAILED', e.message); process.exit(1); });
