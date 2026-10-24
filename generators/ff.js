// ffmpeg helpers shared by the generators and the film export.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FONT_DISPLAY = path.join(__dirname, '..', 'public', 'fonts', 'BigShouldersStencil-Black.ttf');
const FONT_UI = path.join(__dirname, '..', 'public', 'fonts', 'Fredoka-SemiBold.ttf');

// FFMPEG_PATH picks a specific binary. The film export needs the drawtext filter
// (libfreetype); Homebrew's plain `ffmpeg` formula ships without it, `ffmpeg-full` has it.
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function hasDrawtext() {
  try {
    const out = require('child_process').execFileSync(FFMPEG, ['-hide_banner', '-filters'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return / drawtext /.test(out);
  } catch { return false; }
}

function ff(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`ffmpeg not found (${e.message}). Install it: brew install ffmpeg-full`)));
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.slice(-500)}`))));
  });
}

// drawtext reads text from a file so names and twists never need escaping.
let n = 0;
function textFile(dir, text) {
  const f = path.join(dir, `.txt${process.pid}_${n++}.txt`);
  fs.writeFileSync(f, String(text).replace(/\r?\n/g, ' '));
  return f.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
const font = (f) => f.replace(/\\/g, '/').replace(/:/g, '\\:');

function drawText(dir, text, { size, color = 'white', x = '(w-tw)/2', y, display = true, box = null }) {
  const b = box ? `:box=1:boxcolor=${box}:boxborderw=14` : '';
  return `drawtext=fontfile='${font(display ? FONT_DISPLAY : FONT_UI)}':textfile='${textFile(dir, text)}':fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}${b}`;
}

// A 1280x720 still card on ultramarine with stacked lines, as a short clip.
async function card(out, dir, lines, seconds = 3) {
  const vf = lines.map((l) => drawText(dir, l.text, l)).join(',');
  await ff(['-y', '-f', 'lavfi', '-i', `color=c=0x1B1FB3:s=1280x720:d=${seconds}:r=25`, '-vf', `${vf},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', out]);
  return out;
}

// Remove a flat background color (the character workflows render on flat cyan).
async function keyOut(src, out, hex = '0x00FFFF') {
  await ff(['-y', '-i', src, '-vf', `colorkey=${hex}:0.32:0.08,format=rgba`, out]);
  return out;
}

module.exports = { ff, card, drawText, keyOut, hasDrawtext, FFMPEG, FONT_DISPLAY, FONT_UI };
