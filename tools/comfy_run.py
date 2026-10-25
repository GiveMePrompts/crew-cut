#!/usr/bin/env python3
"""Minimal ComfyUI API runner for Crew Cut tests: submit an API graph, wait, copy outputs.

usage: comfy_run.py <graph.json> <outdir> [--set node.field=value ...] [--upload node=path ...]
"""
import json, sys, time, uuid, urllib.request, urllib.parse, shutil, pathlib, mimetypes

BASE = 'http://127.0.0.1:8188'

def req(path, data=None, headers=None):
    r = urllib.request.Request(BASE + path, data=data, headers=headers or {})
    with urllib.request.urlopen(r, timeout=600) as f:
        return f.read()

def upload(path):
    p = pathlib.Path(path); b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="image"; filename="{p.name}"\r\n'
            f'Content-Type: {mimetypes.guess_type(p.name)[0] or "application/octet-stream"}\r\n\r\n').encode() + p.read_bytes() + \
           f'\r\n--{b}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{b}--\r\n'.encode()
    out = json.loads(req('/upload/image', body, {'Content-Type': f'multipart/form-data; boundary={b}'}))
    return (out.get('subfolder') + '/' if out.get('subfolder') else '') + out['name']

def main():
    graph = json.load(open(sys.argv[1])); outdir = pathlib.Path(sys.argv[2]); outdir.mkdir(parents=True, exist_ok=True)
    args = sys.argv[3:]
    for i, a in enumerate(args):
        if a == '--set':
            k, v = args[i + 1].split('=', 1); node, field = k.rsplit('.', 1)
            try: v = json.loads(v)
            except Exception: pass
            graph[node]['inputs'][field] = v
        if a == '--upload':
            node, path = args[i + 1].split('=', 1)
            graph[node]['inputs']['image'] = upload(path)
    t0 = time.time()
    pid = json.loads(req('/prompt', json.dumps({'prompt': graph, 'client_id': 'crewcut-test'}).encode(), {'Content-Type': 'application/json'}))['prompt_id']
    while True:
        h = json.loads(req(f'/history/{pid}'))
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('completed') or st.get('status_str') in ('success', 'error'):
                break
        time.sleep(1)
    secs = round(time.time() - t0, 1)
    if st.get('status_str') == 'error':
        print(json.dumps({'error': [m for m in st.get('messages', []) if m[0] == 'execution_error']}, indent=1)[:3000]); sys.exit(1)
    files = []
    for node, out in h[pid]['outputs'].items():
        for key in ('images', 'gifs', 'videos', 'animated'):
            for o in out.get(key, []) if isinstance(out.get(key), list) else []:
                if not isinstance(o, dict) or 'filename' not in o: continue
                q = urllib.parse.urlencode({'filename': o['filename'], 'subfolder': o.get('subfolder', ''), 'type': o.get('type', 'output')})
                dst = outdir / o['filename']; dst.write_bytes(req('/view?' + q)); files.append(str(dst))
    print(json.dumps({'seconds': secs, 'files': files}))

main()
