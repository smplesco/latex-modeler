// Handwriting tests: expressions built from stroke-font glyphs, wobbled like real writing, read back as LaTeX.
import { readFileSync } from 'node:fs';
import { recognize } from '../src/hand/recognize';

type P = [number, number];
const H = JSON.parse(readFileSync('node_modules/hersheytext/hersheytext.json', 'utf8'));
const FONTS: Record<string, { font: string; off: number }> = { a: { font: 'futural', off: 33 } };
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / 1.4; };

function glyph(ch: string, font = 'futural'): P[][] {
  const map: Record<string, [string, number]> = { 'Σ': ['mathlow', 26], '∫': ['mathlow', 80], 'π': ['greek', 79], 'θ': ['greek', 48], '∞': ['mathlow', 62] };
  const [f, idx] = map[ch] ?? [font, ch.charCodeAt(0) - 33];
  const d: string = H[f].chars[idx].d; const out: P[][] = [];
  for (const seg of d.split('M').slice(1)) out.push([...seg.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => [+m[1], +m[2]] as P));
  return out;
}
/** put a glyph down: x, baseline y, size (1 = a capital letter), with a little wobble */
function place(ch: string, x: number, y: number, s = 1): P[][] {
  // Hershey glyphs: capitals from y = 1 to the baseline at 22; the tall integral sign spans -26 to 52
  const [unit, base] = ch === '∫' ? [78 / 2.2, 40] : [21, 22];
  const sh = (rnd() - 0.5) * 0.25, sc = s * (0.92 + rnd() * 0.16) / unit;
  return glyph(ch).map(st => st.map(([gx, gy]) => { const X = gx * sc, Y = (gy - base) * sc; return [x + X - sh * Y + gauss() * 0.012, y + Y + gauss() * 0.012] as P; }));
}
const right = (g: P[][]) => Math.max(...g.flat().map(p => p[0]));
const line = (x0: number, y0: number, x1: number, y1: number): P[] => Array.from({ length: 12 }, (_, i) => [x0 + (x1 - x0) * i / 11 + gauss() * 0.01, y0 + (y1 - y0) * i / 11 + gauss() * 0.01] as P);
/** a line of text: each glyph placed after the last one, with a small gap (like handwriting) */
function row(text: string, x = 0, y = 0, s = 1, gap = 0.18): P[][] {
  const out: P[][] = [];
  for (const ch of text) {
    if (ch === ' ') { x += 0.35 * s; continue; }
    const g = place(ch, x, y, s); const xs = g.flat().map(p => p[0]); const x0 = Math.min(...xs), x1 = Math.max(...xs);
    out.push(...g.map(st => st.map(p => [p[0] - (x0 - x), p[1]] as P))); x += (x1 - x0) + gap * s;
  }
  return out;
}

export const CASES: { name: string; strokes: () => P[][]; want: string }[] = [
  { name: 'y = 3x - 2', strokes: () => row('y=3x-2'), want: 'y=3x-2' },
  { name: 'x squared plus one', strokes: () => { const x = place('x', 0, 0), two = place('2', right(x) + 0.06, -0.55, 0.55); return [...x, ...two, ...row('+1', right(two) + 0.25, 0)]; }, want: 'x^2+1' },
  { name: 'a fraction', strokes: () => [...place('1', 0.2, -0.75), line(0, -0.55, 1, -0.55), ...place('2', 0.2, 0.55)], want: '\\frac{1}{2}' },
  { name: 'square root', strokes: () => [[[0, -0.45], [0.15, -0.5], [0.35, 0.05], [0.6, -1.15], [2.7, -1.15]] as P[], ...row('x+1', 0.75, 0, 0.8)], want: '\\sqrt{x+1}' },
  { name: 'sin x', strokes: () => row('sin x'), want: '\\sin x' },
  { name: 'integral with limits', strokes: () => { const I = place('∫', 0, 0.5, 1.8); const r = right(I); return [...I, ...place('1', r + 0.05, -1.9, 0.5), ...place('0', r - 0.35, 0.75, 0.5), ...row('x dx', r + 0.55, 0)]; }, want: '\\int_0^1 x dx' },
  { name: 'pi r squared', strokes: () => { const r = row('A=πr', 0, 0); return [...r, ...place('2', right(r) + 0.08, -0.55, 0.55)]; }, want: 'A=\\pi r^2' },
];

export function runHandTests(check: (name: string, ok: boolean, info?: string) => void) {
  for (const c of CASES) {
    let ok = 0; const got: string[] = [];
    for (let k = 0; k < 6; k++) { const r = recognize(c.strokes()).latex.replace(/\s+/g, ''); got.push(r); if (r === c.want.replace(/\s+/g, '')) ok++; }
    check(`handwriting: ${c.name}`, ok >= 4, `${ok}/6 → ${got.join(' | ')}`);
  }
}
void FONTS;
