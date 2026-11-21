// Numerics for integrals, limits and series in the auto-modeller.
type F1 = (x: number) => number;

// ---------------------------------------------------------------- integration
/** tanh-sinh (double-exponential) quadrature on a finite interval: copes with endpoint singularities
 *  like 1/sqrt(x) or ln(x). Returns the value and an error estimate (NaN when it doesn't settle). */
function tanhSinh(f: F1, a: number, b: number): { v: number; err: number } {
  const c = (a + b) / 2, r = (b - a) / 2; if (r === 0) return { v: 0, err: 0 };
  const g = (t: number) => {
    const u = (Math.PI / 2) * Math.sinh(t), ch = Math.cosh(u);
    // distance to the nearer end computed directly (c + r·tanh(u) would lose it to rounding near a singular end)
    const dEnd = r * 2 / (Math.exp(2 * Math.abs(u)) + 1);
    const x = u < 0 ? a + dEnd : b - dEnd; if (!(x > a && x < b)) return 0;
    const w = r * (Math.PI / 2) * Math.cosh(t) / (ch * ch); const y = f(x) * w;
    return isFinite(y) ? y : NaN;
  };
  let h = 0.5, prev = NaN, sum = g(0);
  for (let k = 1; k <= 40; k++) { const t = k * h; const s = g(t) + g(-t); if (!isFinite(s)) { sum = NaN; break; } sum += s; if (Math.abs(s) < 1e-18 && t > 3) break; }
  prev = sum * h;
  for (let level = 0; level < 7; level++) {
    h /= 2; let add = 0;
    for (let k = 1; k <= 80 * 2 ** level; k += 2) { const t = k * h; if (t > 6.5) break; const s = g(t) + g(-t); if (!isFinite(s)) return { v: NaN, err: NaN }; add += s; }
    sum += add; const cur = sum * h;
    const err = Math.abs(cur - prev);
    if (level >= 2 && err <= 1e-11 * Math.max(1, Math.abs(cur))) return { v: cur, err };
    prev = cur;
  }
  return { v: prev, err: NaN };
}
/** definite integral with finite or infinite limits. diverges=true when it doesn't converge numerically. */
export function integrate(f: F1, a: number, b: number): { v: number; err: number; diverges: boolean } {
  if (a === b) return { v: 0, err: 0, diverges: false };
  if (a > b) { const r = integrate(f, b, a); return { ...r, v: -r.v }; }
  let res: { v: number; err: number };
  if (isFinite(a) && isFinite(b)) res = tanhSinh(f, a, b);
  else if (isFinite(a)) res = tanhSinh(t => f(a + t / (1 - t)) / ((1 - t) * (1 - t)), 0, 1);
  else if (isFinite(b)) res = tanhSinh(t => f(b - (1 - t) / t) / (t * t), 0, 1);
  else res = tanhSinh(t => { const d = 1 - t * t; return f(t / d) * (1 + t * t) / (d * d); }, -1, 1);
  // a "converged" answer that is huge relative to the integrand's size near the ends usually means divergence
  const diverges = !isFinite(res.v) || !isFinite(res.err) || res.err > 1e-6 * Math.max(1, Math.abs(res.v)) || Math.abs(res.v) > 1e12;
  return { v: res.v, err: res.err, diverges };
}

