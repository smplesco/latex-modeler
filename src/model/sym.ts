// A small computer-algebra core: expression trees, simplification, differentiation,
// LaTeX / .bd code printing and numeric compilation.
import { gamma, fact, erf } from '../lang/builtins';

export type Node =
  | { k: 'num'; v: number; paren?: boolean }
  | { k: 'sym'; n: string; tex: string; bold?: boolean; c?: boolean; paren?: boolean }
  | { k: 'add'; a: Node[]; paren?: boolean }
  | { k: 'mul'; a: Node[]; paren?: boolean }
  | { k: 'pow'; b: Node; e: Node; paren?: boolean }
  | { k: 'fn'; f: string; a: Node[]; paren?: boolean }
  | { k: 'tuple'; a: Node[]; paren?: boolean; bracket?: boolean }
  | { k: 'matrix'; rows: Node[][]; paren?: boolean }
  | { k: 'pw'; cases: { v: Node; c: Node | null }[]; paren?: boolean }
  | { k: 'rel'; ops: string[]; terms: Node[]; paren?: boolean }
  | { k: 'sum'; i: string; lo: Node; hi: Node; body: Node; prod: boolean; paren?: boolean }
  | { k: 'deriv'; of: string; ofTex: string; wrt: string; order: number; paren?: boolean }
  | { k: 'alt'; a: Node[]; paren?: boolean }
  | { k: 'interval'; lo: Node; hi: Node; paren?: boolean }
  | { k: 'stmts'; a: Node[]; paren?: boolean }
  | { k: 'int'; v: string; vtex: string; lo: Node | null; hi: Node | null; body: Node; paren?: boolean }
  | { k: 'lim'; v: string; vtex: string; to: Node; dir: number; body: Node; paren?: boolean };

export class MathError extends Error {}

// ---------------------------------------------------------------- constructors
export const N = (v: number): Node => ({ k: 'num', v });
export const S = (n: string, tex?: string): Node => ({ k: 'sym', n, tex: tex ?? n });
export const PI: Node = { k: 'sym', n: 'pi', tex: '\\pi', c: true };
export const E: Node = { k: 'sym', n: 'e', tex: 'e', c: true };
export const add = (...a: Node[]): Node => ({ k: 'add', a });
export const mul = (...a: Node[]): Node => ({ k: 'mul', a });
export const pow = (b: Node, e: Node | number): Node => {
  const ee = typeof e === 'number' ? N(e) : e;
  if (b.k === 'sym' && b.c && b.n === 'e') return fn('exp', ee);
  return { k: 'pow', b, e: ee };
};
export const fn = (f: string, ...a: Node[]): Node => ({ k: 'fn', f, a });
export const neg = (a: Node): Node => mul(N(-1), a);
export const sub = (a: Node, b: Node): Node => add(a, neg(b));
export const div = (a: Node, b: Node): Node => mul(a, pow(b, -1));
export const isNum = (n: Node, v?: number) => n.k === 'num' && (v === undefined || Math.abs(n.v - v) < 1e-12);

// ---------------------------------------------------------------- inspection
export function key(n: Node): string {
  switch (n.k) {
    case 'num': return String(+n.v.toPrecision(14));
    case 'sym': return n.n;
    case 'add': return '(+ ' + n.a.map(key).join(' ') + ')';
    case 'mul': return '(* ' + n.a.map(key).join(' ') + ')';
    case 'pow': return '(^ ' + key(n.b) + ' ' + key(n.e) + ')';
    case 'fn': return '(' + n.f + ' ' + n.a.map(key).join(' ') + ')';
    case 'tuple': return '(tuple ' + n.a.map(key).join(' ') + ')';
    case 'matrix': return '(mat ' + n.rows.map(r => r.map(key).join(' ')).join(' | ') + ')';
    case 'pw': return '(pw ' + n.cases.map(c => key(c.v) + ' ' + (c.c ? key(c.c) : '_')).join(' ') + ')';
    case 'rel': return '(rel ' + n.ops.join(',') + ' ' + n.terms.map(key).join(' ') + ')';
    case 'sum': return `(${n.prod ? 'prod' : 'sum'} ${n.i} ${key(n.lo)} ${key(n.hi)} ${key(n.body)})`;
    case 'int': return `(int ${n.v} ${n.lo ? key(n.lo) : '_'} ${n.hi ? key(n.hi) : '_'} ${key(n.body)})`;
    case 'lim': return `(lim ${n.v} ${key(n.to)} ${n.dir} ${key(n.body)})`;
    case 'deriv': return `(d ${n.of} ${n.wrt} ${n.order})`;
    case 'alt': return '(alt ' + n.a.map(key).join(' ') + ')';
    case 'interval': return `(int ${key(n.lo)} ${key(n.hi)})`;
    case 'stmts': return '(stmts ' + n.a.map(key).join(' ') + ')';
  }
}

