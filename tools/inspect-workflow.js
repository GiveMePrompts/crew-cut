#!/usr/bin/env node
// Usage: node tools/inspect-workflow.js workflows/character.json
// Prints every node and the bindings Crew Cut will use. Pin them with workflows/<name>.bindings.json if a guess is wrong.
const fs = require('fs');
const { detectBindings } = require('./bindings');
const file = process.argv[2];
if (!file) { console.error('usage: node tools/inspect-workflow.js workflows/<name>.json'); process.exit(1); }
const g = JSON.parse(fs.readFileSync(file, 'utf8'));
if (g.nodes && g.links) { console.error('This is a UI-format workflow. In ComfyUI use Workflow > Export (API).'); process.exit(1); }
for (const [id, n] of Object.entries(g)) {
  const simple = Object.entries(n.inputs || {}).filter(([, v]) => !Array.isArray(v)).map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 50)}`).join('  ');
  console.log(`${id.padStart(4)}  ${n.class_type}${simple ? '   ' + simple : ''}`);
}
const b = detectBindings(g);
console.log('\nDetected bindings:\n' + JSON.stringify(b, null, 2));
if (!b.images.length) console.log('! No LoadImage node: this stage cannot receive the selfie/character/keyframe.');
if (!b.prompt) console.log('! No prompt node found: Crew Cut prompts will be ignored.');
if (!b.output) console.log('! No SaveImage/SaveVideo node: add one.');
