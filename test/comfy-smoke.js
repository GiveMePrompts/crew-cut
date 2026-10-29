// Real-AI smoke test: one selfie through the Comfy SDK, then one scene.
// Usage: GENERATOR=comfy server running, then: node test/comfy-smoke.js [baseUrl] [selfie.png]
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2] || 'http://localhost:3000';
const SELFIE = process.argv[3] || path.join(__dirname, '..', 'examples', 'selfies', 'rosa.jpg');
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; };
const state = async (code) => {
  const r = await fetch(`${BASE}/events?code=${code}`); const rd = r.body.getReader(); let buf = '';
  while (!buf.includes('\n\n')) buf += new TextDecoder().decode((await rd.read()).value);
  rd.cancel(); return JSON.parse(buf.split('data: ')[1].split('\n\n')[0]);
};
const until = async (code, fn, label, ms = 900000) => { const t = Date.now(); for (;;) { const s = await state(code); if (fn(s)) return s; if (Date.now() - t > ms) throw new Error('timeout: ' + label); await new Promise((r) => setTimeout(r, 2000)); } };
const mime = SELFIE.endsWith('.png') ? 'image/png' : 'image/jpeg';

(async () => {
  const t0 = Date.now(); const secs = () => Math.round((Date.now() - t0) / 1000);
  const { code, hostKey } = await post('/api/room', {});
  const A = (await post('/api/join', { code, name: 'Rosa' })).pid;
  const B = (await post('/api/join', { code, name: 'Mika' })).pid;
  await post('/api/character', { code, pid: A, selfie: `data:${mime};base64,` + fs.readFileSync(SELFIE).toString('base64'), consent: true });
  await post('/api/character', { code, pid: B, preset: 'mika' });
  let s = await until(code, (s) => s.players.every((p) => p.char && ['ready', 'failed'].includes(p.char.status)), 'character');
  const rosa = s.players.find((p) => p.name === 'Rosa');
  console.log(`character: ${rosa.char.status} after ${secs()} s`, rosa.char.error || '');
  if (rosa.char.status !== 'ready') process.exit(1);
  for (const pid of [A, B]) await post('/api/accept', { code, pid }).catch(() => {});
  await post('/api/host/settings', { code, hostKey, genre: 'heist', directSeconds: 60 });
  await post('/api/host/start', { code, hostKey });
  s = await until(code, (s) => s.phase === 'directing', 'directing');
  await post('/api/direct', { code, pid: s.director.id, shotId: s.scene.shots[0].id, castIds: [A], twist: 'the map is upside down' });
  s = await until(code, (s) => s.renders && s.renders[0] && ['done', 'failed'].includes(s.renders[0].status), 'scene 1');
  console.log(`scene 1: ${s.renders[0].status} after ${secs()} s`, s.renders[0].error || '', s.renders[0].mock === false ? '(real)' : '');
  console.log(JSON.stringify({ code, character: rosa.char, render: s.renders[0] }, null, 1).slice(0, 1500));
  process.exit(s.renders[0].status === 'done' ? 0 : 1);
})().catch((e) => { console.error('SMOKE FAILED', e.message); process.exit(1); });
