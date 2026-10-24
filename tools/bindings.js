// Finds where to plug inputs into an API-format ComfyUI workflow.
const OUTPUT = /^(SaveImage|SaveVideo|SaveWEBM|SaveAnimatedWEBP|SaveAnimatedPNG|VHS_VideoCombine|PreviewImage)$/;
const TEXT = /(TextEncode|Prompt|CLIPText)/i;
const NEGATIVE = /\b(blurry|worst|low quality|lowres|bad anatomy|watermark|deformed|ugly|negative)\b/i;

function detectBindings(graph) {
  const ids = Object.keys(graph).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const images = ids.filter((id) => graph[id].class_type === 'LoadImage').map((id) => ({ node: id, field: 'image' }));
  let prompt = null;
  for (const id of ids) {
    const n = graph[id];
    if (!TEXT.test(n.class_type || '')) continue;
    for (const f of ['text', 'prompt', 'positive']) {
      const v = n.inputs && n.inputs[f];
      if (typeof v === 'string' && !NEGATIVE.test(v)) { prompt = { node: id, field: f }; break; }
    }
    if (prompt) break;
  }
  const seeds = [];
  for (const id of ids) for (const f of ['seed', 'noise_seed']) if (graph[id].inputs && typeof graph[id].inputs[f] === 'number') seeds.push({ node: id, field: f });
  const outId = ids.find((id) => OUTPUT.test(graph[id].class_type) && graph[id].class_type !== 'PreviewImage') || ids.find((id) => OUTPUT.test(graph[id].class_type));
  return { images, prompt, seeds, output: outId ? { node: outId } : null };
}
module.exports = { detectBindings };
