// Handwritten maths → LaTeX. Strokes are grouped into symbols, each symbol is matched against stroke-font
// templates (cloud.ts), and the layout is read: fraction bars, square roots, superscripts and subscripts,
// limits on ∫ and Σ, and function names like sin or log. Everything runs on the device.
import { normalize, cloudDistance, quickDistance, slant } from './cloud';
import TEMPLATES from './templates.json';

type P = [number, number];
interface Box { x0: number; y0: number; x1: number; y1: number }
export interface HSymbol { label: string; alts: string[]; box: Box; strokes: number[] }
export interface HResult { latex: string; symbols: HSymbol[] }

const TPL: { label: string; pts: number[] }[] = (TEMPLATES as any).t.map(([l, p]: [number, number[]]) => ({ label: (TEMPLATES as any).labels[l], pts: p.map(v => v / 1000) }));

const TEX: Record<string, string> = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\varepsilon', 'θ': '\\theta', 'λ': '\\lambda', 'μ': '\\mu', 'π': '\\pi', 'ρ': '\\rho',
  'σ': '\\sigma', 'τ': '\\tau', 'φ': '\\varphi', 'ω': '\\omega', 'Δ': '\\Delta', 'Ω': '\\Omega', 'Σ': '\\sum', '∫': '\\int', '∞': '\\infty', '≤': '\\le', '≥': '\\ge',
  '≠': '\\ne', '±': '\\pm', '∂': '\\partial', '√': '\\sqrt{}', '·': '\\cdot', '[': '[', ']': ']',
};
const FUNCS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'det'];

const box = (pts: P[]): Box => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, y0, x1, y1 }; };
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const W = (b: Box) => b.x1 - b.x0, Hh = (b: Box) => b.y1 - b.y0, cx = (b: Box) => (b.x0 + b.x1) / 2, cy = (b: Box) => (b.y0 + b.y1) / 2;

/** the best few labels for one symbol (its strokes) */
export function classify(strokes: P[][], allow?: (l: string) => boolean): { label: string; d: number }[] {
  const pts = normalize(strokes);   // leaned upright the same way the templates were
  const cand = TPL.filter(t => !allow || allow(t.label)).map(t => ({ t, q: quickDistance(pts, t.pts) })).sort((a, b) => a.q - b.q).slice(0, 48);
  const best = new Map<string, number>();
  for (const { t } of cand) { const d = cloudDistance(pts, t.pts); if (d < (best.get(t.label) ?? Infinity)) best.set(t.label, d); }
  return [...best].map(([label, d]) => ({ label, d })).sort((a, b) => a.d - b.d).slice(0, 5);
}

let raw: P[][] = [];
type Node = { kind: 'sym'; s: HSymbol } | { kind: 'frac'; num: Node[]; den: Node[]; box: Box } | { kind: 'sqrt'; body: Node[]; box: Box };
const nbox = (n: Node) => (n.kind === 'sym' ? n.s.box : n.box);

export function recognize(input: P[][]): HResult {
  let strokes = input.filter(s => s.length >= 1).map(s => s.map(p => [p[0], p[1]] as P));
  if (!strokes.length) return { latex: '', symbols: [] };
  raw = strokes;   // shapes are matched as written (each symbol is straightened on its own)
  // lean the writing upright first (everyone slants a little)
  const k = slant(strokes);
  if (k) { const all = box(strokes.flat()), yc = cy(all); strokes = strokes.map(s => s.map(p => [p[0] - k * (p[1] - yc), p[1]] as P)); }
  const boxes = strokes.map(box);
  // the size of an ordinary symbol: the median height of the strokes that aren't flat lines or dots
  const hs = boxes.map(b => Math.max(Hh(b), W(b) * 0.25)).filter(h => h > 0).sort((a, b) => a - b);
  const h = Math.max(1e-6, hs[Math.floor(hs.length * 0.7)] ?? 1);   // a little above the median: dots and dashes pull it down
  const symbols: HSymbol[] = [];
  const nodes = parseRegion(strokes.map((_, i) => i), strokes, boxes, h, symbols);
  return { latex: emit(nodes, h).trim(), symbols };
}

