// Keep the party SFW: a small word filter for player names and twists,
// plus a safety line added to every generation prompt.
// It blocks the obvious cases; it is not a full moderation system.

// Whole words (an optional trailing "s" is allowed).
const WORDS = [
  'nude', 'nudes', 'naked', 'nsfw', 'sex', 'sexy', 'boob', 'boobs', 'tit', 'titty', 'nipple', 'penis', 'dick', 'cock',
  'pussy', 'vagina', 'cum', 'orgasm', 'horny', 'blowjob', 'handjob', 'stripper', 'thong', 'lingerie', 'onlyfans', 'hentai', 'fetish', 'bdsm',
  'gore', 'gory', 'behead', 'beheaded', 'beheading', 'suicide', 'selfharm', 'kys', 'rape', 'raped', 'raping', 'rapist', 'torture', 'tortured',
  'massacre', 'cocaine', 'heroin', 'meth', 'fentanyl',
  'nazi', 'hitler', 'kkk',
];
// Word starts ("decapitated", "dismembering").
const PREFIXES = ['porn', 'decapitat', 'dismember', 'mutilat', 'disembowel', 'terroris', 'molest'];
// Phrases.
const PHRASES = ['self harm', 'kill yourself', 'school shooting', 'bomb threat', 'crack pipe'];
// Slurs: also caught when spaced or punctuated out ("n i g g e r").
const SLURS = ['nigger', 'nigga', 'faggot', 'fag', 'retard', 'tranny', 'chink', 'spic', 'kike', 'wetback'];

const norm = (s) => String(s || '').toLowerCase()
  .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/\$/g, 's').replace(/7/g, 't')
  .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const word = (w) => new RegExp(`(^|\\s)${w}s?(\\s|$)`);
const PATTERNS = [
  ...WORDS.map(word), ...SLURS.map(word),
  ...PREFIXES.map((p) => new RegExp(`(^|\\s)${p}`)),
  ...PHRASES.map((p) => new RegExp(`(^|\\s)${p}(\\s|$)`)),
];

function isUnsafe(text) {
  const t = norm(text);
  if (!t) return false;
  if (PATTERNS.some((re) => re.test(t))) return true;
  // Spaced-out words: only when the text is mostly single letters.
  const singles = t.split(' ').filter((x) => x.length === 1).length;
  if (singles >= 3) {
    const squeezed = t.replace(/\s/g, '');
    return [...SLURS, ...WORDS].some((s) => s.length >= 4 && squeezed.includes(s));
  }
  return false;
}

const SAFETY_LINE = 'Family-friendly and safe for work: everyone fully clothed, no nudity, no gore, no weapons pointed at people, no real brands or logos.';

module.exports = { isUnsafe, SAFETY_LINE };