export function freeSyms(n: Node, out = new Set<string>(), bound = new Set<string>()): Set<string> {
  switch (n.k) {
    case 'sym': if (!n.c && !bound.has(n.n)) out.add(n.n); break;
    case 'add': case 'mul': case 'tuple': case 'alt': case 'stmts': n.a.forEach(x => freeSyms(x, out, bound)); break;
    case 'fn': n.a.forEach(x => freeSyms(x, out, bound)); break;
    case 'pow': freeSyms(n.b, out, bound); freeSyms(n.e, out, bound); break;
    case 'matrix': n.rows.forEach(r => r.forEach(x => freeSyms(x, out, bound))); break;
    case 'pw': n.cases.forEach(c => { freeSyms(c.v, out, bound); if (c.c) freeSyms(c.c, out, bound); }); break;
    case 'rel': n.terms.forEach(x => freeSyms(x, out, bound)); break;
    case 'sum': { freeSyms(n.lo, out, bound); freeSyms(n.hi, out, bound); const b2 = new Set(bound); b2.add(n.i); freeSyms(n.body, out, b2); break; }
    case 'int': { if (n.lo) freeSyms(n.lo, out, bound); if (n.hi) freeSyms(n.hi, out, bound); const b2 = new Set(bound); if (n.lo || n.hi) b2.add(n.v); freeSyms(n.body, out, b2); break; }
    case 'lim': { freeSyms(n.to, out, bound); const b2 = new Set(bound); b2.add(n.v); freeSyms(n.body, out, b2); break; }
    case 'interval': freeSyms(n.lo, out, bound); freeSyms(n.hi, out, bound); break;
  }
  return out;
}
/** map from symbol name to its TeX, for axis labels */
export function symTex(n: Node, out = new Map<string, string>()): Map<string, string> {
  if (n.k === 'sym' && !n.c) { if (!out.has(n.n)) out.set(n.n, n.tex); return out; }
  for (const c of children(n)) symTex(c, out);
  return out;
}
export function children(n: Node): Node[] {
  switch (n.k) {
    case 'add': case 'mul': case 'tuple': case 'alt': case 'stmts': case 'fn': return n.a;
    case 'pow': return [n.b, n.e];
    case 'matrix': return n.rows.flat();
    case 'pw': return n.cases.flatMap(c => (c.c ? [c.v, c.c] : [c.v]));
    case 'rel': return n.terms;
    case 'sum': return [n.lo, n.hi, n.body];
    case 'int': return [...(n.lo ? [n.lo] : []), ...(n.hi ? [n.hi] : []), n.body];
    case 'lim': return [n.to, n.body];
    case 'interval': return [n.lo, n.hi];
    default: return [];
  }
}
export const depends = (n: Node, v: string) => freeSyms(n).has(v);
export function hasFn(n: Node, names: string[], v?: string): boolean {
  if (n.k === 'fn' && names.includes(n.f) && (!v || n.a.some(a => depends(a, v)))) return true;
  return children(n).some(c => hasFn(c, names, v));
}
export const TRIG = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'];

/** substitute symbols */
export function subst(n: Node, map: Record<string, Node>): Node {
  switch (n.k) {
    case 'sym': return !n.c && map[n.n] ? map[n.n] : n;
    case 'num': case 'deriv': return n;
    case 'add': return { ...n, a: n.a.map(x => subst(x, map)) };
    case 'mul': return { ...n, a: n.a.map(x => subst(x, map)) };
    case 'tuple': return { ...n, a: n.a.map(x => subst(x, map)) };
    case 'alt': return { ...n, a: n.a.map(x => subst(x, map)) };
    case 'stmts': return { ...n, a: n.a.map(x => subst(x, map)) };
    case 'fn': return { ...n, a: n.a.map(x => subst(x, map)) };
    case 'pow': return pow(subst(n.b, map), subst(n.e, map));
    case 'matrix': return { ...n, rows: n.rows.map(r => r.map(x => subst(x, map))) };
    case 'pw': return { ...n, cases: n.cases.map(c => ({ v: subst(c.v, map), c: c.c ? subst(c.c, map) : null })) };
    case 'rel': return { ...n, terms: n.terms.map(x => subst(x, map)) };
    case 'sum': { const m2 = { ...map }; delete m2[n.i]; return { ...n, lo: subst(n.lo, map), hi: subst(n.hi, map), body: subst(n.body, m2) }; }
    case 'interval': return { ...n, lo: subst(n.lo, map), hi: subst(n.hi, map) };
  }
}

// ---------------------------------------------------------------- simplification
function degree(n: Node): number {
  if (n.k === 'sym') return n.c ? 0 : 1;
  if (n.k === 'pow') return n.e.k === 'num' ? degree(n.b) * n.e.v : 1.5;
  if (n.k === 'mul') return n.a.reduce((s, x) => s + degree(x), 0);
  if (n.k === 'num') return 0;
  return 0.5;
}
function factorRank(n: Node) {
  if (n.k === 'num') return 0;
  if (n.k === 'sym') return n.c ? 1 : 2;
  if (n.k === 'pow' && n.b.k === 'sym') return n.e.k === 'num' && n.e.v < 0 ? 6 : 3;
  if (n.k === 'fn') return 4;
  if (n.k === 'pow' && n.e.k === 'num' && n.e.v < 0) return 6;
  return 5;
}
function splitCoef(t: Node): [number, Node | null] {
  if (t.k === 'num') return [t.v, null];
  if (t.k === 'mul') {
    let c = 1; const rest: Node[] = [];
    for (const f of t.a) { if (f.k === 'num') c *= f.v; else rest.push(f); }
    return [c, rest.length === 0 ? null : rest.length === 1 ? rest[0] : { k: 'mul', a: rest }];
  }
  return [1, t];
}
function mkMul(c: number, rest: Node | null): Node {
  if (!rest) return N(c);
  if (c === 1) return rest;
  if (rest.k === 'mul') return { k: 'mul', a: [N(c), ...rest.a] };
  return { k: 'mul', a: [N(c), rest] };
}