function parseRegion(ids: number[], strokes: P[][], boxes: Box[], h: number, out: HSymbol[]): Node[] {
  const items: Node[] = []; let rest = [...ids];
  // square roots: a tick that climbs into a long top bar, with things under the bar
  for (const i of [...rest].sort((a, b) => W(boxes[b]) - W(boxes[a]))) {
    if (!rest.includes(i)) continue;
    const b = boxes[i]; if (W(b) < 1.2 * h || Hh(b) < 0.6 * h || !isRoot(strokes[i], b)) continue;
    const inside = rest.filter(j => j !== i && cx(boxes[j]) > b.x0 + 0.25 * W(b) && cx(boxes[j]) < b.x1 + 0.1 * h && cy(boxes[j]) > b.y0 && cy(boxes[j]) < b.y1 + 0.2 * h);
    if (!inside.length) continue;
    rest = rest.filter(j => j !== i && !inside.includes(j));
    out.push({ label: '√', alts: [], box: b, strokes: [i] });
    items.push({ kind: 'sqrt', body: parseRegion(inside, strokes, boxes, h, out), box: b });
  }
  // fraction bars: a long flat stroke with something above and below it (widest first, so nested ones work)
  for (const i of [...rest].sort((a, b) => W(boxes[b]) - W(boxes[a]))) {
    if (!rest.includes(i)) continue;
    const b = boxes[i]; if (W(b) < 0.9 * h || Hh(b) > 0.3 * W(b)) continue;
    const pad = 0.15 * W(b), within = (j: number) => j !== i && cx(boxes[j]) > b.x0 - pad && cx(boxes[j]) < b.x1 + pad;
    const above = rest.filter(j => within(j) && cy(boxes[j]) < b.y0 && cy(boxes[j]) > b.y0 - 2.5 * h);
    const below = rest.filter(j => within(j) && cy(boxes[j]) > b.y1 && cy(boxes[j]) < b.y1 + 2.5 * h);
    if (!above.length || !below.length) continue;
    // an '=' is two flat strokes on top of each other, not a fraction
    if (above.length === 1 && below.length === 0) continue;
    if ((above.length === 1 && isFlat(boxes[above[0]]) && Math.abs(W(boxes[above[0]]) - W(b)) < 0.4 * W(b)) || (below.length === 1 && isFlat(boxes[below[0]]) && Math.abs(W(boxes[below[0]]) - W(b)) < 0.4 * W(b))) continue;
    rest = rest.filter(j => j !== i && !above.includes(j) && !below.includes(j));
    out.push({ label: '—', alts: [], box: b, strokes: [i] });
    items.push({ kind: 'frac', num: parseRegion(above, strokes, boxes, h, out), den: parseRegion(below, strokes, boxes, h, out), box: b });
  }
  // the rest: strokes that meet (A, x, π, +) or sit stacked over each other (=, ≤, ÷) make one symbol
  const ids2 = rest.sort((a, b) => a - b).filter(i => Math.max(W(boxes[i]), Hh(boxes[i])) >= 0.25 * h);   // dots are placed afterwards
  const parent = new Map<number, number>(ids2.map(i => [i, i]));
  const find = (i: number): number => { while (parent.get(i) !== i) i = parent.get(i)!; return i; };
  const size = (r: number) => ids2.filter(i => find(i) === r).length;
  for (let a = 0; a < ids2.length; a++) for (let c = a + 1; c < ids2.length; c++) {
    const i = ids2[a], j = ids2[c], A = boxes[i], B = boxes[j];
    const ov = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), minW = Math.max(1e-6, Math.min(W(A), W(B)));
    const vgap = Math.max(A.y0 - B.y1, B.y0 - A.y1);
    const stacked = ov > 0.5 * minW && vgap < 0.5 * h && vgap > -0.05 * h && isFlat(A) === isFlat(B);
    const meet = ov > -0.1 * h && touches(strokes[i], strokes[j], 0.1 * h);
    if (!stacked && !meet) continue;
    const ri = find(i), rj = find(j); if (ri === rj) continue;
    if (size(ri) + size(rj) > 5) continue;   // joined-up writing shouldn't swallow a whole word
    parent.set(rj, ri);
  }
  const groups: number[][] = [];
  for (const i of ids2) { const r = find(i); let g = groups.find(x => find(x[0]) === r); if (!g) groups.push(g = []); g.push(i); }
  for (const i of rest) if (!ids2.includes(i)) groups.push([i]);
  // the dot of an i or j goes with the thin upright stroke right under it; other dots stay on their own
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const g = groups[gi]; if (g.length !== 1) continue; const d = boxes[g[0]];
    if (Math.max(W(d), Hh(d)) >= 0.25 * h) continue;
    const stem = groups.filter(o => o !== g && o.length === 1).map(o => ({ o, b: boxes[o[0]] }))
      .filter(({ b }) => Hh(b) > 2.2 * W(b) && cx(d) > b.x0 - 0.2 * h && cx(d) < b.x1 + 0.2 * h && d.y1 < b.y0 + 0.1 * h && d.y1 > b.y0 - 0.7 * h)
      .sort((a, c) => Math.abs(cx(a.b) - cx(d)) - Math.abs(cx(c.b) - cx(d)))[0];
    if (stem) { stem.o.push(g[0]); groups.splice(gi, 1); continue; }
    // a dot touching a bigger symbol is part of it (the ball at the end of a stroke)
    const host = groups.find(o => o !== g && o.some(j => touches(strokes[j], strokes[g[0]], 0.06 * h)));
    if (host) { host.push(g[0]); groups.splice(gi, 1); }
  }
  for (const g of groups) {
    const b = g.map(j => boxes[j]).reduce(union);
    const sym: HSymbol = { label: '?', alts: [], box: b, strokes: g };
    const size = Math.max(W(b), Hh(b));
    if (size < 0.22 * h) sym.label = '.';                              // decided from its position later
    else if (g.length === 1 && Hh(b) < 0.22 * W(b) && W(b) < 1.6 * h) sym.label = '-';
    else {
      const top = classify(g.map(j => raw[j]));
      sym.label = top[0]?.label ?? '?'; sym.alts = top.slice(1, 4).map(t => t.label);
      // a capital and its lower-case twin are told apart by size
      if (/^[a-z]$/.test(sym.label) && Hh(b) > 1.25 * h && top.some(t => t.label === sym.label.toUpperCase())) sym.label = sym.label.toUpperCase();
    }
    out.push(sym); items.push({ kind: 'sym', s: sym });
  }
  return items.sort((a, b) => nbox(a).x0 - nbox(b).x0);
}

