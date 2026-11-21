// Symbolic integration for the auto-modeller: the techniques of a calculus course, tried in order.
//   table + linearity · linear substitution (sin 3x, e^(2x+1)) · u-substitution (2x cos x², f'/f) ·
//   integration by parts (LIATE) · e^(ax)·sin/cos(bx) · partial fractions · powers of sin and cos ·
//   square roots of quadratics · expanding products as a last resort.
// Every answer is checked by differentiating it and comparing with the integrand numerically, so a wrong
// rule can only make the integrator give up (and the page falls back to numerical integration), never lie.
import { Node, N, S, PI, add, mul, pow, fn, neg, sub, simplify, depends, key, subst, diff, tryDiff, compile, freeSyms, isNum, rational } from './sym';

const U = '__u';
const prodOf = (a: Node[]): Node => (a.length === 0 ? N(1) : a.length === 1 ? a[0] : mul(...a));
const lnAbs = (u: Node) => fn('ln', fn('abs', u));
const isX = (n: Node, x: string) => n.k === 'sym' && n.n === x;
const numOf = (n: Node): number | null => { if (n.k === 'num') return n.v; try { const v = compile(n, [], {})(); return isFinite(v) && !freeSyms(n).size ? v : null; } catch { return null; } };
/** √v as an exact node when v is a perfect rational square, otherwise as a power */
function sqrtNode(v: number): Node {
  const r = Math.sqrt(v); const q = rational(r, 60); if (q) return N(q[0] / q[1]);
  const rv = rational(v, 60); if (rv && rv[1] !== 1) return mul(N(1 / rv[1]), pow(N(rv[0] * rv[1]), 0.5));
  return pow(N(+v.toPrecision(15)), 0.5);
}
/** a (exact if rational) number node */
const numNode = (v: number) => { const r = rational(v, 1000); return N(r ? r[0] / r[1] : +v.toPrecision(15)); };

function replace(n: Node, target: string, by: Node): Node {
  if (key(n) === target) return by;
  switch (n.k) {
    case 'add': case 'mul': return { ...n, a: n.a.map(c => replace(c, target, by)) } as Node;
    case 'pow': return { ...n, b: replace(n.b, target, by), e: replace(n.e, target, by) };
    case 'fn': return { ...n, a: n.a.map(c => replace(c, target, by)) };
    default: return n;
  }
}
function subtrees(n: Node, out: Node[] = []): Node[] {
  out.push(n);
  if (n.k === 'add' || n.k === 'mul' || n.k === 'fn') n.a.forEach(c => subtrees(c, out));
  else if (n.k === 'pow') { subtrees(n.b, out); subtrees(n.e, out); }
  return out;
}
/** a·x + b with a ≠ 0 independent of x → a (else null) */
function linearSlope(L: Node, x: string): Node | null {
  if (!depends(L, x)) return null;
  const d = tryDiff(L, x); if (!d || depends(d, x) || isNum(d, 0)) return null;
  return d;
}