export function simplify(n: Node, depth = 0): Node {
  if (depth > 40) return n;
  const s = (x: Node) => simplify(x, depth + 1);
  switch (n.k) {
    case 'num': case 'sym': case 'deriv': return n;
    case 'add': {
      const terms: Node[] = [];
      const push = (x: Node) => { if (x.k === 'add') x.a.forEach(push); else terms.push(x); };
      n.a.map(s).forEach(push);
      let constant = 0; const coef = new Map<string, { c: number; r: Node }>(); const order: string[] = [];
      for (const t of terms) {
        const [c, r] = splitCoef(t);
        if (!r) { constant += c; continue; }
        const kk = key(r);
        if (!coef.has(kk)) { coef.set(kk, { c: 0, r }); order.push(kk); }
        coef.get(kk)!.c += c;
      }
      const out: Node[] = [];
      for (const kk of order) { const { c, r } = coef.get(kk)!; if (Math.abs(c) > 1e-14) out.push(mkMul(+c.toPrecision(15), r)); }
      const rk = (t: Node) => { const [c, r] = splitCoef(t); return { c, k: r ? key(r) : '' }; };
      out.sort((a, b) => { const A = rk(a), Bq = rk(b); return degree(b) - degree(a) || (A.c < 0 ? 1 : 0) - (Bq.c < 0 ? 1 : 0) || (A.k < Bq.k ? -1 : A.k > Bq.k ? 1 : 0); });
      if (Math.abs(constant) > 1e-14) out.push(N(+constant.toPrecision(15)));
      if (out.length === 0) return N(0);
      return out.length === 1 ? out[0] : { k: 'add', a: out };
    }
    case 'mul': {
      const fs: Node[] = [];
      const push = (x: Node) => { if (x.k === 'mul') x.a.forEach(push); else fs.push(x); };
      n.a.map(s).forEach(push);
      // e^a · e^b = e^(a+b)
      const exps = fs.filter(f => f.k === 'fn' && f.f === 'exp');
      if (exps.length > 1) return s({ k: 'mul', a: [...fs.filter(f => !(f.k === 'fn' && f.f === 'exp')), fn('exp', add(...exps.map(e => (e as any).a[0])))] });
      let c = 1; const bases = new Map<string, { b: Node; e: Node[] }>(); const order: string[] = [];
      for (const f of fs) {
        if (f.k === 'num') { c *= f.v; continue; }
        const b = f.k === 'pow' ? f.b : f, e = f.k === 'pow' ? f.e : N(1);
        const kk = key(b);
        if (!bases.has(kk)) { bases.set(kk, { b, e: [] }); order.push(kk); }
        bases.get(kk)!.e.push(e);
      }
      if (c === 0) return N(0);
      let out: Node[] = [];
      for (const kk of order) {
        const { b, e } = bases.get(kk)!;
        const p = simpPow(b, s(e.length === 1 ? e[0] : { k: 'add', a: e }), depth);
        if (p.k === 'num') c *= p.v;
        else if (p.k === 'mul') for (const q of p.a) { if (q.k === 'num') c *= q.v; else out.push(q); }
        else out.push(p);
      }
      if (c === 0) return N(0);
      // a second pass merges bases that surfaced from distributing powers
      if (out.length > 1 && new Set(out.map(o => key(o.k === 'pow' ? o.b : o))).size < out.length) return s({ k: 'mul', a: [N(c), ...out] });
      out.sort((a, b) => factorRank(a) - factorRank(b) || (key(a) < key(b) ? -1 : 1));
      c = +c.toPrecision(15);
      if (out.length === 0) return N(c);
      if (c !== 1) out = [N(c), ...out];
      return out.length === 1 ? out[0] : { k: 'mul', a: out };
    }
    case 'pow': return simpPow(s(n.b), s(n.e), depth);
    case 'fn': {
      const a = n.a.map(s); const x = a[0];
      if (x && x.k === 'num') {
        const z = x.v;
        if (z === 0 && ['sin', 'tan', 'sinh', 'tanh', 'asin', 'atan', 'asinh', 'atanh', 'abs', 'sign', 'erf'].includes(n.f)) return N(0);
        if (z === 0 && ['cos', 'cosh', 'exp', 'sec', 'sech'].includes(n.f)) return N(1);
        if (z === 1 && n.f === 'ln') return N(0);
        if (z === 1 && n.f === 'acos') return N(0);
        if (n.f === 'abs') return N(Math.abs(z));
        if ((n.f === 'floor' || n.f === 'ceil' || n.f === 'round') && Number.isInteger(z)) return N(z);
        if (n.f === 'fact' && Number.isInteger(z) && z >= 0 && z <= 20) return N(fact(z));
      }
      if (n.f === 'ln' && x && x.k === 'fn' && x.f === 'exp') return x.a[0];
      if (n.f === 'ln' && x && x.k === 'sym' && x.c && x.n === 'e') return N(1);
      if (n.f === 'exp' && x && x.k === 'fn' && x.f === 'ln') return x.a[0];
      if (n.f === 'abs' && x && x.k === 'pow' && x.e.k === 'num' && x.e.v % 2 === 0) return x;
      return { k: 'fn', f: n.f, a };
    }
    case 'tuple': return { ...n, a: n.a.map(s) };
    case 'matrix': return { ...n, rows: n.rows.map(r => r.map(s)) };
    case 'pw': return { ...n, cases: n.cases.map(c => ({ v: s(c.v), c: c.c ? s(c.c) : null })) };
    case 'rel': return { ...n, terms: n.terms.map(s) };
    case 'sum': return { ...n, lo: s(n.lo), hi: s(n.hi), body: s(n.body) };
    case 'alt': return { ...n, a: n.a.map(s) };
    default: return n;
  }
}
function simpPow(b: Node, e: Node, depth: number): Node {
  if (isNum(e, 0)) return N(1);
  if (isNum(e, 1)) return b;
  if (isNum(b, 1)) return N(1);
  if (isNum(b, 0) && e.k === 'num' && e.v > 0) return N(0);
  if (b.k === 'num' && e.k === 'num') {
    const r = Math.pow(b.v, e.v);
    if (isFinite(r) && Number.isInteger(e.v) && Math.abs(r) < 1e12) return N(r);
    if (isFinite(r) && Number.isInteger(r) && Math.abs(r) < 1e9) return N(r);
  }
  if (b.k === 'sym' && b.c && b.n === 'e') return simplify(fn('exp', e), depth + 1);
  if (b.k === 'fn' && b.f === 'exp' && e.k === 'num') return simplify(fn('exp', mul(b.a[0], e)), depth + 1);
  if (b.k === 'pow' && e.k === 'num' && (Number.isInteger(e.v) || (b.e.k === 'num' && Number.isInteger(b.e.v) && b.e.v % 2 === 1)))
    return simpPow(b.b, simplify(mul(b.e, e), depth + 1), depth + 1);
  if (b.k === 'mul' && e.k === 'num' && Number.isInteger(e.v)) return simplify({ k: 'mul', a: b.a.map(f => pow(f, e)) }, depth + 1);
  return { k: 'pow', b, e };
}