const isFlat = (b: Box) => Hh(b) < 0.3 * W(b);
/** extra points along a stroke so none of its straight pieces is longer than step */
function dense(s: P[], step: number): P[] {
  const out: P[] = s.length ? [s[0]] : [];
  for (let i = 1; i < s.length; i++) { const a = s[i - 1], c = s[i], n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / step)); for (let k = 1; k <= n; k++) out.push([a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n]); }
  return out;
}
/** do two strokes come within d of each other (checking points and the segments between them) */
function touches(a: P[], b: P[], d: number): boolean {
  const near = (p: P, s: P[]) => {
    for (let i = 0; i < s.length; i++) {
      const q = s[i], r = s[i + 1] ?? q; const vx = r[0] - q[0], vy = r[1] - q[1], l2 = vx * vx + vy * vy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - q[0]) * vx + (p[1] - q[1]) * vy) / l2)) : 0;
      if (Math.hypot(p[0] - q[0] - t * vx, p[1] - q[1] - t * vy) < d) return true;
    }
    return false;
  };
  if (a.some(p => near(p, b)) || b.some(p => near(p, a))) return true;
  // or they simply cross (an x drawn with two straight lines has no points near the other line)
  const cross = (p: P, q: P, r: P, t: P) => { const d = (q[0] - p[0]) * (t[1] - r[1]) - (q[1] - p[1]) * (t[0] - r[0]); if (!d) return false; const u = ((r[0] - p[0]) * (t[1] - r[1]) - (r[1] - p[1]) * (t[0] - r[0])) / d, v = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return u >= 0 && u <= 1 && v >= 0 && v <= 1; };
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) if (cross(a[i - 1], a[i], b[j - 1], b[j])) return true;
  return false;
}
/** the band a symbol's body sits in: letters with tails below the line don't count the tail */
const DESC = new Set(['g', 'j', 'p', 'q', 'y', 'β', 'ρ', 'φ', 'μ', 'γ', ',']);
function core(n: Node): Box { const b = nbox(n); return n.kind === 'sym' && DESC.has(n.s.label) ? { ...b, y1: b.y1 - 0.3 * Hh(b) } : b; }
export function isRoot(s0: P[], b: Box): boolean {
  const w = W(b), hh = Hh(b), s = dense(s0, Math.max(w, hh) / 40);
  // a bar along the top on the right, and the low point of the tick on the left
  const topRight = s.filter(p => p[1] < b.y0 + 0.18 * hh && p[0] > b.x0 + 0.4 * w);
  const span = topRight.length ? Math.max(...topRight.map(p => p[0])) - Math.min(...topRight.map(p => p[0])) : 0;
  const low = s.some(p => p[1] > b.y0 + 0.7 * hh && p[0] < b.x0 + 0.45 * w);
  return span > 0.35 * w && low;
}

