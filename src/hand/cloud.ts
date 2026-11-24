// Point-cloud matching for handwritten symbols (after the $P recogniser by Vatavu, Anthony and Wobbrock):
// a symbol is its strokes resampled to N points, scaled and centred; two symbols are compared by greedily
// pairing up their points. Stroke order and direction don't matter, which suits handwriting.

export const N = 32;
type P = [number, number];

/** strokes (lists of [x, y], y down) → N points as a flat [x0, y0, x1, y1, …], centred, scaled to size 1 */
export function normalize(strokes: P[][], deskew = true): number[] {
  let all = strokes.filter(s => s.length);
  if (deskew) { const k = slant(all); if (k) { const yc = centreY(all); all = all.map(s => s.map(p => [p[0] - k * (p[1] - yc), p[1]] as P)); } }
  let len = 0;
  for (const s of all) for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  const pts: P[] = [];
  if (len < 1e-9) { const p = all[0]?.[0] ?? [0, 0]; for (let i = 0; i < N; i++) pts.push([p[0], p[1]]); }
  else {
    const I = len / (N - 1); let D = 0;
    for (const s0 of all) {
      const s = s0.map(p => [p[0], p[1]] as P);
      if (!pts.length) pts.push(s[0]);
      for (let i = 1; i < s.length; i++) {
        const d = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
        if (D + d >= I && d > 0) {
          const t = (I - D) / d; const q: P = [s[i - 1][0] + t * (s[i][0] - s[i - 1][0]), s[i - 1][1] + t * (s[i][1] - s[i - 1][1])];
          pts.push(q); s.splice(i, 0, q); D = 0;
        } else D += d;
        if (pts.length >= N) break;
      }
      if (pts.length >= N) break;
    }
    while (pts.length < N) pts.push(all[all.length - 1][all[all.length - 1].length - 1]);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const sz = Math.max(x1 - x0, y1 - y0) || 1;
  let cx = 0, cy = 0; for (const [x, y] of pts) { cx += x; cy += y; } cx /= N; cy /= N;
  const out: number[] = []; for (const [x, y] of pts) out.push((x - cx) / sz, (y - cy) / sz);
  return out;
}

/** how much the writing leans: the average dx/dy of its near-vertical pieces (0 for upright) */
export function slant(strokes: P[][]): number {
  let sw = 0, sk = 0;
  for (const s of strokes) for (let i = 1; i < s.length; i++) {
    const dx = s[i][0] - s[i - 1][0], dy = s[i][1] - s[i - 1][1], l = Math.hypot(dx, dy);
    if (l > 0 && Math.abs(dy) > 2.2 * Math.abs(dx)) { sw += l; sk += l * (dx / dy); }
  }
  const k = sw ? sk / sw : 0;
  return Math.abs(k) > 0.05 ? Math.max(-0.45, Math.min(0.45, k)) : 0;
}
const centreY = (st: P[][]) => { let a = Infinity, b = -Infinity; for (const s of st) for (const p of s) { a = Math.min(a, p[1]); b = Math.max(b, p[1]); } return (a + b) / 2; };

/** a quick, rougher distance: one pairing in each direction (used to pick the candidates worth a full look) */
export function quickDistance(a: number[], b: number[], cutoff = Infinity): number { return Math.min(greedy(a, b, 0, cutoff), greedy(b, a, 0, cutoff)); }
/** how far apart two normalised clouds are (smaller is closer) */
export function cloudDistance(a: number[], b: number[]): number {
  const step = Math.floor(Math.pow(N, 0.5)); let best = Infinity;
  for (let i = 0; i < N; i += step) {
    best = Math.min(best, greedy(a, b, i, best), greedy(b, a, i, best));
  }
  return best;
}
const matched = new Uint8Array(N);
function greedy(a: number[], b: number[], start: number, cutoff: number): number {
  matched.fill(0); let sum = 0, i = start;
  do {
    let min = Infinity, idx = -1;
    const ax = a[2 * i], ay = a[2 * i + 1];
    for (let j = 0; j < N; j++) if (!matched[j]) { const dx = ax - b[2 * j], dy = ay - b[2 * j + 1]; const d = dx * dx + dy * dy; if (d < min) { min = d; idx = j; } }
    matched[idx] = 1;
    const w = 1 - ((i - start + N) % N) / N;
    sum += w * Math.sqrt(min);
    if (sum >= cutoff) return sum;
    i = (i + 1) % N;
  } while (i !== start);
  return sum;
}