// ---------------------------------------------------------------- differentiation
export function diff(n: Node, v: string): Node {
  if (!depends(n, v)) return N(0);
  switch (n.k) {
    case 'sym': return N(n.n === v ? 1 : 0);
    case 'add': return add(...n.a.map(t => diff(t, v)));
    case 'mul': return add(...n.a.map((f, i) => mul(...n.a.map((g, j) => (i === j ? diff(g, v) : g)))));
    case 'pow': {
      const db = depends(n.b, v), de = depends(n.e, v);
      if (!de) return mul(n.e, pow(n.b, add(n.e, N(-1))), diff(n.b, v));
      if (!db) return mul(n, fn('ln', n.b), diff(n.e, v));
      return mul(n, add(mul(diff(n.e, v), fn('ln', n.b)), mul(n.e, diff(n.b, v), pow(n.b, -1))));
    }
    case 'fn': {
      const u = n.a[0], du = diff(u, v);
      const d = fnDeriv(n.f, u, n);
      return mul(d, du);
    }
    case 'tuple': return { k: 'tuple', a: n.a.map(c => diff(c, v)) };
    case 'pw': return { k: 'pw', cases: n.cases.map(c => ({ v: diff(c.v, v), c: c.c })) };
    case 'sum': return { ...n, body: diff(n.body, v) };
    case 'alt': return { k: 'alt', a: n.a.map(c => diff(c, v)) };
  }
  throw new MathError(`can't differentiate ${n.k}`);
}
function fnDeriv(f: string, u: Node, whole: Node): Node {
  const sq = (x: Node) => pow(x, 2), one = N(1);
  switch (f) {
    case 'sin': return fn('cos', u);
    case 'cos': return neg(fn('sin', u));
    case 'tan': return pow(fn('cos', u), -2);
    case 'sec': return mul(fn('sec', u), fn('tan', u));
    case 'csc': return neg(mul(fn('csc', u), fn('cot', u)));
    case 'cot': return neg(pow(fn('sin', u), -2));
    case 'asin': return pow(sub(one, sq(u)), -0.5);
    case 'acos': return neg(pow(sub(one, sq(u)), -0.5));
    case 'atan': return pow(add(one, sq(u)), -1);
    case 'acot': return neg(pow(add(one, sq(u)), -1));
    case 'sinh': return fn('cosh', u);
    case 'cosh': return fn('sinh', u);
    case 'tanh': return pow(fn('cosh', u), -2);
    case 'sech': return neg(mul(fn('sech', u), fn('tanh', u)));
    case 'csch': return neg(mul(fn('csch', u), fn('coth', u)));
    case 'coth': return neg(pow(fn('sinh', u), -2));
    case 'asinh': return pow(add(sq(u), one), -0.5);
    case 'acosh': return pow(sub(sq(u), one), -0.5);
    case 'atanh': return pow(sub(one, sq(u)), -1);
    case 'exp': return whole;
    case 'ln': return pow(u, -1);
    case 'log10': return pow(mul(u, fn('ln', N(10))), -1);
    case 'log2': return pow(mul(u, fn('ln', N(2))), -1);
    case 'abs': return fn('sign', u);
    case 'sign': case 'floor': case 'ceil': case 'round': return N(0);
    case 'erf': return mul(N(2), pow(PI, -0.5), fn('exp', neg(sq(u))));
  }
  throw new MathError(`no derivative rule for ${f}`);
}
export function tryDiff(n: Node, v: string): Node | null {
  try { return simplify(diff(n, v)); } catch { return null; }
}