// ---------------------------------------------------------------- limits
export type LimitResult = { kind: 'value'; v: number } | { kind: 'inf'; sign: number } | { kind: 'none'; left?: number; right?: number; why: string };
function oneSided(f: F1, a: number, side: number, integer: boolean): LimitResult {
  // sample closer and closer (or farther out, for a = ±∞) and look for a settled value or a blow-up
  const xs: number[] = [];
  if (!isFinite(a)) { const s = a > 0 ? 1 : -1; for (let k = 1; k <= 9; k++) xs.push(s * (integer ? Math.round(10 ** k) : 10 ** k)); }
  else for (let k = 1; k <= 9; k++) xs.push(a + side * 10 ** -k);
  const ys = xs.map(f);
  const good = ys.map(isFinite);
  if (good.filter(Boolean).length < 4) return { kind: 'none', why: 'the function has no real values there' };
  // blow-up: magnitudes growing steadily with a fixed sign
  const mags = ys.slice(2, 8).map(Math.abs);
  if (mags.every((m, i) => i === 0 || m > mags[i - 1] * 1.5) && mags[mags.length - 1] > 1e4 && ys.slice(4, 8).every(y => Math.sign(y) === Math.sign(ys[7])))
    return { kind: 'inf', sign: Math.sign(ys[7]) };
  // settled: consecutive differences shrink. Find where they stop shrinking (round-off takes over from there,
  // e.g. 1 - cos x becomes exactly 0) and only trust the samples before that point.
  const d = ys.slice(0, 8).map((y, k) => Math.abs(ys[k + 1] - y));
  let cut = 8;
  for (let k = 2; k < 8; k++) if (!(d[k] <= 3 * d[k - 1] + 1e-300)) { cut = k; break; }
  let best = NaN, bestD = Infinity, kb = -1;
  for (let k = 1; k < cut; k++) if (isFinite(d[k]) && d[k] < bestD) { bestD = d[k]; best = (ys[k] + ys[k + 1]) / 2; kb = k; }
  // steady geometric approach (x·ln x → 0, (1+1/n)^n → e, (e^x-1-x)/x² → ½): Aitken's Δ² extrapolation tightens the estimate
  if (kb >= 2) {
    const [y0, y1, y2] = [ys[kb - 1], ys[kb], ys[kb + 1]]; const d1 = y1 - y0, d2 = y2 - y1, den = d2 - d1;
    if ([y0, y1, y2].every(isFinite) && Math.abs(den) > 1e-300 && d1 * d2 > 0 && Math.abs(d2) < Math.abs(d1)) { const ex = y2 - d2 * d2 / den; if (Math.abs(ex - y2) <= Math.abs(d2) * 2) best = ex; }
  }
  if (isFinite(best) && Math.abs(best) < 1e-6 && bestD < 1e-5) return { kind: 'value', v: 0 };
  const scale = Math.max(1, Math.abs(best));
  if (isFinite(best) && bestD < 1e-3 * scale) {
    const near = ys.slice(Math.max(1, kb - 2), kb + 2).filter(isFinite); const spread = near.length ? Math.max(...near) - Math.min(...near) : Infinity;
    if (spread < 0.05 * scale || bestD < 1e-7 * scale) return { kind: 'value', v: Math.abs(best) < 1e-9 ? 0 : best };
  }
  return { kind: 'none', why: 'the values keep oscillating' };
}
export function limitOf(f: F1, a: number, dir: number, integer = false): LimitResult {
  if (!isFinite(a) || dir) return oneSided(f, a, dir || 1, integer);
  const L = oneSided(f, a, -1, false), R = oneSided(f, a, 1, false);
  if (L.kind === 'value' && R.kind === 'value') {
    if (Math.abs(L.v - R.v) <= 1e-4 * Math.max(1, Math.abs(L.v))) return { kind: 'value', v: (L.v + R.v) / 2 };
    return { kind: 'none', left: L.v, right: R.v, why: 'the left and right limits differ' };
  }
  if (L.kind === 'inf' && R.kind === 'inf' && L.sign === R.sign) return L;
  if (L.kind === 'inf' || R.kind === 'inf') return { kind: 'none', why: 'the function blows up differently on the two sides', left: L.kind === 'value' ? L.v : undefined, right: R.kind === 'value' ? R.v : undefined };
  return L.kind === 'none' ? L : R;
}

// ---------------------------------------------------------------- series
export type SeriesResult = { kind: 'converges'; v: number; err: number } | { kind: 'diverges'; why: string };
/** numeric verdict on Σ_{n=n0}^∞ a(n) */
export function seriesSum(a: F1, n0: number): SeriesResult {
  let s = 0; const at = new Map<number, number>(); const marks = [250, 500, 1000, 2000, 4000, 8000, 16000];
  let last = 0;
  for (let n = n0, k = 0; k <= 16000; n++, k++) {
    const v = a(n); if (!isFinite(v)) return { kind: 'diverges', why: `term ${n} is undefined` };
    s += v; last = v; if (marks.includes(k)) at.set(k, s);
  }
  const big = Math.abs(a(n0 + 16000)), big2 = Math.abs(a(n0 + 8000));
  if (big > 1e-3 && big >= big2 * 0.5) return { kind: 'diverges', why: 'the terms do not shrink to 0' };
  const S = marks.map(m => at.get(m)!);
  // growth like log N (harmonic-type) or faster: partial sums keep increasing by similar amounts per doubling
  const inc = S.slice(1).map((v, i) => v - S[i]);
  const tail = Math.abs(inc[inc.length - 1]);
  if (tail > 1e-3 * Math.max(1, Math.abs(S[S.length - 1])) && Math.abs(inc[inc.length - 1]) > 0.6 * Math.abs(inc[inc.length - 2]))
    return { kind: 'diverges', why: 'the partial sums keep growing' };
  // alternating series: average neighbouring partial sums; otherwise Richardson in 1/N on doubling N
  const alt = Math.sign(a(n0 + 16000)) !== Math.sign(a(n0 + 16001)) && last !== 0;
  if (alt) { const sNext = S[S.length - 1] + a(n0 + 16001); const v = (S[S.length - 1] + sNext) / 2; return { kind: 'converges', v, err: Math.abs(a(n0 + 16001)) / 4 }; }
  const [s1, s2, s3] = S.slice(-3);
  const d1 = s2 - s1, d2 = s3 - s2;
  let v = s3, err = Math.abs(d2);
  if (Math.abs(d1) > 1e-300 && Math.abs(d2) < Math.abs(d1)) {
    const ratio = d2 / d1;                         // ≈ 2^-p for an O(N^-p) tail
    if (ratio > 0 && ratio < 0.95) { v = s3 + d2 * ratio / (1 - ratio); err = Math.abs(d2 * ratio / (1 - ratio)) * 0.05 + 1e-12; }
  }
  return { kind: 'converges', v, err };
}