// ---------------------------------------------------------------- polynomials (numeric coefficients, low → high)
type Poly = number[];
function polyOf(n: Node, x: string): Poly | null {
  switch (n.k) {
    case 'num': return [n.v];
    case 'sym': return n.n === x ? [0, 1] : null;
    case 'add': { let r: Poly = [0]; for (const t of n.a) { const p = polyOf(t, x); if (!p) return null; r = padd(r, p); } return r; }
    case 'mul': { let r: Poly = [1]; for (const t of n.a) { const p = polyOf(t, x); if (!p) return null; r = pmul(r, p); } return r; }
    case 'pow': {
      if (n.e.k !== 'num' || !Number.isInteger(n.e.v) || n.e.v < 0 || n.e.v > 12) return null;
      const b = polyOf(n.b, x); if (!b) return null; let r: Poly = [1]; for (let i = 0; i < n.e.v; i++) r = pmul(r, b); return r;
    }
    default: { const v = numOf(n); return v === null ? null : [v]; }
  }
}
const trim = (p: Poly) => { const q = [...p]; while (q.length > 1 && Math.abs(q[q.length - 1]) < 1e-12) q.pop(); return q; };
const padd = (a: Poly, b: Poly) => trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0)));
const pmul = (a: Poly, b: Poly) => { const r = new Array(a.length + b.length - 1).fill(0); a.forEach((u, i) => b.forEach((v, j) => (r[i + j] += u * v))); return trim(r); };
const deg = (p: Poly) => trim(p).length - 1;
function pdiv(a: Poly, b: Poly): [Poly, Poly] {
  let r = [...trim(a)]; const d = trim(b); const q = new Array(Math.max(1, r.length - d.length + 1)).fill(0);
  while (r.length >= d.length && !(r.length === 1 && Math.abs(r[0]) < 1e-14)) {
    const c = r[r.length - 1] / d[d.length - 1], k = r.length - d.length; q[k] = c;
    for (let i = 0; i < d.length; i++) r[k + i] -= c * d[i];
    r.pop(); r = trim(r.length ? r : [0]); if (r.length < d.length) break;
  }
  return [trim(q), r];
}
function polyNode(p: Poly, X: Node): Node {
  const terms: Node[] = [];
  p.forEach((c, i) => { if (Math.abs(c) > 1e-14) terms.push(i === 0 ? numNode(c) : mul(numNode(c), i === 1 ? X : pow(X, i))); });
  return terms.length ? add(...terms) : N(0);
}
/** complex roots of a real polynomial (Durand–Kerner) */
function roots(p: Poly): [number, number][] {
  const a = trim(p), n = a.length - 1; if (n < 1) return [];
  const c = a.map(v => v / a[n]);
  let z: [number, number][] = Array.from({ length: n }, (_, k) => { const t = 2 * Math.PI * k / n + 0.4; const r = 1 + Math.max(...c.slice(0, n).map(Math.abs)); return [r * Math.cos(t) * 0.9, r * Math.sin(t) * 0.9]; });
  const ev = (re: number, im: number): [number, number] => { let pr = 1, pi = 0; for (let k = n - 1; k >= 0; k--) { const nr = pr * re - pi * im + c[k], ni = pr * im + pi * re; pr = nr; pi = ni; } return [pr, pi]; };
  for (let it = 0; it < 500; it++) {
    let moved = 0;
    z = z.map(([re, im], i) => {
      let [nr, ni] = ev(re, im); let dr = 1, di = 0;
      z.forEach(([r2, i2], j) => { if (j === i) return; const a1 = re - r2, b1 = im - i2; const t = dr * a1 - di * b1; di = dr * b1 + di * a1; dr = t; });
      const den = dr * dr + di * di || 1e-300; const qr = (nr * dr + ni * di) / den, qi = (ni * dr - nr * di) / den;
      moved = Math.max(moved, Math.hypot(qr, qi)); return [re - qr, im - qi];
    });
    if (moved < 1e-15) break;
  }
  return z;
}
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-13) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// ---------------------------------------------------------------- strategies
type Ctx = { x: string; depth: number };
function integ(f: Node, c: Ctx): Node | null {
  if (c.depth > 7) return null;
  const x = c.x, X = S(x); const d = { x, depth: c.depth + 1 };
  if (!depends(f, x)) return mul(f, X);
  if (f.k === 'add') {
    const parts = f.a.map(t => integ(t, d));
    if (parts.every(Boolean)) return add(...(parts as Node[]));
    return rationalFn(f, d) ?? expandThen(f, d);
  }
  if (f.k === 'mul') {
    const cs = f.a.filter(t => !depends(t, x)), rest = f.a.filter(t => depends(t, x));
    if (cs.length) { const r = integ(simplify(prodOf(rest)), d); return r ? mul(prodOf(cs), r) : null; }
  }
  for (const s of [table, linearSub, rationalFn, expTrig, trigPowers, sqrtQuadratic, tabular, uSub, parts, expandThen]) {
    const r = s(f, d); if (r) return r;
  }
  return null;
}

