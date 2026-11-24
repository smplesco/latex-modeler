// Builds src/hand/templates.json: the shapes the handwriting recogniser compares strokes with.
// Sources: the Hershey stroke fonts and EMS single-line fonts from the hersheytext package (MIT; EMS fonts under the
// SIL Open Font License). Each glyph becomes a cloud of points, already resampled and normalised.
// Run: npx tsx scripts/hand-templates.mts [--test]   (--test writes the held-out fonts to tests/hand-test.json instead)
import { readFileSync, writeFileSync } from 'node:fs';
import { normalize } from '../src/hand/cloud';

const H = JSON.parse(readFileSync('node_modules/hersheytext/hersheytext.json', 'utf8'));
const svgFont = name => {
  const s = readFileSync(`node_modules/hersheytext/svg_fonts/${name}.svg`, 'utf8'); const out = {};
  for (const m of s.matchAll(/<glyph unicode="([^"]*)"[^>]*?(?:d="([^"]*)")?\s*\/>/g)) {
    const ch = m[1].replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");
    if (m[2]) out[ch] = m[2];
  }
  return out;
};
/** an SVG / Hershey path "M x y L x y ..." → strokes of [x, y] (y pointing down) */
function strokes(d, flipY) {
  const res = []; let cur = null;
  const toks = d.replace(/,/g, ' ').trim().split(/\s+|(?=[ML])|(?<=[ML])/).filter(Boolean);
  let cmd = 'M';
  for (let i = 0; i < toks.length;) {
    if (/^[MLml]$/.test(toks[i])) { cmd = toks[i].toUpperCase(); i++; continue; }
    const x = +toks[i], y = +toks[i + 1]; i += 2; if (!isFinite(x) || !isFinite(y)) continue;
    if (cmd === 'M') { cur = []; res.push(cur); cmd = 'L'; }
    cur.push([x, flipY ? -y : y]);
  }
  return res.filter(s => s.length);
}

// what each label is called in LaTeX
const LETTERS = 'abcdefghijkmnpqrstuvwxyz'.split('');            // l and o look like 1 and 0: sorted out from context
const CAPS = 'ABDEFGHLMNPRT'.split('');
const DIGITS = '0123456789'.split('');
const ASCII_SYM = ['+', '-', '=', '(', ')', '[', ']', '/', '<', '>', '!'];
const ascii = [...DIGITS, ...LETTERS, ...CAPS, ...ASCII_SYM];
const MATHLOW = { '±': 0, '≤': 5, '≥': 6, '(': 7, ')': 8, '+': 10, '-': 12, '/': 14, 'Σ': 26, '<': 27, '=': 28, '>': 29, '≠': 30, '[': 58, ']': 60, '∞': 62, '√': [66, 78], '∫': [79, 80], '∂': 76 };
DIGITS.forEach((d, i) => (MATHLOW[d] = 15 + i));
LETTERS.forEach(c => (MATHLOW[c] = 32 + c.charCodeAt(0) - 97));
const MATHUPP = {}; CAPS.forEach(c => (MATHUPP[c] = 32 + c.charCodeAt(0) - 65));
const GREEK = { 'α': 64, 'β': 65, 'γ': 70, 'δ': 67, 'ε': 68, 'θ': [48, 80], 'λ': 75, 'μ': 76, 'π': 79, 'ρ': 81, 'σ': 82, 'τ': 83, 'φ': [69, 37], 'ω': 86, 'Δ': 35, 'Ω': 54 };

const test = process.argv.includes('--test');
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '';
const ALL_SVG = ['EMSReadability', 'EMSTech', 'EMSOsmotron', 'HersheySans1', 'EMSNixish', 'EMSAllure', 'EMSFelix', 'EMSElfin', 'EMSReadabilityItalic', 'EMSNixishItalic', 'HersheyScript1'];
// --leave <font>: keep one font out of the templates and write it as the test set (to measure how well it generalises)
const leave = process.argv.includes('--leave') ? process.argv[process.argv.indexOf('--leave') + 1] : '';
const TRAIN_SVG = ALL_SVG.filter(f => f !== leave);
const TEST_SVG = leave ? [leave] : [];
const out = []; const add = (label, st) => { if (st.length && st.some(s => s.length)) out.push([label, normalize(st)]); };
if (!test) {
  for (const font of ['futural', 'scripts']) for (const ch of ascii) { const g = H[font].chars[ch.charCodeAt(0) - 33]; if (g?.d) add(ch, strokes(g.d, false)); }   // the Hershey ASCII fonts start at '!'
  for (const [ch, idx] of Object.entries(MATHLOW)) for (const i of [idx].flat()) { const g = H.mathlow.chars[i]; if (g?.d) add(ch, strokes(g.d, false)); }
  for (const [ch, idx] of Object.entries(MATHUPP)) add(ch, strokes(H.mathupp.chars[idx].d, false));
  for (const [ch, idx] of Object.entries(GREEK)) for (const i of [idx].flat()) add(ch, strokes(H.greek.chars[i].d, false));
}
for (const f of test ? TEST_SVG : TRAIN_SVG) { const g = svgFont(f); for (const ch of ascii) if (g[ch]) add(ch, strokes(g[ch], true)); }

const labels = [...new Set(out.map(o => o[0]))];
const data = { labels, t: out.map(([l, pts]) => [labels.indexOf(l), pts.map(v => Math.round(v * 1000))]) };
writeFileSync(outFile || (test ? 'tests/hand-test.json' : 'src/hand/templates.json'), JSON.stringify(data));
console.log(`${out.length} ${test ? 'test samples' : 'templates'}, ${labels.length} labels`);