// ---------------------------------------------------------------- numbers
export function rational(v: number, maxDen = 16): [number, number] | null {
  if (!isFinite(v)) return null;
  for (let q = 1; q <= maxDen; q++) { const p = Math.round(v * q); if (Math.abs(p / q - v) < 1e-9 * Math.max(1, Math.abs(v))) return [p, q]; }
  return null;
}
function numTex(v: number): string {
  if (!isFinite(v)) return v > 0 ? '\\infty' : v < 0 ? '-\\infty' : '\\text{NaN}';
  const r = rational(v, 40);
  if (r) { const [p, q] = r; if (q === 1) return String(p); return (p < 0 ? '-' : '') + `\\frac{${Math.abs(p)}}{${q}}`; }
  const a = Math.abs(v);
  let s = a >= 1e5 || a < 1e-3 ? (() => { const e = Math.floor(Math.log10(a)); return `${+(v / 10 ** e).toPrecision(4)}\\times 10^{${e}}`; })() : String(+v.toPrecision(5));
  return s;
}
/** pretty-print a numeric result: integers, fractions, multiples of π, square roots */
export function prettyNum(v: number, approx = true): string {
  if (!isFinite(v)) return numTex(v);
  if (Math.abs(v) < 1e-10) return '0';
  const r = rational(v, 12); if (r) return numTex(v);
  const rp = rational(v / Math.PI, 12);
  if (rp) { const [p, q] = rp; const a = Math.abs(p); const s = p < 0 ? '-' : ''; const num = a === 1 ? '\\pi' : `${a}\\pi`; return q === 1 ? s + num : `${s}\\frac{${num}}{${q}}`; }
  for (let k = 2; k <= 60; k++) {
    if (Number.isInteger(Math.sqrt(k))) continue;
    const rr = rational(v / Math.sqrt(k), 8);
    if (rr) { const [p, q] = rr; const a = Math.abs(p); const s = p < 0 ? '-' : ''; const num = (a === 1 ? '' : a) + `\\sqrt{${k}}`; return q === 1 ? s + num : `${s}\\frac{${num}}{${q}}`; }
  }
  const re = rational(v / Math.E, 6);
  if (re) { const [p, q] = re; return (p < 0 ? '-' : '') + (q === 1 ? (Math.abs(p) === 1 ? 'e' : `${Math.abs(p)}e`) : `\\frac{${Math.abs(p) === 1 ? '' : Math.abs(p)}e}{${q}}`); }
  return (approx ? '\\approx ' : '') + String(+v.toPrecision(4));
}
export const prettyEq = (v: number) => { const s = prettyNum(v); return s.startsWith('\\approx') ? s : '= ' + s; };