/** numeric verdict on Π_{n=n0}^∞ a(n), through Σ ln a(n) when the factors are positive */
export function productOf(a: F1, n0: number): SeriesResult {
  let zero = false, neg = 0;
  for (let n = n0; n < n0 + 2000; n++) { const v = a(n); if (!isFinite(v)) return { kind: 'diverges', why: `factor ${n} is undefined` }; if (v === 0) zero = true; if (v < 0) neg++; }
  if (zero) return { kind: 'converges', v: 0, err: 0 };
  if (neg > 0) {
    // only finitely many negative factors are allowed: they just set the sign
    for (let n = n0 + 2000; n < n0 + 16000; n++) if (a(n) < 0) return { kind: 'diverges', why: 'infinitely many negative factors: the sign keeps flipping' };
  }
  const sign = neg % 2 ? -1 : 1;
  const r = seriesSum(n => Math.log(Math.abs(a(n))), n0);
  if (r.kind === 'diverges') {
    const s = Array.from({ length: 4000 }, (_, k) => Math.log(Math.abs(a(n0 + k)))).reduce((p, q) => p + q, 0);
    return s < 0 ? { kind: 'converges', v: 0, err: 0 } : { kind: 'diverges', why: 'the partial products grow without bound' };
  }
  const v = sign * Math.exp(r.v); return { kind: 'converges', v, err: Math.abs(v) * r.err };
}

// ---------------------------------------------------------------- recognising closed forms
const CONSTS: [number, string][] = [
  [1, ''], [Math.PI, '\\pi'], [Math.PI ** 2, '\\pi^2'], [Math.PI ** 3, '\\pi^3'], [Math.PI ** 4, '\\pi^4'], [Math.sqrt(Math.PI), '\\sqrt{\\pi}'],
  [Math.SQRT2, '\\sqrt{2}'], [Math.sqrt(3), '\\sqrt{3}'], [Math.E, 'e'], [Math.E ** 2, 'e^2'], [1 / Math.E, 'e^{-1}'], [Math.LN2, '\\ln 2'], [Math.log(3), '\\ln 3'],
  [Math.PI * Math.SQRT2, '\\pi\\sqrt{2}'], [Math.PI * Math.sqrt(3), '\\pi\\sqrt{3}'], [Math.PI * Math.LN2, '\\pi \\ln 2'],
];
/** a short exact form (like \frac{\pi^2}{6}) for a number known to relative accuracy `tol`, or null */
export function identify(v: number, tol: number): string | null {
  if (!isFinite(v)) return null;
  if (Math.abs(v) < Math.max(tol, 1e-9)) return '0';
  tol = Math.max(tol, 1e-13 * Math.abs(v));
  for (const [c, name] of CONSTS) {
    const r = v / c;
    for (let den = 1; den <= (tol < 1e-10 ? 120 : 12); den++) {
      const num = Math.round(r * den); if (num === 0 || Math.abs(num) > 60) continue;
      if (Math.abs(num / den * c - v) <= tol) {
        const g = gcd(Math.abs(num), den); const p = num / g, d = den / g; const sgn = p < 0 ? '-' : ''; const P = Math.abs(p);
        if (!name) return d === 1 ? String(p) : `${sgn}\\frac{${P}}{${d}}`;
        const top = P === 1 ? name : `${P}${name}`;
        return d === 1 ? sgn + top : `${sgn}\\frac{${top}}{${d}}`;
      }
    }
  }
  return null;
}
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }
