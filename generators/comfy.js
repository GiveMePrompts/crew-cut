// Comfy generator: runs the real pipeline through the official Comfy SDK (@comfyorg/sdk).
// The same code targets three places; only env vars change:
//   Local ComfyUI (Mac/PC): run `comfy-api-proxy`, then COMFY_BASE_URL=http://127.0.0.1:8189
//   Comfy Cloud:            COMFY_API_KEY=comfyui-...   (paid plan needed for API access)
//   Comfy API deployment:   COMFY_BASE_URL=https://<deployment>.run.comfy.app  COMFY_API_KEY=...
//
// Workflows live in /workflows as ComfyUI "Export (API)" JSON files:
//   character.json  selfie -> full-body character on flat cyan (image edit model)
//   keyframe.json   1-3 character images + scene prompt -> 16:9 still (image edit model)
//   scene.json      keyframe + motion prompt -> short video (image-to-video model)
// Which node gets the image / prompt / seed is auto-detected, or pinned in <name>.bindings.json.
// Any stage whose workflow file is missing falls back to the mock generator, so you can wire one stage at a time.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mock = require('./mock');
const { ff, keyOut } = require('./ff');
const { detectBindings } = require('../tools/bindings');

const WF_DIR = path.join(__dirname, '..', 'workflows');
let clientPromise = null;

function client() {
  if (!clientPromise) {
    clientPromise = import('@comfyorg/sdk')
      .catch(() => { throw new Error('Comfy SDK missing. Run: npm install   (needs Node 22+)'); })
      .then(({ Comfy }) => new Comfy(process.env.COMFY_API_KEY ? { apiKey: process.env.COMFY_API_KEY } : {}));
  }
  return clientPromise;
}

const cache = {};
function stage(name) {
  const file = path.join(WF_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file).mtimeMs;
  if (cache[name] && cache[name].stat === stat) return cache[name];
  const graph = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (graph.nodes && graph.links) throw new Error(`${name}.json is a UI workflow. In ComfyUI use Workflow > Export (API) instead.`);
  const bfile = path.join(WF_DIR, `${name}.bindings.json`);
  const bindings = fs.existsSync(bfile) ? JSON.parse(fs.readFileSync(bfile, 'utf8')) : detectBindings(graph);
  if (!bindings.output) throw new Error(`${name}.json: no output node found (SaveImage / SaveVideo). Add ${name}.bindings.json.`);
  cache[name] = { graph, bindings, stat };
  return cache[name];
}

async function runStage(name, { images = [], prompt, seed }, outBase, onProgress) {
  const s = stage(name);
  const c = await client();
  const wf = c.workflows.fromJson(JSON.parse(JSON.stringify(s.graph)));
  const b = s.bindings;
  (b.images || []).forEach((slot, i) => {
    const img = images[Math.min(i, images.length - 1)];
    if (img) wf.setInput(slot.node, slot.field, c.assets.fromFile(img));
  });
  if (b.prompt && prompt) wf.setInput(b.prompt.node, b.prompt.field, prompt);
  for (const sd of b.seeds || []) wf.setInput(sd.node, sd.field, seed);
  const job = await c.submit(wf);
  try {
    for await (const ev of job.events()) {
      if (ev.kind === 'progress' && typeof ev.value === 'number') onProgress(Math.min(95, Math.round(ev.value * 100)));
      if (ev.kind === 'statusChange' && ['succeeded', 'failed', 'canceled', 'expired'].includes(ev.status)) break;
    }
  } catch (_) { /* stream is best effort; result() below is authoritative */ }
  await job.result();
  const outs = job.getOutputs(String(b.output.node));
  if (!outs.length) throw new Error(`${name}: workflow finished but node ${b.output.node} produced nothing`);
  const o = outs[outs.length - 1];
  const file = `${outBase}${path.extname(o.name) || '.bin'}`;
  await o.toFile(file);
  return file;
}

const seedOf = (s) => (s == null ? crypto.randomInt(1, 2 ** 31) : s);

const CHARACTER_PROMPT = 'Redraw this exact person as a full-body flat cel-shaded animated character: thick black outlines, bold flat colors, streetwear outfit, confident standing pose, centered, whole body visible from head to shoes with space around. Keep their face, skin tone, hair and features clearly recognizable. Flat solid cyan (#00FFFF) background, no shadow, no text, no logos.';

async function character(job, onProgress = () => {}) {
  if (!stage('character')) return mock.character(job, onProgress);
  const raw = await runStage('character', { images: [job.selfiePath], prompt: job.prompt || CHARACTER_PROMPT, seed: seedOf(job.seed) }, job.outPath.replace(/\.png$/, '_raw'), onProgress);
  await keyOut(raw, job.outPath); // cyan -> transparent
  onProgress(100);
  return { imagePath: job.outPath, cutout: true };
}

async function scene(job, onProgress = () => {}) {
  if (!stage('scene')) return mock.scene(job, onProgress);
  const base = path.join(job.outDir, `scene${job.sceneIndex + 1}`);
  let still = job.cast[0].characterPath;
  if (stage('keyframe')) {
    still = await runStage('keyframe', { images: job.cast.map((c) => c.characterPath), prompt: job.prompts.keyframe, seed: seedOf() }, `${base}_key`, (p) => onProgress(Math.round(p * 0.35)));
  }
  const vid = await runStage('scene', { images: [still], prompt: job.prompts.motion, seed: seedOf() }, `${base}_raw`, (p) => onProgress(35 + Math.round(p * 0.6)));
  const out = `${base}.mp4`;
  // normalize whatever the video node saved (mp4/webm/webp) to 1280x720 H.264 for every browser
  await ff(['-y', '-i', vid, '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=25,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-an', out]);
  onProgress(100);
  return { videoPath: out, mock: false };
}

module.exports = { name: 'comfy', character, scene, stage };
