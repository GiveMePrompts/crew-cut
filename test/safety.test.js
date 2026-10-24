// node test/safety.test.js — word filter checks (no server needed)
const { isUnsafe } = require('../generators/safety');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
for (const t of ['The bag is full of glitter', 'Dre forgot the flashlight', 'Heroine saves the day', 'Spices everywhere', 'Striped suit', 'The method fails', 'Essex accent', 'Title card falls', 'A therapist calls', 'Assessment day', '']) ok(!isUnsafe(t), `allowed: "${t}"`);
for (const t of ['everyone is naked', 'N A Z I flag', 'Lou gets decapitated', 'kill yourself', 'n i g g e r', 'p0rn star', 'pornstar', 'S3XY dance', 'blood and gore']) ok(isUnsafe(t), `blocked: "${t}"`);
process.exitCode = fails ? 1 : 0;