/** standard integrals with the bare variable inside */
function table(f: Node, c: Ctx): Node | null {
  const x = c.x, X = S(x);
  if (isX(f, x)) return mul(N(0.5), pow(X, 2));
  if (f.k === 'pow' && isX(f.b, x) && !depends(f.e, x)) {
    if (isNum(f.e, -1)) return lnAbs(X);
    return mul(pow(X, add(f.e, N(1))), pow(add(f.e, N(1)), -1));
  }
  if (f.k === 'pow' && !depends(f.b, x) && isX(f.e, x)) return mul(f, pow(fn('ln', f.b), -1));
  if (f.k === 'fn' && f.a.length === 1 && isX(f.a[0], x)) {
    const T: Record<string, () => Node> = {
      sin: () => neg(fn('cos', X)), cos: () => fn('sin', X), tan: () => neg(lnAbs(fn('cos', X))), cot: () => lnAbs(fn('sin', X)),
      sec: () => lnAbs(add(fn('sec', X), fn('tan', X))), csc: () => neg(lnAbs(add(fn('csc', X), fn('cot', X)))),
      exp: () => fn('exp', X), ln: () => sub(mul(X, fn('ln', X)), X), sinh: () => fn('cosh', X), cosh: () => fn('sinh', X), tanh: () => fn('ln', fn('cosh', X)),
      asin: () => add(mul(X, fn('asin', X)), pow(sub(N(1), pow(X, 2)), 0.5)), acos: () => sub(mul(X, fn('acos', X)), pow(sub(N(1), pow(X, 2)), 0.5)),
      atan: () => sub(mul(X, fn('atan', X)), mul(N(0.5), fn('ln', add(pow(X, 2), N(1))))), asinh: () => sub(mul(X, fn('asinh', X)), pow(add(pow(X, 2), N(1)), 0.5)),
      log10: () => mul(sub(mul(X, fn('ln', X)), X), pow(fn('ln', N(10)), -1)), log2: () => mul(sub(mul(X, fn('ln', X)), X), pow(fn('ln', N(2)), -1)),
      abs: () => mul(N(0.5), X, fn('abs', X)), sign: () => fn('abs', X),
    };
    if (T[f.f]) return T[f.f]();
  }
  // squared trig / hyperbolic: derivatives of tan, cot, tanh; sec·tan, csc·cot
  if (f.k === 'pow' && f.b.k === 'fn' && isX(f.b.a[0], x)) {
    const g = f.b.f, e = f.e.k === 'num' ? f.e.v : NaN;
    if ((g === 'cos' && e === -2) || (g === 'sec' && e === 2)) return fn('tan', X);
    if ((g === 'sin' && e === -2) || (g === 'csc' && e === 2)) return neg(fn('cot', X));
    if ((g === 'cosh' && e === -2) || (g === 'sech' && e === 2)) return fn('tanh', X);
    if (g === 'tan' && e === 2) return sub(fn('tan', X), X);
    if (g === 'cot' && e === 2) return neg(add(fn('cot', X), X));
    if (g === 'tanh' && e === 2) return sub(X, fn('tanh', X));
  }
  if (f.k === 'mul' && f.a.length === 2) {
    const ks = f.a.map(t => (t.k === 'fn' && isX(t.a[0], x) ? t.f : '')).sort().join(',');
    if (ks === 'sec,tan') return fn('sec', X);
    if (ks === 'cot,csc') return neg(fn('csc', X));
  }
  return null;
}

/** f(a·x + b): integrate f(u) and divide by a */
function linearSub(f: Node, c: Ctx): Node | null {
  const x = c.x; const seen = new Set<string>();
  for (const L of subtrees(f)) {
    if (L.k !== 'add' && L.k !== 'mul') continue;
    const k = key(L); if (seen.has(k)) continue; seen.add(k);
    const a = linearSlope(L, x); if (!a) continue;
    const g = simplify(replace(f, k, S(U))); if (depends(g, x)) continue;
    const G = integ(g, { x: U, depth: c.depth }); if (!G) continue;
    return mul(pow(a, -1), subst(G, { [U]: L }));
  }
  return null;
}

/** ∫ g(u(x)) u'(x) dx = ∫ g(u) du, trying each inner expression as u */
function uSub(f: Node, c: Ctx): Node | null {
  const x = c.x; const seen = new Set<string>(); const cands: Node[] = [];
  for (const s of subtrees(f)) {
    if (!depends(s, x) || isX(s, x) || s.k === 'num') continue;
    const k = key(s); if (seen.has(k) || k === key(f)) continue; seen.add(k); cands.push(s);
  }
  // larger expressions first (they usually remove the most x's)
  cands.sort((a, b) => key(b).length - key(a).length);
  for (const u of cands.slice(0, 16)) {
    const du = tryDiff(u, x); if (!du || isNum(du, 0)) continue;
    const q = simplify(mul(f, pow(du, -1)));
    const g = simplify(replace(q, key(u), S(U)));
    if (depends(g, x)) continue;
    const G = integ(g, { x: U, depth: c.depth + 1 }); if (!G) continue;
    return subst(G, { [U]: u });
  }
  return null;
}