/** the nodes of a region, written out as LaTeX (with scripts read from where things sit) */
function emit(nodes: Node[], h: number): string {
  // limits written above and below a ∫ or Σ belong to it, wherever they start
  const limits = new Map<Node, { above: Node[]; below: Node[] }>();
  for (const n of nodes) {
    if (n.kind !== 'sym' || !(n.s.label === 'Σ' || n.s.label === '∫')) continue;
    const b = n.s.box, m = 0.3 * W(b);
    const above = nodes.filter(o => o !== n && cx(nbox(o)) > b.x0 - m && cx(nbox(o)) < b.x1 + m && nbox(o).y1 < b.y0 + 0.12 * Hh(b));
    const below = nodes.filter(o => o !== n && cx(nbox(o)) > b.x0 - m && cx(nbox(o)) < b.x1 + m && nbox(o).y0 > b.y1 - 0.12 * Hh(b));
    if (above.length || below.length) limits.set(n, { above, below });
  }
  if (limits.size) { const taken = new Set([...limits.values()].flatMap(l => [...l.above, ...l.below])); nodes = nodes.filter(o => !taken.has(o)); }
  let out = '';
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i]; const b = nbox(n);
    let base = n.kind === 'frac' ? `\\frac{${emit(n.num, h)}}{${emit(n.den, h)}}` : n.kind === 'sqrt' ? `\\sqrt{${emit(n.body, h)}}` : '';
    let j = i + 1;
    if (n.kind === 'sym') {
      const s = n.s;
      if (s.label === '.') {   // a dot: decimal point, multiplication dot or prime
        const prev = nodes[i - 1], next = nodes[i + 1];
        const pb = prev ? nbox(prev) : null;
        if (pb && b.y1 < pb.y0 + 0.4 * Hh(pb)) base = "'";
        else if (pb && cy(b) < pb.y1 - 0.3 * Hh(pb)) base = '\\cdot ';
        else base = next && prev ? '.' : '';
      } else {
        // words: sin, cos, log... (1 and 0 inside a word are l and o)
        const word = wordAt(nodes, i);
        if (word) { base = `\\${word.name}`; j = i + word.len; out += base + ' '; i = j; continue; }
        base = TEX[s.label] ?? (s.label === '?' ? '' : s.label);
        if (/\\[a-zA-Z]+$/.test(base)) base += ' ';   // \pi r, not \pir
      }
    }
    // scripts: smaller things raised (superscript) or lowered (subscript) next to this one; limits for ∫ and Σ
    const big = n.kind === 'sym' && (n.s.label === '∫' || n.s.label === 'Σ');
    const sup: Node[] = [], sub: Node[] = [];
    const cb = core(n), ch = Math.max(Hh(cb), 0.5 * h);
    while (j < nodes.length) {
      const c = nbox(nodes[j]);
      // smaller than the symbol, or lifted clear of its middle (a written 2 is often nearly full size)
      const small = Hh(c) < 0.8 * Math.max(Hh(b), h) || (big && Hh(c) < 0.6 * Hh(b)) || (!big && c.y1 < cy(b) && Hh(c) < 1.1 * Math.max(Hh(b), h));
      const last = (sup.length || sub.length) ? [...sup, ...sub].map(nbox).reduce(union) : null;
      const near = c.x0 < (last ? last.x1 + 0.5 * h : b.x1 + (big ? 0.6 * h : 0.45 * h));
      if (!small || !near || (n.kind === 'sym' && n.s.label === '.')) break;
      // raised: sticks out above, or sits wholly in the top part; lowered: starts below the middle and hangs under the line
      const op = nodes[j].kind === 'sym' && /^[-+=<>≤≥]$/.test((nodes[j] as any).s.label);
      if (big) {   // ∫ and Σ: limits in the top and bottom parts, then back to the line
        if (c.y0 < b.y0 + 0.28 * Hh(b) && c.y1 < cy(b)) sup.push(nodes[j]);
        else if (c.y1 > b.y1 - 0.15 * Hh(b) && c.y0 > cy(b) - 0.1 * Hh(b)) sub.push(nodes[j]);
        else break;
      }
      else if (op ? c.y1 < cb.y0 : (c.y0 < cb.y0 - 0.15 * ch && c.y1 < cb.y1 - 0.35 * ch) || c.y1 < cb.y0 + 0.2 * ch) sup.push(nodes[j]);
      else if (c.y0 > cb.y0 + 0.45 * ch && c.y1 > cb.y1 + 0.15 * ch && !(nodes[j].kind === 'sym' && (nodes[j] as any).s.label === '.')) sub.push(nodes[j]);
      else break;
      j++;
    }
    const lim = limits.get(n);
    if (lim) { sub.push(...lim.below); sup.push(...lim.above); }
    out += base;
    const subT = sub.length ? emit(sub, h * 0.7).trim() : '', supT = sup.length ? emit(sup, h * 0.7).trim() : '';
    if (subT) out += `_{${subT}}`;
    if (supT) out += `^{${supT}}`;
    if (big || /\\(int|sum)$/.test(base)) out += ' ';
    i = j;
  }
  return out.replace(/_\{(.)\}/g, '_$1').replace(/\^\{(.)\}/g, '^$1').replace(/\s+/g, ' ');
}