// ---------------------------------------------------------------- LaTeX printing
const FN_TEX: Record<string, string> = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot',
  asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan', acot: '\\operatorname{arccot}', asec: '\\operatorname{arcsec}', acsc: '\\operatorname{arccsc}',
  sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', coth: '\\coth', sech: '\\operatorname{sech}', csch: '\\operatorname{csch}',
  asinh: '\\operatorname{arsinh}', acosh: '\\operatorname{arcosh}', atanh: '\\operatorname{artanh}',
  ln: '\\ln', log10: '\\log_{10}', log2: '\\log_{2}', sign: '\\operatorname{sgn}', erf: '\\operatorname{erf}', max: '\\max', min: '\\min', det: '\\det',
  gamma: '\\Gamma', sinc: '\\operatorname{sinc}', round: '\\operatorname{round}', norm: '\\operatorname{norm}',
};
const atomic = (n: Node) => n.k === 'sym' || (n.k === 'num' && n.v >= 0) || (n.k === 'fn' && ['abs', 'floor', 'ceil'].includes(n.f));
const isNegTerm = (n: Node) => (n.k === 'num' && n.v < 0) || (n.k === 'mul' && n.a[0].k === 'num' && n.a[0].v < 0);
const negateTerm = (n: Node): Node => n.k === 'num' ? N(-n.v) : mkMul(-(n as any).a[0].v, (n as any).a.length === 2 ? (n as any).a[1] : { k: 'mul', a: (n as any).a.slice(1) });
const REL_TEX: Record<string, string> = { '=': '=', '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '!=': '\\ne', in: '\\in' };

export function toTex(n: Node, prec = 0): string {
  const wrap = (s: string, p: number) => (p < prec ? `\\left(${s}\\right)` : s);
  switch (n.k) {
    case 'num': return n.v < 0 && prec > 1 ? `\\left(${numTex(n.v)}\\right)` : numTex(n.v);
    case 'sym': return n.tex;
    case 'add': {
      // lead with a positive term when there is one (1 - y rather than -y + 1)
      let terms = n.a;
      if (isNegTerm(terms[0])) { const k = terms.findIndex(t => !isNegTerm(t)); if (k > 0) terms = [terms[k], ...terms.filter((_, i) => i !== k)]; }
      let s = toTex(terms[0], 1);
      for (const t of terms.slice(1)) s += isNegTerm(t) ? ' - ' + toTex(negateTerm(t), 2) : ' + ' + toTex(t, 1);
      return wrap(s, 1);
    }
    case 'mul': {
      if (isNegTerm(n)) return wrap('-' + toTex(negateTerm(n), 2), 1);
      let c = 1; const numF: Node[] = [], denF: Node[] = [];
      for (const f of n.a) {
        if (f.k === 'num') c *= f.v;
        else if (f.k === 'pow' && f.e.k === 'num' && f.e.v < 0) denF.push(simpPow(f.b, N(-f.e.v), 0));
        else numF.push(f);
      }
      const r = rational(c, 40) ?? [c, 1];
      let [p, q] = r;
      const joinF = (fs: Node[], lead: number) => {
        const parts: string[] = []; if (lead !== 1 || fs.length === 0) parts.push(numTex(lead));
        const solo = fs.length === 1 && lead === 1 && (denF.length > 0 || q !== 1);
        for (const f of fs) parts.push(toTex(f, solo ? 0 : 2.5));
        let out = parts[0] ?? '';
        for (let i = 1; i < parts.length; i++) out += (/^[\d.]/.test(parts[i]) || /^\\frac/.test(parts[i]) && i > 0 && /\d$/.test(out) ? ' \\cdot ' : ' ') + parts[i];
        return out;
      };
      if (denF.length || q !== 1) {
        const num = joinF(numF, p), den = joinF(denF, q);
        return wrap(`\\frac{${num}}{${den}}`, 2);
      }
      return wrap(joinF(numF, p), 2);
    }
    case 'pow': {
      const e = n.e, b = n.b;
      if (e.k === 'num') {
        if (Math.abs(e.v - 0.5) < 1e-12) return `\\sqrt{${toTex(b)}}`;
        if (Math.abs(e.v - 1 / 3) < 1e-12) return `\\sqrt[3]{${toTex(b)}}`;
        if (e.v < 0) return wrap(`\\frac{1}{${toTex(simpPow(b, N(-e.v), 0))}}`, 2);   // a denominator needs no brackets
        if (b.k === 'fn' && Number.isInteger(e.v) && e.v > 0 && FN_TEX[b.f] && !['ln', 'log10', 'log2', 'gamma', 'max', 'min', 'det'].includes(b.f) && !b.f.startsWith('a')) {
          const arg = b.a[0];
          return wrap(`${FN_TEX[b.f]}^{${e.v}}${atomic(arg) ? ' ' + toTex(arg, 3) : `\\left(${toTex(arg)}\\right)`}`, 2);
        }
      }
      const et = e.k === 'num' && !Number.isInteger(e.v) && rational(e.v, 12) ? (() => { const [p, q] = rational(e.v, 12)!; return `${p}/${q}`; })() : toTex(e);
      const bt = (b.k === 'sym' || (b.k === 'num' && b.v >= 0)) ? toTex(b) : `\\left(${toTex(b)}\\right)`;
      return wrap(`${bt}^{${et}}`, 3);
    }
    case 'fn': {
      const a = n.a[0];
      switch (n.f) {
        case 'exp': return `e^{${toTex(a)}}`;
        case 'abs': return `\\left|${toTex(a)}\\right|`;
        case 'floor': return `\\left\\lfloor ${toTex(a)} \\right\\rfloor`;
        case 'ceil': return `\\left\\lceil ${toTex(a)} \\right\\rceil`;
        case 'fact': return wrap(`${atomic(a) ? toTex(a, 3) : `\\left(${toTex(a)}\\right)`}!`, 3);
        case 'binom': return `\\binom{${toTex(n.a[0])}}{${toTex(n.a[1])}}`;
        case 'atan2': return `\\operatorname{atan2}\\left(${toTex(n.a[0])}, ${toTex(n.a[1])}\\right)`;
        case 'norm': return `\\left\\|${toTex(a)}\\right\\|`;
      }
      const name = FN_TEX[n.f] ?? `\\operatorname{${n.f}}`;
      if (n.a.length > 1) return `${name}\\left(${n.a.map(x => toTex(x)).join(', ')}\\right)`;
      const simpleArg = atomic(a) || (a.k === 'mul' && a.a.length === 2 && a.a[0].k === 'num' && a.a[0].v > 0 && a.a[1].k === 'sym');
      return wrap(simpleArg && n.f !== 'gamma' ? `${name} ${toTex(a, a.k === 'mul' ? 2 : 3)}` : `${name}\\left(${toTex(a)}\\right)`, 2.5);
    }
    case 'tuple': return `\\left(${n.a.map(x => toTex(x)).join(',\\; ')}\\right)`;
    case 'matrix': return `\\begin{pmatrix} ${n.rows.map(r => r.map(x => toTex(x)).join(' & ')).join(' \\\\ ')} \\end{pmatrix}`;
    case 'pw': return `\\begin{cases} ${n.cases.map(c => `${toTex(c.v)} & ${c.c ? toTex(c.c) : '\\text{otherwise}'}`).join(' \\\\ ')} \\end{cases}`;
    case 'rel': return n.terms.map(x => toTex(x)).reduce((s, t, i) => s + (i ? ` ${REL_TEX[n.ops[i - 1]] ?? n.ops[i - 1]} ` : '') + t, '');
    case 'sum': return wrap(`${n.prod ? '\\prod' : '\\sum'}_{${n.i}=${toTex(n.lo)}}^{${toTex(n.hi)}} ${toTex(n.body, 2)}`, 1.5);
    case 'int': return wrap(`\\int${n.lo ? `_{${toTex(n.lo)}}` : ''}${n.hi ? `^{${toTex(n.hi)}}` : ''} ${toTex(n.body, 1)}\\,d${n.vtex}`, 1.5);
    case 'lim': return wrap(`\\lim_{${n.vtex} \\to ${toTex(n.to)}${n.dir > 0 ? '^+' : n.dir < 0 ? '^-' : ''}} ${toTex(n.body, 2)}`, 1.5);
    case 'deriv': return n.order === 1 ? `\\frac{d${n.ofTex}}{d${n.wrt}}` : `\\frac{d^{${n.order}}${n.ofTex}}{d${n.wrt}^{${n.order}}}`;
    case 'alt': return n.a.length === 2 ? `\\pm` : n.a.map(x => toTex(x)).join(', ');
    case 'interval': return `\\left[${toTex(n.lo)}, ${toTex(n.hi)}\\right]`;
    case 'stmts': return n.a.map(x => toTex(x)).join(',\\quad ');
  }
}

// ---------------------------------------------------------------- .bd code printing
const FN_CODE: Record<string, string> = { ln: 'log', asin: 'asin', acos: 'acos', atan: 'atan', norm: 'len' };
export type Namer = (n: string) => string;
export function toCode(n: Node, name: Namer, prec = 0): string {
  const wrap = (s: string, p: number) => (p < prec ? `(${s})` : s);
  const num = (v: number) => { const s = !isFinite(v) ? (v > 0 ? 'inf' : v < 0 ? '-inf' : 'nan') : String(+v.toPrecision(12)); return v < 0 && prec > 1 ? `(${s})` : s; };
  switch (n.k) {
    case 'num': return num(n.v);
    case 'sym': return n.c ? (n.n === 'pi' ? 'pi' : 'exp(1)') : name(n.n);
    case 'add': {
      let s = toCode(n.a[0], name, 1);
      for (const t of n.a.slice(1)) s += isNegTerm(t) ? ' - ' + toCode(negateTerm(t), name, 2) : ' + ' + toCode(t, name, 1);
      return wrap(s, 1);
    }
    case 'mul': {
      if (isNegTerm(n)) return wrap('-' + toCode(negateTerm(n), name, 2.5), 1);
      const numF: string[] = [], denF: string[] = [];
      for (const f of n.a) {
        if (f.k === 'pow' && f.e.k === 'num' && f.e.v < 0) denF.push(toCode(simpPow(f.b, N(-f.e.v), 0), name, 2.5));
        else numF.push(toCode(f, name, 2));
      }
      let s = numF.length ? numF.join(' * ') : '1';
      if (denF.length) s += ' / ' + (denF.length === 1 ? denF[0] : `(${denF.join(' * ')})`);
      return wrap(s, 2);
    }
    case 'pow': {
      if (n.e.k === 'num' && Math.abs(n.e.v - 0.5) < 1e-12) return `sqrt(${toCode(n.b, name)})`;
      if (n.e.k === 'num' && Math.abs(n.e.v - 1 / 3) < 1e-12) return `cbrt(${toCode(n.b, name)})`;
      return wrap(`${toCode(n.b, name, 3)} ^ ${toCode(n.e, name, 3)}`, 2.9);
    }
    case 'fn': {
      if (n.f === 'binom') { const [a, b] = n.a.map(x => toCode(x, name)); return `(fact(${a}) / (fact(${b}) * fact(${a} - (${b}))))`; }
      if (n.f === 'atan2') return `atan2(${toCode(n.a[0], name)}, ${toCode(n.a[1], name)})`;
      return `${FN_CODE[n.f] ?? n.f}(${n.a.map(x => toCode(x, name)).join(', ')})`;
    }
    case 'tuple': return `(${n.a.map(x => toCode(x, name)).join(', ')})`;
    case 'pw': {
      let s = 'nan';
      for (let i = n.cases.length - 1; i >= 0; i--) { const c = n.cases[i]; s = c.c ? `(${condCode(c.c, name)} ? ${toCode(c.v, name)} : ${s})` : toCode(c.v, name, 1); }
      return s;
    }
    case 'sum': return `${n.prod ? 'prod' : 'sum'}(map(range(${toCode(n.lo, name)}, ${toCode(n.hi, name)} + 1), (${name(n.i)}) => ${toCode(n.body, name)}))`;
    case 'rel': return condCode(n, name);
  }
  throw new MathError(`can't turn ${n.k} into code`);
}
export function condCode(n: Node, name: Namer): string {
  if (n.k !== 'rel') return `(${toCode(n, name)} != 0)`;
  const parts: string[] = [];
  for (let i = 0; i < n.ops.length; i++) {
    const op = n.ops[i] === '=' ? '==' : n.ops[i];
    parts.push(`${toCode(n.terms[i], name, 1)} ${op} ${toCode(n.terms[i + 1], name, 1)}`);
  }
  return parts.length === 1 ? parts[0] : '(' + parts.join(' && ') + ')';
}

// ---------------------------------------------------------------- numeric compilation
export type Fn = (...a: number[]) => number;
export function compile(n: Node, vars: string[], params: Record<string, number> = {}): Fn {
  const f = comp(n, vars, params);
  return (...a: number[]) => { try { const r = f(a); return typeof r === 'number' ? r : NaN; } catch { return NaN; } };
}
type CF = (a: number[]) => number;
const FN_NUM: Record<string, (...x: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sec: x => 1 / Math.cos(x), csc: x => 1 / Math.sin(x), cot: x => 1 / Math.tan(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan, acot: x => Math.atan(1 / x), asec: x => Math.acos(1 / x), acsc: x => Math.asin(1 / x),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sech: x => 1 / Math.cosh(x), csch: x => 1 / Math.sinh(x), coth: x => 1 / Math.tanh(x),
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh, exp: Math.exp, ln: Math.log, log10: Math.log10, log2: Math.log2,
  abs: Math.abs, sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, cbrt: Math.cbrt,
  gamma, fact, erf, sinc: x => (x === 0 ? 1 : Math.sin(x) / x), max: Math.max, min: Math.min, atan2: Math.atan2,
  binom: (a, b) => fact(a) / (fact(b) * fact(a - b)), norm: Math.abs,
};
function comp(n: Node, vars: string[], params: Record<string, number>): CF {
  switch (n.k) {
    case 'num': { const v = n.v; return () => v; }
    case 'sym': {
      if (n.c) { const v = n.n === 'pi' ? Math.PI : Math.E; return () => v; }
      const i = vars.indexOf(n.n);
      if (i >= 0) return a => a[i];
      if (n.n in params) { const v = params[n.n]; return () => v; }
      return () => NaN;
    }
    case 'add': { const fs = n.a.map(x => comp(x, vars, params)); return a => { let s = 0; for (const f of fs) s += f(a); return s; }; }
    case 'mul': { const fs = n.a.map(x => comp(x, vars, params)); return a => { let s = 1; for (const f of fs) s *= f(a); return s; }; }
    case 'pow': {
      const b = comp(n.b, vars, params), e = comp(n.e, vars, params);
      const ev = n.e.k === 'num' ? n.e.v : null;
      const oddRoot = ev !== null && !Number.isInteger(ev) && (() => { const r = rational(ev, 9); return r && r[1] % 2 === 1; })();
      return a => { const x = b(a), y = e(a); if (oddRoot && x < 0) return -Math.pow(-x, y); return Math.pow(x, y); };
    }
    case 'fn': {
      const fs = n.a.map(x => comp(x, vars, params)); const g = FN_NUM[n.f];
      if (!g) return () => NaN;
      if (fs.length === 1) { const f0 = fs[0]; return a => g(f0(a)); }
      return a => g(...fs.map(f => f(a)));
    }
    case 'pw': {
      const cs = n.cases.map(c => ({ v: comp(c.v, vars, params), c: c.c ? compCond(c.c, vars, params) : null }));
      return a => { for (const c of cs) if (!c.c || c.c(a)) return c.v(a); return NaN; };
    }
    case 'sum': {
      const lo = comp(n.lo, vars, params), hi = comp(n.hi, vars, params);
      const vars2 = [...vars, n.i]; const body = comp(n.body, vars2, params);
      return a => {
        const l = Math.round(lo(a)), h = Math.round(hi(a)); let s = n.prod ? 1 : 0;
        if (!(h - l < 1e5)) return NaN;
        for (let k = l; k <= h; k++) { const v = body([...a, k]); s = n.prod ? s * v : s + v; }
        return s;
      };
    }
    case 'rel': { const c = compCond(n, vars, params); return a => (c(a) ? 1 : 0); }
  }
  throw new MathError(`can't evaluate ${n.k}`);
}
export function compCond(n: Node, vars: string[], params: Record<string, number>): (a: number[]) => boolean {
  if (n.k !== 'rel') { const f = comp(n, vars, params); return a => f(a) !== 0; }
  const ts = n.terms.map(t => comp(t, vars, params));
  return a => {
    for (let i = 0; i < n.ops.length; i++) {
      const x = ts[i](a), y = ts[i + 1](a);
      const ok = n.ops[i] === '<' ? x < y : n.ops[i] === '<=' ? x <= y : n.ops[i] === '>' ? x > y : n.ops[i] === '>=' ? x >= y : n.ops[i] === '!=' ? x !== y : Math.abs(x - y) < 1e-9;
      if (!ok) return false;
    }
    return true;
  };
}
export function evalConst(n: Node, params: Record<string, number> = {}): number { return compile(n, [], params)(); }
