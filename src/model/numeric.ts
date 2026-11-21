// Numerical analysis used by the auto-modeller to frame and annotate a figure.
import type { Fn } from './sym';
import { niceStep } from '../geom/ticks';

export const finite = (x: number) => typeof x === 'number' && isFinite(x);

export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * p));
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** a nicely rounded range [a, b] that contains [lo, hi] with some padding */
export function niceRange(lo: number, hi: number, pad = 0.08, ticks = 6): [number, number] {
  if (!finite(lo) || !finite(hi)) return [-1, 1];
  if (hi - lo < 1e-9 * Math.max(1, Math.abs(lo))) { const c = lo; const w = Math.max(1, Math.abs(c) * 0.5); lo = c - w; hi = c + w; }
  const span = hi - lo; lo -= span * pad; hi += span * pad;
  const st = niceStep(hi - lo, ticks) / 2;
  return [Math.floor(lo / st + 1e-9) * st, Math.ceil(hi / st - 1e-9) * st];
}
export function symmetricIfNear(r: [number, number]): [number, number] {
  const [a, b] = r; if (a < 0 && b > 0 && Math.abs(a + b) < 0.35 * (b - a)) { const m = Math.max(-a, b); return [-m, m]; }
  return r;
}

/** robust value range of samples (ignores poles) */
export function robustRange(vals: number[], lo = 0.03, hi = 0.97): [number, number] {
  const v = vals.filter(finite).sort((a, b) => a - b);
  if (!v.length) return [-1, 1];
  let a = percentile(v, lo), b = percentile(v, hi);
  const full = [v[0], v[v.length - 1]];
  // if the true range is only modestly larger, show all of it
  if (full[1] - full[0] < 2.2 * (b - a) || b - a < 1e-12) { a = full[0]; b = full[1]; }
  return [a, b];
}

