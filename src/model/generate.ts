// Auto-modeller: LaTeX → classification → analysis → an editable .bd page.
import { parseLatex } from './latex';
import {
  Node, N, S, add, mul, neg, sub, pow, fn, simplify, freeSyms, symTex, toTex, toCode, tryDiff, compile, compCond, hasFn, TRIG,
  subst, prettyNum, prettyEq, evalConst, depends, key, condCode, MathError, Fn, children,
} from './sym';
import * as nm from './numeric';
import { BUILTIN_NAMES } from '../lang/interp';
import { cmapHex } from '../geom/colormap';
import { niceTicks } from '../geom/ticks';
import { integrate, limitOf, seriesSum, productOf, identify } from './calculus';
import { antiderivative } from './antideriv';

export interface ModelResult { ok: boolean; kind?: string; title?: string; detected?: string; code?: string; warnings: string[]; error?: string }

const BLUE = '#1f6fd1', RED = '#d64545', GREEN = '#2e9e5b', ORANGE = '#e08a1e', PURPLE = '#8a4fd6';
const PALETTE = [BLUE, RED, GREEN, ORANGE, PURPLE];
const AXES = ['x', 'y', 'z'];
const PREF = ['x', 't', 'theta', 'r', 's', 'u', 'v', 'phi', 'n', 'w', 'k', 'q'];
const INTERNAL = new Set(['Fr', 'f', 'g', 'df', 'd2f', 'fx', 'fy', 'G', 'P', 'dP', 'S', 'Fv', 'A', 'M', 'T', 'X0', 'X1', 'Y0', 'Y1', 'Z0', 'Z1', 'T0', 'T1', 'U0', 'U1', 'V0', 'V1',
  'x0', 'y0', 'm0', 'P0', 'dir', 'tt', 'uu', 'px', 'py', 'pz', 'gx', 'gy', 'gl', 'ang', 'head', 'eq', 'inside', 'rr', 'th0', 'sm', 'Tm', 'q0', 'v0', 'F1', 'F2']);
const RESERVED = new Set([...BUILTIN_NAMES, 't', 'for', 'in', 'if', 'else', 'true', 'false', ...INTERNAL]);