function wordAt(nodes: Node[], i: number): { name: string; len: number } | null {
  // each place may be its best guess or one of the next ones: "5in" reads as sin when s was a close second
  const opts: { top: string; all: string[] }[] = [];
  const first = nodes[i]; if (first.kind !== 'sym') return null;
  const asLetter = (l: string) => (l === '1' ? 'l' : l === '0' ? 'o' : l);
  for (let k = i; k < nodes.length && k < i + 6; k++) {
    const n = nodes[k]; if (n.kind !== 'sym') break;
    if (k > i && Math.abs(cy(n.s.box) - cy(first.s.box)) > 0.6 * Math.max(Hh(n.s.box), Hh(first.s.box))) break;   // a word sits on one line
    if (k > i && n.s.box.x0 - nbox(nodes[k - 1]).x1 > 1.2 * Math.max(Hh(first.s.box), 0.5)) break;   // and its letters are close together
    opts.push({ top: asLetter(n.s.label).toLowerCase(), all: [n.s.label, ...n.s.alts].map(asLetter).map(l => l.toLowerCase()) });
  }
  for (const f of FUNCS) {
    if (f.length > opts.length) continue;
    let tops = 0, ok = true;
    for (let k = 0; k < f.length; k++) { if (opts[k].top === f[k]) tops++; else if (!opts[k].all.includes(f[k])) { ok = false; break; } }
    if (ok && tops >= Math.ceil(f.length / 2)) return { name: f, len: f.length };
  }
  return null;
}

/** strokes → LaTeX, in one call (what the app and the board use) */
export function toLatex(strokes: P[][]): string { return recognize(strokes).latex; }
