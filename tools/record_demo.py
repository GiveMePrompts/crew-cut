#!/usr/bin/env python3
"""Record a full real-AI Crew Cut game: the TV page and one real phone (Rosa), plus 3 API players.

usage: record_demo.py <baseUrl> <outdir> <selfie.jpg>
Writes tv.webm, phone.webm and timeline.json (seconds since recording start per phase).
"""
import asyncio, json, sys, time, urllib.request, shutil
from pathlib import Path
from playwright.async_api import async_playwright

BASE, OUT, SELFIE = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
OUT.mkdir(parents=True, exist_ok=True)
T0 = None
timeline = []

def mark(label):
    t = round(time.time() - T0, 1); timeline.append([t, label]); print(f'{t:7.1f}s  {label}', flush=True)
    (OUT / 'timeline.json').write_text(json.dumps(timeline, indent=1))

def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())

async def state(page):
    return await page.evaluate("""async (code) => { const r = await fetch('/events?code=' + code); const rd = r.body.getReader(); let b = '';
      while (!b.includes('\\n\\n')) b += new TextDecoder().decode((await rd.read()).value); rd.cancel();
      return JSON.parse(b.split('data: ')[1].split('\\n\\n')[0]); }""", CODE)

async def until(page, fn, label, timeout=1800):
    t = time.time()
    while True:
        s = await state(page)
        if fn(s): return s
        if time.time() - t > timeout: raise SystemExit('timeout ' + label)
        await asyncio.sleep(1.5)

async def main():
    global T0, CODE
    async with async_playwright() as pw:
        br = await pw.chromium.launch(channel='chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
        tvc = await br.new_context(viewport={'width': 1280, 'height': 720}, record_video_dir=str(OUT / 'raw_tv'), record_video_size={'width': 1280, 'height': 720})
        phc = await br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                   record_video_dir=str(OUT / 'raw_phone'), record_video_size={'width': 390, 'height': 844})
        T0 = time.time()
        tv = await tvc.new_page(); await tv.goto(BASE + '/'); await tv.wait_for_timeout(2500)
        room = await tv.evaluate("JSON.parse(sessionStorage.getItem('cc_host'))"); CODE = room['code']; key = room['hostKey']
        mark(f'tv lobby {CODE}')
        ph = await phc.new_page(); await ph.goto(f'{BASE}/play?code={CODE}'); await ph.wait_for_timeout(1500)
        await ph.click('#name'); await ph.keyboard.type('Rosa', delay=120); await ph.wait_for_timeout(500); await ph.tap('#go')
        mark('phone joined')
        await ph.wait_for_selector('#cam', state='attached', timeout=20000); await ph.wait_for_timeout(1200)
        await ph.set_input_files('#cam', SELFIE); await ph.wait_for_timeout(1500)
        await ph.tap('#consent'); await ph.wait_for_timeout(600); await ph.tap('#draw')
        mark('selfie sent')
        pids = {}
        for name, preset in (('Dre', 'dre'), ('Mika', 'mika')):  # 3 players = everyone directs one scene
            pids[name] = post('/api/join', {'code': CODE, 'name': name})['pid']; await asyncio.sleep(1.2)
            post('/api/character', {'code': CODE, 'pid': pids[name], 'preset': preset}); await asyncio.sleep(1.5)
        await ph.wait_for_selector('#ok', timeout=900000); mark('character ready on phone')
        await ph.wait_for_timeout(4000); await ph.tap('#ok'); mark('rosa locked in')
        post('/api/host/settings', {'code': CODE, 'hostKey': key, 'genre': 'heist', 'directSeconds': 60}); await tv.wait_for_timeout(3000)
        await tv.click('#start'); mark('shoot started')
        s = await state(tv)
        rosa = next(p['id'] for p in s['players'] if p['name'] == 'Rosa')
        twists = ['the map is upside down', 'Dre brought a rubber duck instead of the drill', 'the vault is already open']
        for i in range(3):
            s = await until(tv, lambda s: s['phase'] == 'directing' and s['sceneIndex'] == i, f'directing {i}')
            d = s['director']['id']; mark(f'scene {i+1} directing by {s["director"]["name"]}')
            cast = [[rosa], [pids['Dre']], [rosa]][i]
            if d == rosa:
                await ph.wait_for_selector('#lock', timeout=30000); await ph.wait_for_timeout(2500)
                shots = await ph.query_selector_all('[data-shot]'); await shots[i % len(shots)].tap(); await ph.wait_for_timeout(1200)
                for c in cast: await ph.tap(f'[data-cast="{c}"]'); await ph.wait_for_timeout(900)
                await ph.tap('#twist'); await ph.keyboard.type(twists[i], delay=70); await ph.wait_for_timeout(1000)
                await ph.tap('#lock')
            else:
                await asyncio.sleep(8)
                post('/api/direct', {'code': CODE, 'pid': d, 'shotId': s['scene']['shots'][i % 3]['id'], 'castIds': cast, 'twist': twists[i]})
            mark(f'scene {i+1} locked')
        s = await until(tv, lambda s: s['phase'] == 'premiere', 'premiere'); mark('premiere')
        for e in ['🔥', '😂', '🔥', '😱', '👏', '🔥']:
            await asyncio.sleep(4)
            b = await ph.query_selector(f'[data-e="{e}"]')
            if b: await b.tap()
        s = await until(tv, lambda s: s['phase'] == 'voting', 'voting', timeout=600); mark('voting')
        best_dir = s['renders'][0]['directorId']
        for pid in [rosa] + list(pids.values()):
            await asyncio.sleep(1.5); post('/api/vote', {'code': CODE, 'pid': pid, 'bestDirector': best_dir, 'bestPerformance': rosa})
        s = await until(tv, lambda s: s['phase'] == 'results', 'results'); mark('results')
        s = await until(tv, lambda s: s.get('film') and s['film'].get('status') != 'stitching', 'film', timeout=900); mark('film ' + json.dumps(s['film']))
        await asyncio.sleep(12)
        (OUT / 'final_state.json').write_text(json.dumps(s, indent=1))
        vt, vp = tv.video, ph.video
        await tvc.close(); await phc.close()
        shutil.move(await vt.path(), OUT / 'tv.webm'); shutil.move(await vp.path(), OUT / 'phone.webm')
        mark('done'); await br.close()

asyncio.run(main())