/** polynomial × e^L, sin L, cos L, sinh L, cosh L or c^L (L linear): the tabular method,
 *  ∫ P g = P G₁ − P' G₂ + P'' G₃ − …  where each Gₖ₊₁ is an antiderivative of Gₖ. No deep recursion, so any degree works. */
function tabular(f: Node, c: Ctx): Node | null {
  const x = c.x; if (f.k !== 'mul') return null;
  const isG = (t: Node) => (t.k === 'fn' && ['exp', 'sin', 'cos', 'sinh', 'cosh'].includes(t.f) && !!linearSlope(t.a[0], x)) || (t.k === 'pow' && !depends(t.b, x) && !!linearSlope(t.e, x));
  const gs = f.a.filter(isG); if (gs.length !== 1) return null;
  const g = gs[0]; const P = simplify(prodOf(f.a.filter(t => t !== g)));
  if (!depends(P, x) || !polyOf(P, x)) return null;
  const terms: Node[] = []; let dP: Node = P, G: Node = g, sign = 1;
  for (let k = 0; k < 14 && !isNum(dP, 0); k++) {
    const Gn = integ(G, { x, depth: c.depth + 1 }); if (!Gn) return null;
    G = simplify(Gn); terms.push(mul(N(sign), dP, G));
    dP = simplify(diff(dP, x)); sign = -sign;
  }
  return isNum(dP, 0) ? add(...terms) : null;
}

