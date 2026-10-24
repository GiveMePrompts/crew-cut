// Mock generator: no GPU. Lets the whole product run end to end.
//   character(): posterized, ink-lined version of the selfie (stand-in for the AI character)
//   scene():     the cast's character art over a genre-colored backdrop, 5s, with gentle motion
const path = require('path');
const { ff } = require('./ff');

const DELAY_MS = Number(process.env.MOCK_DELAY_MS || 5000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BG = {
  heist: ['0x0a0c3a', '0x1B1FB3', '0xFFC72C'],
  horror: ['0x020604', '0x0f2a1f', '0x5a7a6a'],
  romcom: ['0x5a1a8a', '0xFF2E88', '0xFFC72C'],
};

async function fakeProgress(onProgress, ms, upto = 90) {
  const steps = 12;
  for (let i = 1; i <= steps; i++) { await sleep(ms / steps); onProgress(Math.round((i / steps) * upto)); }
}

async function character({ selfiePath, outPath }, onProgress = () => {}) {
  await fakeProgress(onProgress, DELAY_MS * 0.6);
  await ff(['-y', '-i', selfiePath, '-filter_complex',
    "[0]scale=768:768,format=rgb24,split[a][b];[a]eq=saturation=1.7:contrast=1.25,lutrgb=r='floor(val/42)*42':g='floor(val/42)*42':b='floor(val/42)*42',format=gbrp[c];" +
    '[b]format=gray,edgedetect=low=0.06:high=0.2,negate,format=gbrp[e];[c][e]blend=all_mode=multiply,format=rgb24',
    '-frames:v', '1', outPath]);
  onProgress(100);
  return { imagePath: outPath, cutout: false };
}

async function scene(job, onProgress = () => {}) {
  await fakeProgress(onProgress, DELAY_MS);
  const out = path.join(job.outDir, `scene${job.sceneIndex + 1}.mp4`);
  const [c0, c1, c2] = BG[job.genre] || BG.heist;
  const cast = job.cast.slice(0, 3);
  const inputs = ['-f', 'lavfi', '-i', `gradients=s=1280x720:d=5:r=25:c0=${c0}:c1=${c1}:c2=${c2}:nb_colors=3:speed=0.02`];
  cast.forEach((c) => inputs.push('-loop', '1', '-t', '5', '-i', c.characterPath));
  let chain = '';
  let last = '0:v';
  cast.forEach((c, i) => {
    const slot = cast.length === 1 ? '(W-w)/2' : `${(i + 0.5) / cast.length}*W-w/2`;
    chain += `[${i + 1}:v]scale=-2:${cast.length === 1 ? 600 : 500},format=rgba[c${i}];`;
    chain += `[${last}][c${i}]overlay=x='${slot}+40*sin(t*1.3+${i})':y='H-h-20+12*sin(t*2.1+${i})':shortest=1[o${i}];`;
    last = `o${i}`;
  });
  chain += `[${last}]scale=1408:792,crop=1280:720:'64-64*t/5':'36-36*t/5',format=yuv420p[v]`;
  await ff(['-y', ...inputs, '-filter_complex', chain, '-map', '[v]', '-t', '5', '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-an', out]);
  onProgress(100);
  return { videoPath: out, mock: true };
}

module.exports = { name: 'mock', character, scene };