// ---------------------------------------------------------------- small helpers
const q = (s: string) => '"' + s.replace(/"/g, "''") + '"';
const nf = (v: number) => (!isFinite(v) ? (v > 0 ? 'inf' : v < 0 ? '-inf' : 'nan') : String(+(+v).toPrecision(6)));
const pt = (...v: number[]) => '(' + v.map(nf).join(', ') + ')';
const textEsc = (s: string) => s.replace(/([_%&#$])/g, '\\$1');
const T = (s: string) => `\\text{${textEsc(s)}}`;
function namer(n: string) { let c = n.replace(/[^A-Za-z0-9_]/g, '_'); if (/^[0-9]/.test(c)) c = 'v_' + c; if (RESERVED.has(c)) c += '_'; return c; }
const code = (n: Node) => toCode(n, namer);
const texOf = (n: Node) => toTex(n);
const short = (s: string, max = 150) => s.length <= max;

function pickIndep(vars: string[]) { for (const p of PREF) if (vars.includes(p)) return p; return [...vars].sort()[0]; }
function isZero(n: Node, vars: string[]) {
  const s = simplify(n); if (s.k === 'num') return Math.abs(s.v) < 1e-12;
  const f = compile(s, vars);
  for (let i = 0; i < 12; i++) { const a = vars.map(() => Math.random() * 4 - 2); const v = f(...a); if (!isFinite(v) || Math.abs(v) > 1e-9) return false; }
  return true;
}

class Code {
  lines: string[] = [];
  l(s = '') { this.lines.push(s); return this; }
  c(s: string) { this.lines.push('// ' + s); return this; }
  sec(s: string) { this.lines.push('', '// ' + '-'.repeat(46) + ' ' + s); return this; }
  toString() { return this.lines.join('\n') + '\n'; }
}
type Fact = { head: string; eqs: string[] };

interface Ctx { input: string; inputTex: string; params: string[]; ptex: Map<string, string>; domains: Record<string, [number, number]>; warnings: string[] }

function header(C: Code, cx: Ctx, title: string, detected: string, dur = 6) {
  C.c('Auto-modelled from LaTeX by LaTeX Modeler — everything below is ordinary, editable code.');
  C.c('input:    ' + cx.input.replace(/\s+/g, ' ').trim());
  C.c('detected: ' + detected);
  C.l('page("A4", "paper")').l(`duration(${dur})`).l();
  C.l(`tex(${q(`\\textbf{${textEsc(title)}}`)}, (105, 281), {size: 19})`);
  const tall = /\\begin|\\\\/.test(cx.inputTex);
  C.l(`tex(${q(cx.inputTex)}, (105, ${tall ? 276.5 : 270}), {size: ${tall ? 10.5 : 14}, maxw: 172${tall ? ', anchor: "n"' : ''}})`);
  C.l(`tex(${q(T(detected))}, (105, ${tall ? 258.7 : 261.5}), {size: 8.5, color: "#7a828c"})`);
  C.l('line((20, 256), (190, 256), {width: 0.3})');
  if (cx.params.length) {
    C.sec('parameters (change these and the page updates)');
    for (const p of cx.params) C.l(`${namer(p)} = 1`);
  }
}
function factsBlock(C: Code, cx: Ctx, left: Fact[], right: Fact[]) {
  if (cx.params.length) right = [...right, { head: 'Parameters', eqs: [cx.params.map(p => `${cx.ptex.get(p) ?? p} = 1`).join(',\\; ')] }];
  C.sec('analysis (computed when the page was generated)');
  C.l('head(s, x, y) = tex("\\text{" + s + "}", (x, y), {size: 12.5, anchor: "w"})');
  C.l('eq(s, x, y) = tex(s, (x + 3, y), {size: 10.5, anchor: "w", maxw: 80})');
  const col = (facts: Fact[], x: number) => {
    let y = 113;
    for (const f of facts) {
      if (y < 34) break;
      C.l(`head(${q(textEsc(f.head))}, ${x}, ${nf(y)})`); y -= 8.5;
      for (const e of f.eqs) {
        if (y < 28) break;
        const tall = /\\frac|\\sqrt|\\begin|\\sum|\\binom/.test(e);
        if (tall) y -= 1.5;
        C.l(`eq(${q(e)}, ${x}, ${nf(y)})`); y -= tall ? 10.5 : 8;
      }
      y -= 3;
    }
  };
  col(left, 20); col(right, 110);
  C.l();
  C.l('line((20, 21), (190, 21), {width: 0.2, color: "#b8bec6"})');
  C.l('tex("\\text{generated by LaTeX Modeler auto-model — edit any line of code to change the page}", (105, 16.5), {size: 7.5, color: "#9aa1aa"})');
}

// ---------------------------------------------------------------- tree utilities
function mapKids(n: Node, f: (x: Node) => Node): Node {
  switch (n.k) {
    case 'add': case 'mul': case 'tuple': case 'alt': case 'stmts': return { ...n, a: n.a.map(f) } as Node;
    case 'fn': return { ...n, a: n.a.map(f) };
    case 'pow': return { ...n, b: f(n.b), e: f(n.e) };
    case 'matrix': return { ...n, rows: n.rows.map(r => r.map(f)) };
    case 'pw': return { ...n, cases: n.cases.map(c => ({ v: f(c.v), c: c.c ? f(c.c) : null })) };
    case 'rel': return { ...n, terms: n.terms.map(f) };
    case 'sum': return { ...n, lo: f(n.lo), hi: f(n.hi), body: f(n.body) };
    case 'interval': return { ...n, lo: f(n.lo), hi: f(n.hi) };
    default: return n;
  }
}
/** expand ± alternatives into separate trees */
function variants(n: Node, cap = 8): Node[] {
  const find = (x: Node): Node | null => { if (x.k === 'alt') return x; for (const c of children(x)) { const r = find(c); if (r) return r; } return null; };
  const alt = find(n); if (!alt || alt.k !== 'alt') return [n];
  const out: Node[] = [];
  for (const choice of alt.a) {
    const rep = (x: Node): Node => (x === alt ? choice : mapKids(x, rep));
    out.push(...variants(rep(n), cap));
    if (out.length >= cap) break;
  }
  return out.slice(0, cap);
}
function decl(L: Node): { name: Node; args: string[] | null } | null {
  if (L.k === 'sym') return { name: L, args: null };
  if (L.k === 'mul' && L.a.length === 2 && L.a[0].k === 'sym' && (L.a[1] as any).paren) {
    const g = L.a[1];
    if (g.k === 'sym') return { name: L.a[0], args: [g.n] };
    if (g.k === 'tuple' && g.a.every(x => x.k === 'sym')) return { name: L.a[0], args: g.a.map(x => (x as any).n) };
  }
  return null;
}
function asDomain(s: Node): { name: string | null; range: [number, number] } | null {
  if (s.k !== 'rel') return null;
  if (s.ops.length === 1 && s.ops[0] === 'in' && s.terms[0].k === 'sym' && s.terms[1].k === 'interval') {
    const lo = evalConst(simplify(s.terms[1].lo)), hi = evalConst(simplify(s.terms[1].hi));
    return isFinite(lo) && isFinite(hi) && hi > lo ? { name: s.terms[0].n, range: [lo, hi] } : { name: null, range: [0, 0] };
  }
  if (s.ops.length === 2 && s.terms[1].k === 'sym' && freeSyms(s.terms[0]).size === 0 && freeSyms(s.terms[2]).size === 0) {
    const up = s.ops.every(o => o === '<' || o === '<='), down = s.ops.every(o => o === '>' || o === '>=');
    if (!up && !down) return null;
    let lo = evalConst(simplify(s.terms[0])), hi = evalConst(simplify(s.terms[2])); if (down) [lo, hi] = [hi, lo];
    if (isFinite(lo) && isFinite(hi) && hi > lo) return { name: s.terms[1].n, range: [lo, hi] };
  }
  return null;
}

// ---------------------------------------------------------------- entry point
export function autoModel(latex: string): ModelResult {
  const warnings: string[] = [];
  let stmts: Node[];
  try { stmts = parseLatex(latex); }
  catch (e: any) { return { ok: false, warnings, error: e instanceof MathError ? e.message : 'could not read this LaTeX: ' + e.message }; }
  const domains: Record<string, [number, number]> = {};
  const main: Node[] = [];
  for (const s of stmts) { const d = asDomain(s); if (d) { if (d.name) domains[d.name] = d.range; continue; } main.push(s); }
  if (!main.length) return { ok: false, warnings, error: 'only a domain was given — add the equation itself' };
  const inputTex = latex.trim().replace(/^\$+|\$+$/g, '');
  try {
    return build(main, { input: latex, inputTex, params: [], ptex: new Map(), domains, warnings });
  } catch (e: any) {
    return { ok: false, warnings, error: e instanceof MathError ? e.message : 'modelling failed: ' + e.message };
  }
}

type Spec =
  | { kind: 'graph'; fs: Node[]; x: string; ylab: string; fname: string; formula?: boolean }
  | { kind: 'surface'; f: Node; x: string; y: string; zlab: string; fname: string }
  | { kind: 'implicit2'; rels: Node[]; x: string; y: string }
  | { kind: 'implicit3'; rels: Node[]; vars: string[] }
  | { kind: 'region'; rel: Node; x: string; y: string }
  | { kind: 'polar'; r: Node; th: string }
  | { kind: 'pcurve'; comps: Node[]; p: string; name: string }
  | { kind: 'psurf'; comps: Node[]; u: string; v: string; name: string }
  | { kind: 'field'; comps: Node[]; vars: string[]; name: string }
  | { kind: 'ode'; f: Node; x: string; y: string; lhs: string }
  | { kind: 'matrix'; M: Node; name: string }
  | { kind: 'vector'; comps: Node[]; name: string }
  | { kind: 'value'; v: Node; name: string | null }
  | { kind: 'solve1'; l: Node; r: Node; x: string }
  | { kind: 'scalar3'; f: Node; vars: string[]; name: string };

function build(main: Node[], cx: Ctx): ModelResult {
  // integrals, limits and infinite series get their own pages
  const calc = calculusSpec(main);
  if (calc) {
    const texMap = new Map<string, string>(); const free = new Set<string>();
    for (const st of main) { freeSyms(st).forEach(v => free.add(v)); symTex(st, texMap); }
    const L = main[0].k === 'rel' ? main[0].terms[0] : null; const d = L && decl(L); if (d && d.name.k === 'sym') free.delete(d.name.n);
    cx.params = [...free].filter(v => !calc.vars.includes(v)).sort(); cx.ptex = texMap;
    const C = new Code();
    const { title, detected } = CALC_GENERATORS[calc.spec.kind](calc.spec, cx, C, texMap);
    return { ok: true, kind: calc.spec.kind, title, detected, code: C.toString(), warnings: cx.warnings };
  }
  const all = main.flatMap(s => variants(s));
  const spec = classify(all, cx);
  // parameters = free symbols not used as variables
  const used = new Set<string>(specVars(spec));
  const free = new Set<string>(); const texMap = new Map<string, string>();
  for (const s of all) { freeSyms(s).forEach(v => free.add(v)); symTex(s, texMap); }
  if (spec.kind === 'graph' || spec.kind === 'surface' || spec.kind === 'field' || spec.kind === 'pcurve' || spec.kind === 'psurf' || spec.kind === 'scalar3' || spec.kind === 'matrix' || spec.kind === 'vector' || spec.kind === 'value')
    for (const s of all) { const L = s.k === 'rel' ? s.terms[0] : null; const d = L && decl(L); if (d && d.name.k === 'sym') free.delete(d.name.n); }
  if (spec.kind === 'ode') { free.delete(spec.y); }
  if (used.has('i') && !free.has('x')) throw new MathError('complex numbers aren’t supported yet (i was used as a variable)');
  cx.params = [...free].filter(v => !used.has(v)).sort();
  cx.ptex = texMap;
  if (cx.params.includes('i')) cx.warnings.push('complex numbers aren’t supported — i was treated as a parameter');
  if (cx.params.includes('d')) cx.warnings.push('a stray “d” was treated as a parameter (write derivatives as \\frac{dy}{dx} or y\')');
  const C = new Code();
  const gen = GENERATORS[spec.kind] as (s: any, cx: Ctx, C: Code, tex: Map<string, string>) => { title: string; detected: string };
  const { title, detected } = gen(spec, cx, C, texMap);
  return { ok: true, kind: spec.kind, title, detected, code: C.toString(), warnings: cx.warnings };
}
function specVars(s: Spec): string[] {
  switch (s.kind) {
    case 'graph': return [s.x]; case 'surface': return [s.x, s.y]; case 'implicit2': case 'region': return [s.x, s.y];
    case 'implicit3': case 'field': case 'scalar3': return s.vars; case 'polar': return [s.th, 'r']; case 'pcurve': return [s.p];
    case 'psurf': return [s.u, s.v]; case 'ode': return [s.x, s.y]; case 'solve1': return [s.x]; default: return [];
  }
}

// ---------------------------------------------------------------- classification
function classify(stmts: Node[], cx: Ctx): Spec {
  const rels = stmts.filter(s => s.k === 'rel') as Extract<Node, { k: 'rel' }>[];
  if (stmts.length > 1) {
    // parametric components: x = ..., y = ..., (z = ...) sharing one parameter
    const comp: Record<string, Node> = {};
    for (const r of rels) if (r.ops.length === 1 && r.ops[0] === '=' && r.terms[0].k === 'sym' && AXES.includes(r.terms[0].n)) comp[r.terms[0].n] = r.terms[1];
    const ks = Object.keys(comp);
    if (ks.length === stmts.length && ks.includes('x') && ks.includes('y')) {
      const vars = new Set<string>(); ks.forEach(k => freeSyms(comp[k]).forEach(v => vars.add(v)));
      const nonAx = [...vars].filter(v => !AXES.includes(v));
      if (nonAx.length >= 1 && ![...vars].some(v => AXES.includes(v))) {
        const comps = ks.includes('z') ? [comp.x, comp.y, comp.z] : [comp.x, comp.y];
        const ps = nonAx.filter(v => ['t', 's', 'theta', 'u', 'phi', 'tau'].includes(v));
        if (nonAx.length === 1 || ps.length === 1) return { kind: 'pcurve', comps: comps.map(c => simplify(c)), p: ps[0] ?? nonAx[0], name: '\\mathbf{r}' };
        if (comps.length === 3 && nonAx.length === 2) return { kind: 'psurf', comps: comps.map(c => simplify(c)), u: nonAx[0], v: nonAx[1], name: '\\mathbf{r}' };
      }
    }
    // explicit graphs of the same variable (e.g. from ±)
    const graphs = stmts.map(s => classify([s], cx));
    if (graphs.every(g => g.kind === 'graph') && new Set(graphs.map(g => (g as any).x)).size === 1)
      return { kind: 'graph', fs: graphs.flatMap(g => (g as any).fs), x: (graphs[0] as any).x, ylab: (graphs[0] as any).ylab, fname: (graphs[0] as any).fname };
    // systems in the plane / in space
    const allVars = new Set<string>(); stmts.forEach(s => freeSyms(s).forEach(v => allVars.add(v)));
    if (rels.length === stmts.length && rels.every(r => r.ops.length === 1 && r.ops[0] === '=')) {
      if (allVars.has('z')) return { kind: 'implicit3', rels, vars: ['x', 'y', 'z'] };
      const xy = axesFor([...allVars]);
      return { kind: 'implicit2', rels, x: xy[0], y: xy[1] };
    }
    cx.warnings.push('several statements were given; only the first one was modelled');
    return classify([stmts[0]], cx);
  }
  const s = stmts[0];
  if (s.k !== 'rel') return classifyExpr(s, null, cx);
  if (s.ops.length > 1) {
    if (s.ops.every(o => o !== '=' && o !== 'in')) { const xy = axesFor([...freeSyms(s)]); return { kind: 'region', rel: s, x: xy[0], y: xy[1] }; }
    throw new MathError('chained equations like a = b = c aren’t supported — split them with a comma');
  }
  const op = s.ops[0], L = s.terms[0], R = s.terms[1];
  if (op === 'in') throw new MathError('a domain on its own can’t be modelled');
  if (op !== '=') {
    const xy = axesFor([...freeSyms(s)]);
    return { kind: 'region', rel: s, x: xy[0], y: xy[1] };
  }
  // ODEs
  if (L.k === 'deriv') {
    if (L.order !== 1) throw new MathError('only first-order differential equations are supported (y\' = f(x, y))');
    return { kind: 'ode', f: simplify(R), x: L.wrt, y: L.of, lhs: texOf(L) };
  }
  const d = decl(L);
  const Rv = [...freeSyms(R)];
  if (d && d.args) {
    const nameTex = (d.name as any).tex as string;
    const fname = `${nameTex}(${d.args.map(a => texOfSym(a, R)).join(', ')})`;
    if (R.k === 'tuple' || R.k === 'matrix') return classifyExpr(R, { nameTex, args: d.args, bold: !!(d.name as any).bold || /^[A-Z]/.test((d.name as any).n) }, cx);
    if (d.args.length === 1) return { kind: 'graph', fs: [simplify(R)], x: d.args[0], ylab: 'y', fname };
    if (d.args.length === 2) return { kind: 'surface', f: simplify(R), x: d.args[0], y: d.args[1], zlab: 'z', fname };
    if (d.args.length === 3) return { kind: 'scalar3', f: simplify(R), vars: d.args, name: fname };
  }
  if (d && !d.args && L.k === 'sym') {
    const nm_ = L.n;
    if (Rv.includes(nm_)) {
      const all = [...freeSyms(s)];
      if (all.includes('z') || (all.length === 3 && AXES.every(a => all.includes(a)))) return { kind: 'implicit3', rels: [s], vars: ['x', 'y', 'z'] };
      const xy = axesFor(all);
      return { kind: 'implicit2', rels: [s], x: xy[0], y: xy[1] };
    }
    if (R.k === 'tuple' || R.k === 'matrix') return classifyExpr(R, { nameTex: L.tex, args: null, bold: !!L.bold || /^[A-Z]/.test(L.n) }, cx);
    if ((nm_ === 'r' || nm_ === 'rho') && (Rv.includes('theta') || Rv.includes('phi'))) {
      if (Rv.includes('theta') && Rv.includes('phi')) {
        const r = simplify(R), th = S('theta', '\\theta'), ph = S('phi', '\\phi');
        const comps = [mul(r, fn('sin', ph), fn('cos', th)), mul(r, fn('sin', ph), fn('sin', th)), mul(r, fn('cos', ph))].map(c => simplify(c));
        if (!cx.domains.phi) cx.domains.phi = [0, Math.PI];
        if (!cx.domains.theta) cx.domains.theta = [0, 2 * Math.PI];
        return { kind: 'psurf', comps, u: 'theta', v: 'phi', name: '\\mathbf{r}' };
      }
      return { kind: 'polar', r: simplify(R), th: Rv.includes('theta') ? 'theta' : 'phi' };
    }
    if (nm_ === 'y' && Rv.length >= 1 && Rv.includes('x') && !Rv.includes('y')) return { kind: 'graph', fs: [simplify(R)], x: 'x', ylab: 'y', fname: 'y' };
    if (nm_ === 'z' && Rv.includes('x') && Rv.includes('y') && !Rv.includes('z')) return { kind: 'surface', f: simplify(R), x: 'x', y: 'y', zlab: 'z', fname: 'z' };
    if (nm_ === 'x' && Rv.length >= 1 && Rv.includes('y') && !Rv.includes('x')) return { kind: 'implicit2', rels: [s], x: 'x', y: 'y' };
    if (Rv.length === 0) return { kind: 'value', v: simplify(R), name: L.tex };
    // general formula  L = f(vars)
    if (Rv.includes('x') && Rv.includes('y') && !Rv.includes('z')) return { kind: 'surface', f: simplify(R), x: 'x', y: 'y', zlab: L.tex, fname: L.tex };
    const x = pickIndep(Rv);
    return { kind: 'graph', fs: [simplify(R)], x, ylab: L.tex, fname: L.tex, formula: true };
  }
  // general equation L = R
  const G = simplify(sub(L, R));
  const vs = [...freeSyms(G)];
  if (vs.length === 0) return { kind: 'value', v: simplify(L), name: null };
  if (vs.includes('z') && vs.includes('x') && vs.includes('y')) return { kind: 'implicit3', rels: [s], vars: ['x', 'y', 'z'] };
  if (vs.length === 1 || (vs.includes('x') && !vs.includes('y') && !vs.includes('z'))) {
    const x = vs.includes('x') ? 'x' : pickIndep(vs);
    return { kind: 'solve1', l: simplify(L), r: simplify(R), x };
  }
  if ((vs.includes('r') && vs.includes('theta')) && !vs.includes('x')) {
    const X = S('x'), Y = S('y');
    const conv = (n: Node) => subst(n, { r: pow(add(pow(X, 2), pow(Y, 2)), 0.5), theta: fn('atan2', Y, X) });
    return { kind: 'implicit2', rels: [{ k: 'rel', ops: ['='], terms: [conv(L), conv(R)] }], x: 'x', y: 'y' };
  }
  const xy = axesFor(vs);
  return { kind: 'implicit2', rels: [s], x: xy[0], y: xy[1] };
}
function texOfSym(n: string, R: Node) { return symTex(R).get(n) ?? (n.length > 1 && !n.includes('_') ? `\\${n}` : n); }
function axesFor(vars: string[]): [string, string] {
  if (vars.includes('x') && vars.includes('y')) return ['x', 'y'];
  const rest = vars.filter(v => !['x', 'y'].includes(v));
  if (vars.includes('x')) return ['x', pickIndep(rest.length ? rest : ['y'])];
  if (vars.includes('y')) return [pickIndep(rest.length ? rest : ['x']), 'y'];
  const a = pickIndep(vars); const b = pickIndep(vars.filter(v => v !== a)) ?? 'y';
  return [a, b ?? 'y'];
}
function classifyExpr(e: Node, d: { nameTex: string; args: string[] | null; bold: boolean } | null, cx: Ctx): Spec {
  const name = d?.nameTex ?? (e.k === 'matrix' ? 'A' : '\\mathbf{r}');
  if (e.k === 'matrix') return { kind: 'matrix', M: simplify(e), name };
  if (e.k === 'fn' && e.f === 'det' && e.a[0].k === 'matrix') return { kind: 'value', v: simplify(e), name: d?.nameTex ?? null };
  if (e.k === 'tuple') {
    const comps = e.a.map(c => simplify(c));
    const vars = [...new Set(comps.flatMap(c => [...freeSyms(c)]))];
    const args = d?.args;
    if (comps.length > 3 || comps.length < 2) throw new MathError('vectors must have 2 or 3 components');
    if (vars.length === 0) return { kind: 'vector', comps, name };
    const fieldVars = comps.length === 2 ? ['x', 'y'] : ['x', 'y', 'z'];
    const looksField = args ? args.length === comps.length && args.every(a => AXES.includes(a)) : vars.every(v => AXES.includes(v)) && vars.length >= 2;
    if (looksField) return { kind: 'field', comps, vars: args ?? fieldVars, name };
    const params = args ?? vars.filter(v => !AXES.includes(v));
    if (params.length === 1 || (!args && vars.length === 1)) return { kind: 'pcurve', comps, p: params[0] ?? vars[0], name };
    if (params.length === 2 && comps.length === 3) return { kind: 'psurf', comps, u: params[0], v: params[1], name };
    const p = pickIndep(params.length ? params : vars);
    return { kind: 'pcurve', comps, p, name };
  }
  const vs = [...freeSyms(e)];
  if (vs.length === 0) return { kind: 'value', v: simplify(e), name: null };
  if (vs.includes('x') && vs.includes('y') && vs.includes('z')) return { kind: 'scalar3', f: simplify(e), vars: ['x', 'y', 'z'], name: 'f(x, y, z)' };
  if (vs.includes('x') && vs.includes('y')) return { kind: 'surface', f: simplify(e), x: 'x', y: 'y', zlab: 'z', fname: 'z' };
  const x = pickIndep(vs);
  return { kind: 'graph', fs: [simplify(e)], x, ylab: 'y', fname: 'y', formula: !AXES.includes(x) && vs.length > 1 };
}

// ---------------------------------------------------------------- generators
const P1 = (cx: Ctx) => Object.fromEntries(cx.params.map(p => [p, 1]));
const symLabel = (v: string, tex: Map<string, string>) => tex.get(v) ?? (v.length > 1 && !v.includes('_') ? '\\' + v : v);

// ---------------------------------------------------------------- calculus: integrals, accumulation, limits, series
type CalcSpec =
  | { kind: 'integral'; f: Node; v: string; a: Node; b: Node }
  | { kind: 'accum'; f: Node; v: string; a: Node; x: string; fname: string; indefinite: boolean }
  | { kind: 'limit'; f: Node; v: string; to: Node; dir: number }
  | { kind: 'series'; f: Node; i: string; n0: Node; x: string | null }
  | { kind: 'product'; f: Node; i: string; n0: Node };
const isInfNum = (n: Node) => n.k === 'num' && !isFinite(n.v);
const isCalc = (n: Node) => n.k === 'int' || n.k === 'lim' || (n.k === 'sum' && isInfNum(n.hi));
/** recognise an integral / limit / infinite series statement (possibly named: F(x) = \int_0^x …) */
function calculusSpec(main: Node[]): { spec: CalcSpec; vars: string[] } | null {
  if (main.length !== 1) return null;
  const s = main[0]; let target: Node | null = null, fname: string | null = null;
  if (isCalc(s)) target = s;
  else if (s.k === 'rel' && s.ops.length === 1 && s.ops[0] === '=') {
    const [L, R] = s.terms;
    if (isCalc(R)) { target = R; const d = decl(L); if (d) fname = (d.name as any).tex + (d.args ? `(${d.args.join(', ')})` : ''); }
    else if (isCalc(L)) target = L;
  }
  if (!target) return null;
  if (target.k === 'int') {
    const t = target;
    if (!t.lo || !t.hi) return { spec: { kind: 'accum', f: simplify(t.body), v: t.v, a: N(0), x: t.v, fname: 'F(' + t.v + ')', indefinite: true }, vars: [t.v] };
    const free = [...freeSyms(t.hi)].filter(v => v !== t.v);
    if (free.length === 1 && !freeSyms(t.lo).size) return { spec: { kind: 'accum', f: simplify(t.body), v: t.v, a: t.lo, x: free[0], fname: fname ?? `F(${free[0]})`, indefinite: false }, vars: [free[0]] };
    if (freeSyms(t.lo).size || freeSyms(t.hi).size) throw new MathError('the limits of integration must be numbers (or a single variable in the upper limit, like \\int_0^x)');
    return { spec: { kind: 'integral', f: simplify(t.body), v: t.v, a: t.lo, b: t.hi }, vars: [] };
  }
  if (target.k === 'lim') {
    if (freeSyms(target.to).size) throw new MathError('the limit point must be a number or \\infty');
    return { spec: { kind: 'limit', f: simplify(target.body), v: target.v, to: target.to, dir: target.dir }, vars: [] };
  }
  const t = target as Extract<Node, { k: 'sum' }>;
  if (freeSyms(t.lo).size) throw new MathError('the series must start at a number, like \\sum_{n=1}^{\\infty}');
  const others = [...freeSyms(t.body)].filter(v => v !== t.i);
  if (t.prod) {
    if (others.length) throw new MathError('infinite products with a variable (like \\prod (1 - x^2/n^2)) aren’t supported yet — try a numeric product');
    return { spec: { kind: 'product', f: simplify(t.body), i: t.i, n0: t.lo }, vars: [] };
  }
  const x = others.includes('x') ? 'x' : others.length === 1 ? others[0] : null;
  return { spec: { kind: 'series', f: simplify(t.body), i: t.i, n0: t.lo, x }, vars: x ? [x] : [] };
}
const evalNum = (n: Node, cx: Ctx) => { if (isInfNum(n)) return (n as any).v as number; const v = compile(n, [], P1(cx))(); if (Number.isNaN(v)) throw new MathError('could not evaluate ' + toTex(n)); return v; };
/** '= exact' when a closed form is recognised, otherwise '≈ decimal' */
/** worth adding a decimal: forms with π, e, ln or √ (not plain fractions) */
const irrationalForm = (id: string | null) => !!id && /\\pi|\\sqrt|\\ln|(^|[^a-z])e(\^|$|[^a-z])/.test(id);
const shownEq = (v: number, tol: number) => { const id = identify(v, tol); return id ? '= ' + id : '\\approx ' + prettyNum(v, false).replace(/^\\approx\s*/, ''); };
/** f(var) code for the page; the integrand's own variable name is kept */
function calcHeader(C: Code, cx: Ctx, title: string, detected: string, dur: number) { header(C, cx, title, detected, dur); }

/** L'Hôpital's rule for a quotient with a 0/0 or ∞/∞ form: the chain lim N/D = lim N'/D' = … until it resolves */
function lhopital(f: Node, v: string, a: number, dir: number, cx: Ctx, vl: string, toT: string): string[] | null {
  if (f.k !== 'mul') return null;
  // denominators: negative powers, and e^(−u) read as 1/e^u (so x²/eˣ counts as a quotient)
  const negExp = (t: Node) => t.k === 'fn' && t.f === 'exp' && depends(t.a[0], v) && toTex(t.a[0]).startsWith('-');
  const den = f.a.filter(t => (t.k === 'pow' && t.e.k === 'num' && t.e.v < 0 && depends(t.b, v)) || negExp(t));
  if (!den.length) return null;
  let Nn = simplify(mul(...f.a.filter(t => !den.includes(t)), N(1)));
  let Dn = simplify(mul(...den.map(t => (t.k === 'fn' ? fn('exp', neg(t.a[0])) : pow((t as any).b, -(t as any).e.v)))));
  // does g tend to 0, to ±∞, or neither? (slow growth like ln x and overflow like eˣ both count as ∞)
  const tends = (n: Node): '0' | 'inf' | null => {
    const g = compile(n, [v], P1(cx)); const sides = isFinite(a) ? (dir ? [dir] : [-1, 1]) : [a > 0 ? 1 : -1];
    const verdicts = sides.map(sd => {
      const xs = isFinite(a) ? [3, 4, 5, 6, 7].map(k => a + sd * 10 ** -k) : [2, 3, 4, 5, 6].map(k => sd * 10 ** k);
      const m = xs.map(t => Math.abs(g(t)));
      if (m.some(Number.isNaN)) return null;
      if (m.every((y, i) => i === 0 || y >= m[i - 1] * 1.01) && (m[4] > 30 || (m[4] > 5 && m[4] > 2 * m[0]))) return 'inf';
      if (m.every((y, i) => i === 0 || y <= m[i - 1] * 1.0001) && m[4] < 1e-3) return '0';
      return null;
    });
    return verdicts.every(x => x === verdicts[0]) ? verdicts[0] : null;
  };
  const form = (n: Node, d: Node) => { const tn = tends(n), td = tends(d); return tn && tn === td ? (tn === '0' ? '0/0' : '∞/∞') : null; };
  const first = form(Nn, Dn); if (!first) return null;
  const limW = `\\lim_{${vl} \\to ${toT}${dir > 0 ? '^+' : dir < 0 ? '^-' : ''}}`;
  const steps: string[] = [`${T('a ')}${first === '0/0' ? '\\tfrac{0}{0}' : '\\tfrac{\\infty}{\\infty}'}${T(' form, so differentiate top and bottom:')}`];
  for (let k = 0; k < 4; k++) {
    const dN = tryDiff(Nn, v), dD = tryDiff(Dn, v); if (!dN || !dD) return null;
    Nn = dN; Dn = dD;
    const t = `= ${limW} \\frac{${toTex(Nn)}}{${toTex(Dn)}}`;
    if (t.length > 150) return null;
    steps.push(t);
    if (!form(Nn, Dn)) return steps;
  }
  return null;
}

const CALC_GENERATORS: Record<string, any> = {
  // ------------------------------------------------------------ ∫_a^b f(x) dx
  integral(s: Extract<CalcSpec, { kind: 'integral' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const v = s.v, V_ = namer(v), vl = symLabel(v, tex);
    const f = compile(s.f, [v], P1(cx));
    const a = evalNum(s.a, cx), b = evalNum(s.b, cx);
    const lo = Math.min(a, b), hi = Math.max(a, b), finite = isFinite(lo) && isFinite(hi);
    const res = integrate(f, a, b);
    // symbolic antiderivative → F(b) − F(a); trusted only when it agrees with the numerical value
    // (an integrand that blows up inside [a, b] makes F(b) − F(a) meaningless, e.g. ∫₋₁¹ dx/x²)
    const Fs = antiderivative(s.f, v);
    let ftc: number | null = null;
    if (Fs && !res.diverges) {
      const Fc = compile(Fs, [v], P1(cx));
      const at = (p: number) => { if (isFinite(p)) return Fc(p); const r = limitOf(Fc, p, 0); return r.kind === 'value' ? r.v : NaN; };
      const val = at(b) - at(a);
      if (isFinite(val) && Math.abs(val - res.v) <= 1e-6 * Math.max(1, Math.abs(res.v))) ftc = val;
    }
    // view: the interval plus a margin; for infinite limits, out to where the integrand has faded
    let x0: number, x1: number;
    if (finite) { const pad = (hi - lo) * 0.15 || 1; [x0, x1] = [lo - pad, hi + pad]; }
    else {
      const ref = isFinite(lo) ? lo : isFinite(hi) ? hi : 0; let W = 1;
      const peak = Math.max(1e-12, ...Array.from({ length: 200 }, (_, i) => Math.abs(f(ref + (i - 100) * 0.05))).filter(isFinite));
      for (W = 1; W < 40; W *= 1.25) { const e = Math.max(Math.abs(f(ref + W)) || 0, Math.abs(f(ref - W)) || 0); if (e < peak * 0.01) break; }
      x0 = isFinite(lo) ? lo - W * 0.15 : ref - W; x1 = isFinite(hi) ? hi + W * 0.15 : ref + W;
    }
    if (cx.domains[v]) [x0, x1] = cx.domains[v];
    const ys: number[] = []; for (let i = 0; i <= 800; i++) ys.push(f(x0 + (x1 - x0) * i / 800));
    if (!ys.some(isFinite)) throw new MathError('the integrand has no real values here');
    let [ya, yb] = nm.robustRange(ys); ya = Math.min(ya, 0); yb = Math.max(yb, 0);
    const [y0, y1] = nm.niceRange(ya, yb, 0.1);
    const trig = hasFn(s.f, TRIG, v) && (x1 - x0) >= Math.PI;
    const best = ftc ?? res.v, bestTol = ftc !== null ? 1e-11 * Math.max(1, Math.abs(ftc)) : Math.max(1e-11 * Math.max(1, Math.abs(res.v)), res.err * 10);
    const valTex = res.diverges ? '' : shownEq(best, bestTol);
    const intTex = `\\int_{${toTex(s.a)}}^{${toTex(s.b)}} ${texOf(s.f)}\\,d${vl}`;
    const title = res.diverges ? 'Integral (diverges)' : finite ? 'Definite integral' : 'Improper integral';
    const detected = finite ? 'definite integral: area under the curve' : 'improper integral over an infinite interval';
    header(C, cx, title, detected, 7);
    C.sec('the integrand and the interval');
    C.l(`f(${V_}) = ${code(s.f)}`);
    C.l(`A = ${nf(a)}`).l(`B = ${nf(b)}`).l(`X0 = ${nf(x0)}`).l(`X1 = ${nf(x1)}`).l(`Y0 = ${nf(y0)}`).l(`Y1 = ${nf(y1)}`);
    if (Fs) C.l(`Fanti(${V_}) = ${code(Fs)}   // an antiderivative: Fanti' = f`);
    if (ftc !== null && finite) C.l('I = Fanti(B) - Fanti(A)   // the fundamental theorem of calculus');
    else if (!res.diverges) C.l(`I = ${nf(res.v)}   // value of the integral (computed numerically when the page was made)`);
    C.sec('figure: the signed area (blue above the axis, red below)');
    C.l(`Fr = frame2d((30, 134), (150, 110), (X0, X1), (Y0, Y1), {xlabel: ${q(vl)}, ylabel: "y"${trig ? ', piTicks: true' : ''}})`);
    C.l('NA = 240').l('xa = max(min(A, B), X0)').l('xb = min(max(A, B), X1)');
    C.l('yc(u) = isnan(f(u)) ? 0 : clamp(f(u), Y0, Y1)');
    C.l('edge(k, part) = k == 0 ? Fr.map((xa, 0)) : (k == NA + 2 ? Fr.map((xb, 0)) : Fr.map((xa + (xb - xa) * (k - 1) / NA, part(yc(xa + (xb - xa) * (k - 1) / NA)))))');
    C.l(`poly(map(range(0, NA + 3), k => edge(k, u => max(u, 0))), {fill: "${BLUE}", opacity: 0.2})`);
    C.l(`poly(map(range(0, NA + 3), k => edge(k, u => min(u, 0))), {fill: "${RED}", opacity: 0.2})`);
    C.l(`fplot(Fr, f, {width: 0.5, color: "${BLUE}"})`);
    C.l('for e in [A, B] { if abs(e) < 1e300 && e >= X0 && e <= X1 {');
    C.l('  line(Fr.map((e, Y0)), Fr.map((e, Y1)), {dash: 1, width: 0.2, color: "#888"})');
    C.l('} }');
    if (finite) {
      C.sec('midpoint Riemann sums: the rectangles double every second (press play)');
      C.l('n = 2 ^ min(7, 1 + floor(t))').l('h = (B - A) / n');
      C.l('for k in 0..n {');
      C.l('  xm = A + (k + 0.5) * h');
      C.l('  ym = yc(xm)');
      C.l(`  poly(Fr.map((A + k * h, 0)), Fr.map((A + (k + 1) * h, 0)), Fr.map((A + (k + 1) * h, ym)), Fr.map((A + k * h, ym)), {fill: ym >= 0 ? "${ORANGE}" : "${RED}", opacity: 0.32, stroke: "#b8741a"})`);
      C.l('}');
      C.l('M = h * sum(map(range(0, n), k => f(A + (k + 0.5) * h)))');
      C.l(res.diverges
        ? 'tex("n = " + str(n) + ",\\quad M_n = " + fmt(M, 5), (105, 127), {size: 10, color: "#b8741a"})'
        : 'tex("n = " + str(n) + ",\\quad M_n = " + fmt(M, 6) + ",\\quad M_n - I = " + fmt(M - I, 6), (105, 127), {size: 10, color: "#b8741a"})');
    }
    const left: Fact[] = [], right: Fact[] = [];
    if (res.diverges) {
      left.push({ head: 'Value', eqs: [intTex, T('diverges: the area is infinite')] });
      if (Fs && finite) {
        const Fc = compile(Fs, [v], P1(cx)), naive = Fc(b) - Fc(a);
        if (isFinite(naive)) left.push({ head: 'A trap', eqs: [`F(${vl}) = ${toTex(Fs)}`, `F(${toTex(s.b)}) - F(${toTex(s.a)}) ${prettyEq(naive)}${T(' is wrong here:')}`, T('f blows up inside the interval,'), T('so the fundamental theorem does not apply')] });
      }
    }
    else {
      const FT = Fs ? toTex(Fs) : '';
      if (Fs && FT.length < 170) left.push({ head: 'Antiderivative', eqs: [`F(${vl}) = ${FT}`] });
      left.push({ head: 'Value', eqs: [
        ...(ftc !== null ? [`${intTex} = F(${toTex(s.b)}) - F(${toTex(s.a)})`, `${valTex}`] : [`${intTex} ${valTex}`]),
        ...(irrationalForm(identify(best, bestTol)) ? [`\\approx ${+best.toPrecision(6)}`] : []),
        ...(!Fs ? [T('no formula for the antiderivative; computed numerically')] : []),
      ] });
      if (finite && hi > lo) {
        const avg = res.v / (b - a);
        left.push({ head: 'Average value', eqs: [`\\frac{1}{${toTex(s.b)} - ${toTex(s.a)}}\\int f\\,d${vl} ${prettyEq(avg)}`] });
        const pos = integrate(u => Math.max(0, f(u)), lo, hi).v, negA = integrate(u => Math.min(0, f(u)), lo, hi).v;
        if (pos > 1e-9 && negA < -1e-9) left.push({ head: 'Signed areas', eqs: [`${T('above: ')} ${prettyNum(pos, false)},\\; ${T('below: ')} ${prettyNum(negA, false)}`] });
      }
    }
    if (finite) {
      const mid = (n: number) => { const h = (b - a) / n; let sm = 0; for (let k = 0; k < n; k++) sm += f(a + (k + 0.5) * h); return sm * h; };
      right.push({ head: 'Midpoint sums', eqs: [4, 16, 64].map(n => `M_{${n}} ${prettyEq(mid(n))}`) });
      if (!res.diverges) right.push({ head: 'Midpoint error', eqs: [T('shrinks to a quarter each time n doubles:'), `|M_n - I| \\le \\frac{(b-a)\\,h^2}{24} \\max|f''|`] });
    } else right.push({ head: 'Improper integral', eqs: [T(isFinite(lo) || isFinite(hi) ? 'one limit is infinite:' : 'both limits are infinite:'), `\\lim_{R \\to \\infty} \\int^{R} f\\,d${vl}`] });
    factsBlock(C, cx, left, right);
    return { title, detected };
  },

  // ------------------------------------------------------------ F(x) = ∫_a^x f(t) dt   (and indefinite ∫ f dx)
  accum(s: Extract<CalcSpec, { kind: 'accum' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const v = s.v, x = s.x, V_ = namer(v), X_ = namer(x), vl = symLabel(v, tex), xl = symLabel(x, tex);
    const f = compile(s.f, [v], P1(cx));
    // a formula for the antiderivative, written in the page's variable
    const Fs = antiderivative(s.f, v);
    let Fx = Fs ? simplify(subst(Fs, { [v]: S(x) })) : null;
    const Fxc = Fx ? compile(Fx, [x], P1(cx)) : null;
    let a = evalNum(s.a, cx);
    // indefinite integrals are drawn as the area from a convenient start: 0 when F is defined there, else 1
    if (s.indefinite && Fxc && !(isFinite(Fxc(0)) && isFinite(f(0)))) a = [1, -1, 2].find(p => isFinite(Fxc(p)) && isFinite(f(p))) ?? 1;
    // the area from A only exists on the stretch around A where f stays finite (indefinite integrals may jump a gap)
    let lo = -Infinity, hi = Infinity;
    if (!s.indefinite) {
      const span = Math.max(10, Math.abs(a) * 2), step = span / 4000; const bad = (u: number) => !isFinite(f(u)) || Math.abs(f(u)) > 1e9;
      for (let u = a + step; u < a + span; u += step) if (bad(u)) { hi = u - step; break; }
      for (let u = a - step; u > a - span; u -= step) if (bad(u)) { lo = u + step; break; }
    }
    const inside = (u: number) => u >= lo && u <= hi;
    const exact = Fxc && isFinite(Fxc(a)) ? (u: number) => (inside(u) ? Fxc(u) - Fxc(a) : NaN) : null;
    if (exact) { const r = integrate(f, a, a + 0.7); if (!r.diverges && Math.abs(exact(a + 0.7) - r.v) > 1e-6 * Math.max(1, Math.abs(r.v))) Fx = null; }
    const area = (u: number) => { if (exact && Fx) return exact(u); if (!inside(u)) return NaN; const r = integrate(f, a, u); return r.diverges ? NaN : r.v; };
    const trig = hasFn(s.f, TRIG, v);
    let [x0, x1] = cx.domains[x] ?? defaultXRange([f], trig);
    if (a < x0) x0 = a - (x1 - x0) * 0.1; if (a > x1) x1 = a + (x1 - x0) * 0.1;
    const fy: number[] = [], Fy: number[] = [];
    for (let i = 0; i <= 160; i++) { const u = x0 + (x1 - x0) * i / 160; fy.push(f(u)); Fy.push(area(u)); }
    if (!fy.some(isFinite)) throw new MathError('the integrand has no real values here');
    let [fa, fb] = nm.robustRange(fy); fa = Math.min(fa, 0); fb = Math.max(fb, 0);
    let [Fa, Fb] = Fy.some(isFinite) ? nm.robustRange(Fy, 0, 1) : [-1, 1]; Fa = Math.min(Fa, 0); Fb = Math.max(Fb, 0);
    const [y0, y1] = nm.niceRange(fa, fb, 0.1), [Y0, Y1] = nm.niceRange(Fa, Fb, 0.1);
    const piT = trig && (x1 - x0) >= Math.PI;
    const Fname = s.indefinite ? 'F' : (s.fname.replace(/\(.*/, '') || 'F');
    const title = s.indefinite ? 'Indefinite integral' : 'Accumulation function';
    const detected = s.indefinite ? (Fx ? 'antiderivative (indefinite integral)' : 'antiderivative, drawn as the area from 0') : `area under f from ${prettyNum(a, false)} up to ${x}`;
    header(C, cx, title, detected, 8);
    C.sec('the integrand and its running area');
    C.l(`f(${V_}) = ${code(s.f)}`);
    C.l(`A = ${nf(a)}`).l(`X0 = ${nf(x0)}`).l(`X1 = ${nf(x1)}`);
    if (Fx) {
      C.l(`Fanti(${X_}) = ${code(Fx)}   // an antiderivative: Fanti' = f`);
      if (isFinite(lo) || isFinite(hi)) C.l(`${Fname}(${X_}) = ${[isFinite(lo) ? `${X_} < ${nf(lo)}` : '', isFinite(hi) ? `${X_} > ${nf(hi)}` : ''].filter(Boolean).join(' || ')} ? nan : Fanti(${X_}) - Fanti(A)   // the area from A to ${x} (only where f stays finite)`);
      else C.l(`${Fname}(${X_}) = Fanti(${X_}) - Fanti(A)   // the area from A to ${x}`);
    } else {
      C.l('// no formula for the antiderivative: area from A to u by Simpson\'s rule (n even)');
      C.l('simpson(g, p, r, n) = (r - p) / (3 * n) * sum(map(range(0, n + 1), k => g(p + (r - p) * k / n) * (k == 0 || k == n ? 1 : (k % 2 == 1 ? 4 : 2))))');
      C.l(`${Fname}(${X_}) = simpson(f, A, ${X_}, 60)`);
    }
    C.sec('left: the area builds up as the edge sweeps along (press play)');
    C.l(`P = frame2d((22, 150), (76, 92), (X0, X1), (${nf(y0)}, ${nf(y1)}), {xlabel: ${q(vl)}, ylabel: "f"${piT ? ', piTicks: true' : ''}})`);
    C.l(`Q = frame2d((114, 150), (76, 92), (X0, X1), (${nf(Y0)}, ${nf(Y1)}), {xlabel: ${q(xl)}, ylabel: ${q(Fname)}${piT ? ', piTicks: true' : ''}})`);
    C.l('xe = X0 + (X1 - X0) * (0.03 + 0.94 * t / 8)');
    C.l('NA = 160');
    C.l(`yc(u) = isnan(f(u)) ? 0 : clamp(f(u), ${nf(y0)}, ${nf(y1)})`);
    C.l('lo = min(A, xe)').l('hi = max(A, xe)');
    C.l('edge(k, part) = k == 0 ? P.map((lo, 0)) : (k == NA + 2 ? P.map((hi, 0)) : P.map((lo + (hi - lo) * (k - 1) / NA, part(yc(lo + (hi - lo) * (k - 1) / NA)))))');
    C.l(`poly(map(range(0, NA + 3), k => edge(k, u => max(u, 0))), {fill: "${BLUE}", opacity: 0.22})`);
    C.l(`poly(map(range(0, NA + 3), k => edge(k, u => min(u, 0))), {fill: "${RED}", opacity: 0.22})`);
    C.l(`fplot(P, f, {width: 0.5, color: "${BLUE}"})`);
    C.l(`line(P.map((xe, ${nf(y0)})), P.map((xe, ${nf(y1)})), {color: "${GREEN}", width: 0.3})`);
    C.l(`tex(${q(`${vl} = `)} + fmt(xe, 2), P.map((xe, ${nf(y1)})) + (0, 2), {size: 8, color: "${GREEN}", anchor: "s"})`);
    C.sec('right: the running area is a function of the upper limit');
    C.l(`fplot(Q, ${Fname}, {width: 0.5, color: "${GREEN}", n: 140})`);
    C.l(`Fe = ${Fname}(xe)`);
    C.l(`if isnan(Fe) == 0 && Fe >= ${nf(Y0)} && Fe <= ${nf(Y1)} {`);
    C.l('  P0 = Q.map((xe, Fe))').l('  dir = normalize(Q.map((xe + 1, Fe + f(xe))) - P0)');
    C.l(`  line(P0 - dir * 10, P0 + dir * 10, {color: "${RED}", width: 0.3})`);
    C.l(`  dot(P0, {r: 0.8, color: "${GREEN}"})`);
    C.l(`  tex(${q(`${Fname}(`)} + fmt(xe, 2) + ") = " + fmt(Fe, 3) + ${q(`,\\; ${Fname}' = f = `)} + fmt(f(xe), 3), (152, 145), {size: 8, color: "#555"})`);
    C.l('}');
    C.l(`tex("\\text{the slope of } ${Fname} \\text{ is the height of } f", (60, 145), {size: 8, color: "#555"})`);
    const FxT = Fx ? toTex(Fx) : '';
    const Gx = Fx && !s.indefinite ? simplify(sub(Fx, subst(Fx, { [x]: s.a }))) : null;
    const left: Fact[] = s.indefinite
      ? [{ head: 'Antiderivative', eqs: Fx && FxT.length < 170 ? [`\\int ${texOf(s.f)}\\,d${vl} = ${FxT} + C`, T(`drawn with C chosen so that ${Fname}(${prettyNum(a, false).replace(/\\/g, '')}) = 0`)] : [`\\int ${texOf(s.f)}\\,d${vl} = ${Fname}(${vl}) + C`, T('no formula found; drawn as ') + `\\int_{${prettyNum(a, false)}}^{${vl}} f`] }]
      : [{ head: 'Definition', eqs: [`${s.fname} = \\int_{${toTex(s.a)}}^{${xl}} ${texOf(s.f)}\\,d${vl}`, ...(Gx && toTex(Gx).length < 160 ? [`= ${toTex(Gx)}`] : [])] }];
    left.push({ head: 'Fundamental theorem', eqs: [`${Fname}'(${xl}) = f(${xl})`, `${Fname}(${prettyNum(a, false)}) = 0`] });
    const samples = [x0 + (x1 - x0) * 0.25, x0 + (x1 - x0) * 0.5, x0 + (x1 - x0) * 0.75, x1].map(u => +u.toPrecision(3));
    const right: Fact[] = [{ head: 'Values', eqs: samples.map(u => { const r = area(u); return `${Fname}(${prettyNum(u, false)}) ${!isFinite(r) ? (inside(u) ? '= \\infty' : T(' undefined (past a blow-up of f)')) : prettyEq(r)}`; }) }];
    factsBlock(C, cx, left, right);
    return { title, detected };
  },

  // ------------------------------------------------------------ lim_{x→a} f(x)
  limit(s: Extract<CalcSpec, { kind: 'limit' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const v = s.v, V_ = namer(v), vl = symLabel(v, tex);
    const f = compile(s.f, [v], P1(cx));
    const a = evalNum(s.to, cx);
    const seq = !isFinite(a) && ['n', 'k', 'm', 'N'].includes(v);
    const res = limitOf(f, a, s.dir, seq);
    const L = res.kind === 'value' ? res.v : NaN;
    const limTex = `\\lim_{${vl} \\to ${toTex(s.to)}${s.dir > 0 ? '^+' : s.dir < 0 ? '^-' : ''}} ${texOf(s.f)}`;
    const verdict = res.kind === 'value' ? shownEq(L, 1e-6 * Math.max(1, Math.abs(L))) : res.kind === 'inf' ? `= ${res.sign > 0 ? '' : '-'}\\infty` : '';
    // window
    let x0: number, x1: number;
    if (isFinite(a)) { const w = cx.domains[v] ? 0 : 1.5; [x0, x1] = cx.domains[v] ?? [a - (s.dir > 0 ? 0.2 : w), a + (s.dir < 0 ? 0.2 : w)]; }
    else [x0, x1] = cx.domains[v] ?? (seq ? [0, 40] : a > 0 ? [0, 30] : [-30, 0]);
    const ys: number[] = []; for (let i = 0; i <= 600; i++) { const u = x0 + (x1 - x0) * i / 600; if (Math.abs(u - a) > 1e-9) ys.push(seq ? f(Math.max(1, Math.round(u))) : f(u)); }
    if (isFinite(L)) ys.push(L);
    let [ya, yb] = nm.robustRange(ys.filter(isFinite), 0.04, 0.96);
    if (res.kind === 'inf') { const sp = yb - ya || 1; if (res.sign > 0) yb = Math.max(yb, ya + sp); else ya = Math.min(ya, yb - sp); }
    const [y0, y1] = nm.niceRange(ya, yb, 0.12);
    const title = 'Limit';
    const detected = isFinite(a) ? (s.dir ? 'one-sided limit' : 'limit at a point') : seq ? 'limit of a sequence' : 'limit at infinity';
    header(C, cx, title, detected, 6);
    C.sec('the function and the point it approaches');
    C.l(`f(${V_}) = ${code(s.f)}`);
    C.l(`X0 = ${nf(x0)}`).l(`X1 = ${nf(x1)}`).l(`Y0 = ${nf(y0)}`).l(`Y1 = ${nf(y1)}`);
    if (isFinite(a)) C.l(`a = ${nf(a)}`);
    if (isFinite(L)) C.l(`L = ${nf(L)}   // the limit (estimated numerically when the page was made)`);
    C.sec('figure');
    C.l(`Fr = frame2d((30, 134), (150, 110), (X0, X1), (Y0, Y1), {xlabel: ${q(vl)}, ylabel: "y"})`);
    if (seq) {
      C.l(`for k in 1..floor(X1) + 1 { y = f(k)\n  if isnan(y) == 0 && y >= Y0 && y <= Y1 { dot(Fr.map((k, y)), {r: 0.55, color: "${BLUE}"}) } }`);
    } else C.l(`fplot(Fr, f, {width: 0.5, color: "${BLUE}", n: 1500})`);
    if (isFinite(L) && L >= y0 && L <= y1) C.l(`line(Fr.map((X0, L)), Fr.map((X1, L)), {dash: 1.2, width: 0.25, color: "${GREEN}"})`).l(`tex("L", Fr.map((X1, L)) + (-1, 1.8), {size: 9, color: "${GREEN}", anchor: "se"})`);
    C.sec('points close in on the limit (press play)');
    if (isFinite(a)) {
      C.l('d = (X1 - X0) * 0.45 * 0.5 ^ (t * 1.8)');
      C.l(`line(Fr.map((a, Y0)), Fr.map((a, Y1)), {dash: 1, width: 0.2, color: "#999"})`);
      const sides = s.dir > 0 ? [1] : s.dir < 0 ? [-1] : [-1, 1];
      for (const sd of sides) {
        C.l(`u${sd > 0 ? 'r' : 'l'} = a ${sd > 0 ? '+' : '-'} d`).l(`y${sd > 0 ? 'r' : 'l'} = f(u${sd > 0 ? 'r' : 'l'})`);
        C.l(`if isnan(y${sd > 0 ? 'r' : 'l'}) == 0 && y${sd > 0 ? 'r' : 'l'} >= Y0 && y${sd > 0 ? 'r' : 'l'} <= Y1 { dot(Fr.map((u${sd > 0 ? 'r' : 'l'}, y${sd > 0 ? 'r' : 'l'})), {r: 0.9, color: "${sd > 0 ? RED : ORANGE}"}) }`);
      }
      if (isFinite(L) && L >= y0 && L <= y1) C.l(`circle(Fr.map((a, L)), 0.9, {stroke: "${BLUE}", fill: "#ffffff", width: 0.3})`);
      C.l(`tex(${q(`${vl} = a \\pm `)} + fmt(d, 5) + ${q(`:\\quad f = `)} + fmt(f(a + d), 6)${s.dir === 0 ? ` + ", \\;" + fmt(f(a - d), 6)` : ''}, (105, 127), {size: 9.5, color: "#555"})`);
    } else {
      C.l(`u = X0 + (X1 - X0) * (0.05 + 0.93 * t / 6)`).l(`y = f(${seq ? 'max(1, round(u))' : 'u'})`);
      C.l(`if isnan(y) == 0 && y >= Y0 && y <= Y1 { dot(Fr.map((${seq ? 'max(1, round(u))' : 'u'}, y)), {r: 0.95, color: "${RED}"}) }`);
      C.l(`tex(${q(`${vl} = `)} + fmt(${seq ? 'max(1, round(u))' : 'u'}, ${seq ? 0 : 2}) + ${q(`:\\quad f = `)} + fmt(y, 6), (105, 127), {size: 9.5, color: "#555"})`);
    }
    // values table (generation time)
    const table: string[] = [];
    if (isFinite(a)) {
      for (const k of [1, 2, 3, 4]) {
        const h = 10 ** -k;
        const parts: string[] = [];
        if (s.dir <= 0) parts.push(`f(a-${prettyNum(h, false)}) ${prettyEq(f(a - h))}`);
        if (s.dir >= 0) parts.push(`f(a+${prettyNum(h, false)}) ${prettyEq(f(a + h))}`);
        table.push(parts.join(',\\; '));
      }
    } else for (const k of [1, 2, 4, 6]) { const u = (a > 0 ? 1 : -1) * 10 ** k; table.push(`f(${a > 0 ? '' : '-'}10^{${k}}) ${prettyEq(f(u))}`); }
    const lh = res.kind !== 'none' ? lhopital(s.f, v, a, s.dir, cx, vl, toTex(s.to)) : null;   // only when it leads somewhere
    const left: Fact[] = [{ head: 'Result', eqs: res.kind === 'none' ? [limTex, T(`does not exist: ${res.why}`), ...(res.left !== undefined && res.right !== undefined ? [`${T('left: ')} ${prettyNum(res.left, false)},\\; ${T('right: ')} ${prettyNum(res.right, false)}`] : [])] : [`${limTex} ${verdict}`] }];
    if (lh) left.push({ head: 'L\'Hospital\'s rule', eqs: [...lh, verdict || T('(no finite limit)')] });
    if (isFinite(a) && !s.dir && !lh) { const fa = f(a); left.push({ head: 'At the point itself', eqs: [isFinite(fa) ? `f(${prettyNum(a, false)}) ${prettyEq(fa)}` : T('f is undefined there — the limit only looks nearby')] }); }
    const right: Fact[] = [{ head: 'Values approaching', eqs: table }];
    factsBlock(C, cx, left, right);
    return { title, detected };
  },

  // ------------------------------------------------------------ Π_{n=n0}^∞ a_n
  product(s: Extract<CalcSpec, { kind: 'product' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const i = s.i, I_ = namer(i), il = symLabel(i, tex);
    const n0 = Math.round(evalNum(s.n0, cx));
    const a = compile(s.f, [i], P1(cx));
    const prodTex = `\\prod_{${il}=${n0}}^{\\infty} ${toTex(s.f, 2)}`;
    const res = productOf(a, n0);
    const L = res.kind === 'converges' ? res.v : NaN;
    const NM = 40;
    const Pp: number[] = []; let acc = 1; for (let k = 0; k <= NM; k++) { acc *= a(n0 + k); Pp.push(acc); }
    const vals = [...Pp]; if (isFinite(L)) vals.push(L);
    let [ya, yb] = nm.robustRange(vals.filter(isFinite), 0, 1); ya = Math.min(ya, 0); yb = Math.max(yb, 0);
    const [y0, y1] = nm.niceRange(ya, yb, 0.1);
    const title = res.kind === 'converges' ? 'Infinite product' : 'Infinite product (diverges)';
    const detected = 'infinite product: partial products';
    header(C, cx, title, detected, 8);
    C.sec('the factors and the partial products');
    C.l(`factor(${I_}) = ${code(s.f)}`).l(`N0 = ${n0}`).l(`NM = ${NM}`);
    C.l('P(k) = prod(map(range(N0, N0 + k + 1), factor))   // product of the first k + 1 factors');
    if (isFinite(L)) C.l(`L = ${nf(L)}   // the value (estimated numerically when the page was made)`);
    C.sec('figure: dots are the partial products (press play)');
    C.l(`Fr = frame2d((30, 134), (150, 110), (0, NM), (${nf(y0)}, ${nf(y1)}), {xlabel: "k", ylabel: "P_k"})`);
    C.l('shown = min(NM, floor(1 + t / 8 * NM))');
    C.l('for k in 0..shown + 1 {');
    C.l(`  pk = P(k)`);
    C.l(`  if isnan(pk) == 0 && pk >= ${nf(y0)} && pk <= ${nf(y1)} { dot(Fr.map((k, pk)), {r: 0.6, color: "${BLUE}"}) }`);
    C.l('}');
    if (isFinite(L) && L >= y0 && L <= y1) C.l(`line(Fr.map((0, L)), Fr.map((NM, L)), {dash: 1.2, width: 0.25, color: "${GREEN}"})`).l(`tex("L", Fr.map((NM, L)) + (-1, 1.8), {size: 9, color: "${GREEN}", anchor: "se"})`);
    C.l(`tex("P_{" + str(shown) + "} = " + fmt(P(shown), 6)${isFinite(L) ? ' + ",\\quad L - P = " + fmt(L - P(shown), 6)' : ''}, (105, 127), {size: 9.5, color: "#555"})`);
    const tol = res.kind === 'converges' ? Math.max(1e-11 * Math.max(1, Math.abs(L)), res.err * 3) : 1;
    const left: Fact[] = [{ head: 'Verdict', eqs: res.kind === 'converges' ? [`${prodTex} ${shownEq(L, tol)}`, ...(irrationalForm(identify(L, tol)) ? [`\\approx ${+L.toPrecision(6)}`] : [])] : [prodTex, T(res.why)] }];
    left.push({ head: 'Why logs help', eqs: [`\\ln \\prod a_{${il}} = \\sum \\ln a_{${il}}`, T('so the product converges when that series does')] });
    const big = (n: number) => { let p = 1; for (let k = n0; k < n0 + n; k++) p *= a(k); return p; };
    const right: Fact[] = [{ head: 'Partial products', eqs: [10, 100, 1000].map(n => `P_{${n}} ${prettyEq(big(n))}`) }];
    factsBlock(C, cx, left, right);
    return { title, detected };
  },

  // ------------------------------------------------------------ Σ_{n=n0}^∞ a_n   (numbers or a power series in x)
  series(s: Extract<CalcSpec, { kind: 'series' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const i = s.i, I_ = namer(i), il = symLabel(i, tex);
    const n0 = Math.round(evalNum(s.n0, cx));
    const sumTex = `\\sum_{${il}=${n0}}^{\\infty} ${toTex(s.f, 2)}`;
    if (!s.x) {
      const a = compile(s.f, [i], P1(cx));
      const res = seriesSum(a, n0);
      const L = res.kind === 'converges' ? res.v : NaN;
      const NM = 40;
      const Sp: number[] = []; let acc = 0; for (let k = 0; k <= NM; k++) { acc += a(n0 + k); Sp.push(acc); }
      const vals = [...Sp, ...Array.from({ length: NM + 1 }, (_, k) => a(n0 + k))]; if (isFinite(L)) vals.push(L);
      let [ya, yb] = nm.robustRange(vals.filter(isFinite), 0, 1); ya = Math.min(ya, 0); yb = Math.max(yb, 0);
      const [y0, y1] = nm.niceRange(ya, yb, 0.1);
      const title = res.kind === 'converges' ? 'Infinite series' : 'Infinite series (diverges)';
      const detected = 'infinite series: partial sums';
      header(C, cx, title, detected, 8);
      C.sec('the terms and the partial sums');
      C.l(`term(${I_}) = ${code(s.f)}`).l(`N0 = ${n0}`).l(`NM = ${NM}`);
      C.l('S(k) = sum(map(range(N0, N0 + k + 1), term))   // partial sum of the first k + 1 terms');
      if (isFinite(L)) C.l(`L = ${nf(L)}   // the sum (estimated numerically when the page was made)`);
      C.sec('figure: grey bars are the terms, dots are the partial sums (press play)');
      C.l(`Fr = frame2d((30, 134), (150, 110), (0, NM), (${nf(y0)}, ${nf(y1)}), {xlabel: "k", ylabel: "S_k"})`);
      C.l('shown = min(NM, floor(1 + t / 8 * NM))');
      C.l('for k in 0..shown + 1 {');
      C.l(`  ak = clamp(term(N0 + k), ${nf(y0)}, ${nf(y1)})`);
      C.l('  if isnan(ak) == 0 { line(Fr.map((k, 0)), Fr.map((k, ak)), {width: 0.9, color: "#c3c9d1"}) }');
      C.l(`  sk = S(k)`);
      C.l(`  if isnan(sk) == 0 && sk >= ${nf(y0)} && sk <= ${nf(y1)} { dot(Fr.map((k, sk)), {r: 0.6, color: "${BLUE}"}) }`);
      C.l('}');
      if (isFinite(L) && L >= y0 && L <= y1) C.l(`line(Fr.map((0, L)), Fr.map((NM, L)), {dash: 1.2, width: 0.25, color: "${GREEN}"})`).l(`tex("L", Fr.map((NM, L)) + (-1, 1.8), {size: 9, color: "${GREEN}", anchor: "se"})`);
      C.l(`tex("S_{" + str(shown) + "} = " + fmt(S(shown), 6)${isFinite(L) ? ' + ",\\quad L - S = " + fmt(L - S(shown), 6)' : ''}, (105, 127), {size: 9.5, color: "#555"})`);
      const big = (n: number) => { let sm = 0; for (let k = n0; k < n0 + n; k++) sm += a(k); return sm; };
      // |a(n+1)/a(n)| sampled at n and 2n, extrapolated (it often creeps towards its limit like 1 − c/n)
      const qr = (n: number) => Math.abs(a(n0 + n + 1) / a(n0 + n));
      const q1 = qr(1000), q2 = qr(2000);
      let r1 = isFinite(q1) && isFinite(q2) ? 2 * q2 - q1 : isFinite(q1) ? q1 : NaN;
      if (!isFinite(r1) || r1 < 0) { const qs = [10, 20, 40, 80].map(qr).filter(isFinite); r1 = qs.length ? qs[qs.length - 1] : NaN; if (qs.length >= 3 && qs.every((q, i) => i === 0 || q < qs[i - 1] * 0.7)) r1 = 0; }
      if (Math.abs(r1 - 1) < 2e-3) r1 = 1;
      const left: Fact[] = [{ head: 'Verdict', eqs: res.kind === 'converges' ? [`${sumTex} ${shownEq(L, Math.max(1e-11 * Math.max(1, Math.abs(L)), res.err * 3))}`, ...(irrationalForm(identify(L, Math.max(1e-11 * Math.max(1, Math.abs(L)), res.err * 3))) ? [`\\approx ${+L.toPrecision(6)}`] : [])] : [sumTex, T('diverges: ' + res.why)] }];
      left.push({ head: 'Ratio test', eqs: [isFinite(r1) ? `\\left|\\frac{a_{n+1}}{a_n}\\right| \\to ${prettyNum(+r1.toPrecision(3), false)}${r1 < 0.998 ? T(' < 1, converges') : Math.abs(r1 - 1) < 0.01 ? T(' = 1: inconclusive') : T(' > 1, diverges')}` : T('not applicable')] });
      const right: Fact[] = [{ head: 'Partial sums', eqs: [10, 100, 1000].map(n => `S_{${n}} ${prettyEq(big(n))}`) }];
      factsBlock(C, cx, left, right);
      return { title, detected };
    }
    // power series in x
    const x = s.x, X_ = namer(x), xl = symLabel(x, tex);
    const g = compile(s.f, [x, i], P1(cx));
    // ratio test on the terms at x = 1: |a_{n+1}/a_n| → 1/R. Terms like 1/n! underflow early, so use the largest n that works,
    // and call R infinite when the ratio keeps falling towards 0.
    const ratio = (n: number) => { const r = Math.abs(g(1, n0 + n + 1) / g(1, n0 + n)); return isFinite(r) && r > 0 ? r : NaN; };
    const qs = [10, 20, 40, 80, 160, 320].map(ratio);
    const okq = qs.filter(isFinite);
    let R = NaN;
    if (okq.length >= 3) {
      const [qa, qb, qc] = okq.slice(-3);
      // q(n) ≈ q∞ + c/n: extrapolate from n and 2n
      const qinf = Math.max(1e-12, 2 * qc - qb);
      R = qc < qb * 0.7 && qb < qa * 0.7 ? Infinity : 1 / qinf;
      if (isFinite(R) && Math.abs(R - Math.round(R)) < 2e-3 * Math.max(1, R)) R = Math.round(R);
    }
    let [x0, x1] = cx.domains[x] ?? (isFinite(R) ? [-Math.min(1.3 * R, 10), Math.min(1.3 * R, 10)] : [-4, 4]);
    const MT = 60;
    const lim = (u: number) => { let sm = 0, last = 0; for (let k = n0; k <= n0 + MT; k++) { last = g(u, k); sm += last; } return Math.abs(last) < 1e-6 * Math.max(1, Math.abs(sm)) ? sm : NaN; };
    const ys: number[] = []; for (let k = 0; k <= 200; k++) ys.push(lim(x0 + (x1 - x0) * k / 200));
    if (!ys.some(isFinite)) throw new MathError('the series does not converge anywhere in view');
    const [ya, yb] = nm.robustRange(ys.filter(isFinite), 0, 1);
    const [y0, y1] = nm.niceRange(Math.min(ya, 0), Math.max(yb, 0), 0.15);
    const title = 'Power series';
    const detected = 'power series: partial sums closing in on the function';
    header(C, cx, title, detected, 8);
    C.sec('the terms, the partial sums and the limit');
    C.l(`term(${X_}, ${I_}) = ${code(s.f)}`).l(`N0 = ${n0}`);
    C.l(`S(N, ${X_}) = sum(map(range(N0, N0 + N + 1), k => term(${X_}, k)))`);
    C.l(`lim(${X_}) = abs(term(${X_}, N0 + ${MT})) < 1e-6 * max(1, abs(S(${MT}, ${X_}))) ? S(${MT}, ${X_}) : nan   // where the series has converged`);
    C.sec('figure: the partial sum grows one term per second (press play)');
    C.l(`Fr = frame2d((30, 134), (150, 110), (${nf(x0)}, ${nf(x1)}), (${nf(y0)}, ${nf(y1)}), {xlabel: ${q(xl)}, ylabel: "y"})`);
    C.l(`fplot(Fr, lim, {width: 1.1, color: "#c9d6e6", n: 300})`);
    C.l('Nt = floor(t)');
    C.l('for k in 0..Nt {');
    C.l(`  fplot(Fr, u => S(k, u), {width: 0.25, color: "#9fb4cc", n: 200})`);
    C.l('}');
    C.l(`fplot(Fr, u => S(Nt, u), {width: 0.55, color: "${RED}", n: 300})`);
    if (isFinite(R) && R > 0 && R < 1e6) C.l(`for e in [-${nf(R)}, ${nf(R)}] { if e >= ${nf(x0)} && e <= ${nf(x1)} { line(Fr.map((e, ${nf(y0)})), Fr.map((e, ${nf(y1)})), {dash: 1, width: 0.2, color: "#999"}) } }`);
    C.l(`tex("S_{" + str(Nt) + "}(${xl}) = \\sum_{${il}=" + str(N0) + "}^{" + str(N0 + Nt) + "} \\ldots", (105, 127), {size: 9.5, color: "${RED}"})`);
    const left: Fact[] = [{ head: 'Series', eqs: [`f(${xl}) = ${sumTex}`] },
      { head: 'Radius of convergence', eqs: [!Number.isNaN(R) ? (R === Infinity ? `R = \\infty ${T(' (converges for every ')}${xl})` : `R ${prettyEq(R)}`) : T('could not be estimated')] }];
    const right: Fact[] = [{ head: 'Values (60 terms)', eqs: [0.5, 1, 2].filter(u => isFinite(lim(u))).map(u => `f(${prettyNum(u, false)}) ${prettyEq(lim(u))}`) }];
    if (!right[0].eqs.length) right[0].eqs.push(T('converges only near the centre'));
    factsBlock(C, cx, left, right);
    return { title, detected };
  },
};

const GENERATORS: Record<string, any> = {
  // ------------------------------------------------------------ y = f(x)
  graph(s: Extract<Spec, { kind: 'graph' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const xv = s.x, X = namer(xv), xl = symLabel(xv, tex);
    const fs = s.fs.map(f => simplify(f));
    const fns = fs.map(f => compile(f, [xv], P1(cx)));
    const trig = fs.some(f => hasFn(f, TRIG, xv));
    let [x0, x1] = cx.domains[xv] ?? defaultXRange(fns, trig);
    const ys: number[] = []; for (const f of fns) for (let i = 0; i <= 1200; i++) ys.push(f(x0 + (x1 - x0) * i / 1200));
    if (!ys.some(isFinite)) throw new MathError('the function has no real values in the plotted range');
    let [ya, yb] = nm.robustRange(ys);
    const sp = yb - ya || 1; if (ya > 0 && ya < 0.35 * sp) ya = 0; if (yb < 0 && -yb < 0.35 * sp) yb = 0;
    let [y0, y1] = nm.symmetricIfNear(nm.niceRange(ya, yb, 0.1));
    if (cx.domains.y) [y0, y1] = cx.domains.y;
    const single = fs.length === 1;
    const d1 = single ? tryDiff(fs[0], xv) : null, d2 = d1 ? tryDiff(d1, xv) : null;
    const df = d1 ? compile(d1, [xv], P1(cx)) : null;
    const piT = trig && (x1 - x0) >= Math.PI;
    const isY = s.fname === 'y';
    const hasArgs = s.fname.includes('(');
    const dname = hasArgs ? s.fname.replace(/\(/, "'(") : `\\frac{d${s.ylab}}{d${xl}}`;
    const primeName = hasArgs ? s.fname.replace(/\(.*/, "'") : s.ylab + "'";
    const title = s.formula ? 'Formula as a function' : fs.length > 1 ? 'Graphs of functions' : 'Graph of a function';
    const detected = s.formula ? `formula ${s.ylab} as a function of ${xl}` : fs.length > 1 ? `${fs.length} explicit graphs y = f(x)` : 'explicit function y = f(x)';
    header(C, cx, title, detected.replace(/\\/g, ''));
    C.sec('the function' + (fs.length > 1 ? 's' : ''));
    const fnames = fs.map((_, i) => (fs.length === 1 ? 'f' : `f${i + 1}`));
    fs.forEach((f, i) => C.l(`${fnames[i]}(${X}) = ${code(f)}`));
    if (d1) C.l(`df(${X}) = ${code(d1)}`);
    C.l(`X0 = ${nf(x0)}`).l(`X1 = ${nf(x1)}`).l(`Y0 = ${nf(y0)}`).l(`Y1 = ${nf(y1)}`);
    C.sec('figure');
    C.l(`Fr = frame2d((30, 134), (150, 110), (X0, X1), (Y0, Y1), {xlabel: ${q(xl)}, ylabel: ${q(isY ? s.ylab : s.formula ? s.ylab : 'y')}${piT ? ', piTicks: true' : ''}})`);
    fs.forEach((_, i) => C.l(`fplot(Fr, ${fnames[i]}, {width: 0.5, color: "${fs.length > 1 ? PALETTE[i % 5] : BLUE}"})`));
    const left: Fact[] = [], right: Fact[] = [];
    if (single) {
      const f = fns[0];
      const scale = Math.max(1e-12, ...ys.filter(isFinite).map(Math.abs)) * 1e-3;
      const rts = nm.roots(f, x0, x1, 4000, scale);
      const ex = nm.extrema(f, df, x0, x1).filter(e => e.y >= y0 && e.y <= y1);
      const marks = (pts: number[][], color: string) => pts.forEach(p => C.l(`dot(Fr.map(${pt(p[0], p[1])}), {r: 0.75, color: "${color}"})`));
      if (rts.length && rts.length <= 12) { C.c('roots'); marks(rts.map(r => [r, 0]), BLUE); }
      if (ex.length && ex.length <= 12) {
        C.c('local extrema');
        ex.forEach(e => {
          C.l(`dot(Fr.map(${pt(e.x, e.y)}), {r: 0.85, color: "${RED}"})`);
          if (ex.length <= 6) C.l(`tex(${q(`\\text{${e.type}}`)}, Fr.map(${pt(e.x, e.y)}) + (0, ${e.type === 'max' ? 3 : -3}), {size: 7.5, color: "#666", anchor: "${e.type === 'max' ? 's' : 'n'}"})`);
        });
      }
      if (df) {
        C.sec('a tangent line slides along the curve (press play)');
        C.l('x0 = X0 + (X1 - X0) * (0.06 + 0.88 * t / 6)').l('y0 = f(x0)').l('m0 = df(x0)');
        C.l('if isnan(y0) == 0 && isnan(m0) == 0 && y0 >= Y0 && y0 <= Y1 {');
        C.l('  P0 = Fr.map((x0, y0))');
        C.l('  dir = normalize(Fr.map((x0 + 1, y0 + m0)) - P0)');
        C.l(`  line(P0 - dir * 16, P0 + dir * 16, {color: "${RED}", width: 0.35})`);
        C.l(`  dot(P0, {r: 0.9, color: "${RED}"})`);
        C.l(`  tex(${q(`${primeName}(`)} + fmt(x0, 2) + ") = " + fmt(m0, 2), P0 + (0, 4.5), {size: 8, color: "${RED}", anchor: "s"})`);
        C.l('}');
      }
      if (d1) left.push({ head: 'Derivative', eqs: [`${dname} = ${texOf(d1)}`] });
      if (d2 && short(texOf(d2), 170)) left.push({ head: 'Second derivative', eqs: [`${hasArgs ? s.fname.replace(/\(/, "''(") : `\\frac{d^2${s.ylab}}{d${xl}^2}`} = ${texOf(d2)}`] });
      if (!d1) left.push({ head: 'Derivative', eqs: [T('not available symbolically for this function')] });
      right.push({ head: 'Roots in view', eqs: rts.length ? (rts.length > 4 ? [T(`${rts.length} roots, e.g.`) + ` \\; ${xl} ${prettyEq(rts[0])}`] : rts.map(r => `${xl} ${prettyEq(r)}`)) : [T('none in the plotted range')] });
      if (ex.length) right.push({ head: 'Local extrema', eqs: ex.slice(0, 4).map(e => `${T(e.type === 'max' ? 'max at ' : 'min at ')} ${xl} ${prettyEq(e.x)},\\; ${s.ylab === 'y' ? 'y' : s.ylab} ${prettyEq(e.y)}`) });
      const y00 = f(0);
      if (x0 <= 0 && x1 >= 0 && isFinite(y00)) right.push({ head: 'Intercept', eqs: [`${s.fname.includes('(') ? s.fname.replace(/\(.*\)/, `(0)`) : s.ylab + '(0)'} ${prettyEq(y00)}`] });
      if (d2) {
        const d2f = compile(d2, [xv], P1(cx));
        const infl = nm.roots(d2f, x0, x1, 3000, 1e-9).filter(x => { const y = f(x); return isFinite(y) && y >= y0 && y <= y1; });
        if (infl.length && infl.length <= 4) left.push({ head: 'Inflection points', eqs: infl.map(x => `${xl} ${prettyEq(x)}`) });
      }
    } else {
      // intersections between branches
      const ints: number[][] = [];
      for (let i = 0; i < fns.length; i++) for (let j = i + 1; j < fns.length; j++) {
        const h = (x: number) => fns[i](x) - fns[j](x);
        for (const r of nm.roots(h, x0, x1, 3000, 1e-6)) { const y = fns[i](r); if (isFinite(y)) ints.push([r, y]); }
      }
      ints.slice(0, 10).forEach(p => C.l(`dot(Fr.map(${pt(p[0], p[1])}), {r: 0.8, color: "${RED}"})`));
      left.push({ head: 'Branches', eqs: fs.slice(0, 5).map((f, i) => `${s.ylab}_{${i + 1}} = ${texOf(f)}`) });
      if (ints.length) right.push({ head: 'Where branches meet', eqs: ints.slice(0, 5).map(p => `(${prettyNum(p[0], false)},\\; ${prettyNum(p[1], false)})`) });
    }
    factsBlock(C, cx, left, right);
    return { title, detected };
  },

  // ------------------------------------------------------------ z = f(x, y)
  surface(s: Extract<Spec, { kind: 'surface' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const xs = s.x, ys = s.y, X = namer(xs), Y = namer(ys);
    const f = compile(s.f, [xs, ys], P1(cx));
    const trig = hasFn(s.f, TRIG);
    let L = trig ? (hasFnDeep(s.f, 'pow') && /sqrt|\^ 0\.5/.test(key(s.f)) ? 2 * Math.PI : Math.PI) : 2;
    if (!cx.domains[xs] && !cx.domains[ys]) {
      const spread = (LL: number) => { const v: number[] = []; for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) v.push(f(-LL + 2 * LL * i / 20, -LL + 2 * LL * j / 20)); const r = nm.robustRange(v); return r[1] - r[0]; };
      if (spread(L) < 1e-6) L *= 3;
    }
    const [x0, x1] = cx.domains[xs] ?? [-L, L], [y0, y1] = cx.domains[ys] ?? [-L, L];
    const zs: number[] = []; for (let j = 0; j <= 60; j++) for (let i = 0; i <= 60; i++) zs.push(f(x0 + (x1 - x0) * i / 60, y0 + (y1 - y0) * j / 60));
    if (!zs.some(isFinite)) throw new MathError('the surface has no real values in the plotted range');
    let [z0, z1] = nm.niceRange(...nm.robustRange(zs, 0.02, 0.98), 0.06);
    if (cx.domains.z) [z0, z1] = cx.domains.z;
    const fx = tryDiff(s.f, xs), fy = tryDiff(s.f, ys);
    const piX = trig && L >= Math.PI && !cx.domains[xs];
    const title = 'Surface', detected = s.fname === 'z' ? 'explicit surface z = f(x, y)' : `${s.fname.replace(/\\/g, '')} as a function of two variables`;
    header(C, cx, title, detected);
    C.sec('the function');
    C.l(`f(${X}, ${Y}) = ${code(s.f)}`);
    if (fx && fy) { C.l(`fx(${X}, ${Y}) = ${code(fx)}`).l(`fy(${X}, ${Y}) = ${code(fy)}`); }
    C.l(`X0 = ${nf(x0)}`).l(`X1 = ${nf(x1)}`).l(`Y0 = ${nf(y0)}`).l(`Y1 = ${nf(y1)}`).l(`Z0 = ${nf(z0)}`).l(`Z1 = ${nf(z1)}`);
    C.sec('figure — orbit the view to see the real 3D surface');
    C.l(`Fr = frame3d((105, 188), 92, (X0, X1), (Y0, Y1), (Z0, Z1), {labels: [${q(symLabel(xs, tex))}, ${q(symLabel(ys, tex))}, ${q(s.zlab)}]${piX ? ', piX: true, piY: true' : ''}})`);
    C.l('splot(Fr, f, {n: 64, wire: 14})');
    // critical points
    const left: Fact[] = [], right: Fact[] = [];
    const crit: { x: number; y: number; z: number; type: string }[] = [];
    if (fx && fy) {
      const gx = compile(fx, [xs, ys], P1(cx)), gy = compile(fy, [xs, ys], P1(cx));
      for (const [px, py] of nm.solve2((a, b) => [gx(a, b), gy(a, b)], [x0, x1, y0, y1], 16)) {
        const z = f(px, py); if (!isFinite(z) || z < z0 || z > z1) continue;
        const h = 1e-4 * (x1 - x0);
        const fxx = (gx(px + h, py) - gx(px - h, py)) / (2 * h), fyy = (gy(px, py + h) - gy(px, py - h)) / (2 * h), fxy = (gx(px, py + h) - gx(px, py - h)) / (2 * h);
        const D = fxx * fyy - fxy * fxy;
        crit.push({ x: px, y: py, z, type: D > 1e-9 ? (fxx > 0 ? 'local min' : 'local max') : D < -1e-9 ? 'saddle' : 'degenerate' });
        if (crit.length >= 8) break;
      }
      if (crit.length) {
        C.c('critical points');
        crit.forEach(c => {
          C.l(`dot(Fr.map(${pt(c.x, c.y, c.z)}), {r: 0.9, color: "${RED}"})`);
          if (crit.length <= 4) C.l(`tex(${q(T(c.type))}, Fr.map(${pt(c.x, c.y, c.z)}) + (0, 3.5, 0), {size: 7.5, color: "${RED}", anchor: "s", face: "viewer"})`);
        });
      }
      C.sec('a point travels over the surface; the arrow on the floor is the gradient (press play)');
      C.l('ang = 2 * pi * t / 6');
      C.l('px = (X0 + X1) / 2 + (X1 - X0) * 0.3 * cos(ang)').l('py = (Y0 + Y1) / 2 + (Y1 - Y0) * 0.3 * sin(ang)').l('pz = f(px, py)');
      C.l('if isnan(pz) == 0 && pz >= Z0 && pz <= Z1 {');
      C.l('  P0 = Fr.map((px, py, pz))');
      C.l(`  dot(P0, {r: 0.95, color: "${ORANGE}"})`);
      C.l(`  line(P0, Fr.map((px, py, Fr.floor)), {dash: 0.8, color: "${ORANGE}", width: 0.22})`);
      C.l('  gx = fx(px, py)').l('  gy = fy(px, py)').l('  gl = sqrt(gx ^ 2 + gy ^ 2)');
      C.l('  if gl > 0 {');
      C.l(`    arrow(Fr.map((px, py, Fr.floor)), Fr.map((px + gx / gl * (X1 - X0) * 0.16, py + gy / gl * (Y1 - Y0) * 0.16, Fr.floor)), {color: "${ORANGE}", width: 0.35})`);
      C.l('  }');
      C.l('}');
      left.push({ head: 'Partial derivatives', eqs: [`\\frac{\\partial ${s.zlab}}{\\partial ${symLabel(xs, tex)}} = ${texOf(fx)}`, `\\frac{\\partial ${s.zlab}}{\\partial ${symLabel(ys, tex)}} = ${texOf(fy)}`] });
      const fxx = tryDiff(fx, xs), fyy = tryDiff(fy, ys), fxy = tryDiff(fx, ys);
      if (fxx && fyy && fxy && short(texOf(fxx) + texOf(fyy) + texOf(fxy), 160)) left.push({ head: 'Second partials', eqs: [`f_{xx} = ${texOf(fxx)}`, `f_{yy} = ${texOf(fyy)},\\; f_{xy} = ${texOf(fxy)}`] });
    } else left.push({ head: 'Partial derivatives', eqs: [T('not available symbolically')] });
    right.push({ head: 'Critical points in view', eqs: crit.length ? crit.slice(0, 5).map(c => `(${prettyNum(c.x, false)},\\, ${prettyNum(c.y, false)})\\; ${T(c.type)}`) : [T('none in the plotted range')] });
    right.push({ head: 'Range shown', eqs: [`${symLabel(xs, tex)} \\in [${prettyNum(x0, false)}, ${prettyNum(x1, false)}],\\; ${symLabel(ys, tex)} \\in [${prettyNum(y0, false)}, ${prettyNum(y1, false)}]`] });
    factsBlock(C, cx, left, right);
    return { title, detected };
  },

  // ------------------------------------------------------------ implicit curves / systems
  implicit2(s: Extract<Spec, { kind: 'implicit2' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const xs = s.x, ys = s.y, X = namer(xs), Y = namer(ys);
    const Gs = s.rels.map(r => simplify(sub((r as any).terms[0], (r as any).terms[1])));
    const gf = Gs.map(G => compile(G, [xs, ys], P1(cx)));
    let box: number[] | null = null;
    for (const L of [8, 40, 200]) {
      for (const g of gf) { const b = nm.zeroBox2(g, L); if (b) box = box ? [Math.min(box[0], b[0]), Math.max(box[1], b[1]), Math.min(box[2], b[2]), Math.max(box[3], b[3])] : b; }
      if (box) break;
    }
    if (!box) { cx.warnings.push('no real points were found — showing the default window'); box = [-3, 3, -3, 3]; }
    else if (Math.max(...box.map(Math.abs)) > 7.5) {      // unbounded curve (e.g. a hyperbola): frame it by its natural scale
      const sc = Math.max(...gf.map(g => nm.axisScale(g, 2) ?? 0));
      if (sc > 0 && sc < 4) { const H = Math.max(3, 2.4 * sc); box = box.map((v, i) => (i % 2 ? Math.min(v, H) : Math.max(v, -H))); }
    }
    let [x0, x1] = nm.symmetricIfNear(nm.niceRange(box[0], box[1], 0.18));
    let [y0, y1] = nm.symmetricIfNear(nm.niceRange(box[2], box[3], 0.18));
    if (cx.domains[xs]) [x0, x1] = cx.domains[xs]; if (cx.domains[ys]) [y0, y1] = cx.domains[ys];
    const system = Gs.length > 1;
    const conic = !system ? conicOf(gf[0]) : null;
    const title = system ? 'System of equations' : conic ? conic.name[0].toUpperCase() + conic.name.slice(1) : 'Implicit curve';
    const detected = system ? `${Gs.length} equations in ${xs}, ${ys} — solved graphically` : conic ? `implicit curve: a ${conic.name}` : 'implicit curve F(x, y) = 0';
    header(C, cx, title, detected);
    C.sec(system ? 'each equation written as G(x, y) = 0' : 'the curve is the zero set of G(x, y)');
    Gs.forEach((G, i) => C.l(`G${system ? i + 1 : ''}(${X}, ${Y}) = ${code(G)}`));
    C.l(`X0 = ${nf(x0)}`).l(`X1 = ${nf(x1)}`).l(`Y0 = ${nf(y0)}`).l(`Y1 = ${nf(y1)}`);
    C.sec('figure');
    C.l(`Fr = frame2d((30, 134), (150, 110), (X0, X1), (Y0, Y1), {equal: true, xlabel: ${q(symLabel(xs, tex))}, ylabel: ${q(symLabel(ys, tex))}})`);
    Gs.forEach((_, i) => C.l(`cplot(Fr, G${system ? i + 1 : ''}, {width: 0.5, color: "${PALETTE[i % 5]}"})`));
    const left: Fact[] = [], right: Fact[] = [];
    if (system) {
      const pts: number[][] = [];
      for (let i = 0; i < gf.length; i++) for (let j = i + 1; j < gf.length; j++)
        for (const p of nm.solve2((a, b) => [gf[i](a, b), gf[j](a, b)], [x0, x1, y0, y1], 22)) pts.push(p);
      C.c('solutions (intersection points)');
      pts.slice(0, 12).forEach(p => C.l(`dot(Fr.map(${pt(p[0], p[1])}), {r: 0.9, color: "${RED}"})`));
      if (pts.length <= 6) pts.forEach(p => C.l(`tex(${q(`(${prettyNum(p[0], false).replace('\\approx ', '')}, ${prettyNum(p[1], false).replace('\\approx ', '')})`)}, Fr.map(${pt(p[0], p[1])}) + (2, 2), {size: 7.5, color: "${RED}", anchor: "sw"})`));
      left.push({ head: 'Equations', eqs: s.rels.slice(0, 5).map((r, i) => `\\color{${PALETTE[i % 5]}}{${texOf(r)}}`) });
      right.push({ head: 'Solutions', eqs: pts.length ? pts.slice(0, 6).map(p => `(${xs}, ${ys}) ${prettyNum(p[0]).startsWith('\\approx') ? '\\approx' : '='} (${prettyNum(p[0], false)},\\; ${prettyNum(p[1], false)})`) : [T('no intersections in view')] });
    } else {
      const Gx = tryDiff(Gs[0], xs), Gy = tryDiff(Gs[0], ys);
      if (Gx && Gy) {
        left.push({ head: 'Gradient (normal to the curve)', eqs: [`\\nabla G = \\left(${texOf(Gx)},\\; ${texOf(Gy)}\\right)`] });
        const slope = simplify(neg(mul(Gx, pow(Gy, -1))));
        if (short(texOf(slope), 140)) left.push({ head: 'Implicit derivative', eqs: [`\\frac{d${symLabel(ys, tex)}}{d${symLabel(xs, tex)}} = ${texOf(slope)}`] });
      }
      if (conic) right.push({ head: 'Conic section', eqs: conic.facts });
      const xi = nm.roots(x => gf[0](x, 0), x0, x1, 3000, 1e-9), yi = nm.roots(y => gf[0](0, y), y0, y1, 3000, 1e-9);
      if (xi.length || yi.length) right.push({ head: 'Axis crossings', eqs: [...xi.slice(0, 3).map(v => `(${prettyNum(v, false)},\\, 0)`), ...yi.slice(0, 3).map(v => `(0,\\, ${prettyNum(v, false)})`)].slice(0, 4) });
    }
    factsBlock(C, cx, left, right);
    return { title, detected };
  },

  // ------------------------------------------------------------ implicit surfaces
  implicit3(s: Extract<Spec, { kind: 'implicit3' }>, cx: Ctx, C: Code) {
    const Gs = s.rels.map(r => simplify(sub((r as any).terms[0], (r as any).terms[1])));
    const gf = Gs.map(G => compile(G, ['x', 'y', 'z'], P1(cx)));
    let box: number[] | null = null;
    for (const L of [4, 20, 100]) {
      for (const g of gf) { const b = nm.zeroBox3(g, L, 30); if (b) box = box ? box.map((v, i) => (i % 2 ? Math.max(v, b[i]) : Math.min(v, b[i]))) : b; }
      if (box) break;
    }
    if (!box) { cx.warnings.push('no real points were found — showing the default box'); box = [-2, 2, -2, 2, -2, 2]; }
    else if (Math.max(...box.map(Math.abs)) > 3.6) {      // unbounded surface (hyperboloid, cone, cylinder…)
      const sc = Math.max(...gf.map(g => nm.axisScale(g, 3) ?? 0));
      const H = sc > 0 ? Math.max(2, 1.6 * sc) : 2.5;
      box = box.map((v, i) => (i % 2 ? Math.min(v, H) : Math.max(v, -H)));
    }
    const r = [0, 2, 4].map(i => nm.symmetricIfNear(nm.niceRange(box![i], box![i + 1], 0.1)));
    for (const [i, v] of ['x', 'y', 'z'].entries()) if (cx.domains[v]) r[i] = cx.domains[v];
    const quad = Gs.length === 1 ? quadricOf(gf[0]) : null;
    const title = Gs.length > 1 ? 'Intersecting surfaces' : quad ? quad.name[0].toUpperCase() + quad.name.slice(1) : 'Implicit surface';
    const detected = Gs.length > 1 ? `${Gs.length} implicit surfaces` : quad ? `implicit surface: ${quad.name}` : 'implicit surface F(x, y, z) = 0';
    header(C, cx, title, detected);
    C.sec('the surface is the zero set of G(x, y, z)');
    Gs.forEach((G, i) => C.l(`G${Gs.length > 1 ? i + 1 : ''}(x, y, z) = ${code(G)}`));
    C.sec('figure — orbit the view to see it in 3D');
    C.l(`Fr = frame3d((105, 188), 88, ${pt(...r[0])}, ${pt(...r[1])}, ${pt(...r[2])}, {equal: true})`);
    Gs.forEach((_, i) => C.l(i === 0 ? `isoplot(Fr, G${Gs.length > 1 ? 1 : ''}, {n: 40${Gs.length > 1 ? ', opacity: 0.85' : ''}})` : `isoplot(Fr, G${i + 1}, {n: 36, fill: "${[ORANGE, RED, GREEN][i % 3]}", opacity: 0.7})`));
    const left: Fact[] = [], right: Fact[] = [];
    const g = ['x', 'y', 'z'].map(v => tryDiff(Gs[0], v));
    if (g.every(Boolean) && short(g.map(x => texOf(x!)).join(''), 150)) left.push({ head: 'Normal vector', eqs: [`\\nabla G = \\left(${g.map(x => texOf(x!)).join(',\\; ')}\\right)`] });
    if (quad) right.push({ head: 'Quadric surface', eqs: quad.facts });
    left.push({ head: 'Box shown', eqs: [`x \\in [${prettyNum(r[0][0], false)}, ${prettyNum(r[0][1], false)}]`, `y \\in [${prettyNum(r[1][0], false)}, ${prettyNum(r[1][1], false)}],\\; z \\in [${prettyNum(r[2][0], false)}, ${prettyNum(r[2][1], false)}]`] });
    factsBlock(C, cx, left, right);
    return { title, detected };
  },

  // ------------------------------------------------------------ inequalities
  region(s: Extract<Spec, { kind: 'region' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const xs = s.x, ys = s.y, X = namer(xs), Y = namer(ys);
    const rel = s.rel as Extract<Node, { k: 'rel' }>;
    const bounds = rel.terms.slice(0, -1).map((t, i) => simplify(sub(t, rel.terms[i + 1])));
    const cond = compCond(rel, [xs, ys], P1(cx));
    let box: number[] | null = null;
    for (const B of bounds) { const b = nm.zeroBox2(compile(B, [xs, ys], P1(cx)), 8); if (b) box = box ? [Math.min(box[0], b[0]), Math.max(box[1], b[1]), Math.min(box[2], b[2]), Math.max(box[3], b[3])] : b; }
    if (!box) box = [-4, 4, -4, 4];
    let [x0, x1] = nm.symmetricIfNear(nm.niceRange(box[0], box[1], 0.3)), [y0, y1] = nm.symmetricIfNear(nm.niceRange(box[2], box[3], 0.3));
    if (cx.domains[xs]) [x0, x1] = cx.domains[xs]; if (cx.domains[ys]) [y0, y1] = cx.domains[ys];
    const strict = rel.ops.every(o => o === '<' || o === '>' || o === '!=');
    header(C, cx, 'Region of the plane', strict ? 'inequality — boundary not included (dashed)' : 'inequality — boundary included (solid)');
    C.sec('the condition');
    C.l(`inside(${X}, ${Y}) = ${condCode(rel, namer)}`);
    bounds.forEach((B, i) => C.l(`G${i + 1}(${X}, ${Y}) = ${code(B)}`));
    C.sec('figure');
    C.l(`Fr = frame2d((30, 134), (150, 110), ${pt(x0, x1)}, ${pt(y0, y1)}, {equal: true, xlabel: ${q(symLabel(xs, tex))}, ylabel: ${q(symLabel(ys, tex))}})`);
    C.l('region(Fr, inside, {fill: "#5b9bd5", opacity: 0.32, n: 220})');
    bounds.forEach((_, i) => C.l(`cplot(Fr, G${i + 1}, {width: 0.45, color: "${BLUE}"${strict ? ', dash: 1.2' : ''}})`));
    // area estimate
    let cnt = 0, edge = false; const n = 300;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const inn = cond([x0 + (x1 - x0) * (i + 0.5) / n, y0 + (y1 - y0) * (j + 0.5) / n]); if (inn) { cnt++; if (i === 0 || j === 0 || i === n - 1 || j === n - 1) edge = true; }
    }
    const area = cnt / (n * n) * (x1 - x0) * (y1 - y0);
    factsBlock(C, cx, [{ head: 'Boundary', eqs: bounds.map(B => `${texOf(B)} = 0`) }],
      [{ head: 'Area', eqs: [cnt === 0 ? T('the region is empty in this window') : edge ? T('unbounded (extends past the window)') : `A \\approx ${+area.toPrecision(4)} ${prettyNum(area).startsWith('\\approx') ? '' : `\\;(${prettyNum(area, false)})`}`] }]);
    return { title: 'Region of the plane', detected: 'inequality region' };
  },

  // ------------------------------------------------------------ polar r = f(θ)
  polar(s: Extract<Spec, { kind: 'polar' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const th = s.th, TH = namer(th), thl = symLabel(th, tex);
    const r = compile(s.r, [th], P1(cx));
    const P = (a: number) => { const v = r(a); return isFinite(v) ? [v * Math.cos(a), v * Math.sin(a)] : null; };
    let range = cx.domains[th];
    let period: number | null = null;
    if (!range) { period = nm.closingPeriod(P, Math.PI, 24); range = [0, period ?? 4 * Math.PI]; }
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i <= 2000; i++) { const p = P(range[0] + (range[1] - range[0]) * i / 2000); if (p) { xs.push(p[0]); ys.push(p[1]); } }
    if (!xs.length) throw new MathError('r has no real values');
    const R = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs), 1e-6);
    const [x0, x1] = nm.symmetricIfNear(nm.niceRange(Math.min(...xs, -0.1 * R), Math.max(...xs, 0.1 * R), 0.1));
    const [y0, y1] = nm.symmetricIfNear(nm.niceRange(Math.min(...ys, -0.1 * R), Math.max(...ys, 0.1 * R), 0.1));
    const dr = tryDiff(s.r, th);
    header(C, cx, 'Polar curve', `polar curve r = f(${thl.replace(/\\/g, '')})`);
    C.sec('the curve');
    C.l(`rr(${TH}) = ${code(s.r)}`);
    C.l(`T0 = ${nf(range[0])}`).l(`T1 = ${nf(range[1])}`);
    C.sec('figure');
    C.l(`Fr = frame2d((30, 134), (150, 110), ${pt(x0, x1)}, ${pt(y0, y1)}, {equal: true, polar: true})`);
    C.l(`pplot(Fr, a => (rr(a) * cos(a), rr(a) * sin(a)), (T0, T1), {width: 0.5, n: 2400})`);
    C.sec('the radius sweeps around (press play)');
    C.l('th0 = T0 + (T1 - T0) * t / 6');
    C.l('q0 = (rr(th0) * cos(th0), rr(th0) * sin(th0))');
    C.l('if isnan(rr(th0)) == 0 {');
    C.l(`  line(Fr.map((0, 0)), Fr.map(q0), {color: "${RED}", width: 0.3})`);
    C.l(`  dot(Fr.map(q0), {r: 0.9, color: "${RED}"})`);
    C.l(`  arc(Fr.map((0, 0)), 6, 0, th0 % (2 * pi), {color: "${RED}", width: 0.25})`);
    C.l(`  tex(${q(thl + ' = ')} + fmt(th0, 2), Fr.map((0, 0)) + (8 * cos(th0 % (2 * pi) / 2), 8 * sin(th0 % (2 * pi) / 2)), {size: 8, color: "${RED}", anchor: "w"})`);
    C.l('}');
    const left: Fact[] = [], right: Fact[] = [];
    if (dr) left.push({ head: 'Rate of change', eqs: [`\\frac{dr}{d${thl}} = ${texOf(dr)}`] });
    left.push({ head: 'Cartesian form', eqs: [`x = r\\cos ${thl},\\; y = r\\sin ${thl}`] });
    if (period) {
      let A = 0; const n = 4000, h = period / n;
      for (let i = 0; i <= n; i++) { const v = r(i * h); const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2; if (isFinite(v)) A += w * v * v; }
      A *= h / 3 / 2;
      right.push({ head: 'Closes after', eqs: [`${thl} = ${prettyNum(period, false)}`] });
      right.push({ head: 'Swept area', eqs: [`\\tfrac12\\int_0^{${prettyNum(period, false)}} r^2\\,d${thl} ${prettyEq(A)}`] });
    } else right.push({ head: 'Range shown', eqs: [`${thl} \\in [${prettyNum(range[0], false)}, ${prettyNum(range[1], false)}]`] });
    right.push({ head: 'Farthest from the origin', eqs: [`r_{\\max} ${prettyEq(Math.max(...xs.map((x, i) => Math.hypot(x, ys[i]))))}`] });
    factsBlock(C, cx, left, right);
    return { title: 'Polar curve', detected: 'polar curve' };
  },

  // ------------------------------------------------------------ parametric curves
  pcurve(s: Extract<Spec, { kind: 'pcurve' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const p = s.p, PV = namer(p), pl = symLabel(p, tex);
    const d3 = s.comps.length === 3;
    const cf = s.comps.map(c => compile(c, [p], P1(cx)));
    const Pf = (t: number) => { const v = cf.map(f => f(t)); return v.every(isFinite) ? v : null; };
    const trig = s.comps.some(c => hasFn(c, TRIG, p));
    let range = cx.domains[p]; let period: number | null = null;
    if (!range) { if (trig) { period = nm.closingPeriod(Pf, Math.PI, 24); range = [0, period ?? 4 * Math.PI]; } else range = [-2, 2]; }
    const pts: number[][] = []; for (let i = 0; i <= 3000; i++) { const v = Pf(range[0] + (range[1] - range[0]) * i / 3000); if (v) pts.push(v); }
    if (!pts.length) throw new MathError('the curve has no real points in the parameter range');
    const rg = [0, 1, 2].slice(0, s.comps.length).map(i => nm.niceRange(...nm.robustRange(pts.map(v => v[i]), 0, 1), 0.1));
    const sym = rg.map(r => nm.symmetricIfNear(r));
    const dP = tryDiff({ k: 'tuple', a: s.comps }, p);
    const title = d3 ? 'Space curve' : 'Parametric curve';
    header(C, cx, title, d3 ? `parametric curve in space, parameter ${pl.replace(/\\/g, '')}` : `parametric plane curve, parameter ${pl.replace(/\\/g, '')}`);
    C.sec('the curve and its velocity');
    C.l(`P(${PV}) = (${s.comps.map(code).join(', ')})`);
    if (dP) C.l(`dP(${PV}) = ${code(dP)}`);
    C.l(`T0 = ${nf(range[0])}`).l(`T1 = ${nf(range[1])}`);
    C.sec('figure');
    if (d3) {
      const ext = rg.map(r => r[1] - r[0]); const equal = Math.max(...ext) / Math.max(1e-9, Math.min(...ext)) < 4;
      C.l(`Fr = frame3d((105, 188), 90, ${pt(...sym[0])}, ${pt(...sym[1])}, ${pt(...sym[2])}${equal ? ', {equal: true}' : ''})`);
    } else C.l(`Fr = frame2d((30, 134), (150, 110), ${pt(...sym[0])}, ${pt(...sym[1])}, {equal: true})`);
    C.l(`pplot(Fr, P, (T0, T1), {width: 0.5, n: 2400${d3 ? `, color: "${BLUE}"` : ''}})`);
    C.sec('a point moves along the curve with its velocity arrow (press play)');
    C.l('tt = T0 + (T1 - T0) * t / 6');
    C.l('P0 = Fr.map(P(tt))');
    C.l(`dot(P0, {r: 0.95, color: "${RED}"})`);
    if (dP) {
      C.l('dir = Fr.map(P(tt) + dP(tt) * 0.001) - P0');
      C.l(`if len(dir) > 0 { arrow(P0, P0 + normalize(dir) * 14, {color: "${RED}", width: 0.4}) }`);
    }
    if (d3) C.l(`line(P0, Fr.map((P(tt).x, P(tt).y, Fr.floor)), {dash: 0.8, color: "${RED}", width: 0.2})`);
    C.l(`tex(${q(pl + ' = ')} + fmt(tt, 2), P0 + (0, 4.5${d3 ? ', 0' : ''}), {size: 8, color: "${RED}", anchor: "s"${d3 ? ', face: "viewer"' : ''}})`);
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(...pts[i].map((v, k) => v - pts[i - 1][k]));
    const left: Fact[] = [], right: Fact[] = [];
    if (dP && dP.k === 'tuple' && short(texOf(dP), 170)) left.push({ head: 'Velocity', eqs: [`${s.name}'(${pl}) = ${texOf(dP)}`] });
    if (dP && dP.k === 'tuple') {
      const sp = simplify(pow(add(...dP.a.map(c => pow(c, 2))), 0.5));
      if (short(texOf(sp), 120)) left.push({ head: 'Speed', eqs: [`\\left|${s.name}'(${pl})\\right| = ${texOf(sp)}`] });
    }
    right.push({ head: 'Parameter range', eqs: [`${pl} \\in [${prettyNum(range[0], false)}, ${prettyNum(range[1], false)}]${period ? ` \\; ${T('(closed curve)')}` : ''}`] });
    right.push({ head: 'Arc length', eqs: [`L ${prettyEq(L)}`] });
    factsBlock(C, cx, left, right);
    return { title, detected: 'parametric curve' };
  },

  // ------------------------------------------------------------ parametric surfaces
  psurf(s: Extract<Spec, { kind: 'psurf' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const u = s.u, v = s.v, U = namer(u), V = namer(v);
    const cf = s.comps.map(c => compile(c, [u, v], P1(cx)));
    const rangeFor = (w: string) => cx.domains[w] ?? (s.comps.some(c => hasFn(c, TRIG, w)) ? (w === 'phi' ? [0, Math.PI] : [0, 2 * Math.PI]) : [-1.5, 1.5]) as [number, number];
    const ur = rangeFor(u), vr = rangeFor(v);
    const pts: number[][] = [];
    for (let j = 0; j <= 50; j++) for (let i = 0; i <= 50; i++) { const a = ur[0] + (ur[1] - ur[0]) * i / 50, b = vr[0] + (vr[1] - vr[0]) * j / 50; const q0 = cf.map(f => f(a, b)); if (q0.every(isFinite)) pts.push(q0); }
    if (!pts.length) throw new MathError('the surface has no real points');
    const rg = [0, 1, 2].map(i => nm.symmetricIfNear(nm.niceRange(...nm.robustRange(pts.map(p => p[i]), 0, 1), 0.08)));
    const ext = rg.map(r => r[1] - r[0]); const equal = Math.max(...ext) / Math.max(1e-9, Math.min(...ext)) < 4;
    const ru = tryDiff({ k: 'tuple', a: s.comps }, u), rv = tryDiff({ k: 'tuple', a: s.comps }, v);
    header(C, cx, 'Parametric surface', `parametric surface, parameters ${symLabel(u, tex).replace(/\\/g, '')} and ${symLabel(v, tex).replace(/\\/g, '')}`);
    C.sec('the surface');
    C.l(`S(${U}, ${V}) = (${s.comps.map(code).join(', ')})`);
    C.l(`U0 = ${nf(ur[0])}`).l(`U1 = ${nf(ur[1])}`).l(`V0 = ${nf(vr[0])}`).l(`V1 = ${nf(vr[1])}`);
    C.sec('figure — orbit the view to see it in 3D');
    C.l(`Fr = frame3d((105, 188), 88, ${pt(...rg[0])}, ${pt(...rg[1])}, ${pt(...rg[2])}${equal ? ', {equal: true}' : ''})`);
    C.l('psurf(Fr, S, (U0, U1), (V0, V1), {n: 72, wire: 16})');
    C.sec('a grid curve sweeps across the surface (press play)');
    C.l('uu = U0 + (U1 - U0) * t / 6');
    C.l(`pplot(Fr, w => S(uu, w), (V0, V1), {color: "${RED}", width: 0.5, n: 300})`);
    // surface area
    let A = 0; const n = 120; const du = (ur[1] - ur[0]) / n, dv = (vr[1] - vr[0]) / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = ur[0] + (i + 0.5) * du, b = vr[0] + (j + 0.5) * dv;
      const p0 = cf.map(f => f(a, b)), pu = cf.map(f => f(a + du * 0.01, b)), pv = cf.map(f => f(a, b + dv * 0.01));
      const xu = pu.map((x, k) => (x - p0[k]) / (du * 0.01)), xv = pv.map((x, k) => (x - p0[k]) / (dv * 0.01));
      const cr = [xu[1] * xv[2] - xu[2] * xv[1], xu[2] * xv[0] - xu[0] * xv[2], xu[0] * xv[1] - xu[1] * xv[0]];
      const m = Math.hypot(...cr); if (isFinite(m)) A += m * du * dv;
    }
    const left: Fact[] = [], right: Fact[] = [];
    if (ru && rv && short(texOf(ru) + texOf(rv), 200)) left.push({ head: 'Tangent vectors', eqs: [`${s.name}_{${symLabel(u, tex)}} = ${texOf(ru)}`, `${s.name}_{${symLabel(v, tex)}} = ${texOf(rv)}`] });
    right.push({ head: 'Parameter ranges', eqs: [`${symLabel(u, tex)} \\in [${prettyNum(ur[0], false)}, ${prettyNum(ur[1], false)}],\\; ${symLabel(v, tex)} \\in [${prettyNum(vr[0], false)}, ${prettyNum(vr[1], false)}]`] });
    right.push({ head: 'Surface area', eqs: [`A ${prettyEq(A)}`] });
    factsBlock(C, cx, left, right);
    return { title: 'Parametric surface', detected: 'parametric surface' };
  },

  // ------------------------------------------------------------ vector fields
  field(s: Extract<Spec, { kind: 'field' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const d3 = s.comps.length === 3; const vars = s.vars; const VN = vars.map(namer);
    const R = vars.map(v => cx.domains[v] ?? (d3 ? [-2, 2] : [-3, 3])) as [number, number][];
    header(C, cx, 'Vector field', d3 ? 'vector field in space' : 'vector field in the plane');
    C.sec('the field');
    C.l(`Fv(${VN.join(', ')}) = (${s.comps.map(code).join(', ')})`);
    C.sec('figure');
    const left: Fact[] = [], right: Fact[] = [];
    const div = simplify(add(...s.comps.map((c, i) => tryDiff(c, vars[i]) ?? N(NaN))));
    if (d3) {
      C.l(`Fr = frame3d((105, 188), 88, ${pt(...R[0])}, ${pt(...R[1])}, ${pt(...R[2])}, {equal: true, labels: [${vars.map(v => q(symLabel(v, tex))).join(', ')}]})`);
      C.l('quiver(Fr, Fv, {n: 6})');
      const d = (i: number, j: number) => tryDiff(s.comps[i], vars[j]) ?? N(NaN);
      const curl = [sub(d(2, 1), d(1, 2)), sub(d(0, 2), d(2, 0)), sub(d(1, 0), d(0, 1))].map(c => simplify(c));
      left.push({ head: 'Divergence', eqs: [`\\nabla\\cdot ${s.name} = ${texOf(div)}`] });
      left.push({ head: 'Curl', eqs: [`\\nabla\\times ${s.name} = \\left(${curl.map(texOf).join(',\\; ')}\\right)`] });
      right.push({ head: 'Character', eqs: [T(curl.every(c => isZero(c, vars)) ? 'curl-free: conservative on simply connected regions' : 'has rotation (curl ≠ 0)'), T(isZero(div, vars) ? 'divergence-free (incompressible)' : 'has sources or sinks')] });
    } else {
      C.l(`Fr = frame2d((30, 134), (150, 110), ${pt(...R[0])}, ${pt(...R[1])}, {equal: true, xlabel: ${q(symLabel(vars[0], tex))}, ylabel: ${q(symLabel(vars[1], tex))}})`);
      C.l('streamlines(Fr, Fv, {n: 9})');
      C.l('quiver(Fr, Fv, {n: 17})');
      const curl = simplify(sub(tryDiff(s.comps[1], vars[0]) ?? N(NaN), tryDiff(s.comps[0], vars[1]) ?? N(NaN)));
      const P = compile(s.comps[0], vars, P1(cx)), Q = compile(s.comps[1], vars, P1(cx));
      const eqs = nm.solve2((a, b) => [P(a, b), Q(a, b)], [R[0][0], R[0][1], R[1][0], R[1][1]], 14);
      if (eqs.length && eqs.length <= 10) { C.c('equilibrium points (where the field vanishes)'); eqs.forEach(p => C.l(`dot(Fr.map(${pt(p[0], p[1])}), {r: 1, color: "${RED}"})`)); }
      left.push({ head: 'Divergence', eqs: [`\\nabla\\cdot ${s.name} = ${texOf(div)}`] });
      left.push({ head: 'Curl (scalar)', eqs: [`\\frac{\\partial Q}{\\partial ${symLabel(vars[0], tex)}} - \\frac{\\partial P}{\\partial ${symLabel(vars[1], tex)}} = ${texOf(curl)}`] });
      right.push({ head: 'Character', eqs: [T(isZero(curl, vars) ? 'conservative (curl-free)' : 'rotational (curl ≠ 0)'), T(isZero(div, vars) ? 'divergence-free' : 'has sources or sinks')] });
      if (eqs.length) right.push({ head: 'Equilibria', eqs: eqs.slice(0, 4).map(p => `(${prettyNum(p[0], false)},\\; ${prettyNum(p[1], false)})`) });
    }
    factsBlock(C, cx, left, right);
    return { title: 'Vector field', detected: 'vector field' };
  },

  // ------------------------------------------------------------ first-order ODE
  ode(s: Extract<Spec, { kind: 'ode' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const xs = s.x, ys = s.y, X = namer(xs), Y = namer(ys);
    const f = compile(s.f, [xs, ys], P1(cx));
    const auto = !depends(s.f, xs);
    let equil: number[] = [];
    if (auto) equil = nm.roots(y => f(0, y), -10, 10, 4000, 1e-9);
    let [x0, x1] = cx.domains[xs] ?? (auto ? [0, 6] : [-3, 3]);
    let [y0, y1] = cx.domains[ys] ?? (equil.length && equil.length <= 6 ? nm.niceRange(Math.min(...equil) - 1, Math.max(...equil) + 1, 0.15) : [-3, 3]);
    let starts = niceTicks(y0, y1, 7).vals.filter(v => v > y0 + 1e-9 && v < y1 - 1e-9);
    if (starts.length > 8) starts = starts.filter((_, i) => i % 2 === 0);
    const linear = isZero(tryDiff(tryDiff(s.f, ys) ?? N(NaN), ys) ?? N(NaN), [xs, ys]);
    const sep = (() => { for (let k = 0; k < 10; k++) { const a = Math.random() * 2 - 1, b = Math.random() * 2 - 1, c = Math.random() * 2 - 1, d = Math.random() * 2 - 1; const l = f(a, b) * f(c, d), r = f(a, d) * f(c, b); if (!isFinite(l) || Math.abs(l - r) > 1e-8 * (1 + Math.abs(l))) return false; } return true; })();
    header(C, cx, 'Differential equation', `first-order ODE ${s.lhs.replace(/\\frac\{d(\w+)\}\{d(\w+)\}/, 'd$1/d$2').replace(/\\/g, '')} = f(${xs}, ${ys})`, 6);
    C.sec('right-hand side f(x, y) of the equation');
    C.l(`f(${X}, ${Y}) = ${code(s.f)}`);
    C.sec('slope field and solution curves (RK4)');
    C.l(`Fr = frame2d((30, 134), (150, 110), ${pt(x0, x1)}, ${pt(y0, y1)}, {xlabel: ${q(symLabel(xs, tex))}, ylabel: ${q(symLabel(ys, tex))}})`);
    C.l('slopefield(Fr, f, {n: 23})');
    const xstart = auto ? x0 : (x0 <= 0 && x1 >= 0 ? 0 : x0);
    starts.forEach((y, i) => C.l(`solcurve(Fr, f, ${pt(xstart, y)}, {color: "${cmapHex(i / Math.max(1, starts.length - 1), 'warm')}", width: 0.42})`));
    if (equil.length && equil.length <= 8) { C.c('equilibrium solutions'); equil.filter(e => e >= y0 && e <= y1).forEach(e => C.l(`line(Fr.map(${pt(x0, e)}), Fr.map(${pt(x1, e)}), {dash: 1.2, color: "${GREEN}", width: 0.35})`)); }
    const left: Fact[] = [{ head: 'Equation', eqs: [`${s.lhs} = ${texOf(s.f)}`] }];
    left.push({ head: 'Type', eqs: [T([auto ? 'autonomous' : 'non-autonomous', linear ? 'linear' : 'nonlinear', sep ? 'separable' : ''].filter(Boolean).join(', '))] });
    const right: Fact[] = [];
    if (auto && equil.length) {
      const df = tryDiff(s.f, ys); const dff = df ? compile(df, [xs, ys], P1(cx)) : null;
      right.push({ head: 'Equilibria', eqs: equil.slice(0, 5).map(e => { const sl = dff ? dff(0, e) : NaN; return `${symLabel(ys, tex)} ${prettyEq(e)} \\; ${T(isFinite(sl) ? (sl < 0 ? '(stable)' : sl > 0 ? '(unstable)' : '(semi-stable)') : '')}`; }) });
    }
    right.push({ head: 'Initial values drawn', eqs: [`${symLabel(xs, tex)}_0 = ${prettyNum(xstart, false)},\\; ${symLabel(ys, tex)}_0 \\in \\{${starts.map(v => +v.toPrecision(3)).join(', ')}\\}`] });
    factsBlock(C, cx, left, right);
    return { title: 'Differential equation', detected: 'first-order ODE' };
  },

  // ------------------------------------------------------------ matrices as linear maps
  matrix(s: Extract<Spec, { kind: 'matrix' }>, cx: Ctx, C: Code) {
    const M = s.M as Extract<Node, { k: 'matrix' }>;
    const n = M.rows.length;
    if (n !== M.rows[0].length || (n !== 2 && n !== 3)) throw new MathError('only square 2×2 and 3×3 matrices can be drawn as linear maps');
    const vars = [...freeSyms(M)];
    const anim = vars.length === 1 ? vars[0] : null;
    const params = P1(cx);
    const val = M.rows.map(r => r.map(e => evalConst(e, anim ? { ...params, [anim]: 1 } : params)));
    if (val.flat().some(x => !isFinite(x))) throw new MathError('the matrix entries must be numbers');
    if (anim) cx.params = cx.params.filter(p => p !== anim);
    const title = 'Linear transformation';
    header(C, cx, title, `${n}×${n} matrix as a linear map${anim ? ` (animating ${anim})` : ''}`, 6);
    C.sec('the matrix');
    if (anim) C.l(`${namer(anim)} = ${hasFn(M, TRIG, anim) ? '2 * pi * t / 6' : '2 * t / 6'}    // animated parameter`);
    C.l(`A = mat(${M.rows.map(r => '(' + r.map(code).join(', ') + ')').join(', ')})`);
    if (!anim) { C.l('s = t > 0 ? ease(clamp(t / 4, 0, 1)) : 1    // at rest: the result; press play to morph from the identity to A').l('M = lerp(ident(), A, s)'); }
    else C.l('M = A');
    const left: Fact[] = [], right: Fact[] = [];
    const ev = nm.eig(val);
    if (n === 2) {
      const corners = [[-2, -2], [2, -2], [2, 2], [-2, 2], [0, 0]].map(([x, y]) => [val[0][0] * x + val[0][1] * y, val[1][0] * x + val[1][1] * y]);
      const ext = Math.max(2.5, ...corners.flat().map(Math.abs));
      const [a, b] = nm.niceRange(-ext, ext, 0.05);
      C.sec('figure: the grid, the unit square and the basis vectors after the map');
      C.l(`Fr = frame2d((30, 134), (150, 110), ${pt(a, b)}, ${pt(a, b)}, {equal: true, grid: false})`);
      C.l('for k in range(-2, 3) {');
      C.l('  line(Fr.map((k, -2)), Fr.map((k, 2)), {color: "#d5dbe3", width: 0.2})');
      C.l('  line(Fr.map((-2, k)), Fr.map((2, k)), {color: "#d5dbe3", width: 0.2})');
      C.l(`  line(Fr.map(M * (k, -2)), Fr.map(M * (k, 2)), {color: "#7fa7d9", width: 0.25})`);
      C.l(`  line(Fr.map(M * (-2, k)), Fr.map(M * (2, k)), {color: "#7fa7d9", width: 0.25})`);
      C.l('}');
      C.l(`poly([Fr.map(M * (0, 0)), Fr.map(M * (1, 0)), Fr.map(M * (1, 1)), Fr.map(M * (0, 1))], {fill: "${BLUE}", opacity: 0.18, stroke: "${BLUE}", width: 0.3})`);
      C.l(`arrow(Fr.map((0, 0)), Fr.map(M * (1, 0)), {color: "${RED}", width: 0.5})`);
      C.l(`arrow(Fr.map((0, 0)), Fr.map(M * (0, 1)), {color: "${GREEN}", width: 0.5})`);
      C.l(`tex("A\\mathbf{e}_1", Fr.map(M * (1, 0)) + (2, -2), {size: 9, color: "${RED}", anchor: "w"})`);
      C.l(`tex("A\\mathbf{e}_2", Fr.map(M * (0, 1)) + (2, 2), {size: 9, color: "${GREEN}", anchor: "w"})`);
      if (!anim) ev.filter(e => Math.abs(e.im) < 1e-12).slice(0, 2).forEach((e, i) => {
        const v = nm.eigvec(val, e.re); if (!v) return;
        const L = (b - a) * 0.48 / Math.max(Math.abs(v[0]), Math.abs(v[1]));
        C.l(`line(Fr.map(${pt(-v[0] * L, -v[1] * L)}), Fr.map(${pt(v[0] * L, v[1] * L)}), {dash: 1.2, color: "${PURPLE}", width: 0.3})    // eigen-direction ${i + 1}`);
      });
    } else {
      const corners: number[][] = []; for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) corners.push(val.map(r => r[0] * x + r[1] * y + r[2] * z));
      const ext = Math.max(1.2, ...corners.flat().map(Math.abs));
      const [a, b] = nm.niceRange(-ext, ext, 0.05);
      C.sec('figure: the unit cube and the basis vectors after the map');
      C.l(`Fr = frame3d((105, 188), 86, ${pt(a, b)}, ${pt(a, b)}, ${pt(a, b)}, {equal: true})`);
      C.l('V(x, y, z) = Fr.map(M * (x, y, z))');
      C.l('cubeface(p, u, w) = poly([V(p.x, p.y, p.z), V(p.x + u.x, p.y + u.y, p.z + u.z), V(p.x + u.x + w.x, p.y + u.y + w.y, p.z + u.z + w.z), V(p.x + w.x, p.y + w.y, p.z + w.z)], {fill: "#7fb3e6", opacity: 0.28, stroke: "#2f6fb8", width: 0.25})');
      C.l('X_ = (1, 0, 0)').l('Y_ = (0, 1, 0)').l('Z_ = (0, 0, 1)').l('O_ = (0, 0, 0)');
      C.l('cubeface(O_, X_, Y_)').l('cubeface(O_, Y_, Z_)').l('cubeface(O_, X_, Z_)').l('cubeface(Z_, X_, Y_)').l('cubeface(X_, Y_, Z_)').l('cubeface(Y_, X_, Z_)');
      [[RED, 'X_', 1], [GREEN, 'Y_', 2], [PURPLE, 'Z_', 3]].forEach(([c, v, i]) => {
        C.l(`arrow(Fr.map((0, 0, 0)), Fr.map(M * ${v}), {color: "${c}", width: 0.45})`);
        C.l(`tex("A\\mathbf{e}_${i}", Fr.map(M * ${v} * 1.12), {size: 9, color: "${c}", face: "viewer"})`);
      });
    }
    const det = n === 2 ? val[0][0] * val[1][1] - val[0][1] * val[1][0] : nm.eig(val).reduce((p, e) => p * Math.hypot(e.re, e.im) * (e.im === 0 ? Math.sign(e.re) : 1), 1);
    const detS = anim ? simplify(n === 2 ? sub(mul(M.rows[0][0], M.rows[1][1]), mul(M.rows[0][1], M.rows[1][0])) : N(det)) : null;
    left.push({ head: 'Determinant', eqs: [anim ? `\\det A = ${texOf(detS!)}` : `\\det A ${prettyEq(det)}`, T(anim ? '' : Math.abs(det) < 1e-12 ? 'singular: flattens space' : det < 0 ? 'orientation is reversed' : 'orientation is preserved')].filter(x => x !== T('')) });
    if (!anim) {
      const tr = val.reduce((s0, r, i) => s0 + r[i], 0);
      left.push({ head: 'Trace', eqs: [`\\operatorname{tr} A ${prettyEq(tr)}`] });
      if (n === 2) left.push({ head: 'Characteristic polynomial', eqs: [`\\lambda^2 - ${prettyNum(tr, false)}\\lambda + ${prettyNum(det, false)} = 0`.replace('+ -', '- ').replace('- -', '+ ')] });
      right.push({ head: 'Eigenvalues', eqs: ev.map((e, i) => `\\lambda_${i + 1} ${Math.abs(e.im) < 1e-12 ? prettyEq(e.re) : `\\approx ${+e.re.toPrecision(4)} ${e.im < 0 ? '-' : '+'} ${+Math.abs(e.im).toPrecision(4)}i`}`) });
      const vecs = ev.filter(e => Math.abs(e.im) < 1e-12).map(e => nm.eigvec(val, e.re)).filter(Boolean) as number[][];
      if (vecs.length) right.push({ head: 'Eigenvectors (unit)', eqs: vecs.slice(0, 3).map((v, i) => `\\mathbf{v}_${i + 1} \\approx (${v.map(x => +x.toPrecision(3)).join(',\\; ')})`) });
    }
    factsBlock(C, cx, left, right);
    return { title, detected: 'linear map' };
  },

  // ------------------------------------------------------------ constant vectors
  vector(s: Extract<Spec, { kind: 'vector' }>, cx: Ctx, C: Code) {
    const v = s.comps.map(c => evalConst(c, P1(cx)));
    if (v.some(x => !isFinite(x))) throw new MathError('vector components must evaluate to numbers');
    const d3 = v.length === 3; const m = Math.hypot(...v);
    const ext = Math.max(1, ...v.map(Math.abs)); const [a, b] = nm.niceRange(-ext, ext, 0.15);
    header(C, cx, 'Vector', d3 ? 'a vector in space' : 'a vector in the plane');
    C.sec('figure');
    if (d3) {
      C.l(`Fr = frame3d((105, 188), 86, ${pt(a, b)}, ${pt(a, b)}, ${pt(a, b)}, {equal: true, style: "axes"})`);
      C.l(`arrow(Fr.map((0, 0, 0)), Fr.map(${pt(...v)}), {color: "${BLUE}", width: 0.55})`);
      C.l(`line(Fr.map(${pt(...v)}), Fr.map(${pt(v[0], v[1], 0)}), {dash: 0.8, color: "#888", width: 0.2})`);
      C.l(`line(Fr.map((0, 0, 0)), Fr.map(${pt(v[0], v[1], 0)}), {dash: 0.8, color: "#888", width: 0.2})`);
      C.l(`tex(${q(s.name)}, Fr.map(${pt(...v.map(x => x * 1.1))}), {size: 11, color: "${BLUE}", face: "viewer"})`);
    } else {
      C.l(`Fr = frame2d((30, 134), (150, 110), ${pt(a, b)}, ${pt(a, b)}, {equal: true})`);
      C.l(`arrow(Fr.map((0, 0)), Fr.map(${pt(...v)}), {color: "${BLUE}", width: 0.55})`);
      C.l(`line(Fr.map(${pt(...v)}), Fr.map(${pt(v[0], 0)}), {dash: 0.8, color: "#888", width: 0.2})`);
      C.l(`tex(${q(s.name)}, Fr.map(${pt(...v)}) + (2, 2), {size: 11, color: "${BLUE}", anchor: "sw"})`);
    }
    const left: Fact[] = [{ head: 'Magnitude', eqs: [`\\left|${s.name}\\right| ${prettyEq(m)}`] }];
    if (m > 0) left.push({ head: 'Unit vector', eqs: [`\\hat{\\mathbf{u}} \\approx (${v.map(x => +(x / m).toPrecision(3)).join(',\\; ')})`] });
    const right: Fact[] = [{ head: 'Direction angles', eqs: d3 ? ['\\alpha', '\\beta', '\\gamma'].map((g, i) => `${g} ${prettyEq(Math.acos(v[i] / m) * 180 / Math.PI)}^\\circ`) : [`\\theta ${prettyEq(Math.atan2(v[1], v[0]) * 180 / Math.PI)}^\\circ`] }];
    factsBlock(C, cx, left, right);
    return { title: 'Vector', detected: 'vector' };
  },

  // ------------------------------------------------------------ plain values
  value(s: Extract<Spec, { kind: 'value' }>, cx: Ctx, C: Code) {
    const v = evalConst(s.v, P1(cx));
    header(C, cx, 'Value', 'a constant expression — evaluated');
    C.sec('result');
    C.l(`tex(${q(`${s.name ? s.name + ' ' : ''}${isFinite(v) ? prettyEq(v) : '\\text{undefined}'}`)}, (105, 200), {size: 30})`);
    if (isFinite(v)) C.l(`tex(${q(`\\approx ${+v.toPrecision(12)}`)}, (105, 180), {size: 13, color: "#666"})`);
    factsBlock(C, cx, [{ head: 'Simplified', eqs: [texOf(s.v)] }], []);
    return { title: 'Value', detected: 'value' };
  },

  // ------------------------------------------------------------ one-variable equations
  solve1(s: Extract<Spec, { kind: 'solve1' }>, cx: Ctx, C: Code, tex: Map<string, string>) {
    const xv = s.x, X = namer(xv), xl = symLabel(xv, tex);
    const lf = compile(s.l, [xv], P1(cx)), rf = compile(s.r, [xv], P1(cx));
    const h = (x: number) => lf(x) - rf(x);
    const wide = nm.roots(h, -50, 50, 20000, 1e-6);
    let [x0, x1] = cx.domains[xv] ?? (wide.length && wide.length < 20 ? nm.symmetricIfNear(nm.niceRange(Math.min(...wide), Math.max(...wide), 0.6)) : [-5, 5]);
    if (x1 - x0 < 2) { const c = (x0 + x1) / 2; x0 = c - 2; x1 = c + 2; }
    const rts = nm.roots(h, x0, x1, 6000, 1e-6);
    const ys: number[] = []; for (let i = 0; i <= 800; i++) { const x = x0 + (x1 - x0) * i / 800; ys.push(lf(x), rf(x)); }
    let [y0, y1] = nm.symmetricIfNear(nm.niceRange(...nm.robustRange(ys), 0.12));
    header(C, cx, 'Solving an equation', 'one-variable equation — solved graphically');
    C.sec('both sides as functions');
    C.l(`f(${X}) = ${code(s.l)}`).l(`g(${X}) = ${code(s.r)}`);
    C.sec('figure: solutions are where the two graphs cross');
    C.l(`Fr = frame2d((30, 134), (150, 110), ${pt(x0, x1)}, ${pt(y0, y1)}, {xlabel: ${q(xl)}, ylabel: "y"})`);
    C.l(`fplot(Fr, f, {width: 0.5, color: "${BLUE}"})`).l(`fplot(Fr, g, {width: 0.5, color: "${ORANGE}"})`);
    rts.slice(0, 12).forEach(r => { const y = lf(r); if (isFinite(y)) { C.l(`dot(Fr.map(${pt(r, y)}), {r: 0.9, color: "${RED}"})`); C.l(`line(Fr.map(${pt(r, y)}), Fr.map(${pt(r, Math.min(y1, Math.max(y0, 0)))}), {dash: 0.8, color: "${RED}", width: 0.22})`); } });
    factsBlock(C, cx,
      [{ head: 'The two sides', eqs: [`\\color{${BLUE}}{y = ${texOf(s.l)}}`, `\\color{${ORANGE}}{y = ${texOf(s.r)}}`] }],
      [{ head: rts.length === 1 ? 'Solution' : 'Solutions', eqs: rts.length ? rts.slice(0, 6).map(r => `${xl} ${prettyEq(r)}`) : [T('no real solutions in view')] }]);
    return { title: 'Solving an equation', detected: 'equation in one variable' };
  },

  // ------------------------------------------------------------ f(x, y, z)
  scalar3(s: Extract<Spec, { kind: 'scalar3' }>, cx: Ctx, C: Code) {
    const vars = s.vars; const f = compile(s.f, vars, P1(cx));
    const vals: number[] = []; for (let i = 0; i < 2000; i++) vals.push(f(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2));
    const sorted = vals.filter(isFinite).sort((a, b) => a - b);
    const c1 = +nm.percentile(sorted, 0.35).toPrecision(2), c2 = +nm.percentile(sorted, 0.7).toPrecision(2);
    header(C, cx, 'Level surfaces', 'scalar field f(x, y, z) shown by two level surfaces');
    C.sec('the field');
    C.l(`f(${vars.map(namer).join(', ')}) = ${code(s.f)}`);
    C.sec('figure');
    C.l('Fr = frame3d((105, 188), 88, (-2, 2), (-2, 2), (-2, 2), {equal: true})');
    C.l(`isoplot(Fr, f, {level: ${nf(c1)}, n: 36})`);
    C.l(`isoplot(Fr, f, {level: ${nf(c2)}, n: 36, fill: "${ORANGE}", opacity: 0.45})`);
    const g = vars.map(v => tryDiff(s.f, v));
    factsBlock(C, cx,
      g.every(Boolean) ? [{ head: 'Gradient', eqs: [`\\nabla f = \\left(${g.map(x => texOf(x!)).join(',\\; ')}\\right)`] }] : [],
      [{ head: 'Levels drawn', eqs: [`f = ${c1}\\;${T('(colored)')}`, `f = ${c2}\\;${T('(orange)')}`] }]);
    return { title: 'Level surfaces', detected: 'scalar field' };
  },
};

function hasFnDeep(n: Node, k: string): boolean { if (n.k === k) return true; return children(n).some(c => hasFnDeep(c, k)); }

function defaultXRange(fns: Fn[], trig: boolean): [number, number] {
  const L = trig ? 2 * Math.PI : 5;
  const defined = (a: number, b: number) => { let c = 0; for (let i = 0; i <= 200; i++) { const x = a + (b - a) * i / 200; if (fns.some(f => isFinite(f(x)))) c++; } return c / 201; };
  const left = defined(-L, -1e-9), right = defined(1e-9, L);
  if (left < 0.1 && right > 0.4) return trig ? [0, 2 * L] : nm.niceRange(0, 8, 0.04);
  if (right < 0.1 && left > 0.4) return trig ? [-2 * L, 0] : nm.niceRange(-8, 0, 0.04);
  if (trig) return [-L, L];
  // frame the interesting features (roots and turning points) if there are a few
  const f = fns[0]; const feats: number[] = [];
  feats.push(...nm.roots(f, -12, 12, 4000, 1e-9));
  feats.push(...nm.extrema(f, null, -12, 12).map(e => e.x));
  const fs = feats.filter(x => Math.abs(x) < 11.9);
  if (fs.length && fs.length <= 12) {
    const lo = Math.min(...fs), hi = Math.max(...fs); const span = Math.max(hi - lo, 2);
    return nm.symmetricIfNear(nm.niceRange(lo - 0.55 * span, hi + 0.55 * span, 0));
  }
  return [-L, L];
}

/** conic section classification for quadratic G(x, y) */
function conicOf(G: Fn): { name: string; facts: string[] } | null {
  const F = G(0, 0), a1 = G(1, 0), a2 = G(-1, 0), c1 = G(0, 1), c2 = G(0, -1), b = G(1, 1);
  const A = (a1 + a2) / 2 - F, D = (a1 - a2) / 2, C = (c1 + c2) / 2 - F, E = (c1 - c2) / 2, B = b - A - C - D - E - F;
  const Q = (x: number, y: number) => A * x * x + B * x * y + C * y * y + D * x + E * y + F;
  for (let k = 0; k < 10; k++) { const x = Math.random() * 6 - 3, y = Math.random() * 6 - 3; const g = G(x, y); if (!isFinite(g) || Math.abs(g - Q(x, y)) > 1e-7 * (1 + Math.abs(g))) return null; }
  if (Math.abs(A) + Math.abs(B) + Math.abs(C) < 1e-12) return null;
  const disc = B * B - 4 * A * C; const r = (v: number) => prettyNum(v, false);
  if (Math.abs(disc) < 1e-10) return { name: 'parabola', facts: [`B^2 - 4AC = 0`] };
  if (disc > 0) return { name: 'hyperbola', facts: [`B^2 - 4AC ${prettyEq(disc)} > 0`] };
  const det = 4 * A * C - B * B; const cx = (B * E - 2 * C * D) / det, cy = (B * D - 2 * A * E) / det; const k = Q(cx, cy);
  if (Math.sign(k) === Math.sign(A) && Math.abs(k) > 1e-12) return { name: 'empty conic', facts: [T('no real points')] };
  if (Math.abs(B) < 1e-12 && Math.abs(A - C) < 1e-12) return { name: 'circle', facts: [`${T('center ')} (${r(cx)},\\, ${r(cy)})`, `${T('radius ')} ${prettyNum(Math.sqrt(-k / A), false)}`] };
  return { name: 'ellipse', facts: [`B^2 - 4AC ${prettyEq(disc)} < 0`, `${T('center ')} (${r(cx)},\\, ${r(cy)})`] };
}
/** quadric surface classification for quadratic G(x, y, z) */
function quadricOf(G: Fn): { name: string; facts: string[] } | null {
  const h = 1;
  const f0 = G(0, 0, 0);
  const e = (i: number) => [0, 1, 2].map(j => (j === i ? h : 0));
  const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const p = G(...(e(i) as [number, number, number])), m = G(...(e(i).map(x => -x) as [number, number, number]));
    g[i] = (p - m) / 2; H[i][i] = p + m - 2 * f0;
  }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    const v = [0, 0, 0]; v[i] = 1; v[j] = 1;
    const pp = G(v[0], v[1], v[2]);
    H[i][j] = H[j][i] = pp - f0 - g[i] - g[j] - (H[i][i] + H[j][j]) / 2;
  }
  const Q = (x: number[]) => f0 + g[0] * x[0] + g[1] * x[1] + g[2] * x[2] + 0.5 * x.reduce((s, xi, i) => s + x.reduce((s2, xj, j) => s2 + H[i][j] * xi * xj, 0), 0);
  for (let k = 0; k < 10; k++) { const x = [0, 0, 0].map(() => Math.random() * 4 - 2); const v = G(x[0], x[1], x[2]); if (!isFinite(v) || Math.abs(v - Q(x)) > 1e-7 * (1 + Math.abs(v))) return null; }
  const ev = nm.eig(H).map(e => e.re);
  const tol = 1e-9 * Math.max(1, ...ev.map(Math.abs));
  const pos = ev.filter(x => x > tol).length, neg_ = ev.filter(x => x < -tol).length, zero = 3 - pos - neg_;
  if (zero === 3) return null;
  if (zero === 0) {
    // centre and value there
    const inv = invert3(H); if (!inv) return null;
    const c = inv.map(r => -(r[0] * g[0] + r[1] * g[1] + r[2] * g[2]));
    let k = Q(c); let p = pos, n = neg_;
    if (n > p) { k = -k; [p, n] = [n, p]; }
    const center = `${T('center ')} (${c.map(v => prettyNum(v, false)).join(',\\, ')})`;
    if (n === 0) { if (k < -1e-12) return { name: Math.max(...ev) - Math.min(...ev) < 1e-9 ? 'sphere' : 'ellipsoid', facts: [center] }; return { name: 'degenerate quadric', facts: [T('a single point or no real points')] }; }
    if (Math.abs(k) < 1e-9) return { name: 'cone', facts: [center] };
    return { name: k < 0 ? 'hyperboloid of one sheet' : 'hyperboloid of two sheets', facts: [center] };
  }
  if (zero === 1) {
    const sameSign = pos === 2 || neg_ === 2;
    // is there a linear term along the null direction?
    const i0 = ev.findIndex(x => Math.abs(x) <= tol);
    const nv = nm.eigvec(H, ev[i0]) ?? [0, 0, 1];
    const lin = Math.abs(nv[0] * g[0] + nv[1] * g[1] + nv[2] * g[2]) > 1e-9;
    if (lin) return { name: sameSign ? 'elliptic paraboloid' : 'hyperbolic paraboloid (saddle)', facts: [T(sameSign ? 'bowl-shaped' : 'saddle-shaped')] };
    return { name: sameSign ? 'elliptic cylinder' : 'hyperbolic cylinder', facts: [T('extends forever along one direction')] };
  }
  return { name: 'parabolic cylinder', facts: [T('extends forever along one direction')] };
}
function invert3(m: number[][]): number[][] | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}

export { MODEL_EXAMPLES } from './examples';