/** ∫ u dv = u v − ∫ v du, choosing u by LIATE */
function parts(f: Node, c: Ctx): Node | null {
  const x = c.x;
  const fs = f.k === 'mul' ? f.a : [f];
  if (fs.length < 2 && !(f.k === 'fn' && ['ln', 'asin', 'acos', 'atan', 'log10', 'log2'].includes(f.f))) return null;
  const rank = (t: Node) => {
    if (t.k === 'fn' && ['ln', 'log10', 'log2'].includes(t.f)) return 0;
    if (t.k === 'fn' && ['asin', 'acos', 'atan', 'asinh', 'acosh', 'atanh'].includes(t.f)) return 1;
    if (polyOf(t, x)) return 2;
    if (t.k === 'fn' && ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh'].includes(t.f)) return 3;
    if ((t.k === 'fn' && t.f === 'exp') || (t.k === 'pow' && !depends(t.b, x))) return 4;
    return 5;
  };
  const sorted = [...fs].sort((a, b) => rank(a) - rank(b));
  const u = sorted[0]; if (rank(u) > 3) return null;
  const dv = simplify(prodOf(fs.filter(t => t !== u)));
  const v = isNum(dv, 1) ? S(x) : integ(dv, c); if (!v) return null;
  const du = tryDiff(u, x); if (!du) return null;
  const R = integ(simplify(mul(simplify(v), du)), c); if (!R) return null;
  return sub(mul(u, v), R);
}

/** e^(a x + p) · sin/cos(b x + q) */
function expTrig(f: Node, c: Ctx): Node | null {
  if (f.k !== 'mul' || f.a.length !== 2) return null;
  const x = c.x;
  const e = f.a.find(t => t.k === 'fn' && t.f === 'exp') as Extract<Node, { k: 'fn' }> | undefined;
  const t = f.a.find(t => t.k === 'fn' && (t.f === 'sin' || t.f === 'cos')) as Extract<Node, { k: 'fn' }> | undefined;
  if (!e || !t) return null;
  const a = linearSlope(e.a[0], x), b = linearSlope(t.a[0], x); if (!a || !b) return null;
  const A = e.a[0], B = t.a[0], den = add(pow(a, 2), pow(b, 2));
  const body = t.f === 'sin' ? sub(mul(a, fn('sin', B)), mul(b, fn('cos', B))) : add(mul(a, fn('cos', B)), mul(b, fn('sin', B)));
  return mul(fn('exp', A), body, pow(den, -1));
}

/** sinⁿ(L)·cosᵐ(L) for whole n, m ≥ 0 with L linear in x */
function trigPowers(f: Node, c: Ctx): Node | null {
  const x = c.x; const fs = f.k === 'mul' ? f.a : [f];
  let n = 0, m = 0, L: Node | null = null;
  for (const t of fs) {
    const base = t.k === 'pow' ? t.b : t, e = t.k === 'pow' ? (t.e.k === 'num' ? t.e.v : NaN) : 1;
    if (base.k !== 'fn' || (base.f !== 'sin' && base.f !== 'cos') || !Number.isInteger(e) || e < 0) return null;
    if (L && key(L) !== key(base.a[0])) return null; L = base.a[0];
    if (base.f === 'sin') n += e; else m += e;
  }
  if (!L || n + m < 2) return null;
  const a = linearSlope(L, x); if (!a) return null;
  const s = fn('sin', L), co = fn('cos', L);
  // (1 − u²)^k as a polynomial
  const omu = (k: number) => { let p: Poly = [1]; for (let i = 0; i < k; i++) p = pmul(p, [1, 0, -1]); return p; };
  const integPoly = (p: Poly, u: Node) => add(...p.map((cf, i) => mul(numNode(cf / (i + 1)), pow(u, i + 1))));
  if (n % 2 === 1) { // u = cos L, du = −a sin L
    const p = pmul(omu((n - 1) / 2), [...new Array(m).fill(0), 1]);
    return mul(N(-1), pow(a, -1), integPoly(p, co));
  }
  if (m % 2 === 1) { // u = sin L, du = a cos L
    const p = pmul(omu((m - 1) / 2), [...new Array(n).fill(0), 1]);
    return mul(pow(a, -1), integPoly(p, s));
  }
  // both even: sin² = (1 − cos 2L)/2, cos² = (1 + cos 2L)/2, then integrate the powers of cos 2L
  let p: Poly = [1];
  for (let i = 0; i < n / 2; i++) p = pmul(p, [0.5, -0.5]);
  for (let i = 0; i < m / 2; i++) p = pmul(p, [0.5, 0.5]);
  const c2 = fn('cos', simplify(mul(N(2), L)));
  const terms = p.map((cf, i) => (Math.abs(cf) < 1e-14 ? null : simplify(mul(numNode(cf), i === 0 ? N(1) : pow(c2, i)))));
  const out: Node[] = [];
  for (const t of terms) { if (!t) continue; const r = integ(t, { x, depth: c.depth + 1 }); if (!r) return null; out.push(r); }
  return add(...out);
}

/** P(x)/Q(x): polynomial division, then partial fractions over rational roots and irreducible quadratics */
function rationalFn(f: Node, c: Ctx): Node | null {
  const x = c.x, X = S(x);
  const fs = f.k === 'mul' ? f.a : [f];
  const num: Node[] = [], den: Node[] = [];
  for (const t of fs) {
    if (t.k === 'pow' && t.e.k === 'num' && Number.isInteger(t.e.v) && t.e.v < 0) den.push(t.e.v === -1 ? t.b : pow(t.b, -t.e.v));
    else num.push(t);
  }
  if (!den.length) return null;
  const P = polyOf(simplify(prodOf(num)), x), Q = polyOf(simplify(prodOf(den)), x);
  if (!P || !Q || deg(Q) < 1 || deg(Q) > 8) return null;
  const [q, r] = pdiv(P, Q);
  const parts: Node[] = [];
  if (deg(q) > 0 || Math.abs(q[0]) > 1e-14) parts.push(...q.map((cf, i) => (Math.abs(cf) < 1e-14 ? null : mul(numNode(cf / (i + 1)), pow(X, i + 1)))).filter(Boolean) as Node[]);
  if (!(deg(r) === 0 && Math.abs(r[0]) < 1e-14)) {
    // roots of Q, grouped by multiplicity; real ones must be rational, complex pairs give rational quadratics
    const z = roots(Q); const lead = trim(Q)[deg(Q)];
    type Fac = { kind: 'lin'; r: number; m: number } | { kind: 'quad'; p: number; q: number };
    const facs: Fac[] = []; const used = new Array(z.length).fill(false);
    for (let i = 0; i < z.length; i++) {
      if (used[i]) continue; used[i] = true;
      const [re, im] = z[i];
      if (Math.abs(im) < 1e-7) {
        let mlt = 1; for (let j = i + 1; j < z.length; j++) if (!used[j] && Math.hypot(z[j][0] - re, z[j][1]) < 1e-4) { used[j] = true; mlt++; }
        const rr = rational(re, 60); if (!rr) return null;
        facs.push({ kind: 'lin', r: rr[0] / rr[1], m: mlt });
      } else {
        const j = z.findIndex((w, k) => !used[k] && Math.abs(w[0] - re) < 1e-6 && Math.abs(w[1] + im) < 1e-6); if (j < 0) return null; used[j] = true;
        if (z.some((w, k) => !used[k] && Math.abs(w[0] - re) < 1e-4 && Math.abs(Math.abs(w[1]) - Math.abs(im)) < 1e-4)) return null; // repeated quadratic factors: not handled
        const p = -2 * re, qq = re * re + im * im; const rp = rational(p, 60), rq = rational(qq, 60); if (!rp || !rq) return null;
        facs.push({ kind: 'quad', p: rp[0] / rp[1], q: rq[0] / rq[1] });
      }
    }
    // unknown coefficients: A/(x−r)^k and (B x + C)/(x² + p x + q)
    type Basis = { ev: (t: number) => number; mk: (cf: number) => Node };
    const basis: Basis[] = [];
    for (const fc of facs) {
      if (fc.kind === 'lin') for (let k = 1; k <= fc.m; k++) {
        const L = add(X, numNode(-fc.r));
        basis.push({ ev: t => 1 / (t - fc.r) ** k, mk: cf => (k === 1 ? mul(numNode(cf), lnAbs(L)) : mul(numNode(cf / (1 - k)), pow(L, 1 - k))) });
      } else {
        const D = 4 * fc.q - fc.p * fc.p; if (!(D > 0)) return null;
        const Qd = add(pow(X, 2), mul(numNode(fc.p), X), numNode(fc.q)), sD = sqrtNode(D);
        basis.push({ ev: t => t / (t * t + fc.p * t + fc.q), mk: cf => add(mul(numNode(cf / 2), fn('ln', Qd)), mul(numNode(-cf * fc.p), pow(sD, -1), fn('atan', mul(add(mul(N(2), X), numNode(fc.p)), pow(sD, -1))))) });
        basis.push({ ev: t => 1 / (t * t + fc.p * t + fc.q), mk: cf => mul(numNode(2 * cf), pow(sD, -1), fn('atan', mul(add(mul(N(2), X), numNode(fc.p)), pow(sD, -1)))) });
      }
    }
    const n = basis.length; const pts = Array.from({ length: n }, (_, i) => 0.37 + 1.13 * i + 0.071 * i * i);
    const evp = (p: Poly, t: number) => p.reduce((s, cf, i) => s + cf * t ** i, 0);
    const coef = solve(pts.map(t => basis.map(b => b.ev(t))), pts.map(t => evp(r, t) / evp(Q, t)));
    if (!coef || coef.some(v => !isFinite(v))) return null;
    // exact coefficients only (textbook answers); otherwise let the numerical fallback take over
    for (let i = 0; i < n; i++) { const rr = rational(coef[i], 600); if (!rr) return null; parts.push(basis[i].mk(rr[0] / rr[1])); }
    void lead;
  }
  return parts.length ? add(...parts) : N(0);
}

/** √(αx² + βx + γ) and 1/√(αx² + βx + γ) by completing the square */
function sqrtQuadratic(f: Node, c: Ctx): Node | null {
  const x = c.x, X = S(x);
  if (f.k !== 'pow' || f.e.k !== 'num' || (f.e.v !== 0.5 && f.e.v !== -0.5)) return null;
  const Q = polyOf(f.b, x); if (!Q || deg(Q) !== 2) return null;
  const [g, b, al] = [Q[0], Q[1] ?? 0, Q[2]];
  const h = b / (2 * al), k = g - b * b / (4 * al);
  const u = Math.abs(h) < 1e-14 ? X : add(X, numNode(h));
  const sq = f.e.v === 0.5 ? f : pow(f.b, 0.5);   // √Q itself
  const A = Math.abs(al), a2 = Math.abs(k) / A, a = sqrtNode(a2), sA = sqrtNode(A);
  if (Math.abs(k) < 1e-14) return null;
  if (al < 0 && k > 0) {        // √(A(a² − u²))
    if (f.e.v === -0.5) return mul(pow(sA, -1), fn('asin', mul(u, pow(a, -1))));
    return add(mul(N(0.5), u, sq), mul(N(0.5), sA, numNode(a2), fn('asin', mul(u, pow(a, -1)))));
  }
  if (al > 0 && k > 0) {        // √(A(u² + a²))
    if (f.e.v === -0.5) return mul(pow(sA, -1), fn('asinh', mul(u, pow(a, -1))));
    return add(mul(N(0.5), u, sq), mul(N(0.5), sA, numNode(a2), fn('asinh', mul(u, pow(a, -1)))));
  }
  if (al > 0 && k < 0) {        // √(A(u² − a²))
    const L = lnAbs(add(u, mul(pow(sA, -1), sq)));
    if (f.e.v === -0.5) return mul(pow(sA, -1), L);
    return sub(mul(N(0.5), u, sq), mul(N(0.5), sA, numNode(a2), L));
  }
  return null;
}

/** multiply out products of sums and small whole powers of sums, then integrate term by term */
export function expand(n: Node): Node {
  if (n.k === 'add') return add(...n.a.map(expand));
  if (n.k === 'pow' && n.e.k === 'num' && Number.isInteger(n.e.v) && n.e.v >= 2 && n.e.v <= 6 && n.b.k === 'add') return expand(mul(...new Array(n.e.v).fill(n.b)));
  if (n.k === 'mul') {
    let terms: Node[][] = [[]];
    for (const fct of n.a.map(expand)) {
      const opts = fct.k === 'add' ? fct.a : [fct];
      if (terms.length * opts.length > 80) return n;
      terms = terms.flatMap(t => opts.map(o => [...t, o]));
    }
    return add(...terms.map(t => prodOf(t)));
  }
  return n;
}
function expandThen(f: Node, c: Ctx): Node | null {
  const e = simplify(expand(f)); if (key(e) === key(f) || e.k !== 'add') return null;
  const parts = e.a.map(t => integ(t, { x: c.x, depth: c.depth + 1 }));
  return parts.every(Boolean) ? add(...(parts as Node[])) : null;
}

// ---------------------------------------------------------------- entry point
/** check F' = f numerically at scattered points (parameters set to assorted values) */
export function verify(F: Node, f: Node, x: string): boolean {
  const dF = tryDiff(F, x); if (!dF) return false;
  const params = [...new Set([...freeSyms(f), ...freeSyms(F)])].filter(v => v !== x);
  const pv = Object.fromEntries(params.map((p, i) => [p, 1.37 + 0.29 * i]));
  let g: (...a: number[]) => number, h: (...a: number[]) => number;
  try { g = compile(f, [x], pv); h = compile(dF, [x], pv); } catch { return false; }
  let ok = 0;
  for (const t of [0.31, 0.77, 1.23, 1.91, 2.63, -0.43, -1.17, -2.29, 3.7, 0.05]) {
    const a = g(t), b = h(t); if (!isFinite(a) || !isFinite(b)) continue;
    if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a))) return false; ok++;
  }
  return ok >= 3;
}
/** an antiderivative of f with respect to x (without the + C), or null when none is found */
export function antiderivative(f: Node, x: string): Node | null {
  let F: Node | null = null;
  try { F = integ(simplify(f), { x, depth: 0 }); } catch { F = null; }
  if (!F) return null;
  let G = simplify(F);
  // multiplying out often reads better (x²eˣ − 2xeˣ + 2eˣ rather than x²eˣ − 2(xeˣ − eˣ)); keep it when it isn't longer
  // (but keep compact powers like (x²+1)⁴/8 rather than a long polynomial)
  const hasSumPower = (n: Node): boolean => (n.k === 'pow' && n.b.k === 'add' && n.e.k === 'num' && Number.isInteger(n.e.v) && n.e.v >= 2) || ((n.k === 'add' || n.k === 'mul' || n.k === 'fn') && n.a.some(hasSumPower)) || (n.k === 'pow' && (hasSumPower(n.b) || hasSumPower(n.e)));
  try { let E = G; for (let i = 0; i < 6; i++) { const nx = simplify(expand(E)); if (key(nx) === key(E)) break; E = nx; } if (key(E).length <= key(G).length * (hasSumPower(G) ? 1.1 : 1.6) && verify(E, f, x)) G = E; } catch { /* keep G */ }
  return verify(G, f, x) ? G : null;
}
void PI; void diff;