export function bisect(f: Fn, a: number, b: number, it = 80) {
  let fa = f(a);
  for (let i = 0; i < it; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (!finite(fm)) return NaN;
    if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

/** sign-change roots of f on [a, b], skipping poles */
export function roots(f: Fn, a: number, b: number, n = 3000, scale = 1): number[] {
  const out: number[] = []; let px = a, pv = f(a);
  if (finite(pv) && Math.abs(pv) < 1e-12 * scale) out.push(a);
  for (let i = 1; i <= n; i++) {
    const x = a + (b - a) * i / n, v = f(x);
    if (finite(v) && finite(pv)) {
      if (v === 0) out.push(x);
      else if ((v < 0) !== (pv < 0) && pv !== 0) {
        const r = bisect(f, px, x);
        const fr = f(r);
        if (finite(r) && finite(fr) && Math.abs(fr) < 1e-6 * Math.max(scale, Math.abs(v), Math.abs(pv))) out.push(r);
      }
    }
    px = x; pv = v;
  }
  return dedupe(out, (b - a) * 1e-6);
}
export function dedupe(xs: number[], tol: number) {
  const s = [...xs].sort((p, q) => p - q); const out: number[] = [];
  for (const x of s) if (!out.length || Math.abs(x - out[out.length - 1]) > tol) out.push(x);
  return out;
}

/** local extrema of f from sign changes of its derivative */
export function extrema(f: Fn, df: Fn | null, a: number, b: number) {
  const d = df ?? ((x: number) => { const h = 1e-5 * Math.max(1, Math.abs(x)); return (f(x + h) - f(x - h)) / (2 * h); });
  const out: { x: number; y: number; type: 'max' | 'min' }[] = [];
  const n = 2000; let px = a, pv = d(a);
  for (let i = 1; i <= n; i++) {
    const x = a + (b - a) * i / n, v = d(x);
    if (finite(v) && finite(pv) && (v < 0) !== (pv < 0) && pv !== 0) {
      const r = bisect(d, px, x); const y = f(r);
      const yl = f(r - (b - a) * 1e-4), yr = f(r + (b - a) * 1e-4);
      if (finite(r) && finite(y) && finite(yl) && finite(yr)) {
        if (y >= yl && y >= yr) out.push({ x: r, y, type: 'max' });
        else if (y <= yl && y <= yr) out.push({ x: r, y, type: 'min' });
      }
    }
    px = x; pv = v;
  }
  return out;
}

/** Newton's method for a 2×2 system F(x, y) = 0 */
export function newton2(F: (x: number, y: number) => [number, number], x: number, y: number, it = 40): [number, number] | null {
  for (let k = 0; k < it; k++) {
    const [f1, f2] = F(x, y); if (!finite(f1) || !finite(f2)) return null;
    if (Math.abs(f1) + Math.abs(f2) < 1e-12) return [x, y];
    const h = 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
    const [a1, a2] = F(x + h, y), [b1, b2] = F(x, y + h);
    const j11 = (a1 - f1) / h, j21 = (a2 - f2) / h, j12 = (b1 - f1) / h, j22 = (b2 - f2) / h;
    const det = j11 * j22 - j12 * j21; if (!finite(det) || Math.abs(det) < 1e-14) return null;
    let dx = (j22 * f1 - j12 * f2) / det, dy = (j11 * f2 - j21 * f1) / det;
    const step = Math.hypot(dx, dy), lim = 2 * Math.max(1, Math.hypot(x, y)); if (step > lim) { dx *= lim / step; dy *= lim / step; }
    x -= dx; y -= dy;
  }
  const [f1, f2] = F(x, y);
  return finite(f1) && Math.abs(f1) + Math.abs(f2) < 1e-7 ? [x, y] : null;
}

/** common zeros of two functions in a box, seeded from a grid */
export function solve2(F: (x: number, y: number) => [number, number], box: number[], n = 24): [number, number][] {
  const [x0, x1, y0, y1] = box; const out: [number, number][] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const r = newton2(F, x0 + (x1 - x0) * (i + 0.5) / (n + 1), y0 + (y1 - y0) * (j + 0.5) / (n + 1));
    if (!r) continue;
    const [x, y] = r;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const tol = 1e-5 * Math.max(x1 - x0, y1 - y0);
    if (!out.some(p => Math.hypot(p[0] - x, p[1] - y) < tol)) out.push([x, y]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** bounding box of the zero set of G on a grid (2D), or null if no sign change */
export function zeroBox2(G: Fn, L: number, n = 140): number[] | null {
  const v: number[] = []; const g = (i: number) => -L + 2 * L * i / n;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) v.push(G(g(i), g(j)));
  let bx = [Infinity, -Infinity, Infinity, -Infinity];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = v[j * (n + 1) + i], b = v[j * (n + 1) + i + 1], c = v[(j + 1) * (n + 1) + i];
    if (!finite(a)) continue;
    if ((finite(b) && (a > 0) !== (b > 0)) || (finite(c) && (a > 0) !== (c > 0))) {
      // ignore pole crossings
      const mid = G(g(i + 0.5), g(j + 0.5));
      if (finite(mid) && Math.abs(mid) > 4 * Math.max(Math.abs(a), Math.abs(b ?? 0), Math.abs(c ?? 0))) continue;
      bx = [Math.min(bx[0], g(i)), Math.max(bx[1], g(i + 1)), Math.min(bx[2], g(j)), Math.max(bx[3], g(j + 1))];
    }
  }
  return bx[0] === Infinity ? null : bx;
}
export function zeroBox3(G: Fn, L: number, n = 30): number[] | null {
  const g = (i: number) => -L + 2 * L * i / n; const W = n + 1;
  const v = new Float64Array(W * W * W);
  for (let k = 0; k <= n; k++) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) v[(k * W + j) * W + i] = G(g(i), g(j), g(k));
  let b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = v[(k * W + j) * W + i];
    if (!finite(a)) continue;
    const nb = [v[(k * W + j) * W + i + 1], v[(k * W + j + 1) * W + i], v[((k + 1) * W + j) * W + i]];
    if (nb.some(x => finite(x) && (x > 0) !== (a > 0))) b = [Math.min(b[0], g(i)), Math.max(b[1], g(i + 1)), Math.min(b[2], g(j)), Math.max(b[3], g(j + 1)), Math.min(b[4], g(k)), Math.max(b[5], g(k + 1))];
  }
  return b[0] === Infinity ? null : b;
}

/** smallest P (multiple of base) after which the curve repeats; null if it doesn't close */
export function closingPeriod(P: (t: number) => number[] | null, base = Math.PI, maxMult = 24, start = 0): number | null {
  const samples = Array.from({ length: 14 }, (_, i) => start + 0.37 + i * 0.731);
  const scale = Math.max(1e-9, ...samples.map(t => { const p = P(t); return p ? Math.hypot(...p.map(x => (finite(x) ? x : 0))) : 0; }));
  for (let m = 1; m <= maxMult; m++) {
    const T = m * base;
    let ok = true, cnt = 0;
    for (const t of samples) {
      const a = P(t), b = P(t + T);
      if (!a || !b || !a.every(finite) || !b.every(finite)) continue;
      cnt++;
      if (Math.hypot(...a.map((x, i) => x - b[i])) > 1e-6 * scale) { ok = false; break; }
    }
    if (ok && cnt >= 4) return T;
  }
  return null;
}

/** eigenvalues of a real 2×2 or 3×3 matrix (complex as [re, im]) */
export function eig(M: number[][]): { re: number; im: number }[] {
  if (M.length === 2) {
    const [[a, b], [c, d]] = M; const tr = a + d, det = a * d - b * c, disc = tr * tr / 4 - det;
    if (disc >= -1e-14) { const s = Math.sqrt(Math.max(0, disc)); return [{ re: tr / 2 + s, im: 0 }, { re: tr / 2 - s, im: 0 }]; }
    const s = Math.sqrt(-disc); return [{ re: tr / 2, im: s }, { re: tr / 2, im: -s }];
  }
  const [[a, b, c], [d, e, f], [g, h, i]] = M;
  // characteristic polynomial λ³ + pλ² + qλ + r
  const tr = a + e + i;
  const minors = (e * i - f * h) + (a * i - c * g) + (a * e - b * d);
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return cubicRoots(1, -tr, minors, -det);
}
export function cubicRoots(A: number, B: number, C: number, D: number): { re: number; im: number }[] {
  const b = B / A, c = C / A, d = D / A;
  const p = c - b * b / 3, q = 2 * b * b * b / 27 - b * c / 3 + d;
  const disc = q * q / 4 + p * p * p / 27;
  const shift = -b / 3;
  if (Math.abs(disc) < 1e-14) {
    const u = Math.cbrt(-q / 2); return [{ re: 2 * u + shift, im: 0 }, { re: -u + shift, im: 0 }, { re: -u + shift, im: 0 }];
  }
  if (disc > 0) {
    const s = Math.sqrt(disc), u = Math.cbrt(-q / 2 + s), v = Math.cbrt(-q / 2 - s);
    return [{ re: u + v + shift, im: 0 }, { re: -(u + v) / 2 + shift, im: (u - v) * Math.sqrt(3) / 2 }, { re: -(u + v) / 2 + shift, im: -(u - v) * Math.sqrt(3) / 2 }];
  }
  const r = Math.sqrt(-p * p * p / 27), phi = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r)))), m = 2 * Math.cbrt(r);
  return [0, 1, 2].map(k => ({ re: m * Math.cos((phi + 2 * Math.PI * k) / 3) + shift, im: 0 })).sort((x, y) => y.re - x.re);
}
/** a unit eigenvector for a real eigenvalue */
export function eigvec(M: number[][], lam: number): number[] | null {
  const n = M.length; const A = M.map((r, i) => r.map((x, j) => x - (i === j ? lam : 0)));
  if (n === 2) {
    const [[a, b], [c, d]] = A;
    const v = Math.hypot(a, b) > Math.hypot(c, d) ? [-b, a] : [-d, c];
    const l = Math.hypot(...v); return l > 1e-10 ? v.map(x => x / l) : [1, 0];
  }
  const cr = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const cands = [cr(A[0], A[1]), cr(A[0], A[2]), cr(A[1], A[2])];
  const best = cands.reduce((p, q) => (Math.hypot(...q) > Math.hypot(...p) ? q : p));
  const l = Math.hypot(...best); if (l < 1e-10) return null;
  return best.map(x => x / l);
}

/** distance from the origin to the first zero crossing along each axis direction (a natural length scale) */
export function axisScale(G: (...a: number[]) => number, dims: number, L = 20): number | null {
  let best: number | null = null;
  for (let d = 0; d < dims; d++) for (const sg of [1, -1]) {
    const f = (t: number) => { const a = new Array(dims).fill(0); a[d] = sg * t; return G(...a); };
    const r = roots(f, 1e-6, L, 2000, 1e-9);
    if (r.length) best = Math.max(best ?? 0, r[0]);
  }
  return best;
}
