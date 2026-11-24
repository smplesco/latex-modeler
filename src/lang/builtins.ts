// Built-in functions of the .bd language: math, transforms, document and marks.
import { Vec, Mat, binop, isObj, typeName, show } from './values';
import { plotBuiltins } from './plots';
import { extraBuiltins } from './extras';

import { PAGES, PAGE_STYLES, STAGES } from './pages';
export { PAGES, PAGE_STYLES, STAGES };

export function num(v: any, what: string): number { if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`${what} must be a number, got ${typeName(v)}`); return v; }
export function vec(v: any, what: string): Vec { if (!(v instanceof Vec)) throw new Error(`${what} must be a point like (x, y) or (x, y, z), got ${typeName(v)}`); return v; }
export function splitArgs(args: any[]): [any[], any] {
  let opts: any = {}; const rest = [...args];
  if (rest.length && isObj(rest[rest.length - 1])) opts = rest.pop();
  return [rest, opts];
}
export function collectPts(rest: any[], what: string) {
  const pts: any = [];
  const take = (p: Vec) => { pts.push(p.v3()); pts.fig ||= p.fig; };
  for (const a of rest) {
    if (a instanceof Vec) take(a);
    else if (Array.isArray(a)) for (const p of a) {
      if (p instanceof Vec) take(p);
      else if (Array.isArray(p)) p.forEach(q => q instanceof Vec && take(q));
      else throw new Error(`${what}: list items must be points, got ${typeName(p)}`);
    }
    else if (typeof a === 'string') continue;
    else if (a !== null) throw new Error(`${what}: expected points, got ${typeName(a)}`);
  }
  return pts as number[][] & { fig?: number };
}
export const rotM = {
  x: (a: number) => new Mat([[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]]),
  y: (a: number) => new Mat([[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]]),
  z: (a: number) => new Mat([[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]]),
};
/** z-up model → page coordinates (x right, y up, z toward the reader). yaw turns the model, tilt looks down on it. */
export function axoMat(yaw: number, tilt: number) {
  const S = new Mat([[1, 0, 0], [0, 0, 1], [0, -1, 0]]);
  return rotM.x(tilt).mulM(S).mulM(rotM.z(-Math.PI / 2 - yaw));
}

// special functions
export function gamma(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}
export function erf(x: number) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const fact = (n: number) => (Number.isInteger(n) && n >= 0 && n <= 170) ? (() => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; })() : gamma(n + 1);

export function makeBuiltins(ctx: any): Record<string, any> {
  // line: where the user wrote the call (outermost user-function call site); inner: the line that actually drew it
  // on a deck, only the slide being shown draws (marks before the first slide() are on every slide)
  const offSlide = () => ctx.slides && ctx.slides.length > 0 && ctx.slideNo >= 0 && ctx.slideNo !== (ctx.slideWant ?? 0);
  const add = (p: any, fig?: number) => {
    if (offSlide()) return null;
    p.order = ctx.order++; p.inner = ctx.line; p.line = ctx.sites && ctx.sites.length ? ctx.sites[0] : ctx.line;
    p.fig = fig || 0; if (ctx.dyn) p.dyn = ctx.dyn;
    if (ctx.role) { p.role = ctx.role.role; p.frame = ctx.role.frame; }
    if (ctx.curHook !== undefined) p.hook = ctx.curHook;
    ctx.prims.push(p); return null;
  };
  const ink = (o: any) => o.color ?? ctx.defaults.color ?? ctx.pageStyle().ink;
  const W = (o: any) => o.width !== undefined ? num(o.width, 'width') : ctx.defaults.width;
  const m = Math;
  const lerpAny = (a: any, b: any, s: number) => typeof a === 'number' ? a + (b - a) * s : binop('+', a, binop('*', binop('-', b, a), s));
  const fn = (f: (...a: number[]) => number) => (...a: any[]) => { a.forEach((x, i) => num(x, 'argument ' + (i + 1))); return f(...a); };
  const B: Record<string, any> = {
    pi: m.PI, tau: m.PI * 2, inf: Infinity, nan: NaN,
    sin: fn(m.sin), cos: fn(m.cos), tan: fn(m.tan), asin: fn(m.asin), acos: fn(m.acos), atan: fn(m.atan), atan2: fn(m.atan2),
    sec: fn(x => 1 / m.cos(x)), csc: fn(x => 1 / m.sin(x)), cot: fn(x => 1 / m.tan(x)),
    asec: fn(x => m.acos(1 / x)), acsc: fn(x => m.asin(1 / x)), acot: fn(x => m.atan(1 / x)),
    sinh: fn(m.sinh), cosh: fn(m.cosh), tanh: fn(m.tanh), asinh: fn(m.asinh), acosh: fn(m.acosh), atanh: fn(m.atanh),
    sech: fn(x => 1 / m.cosh(x)), csch: fn(x => 1 / m.sinh(x)), coth: fn(x => 1 / m.tanh(x)),
    sqrt: fn(m.sqrt), cbrt: fn(m.cbrt), exp: fn(m.exp), log: fn(m.log), log10: fn(m.log10), log2: fn(m.log2),
    floor: fn(m.floor), ceil: fn(m.ceil), round: fn(m.round), sign: fn(m.sign), frac: fn(x => x - m.floor(x)),
    gamma: fn(gamma), fact: fn(fact), erf: fn(erf), isnan: (x: any) => +(typeof x !== 'number' || !isFinite(x)),
    sinc: fn(x => x === 0 ? 1 : m.sin(x) / x),
    abs: (v: any) => v instanceof Vec ? new Vec(v.c.map(m.abs), v.fig) : m.abs(num(v, 'abs')),
    min: (...a: any[]) => m.min(...(Array.isArray(a[0]) ? a[0] : a)), max: (...a: any[]) => m.max(...(Array.isArray(a[0]) ? a[0] : a)),
    clamp: fn((x, a, b) => m.min(b, m.max(a, x))),
    lerp: (a: any, b: any, s: any) => lerpAny(a, b, num(s, 'lerp amount')), mix: (a: any, b: any, s: any) => lerpAny(a, b, num(s, 'mix amount')),
    smoothstep: fn((a, b, x) => { const u = m.min(1, m.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); }),
    ease: fn(x => { x = m.min(1, m.max(0, x)); return x < .5 ? 4 * x * x * x : 1 - m.pow(-2 * x + 2, 3) / 2; }),
    rad: fn(d => d * m.PI / 180), deg: fn(r => r * 180 / m.PI),
    vec: (...a: any[]) => new Vec(a.map((x, i) => num(x, 'component ' + (i + 1)))),
    cross: (a: any, b: any) => { vec(a, 'cross'); vec(b, 'cross'); const [x, y, z] = a.v3(), [u, v, w] = b.v3(); return new Vec([y * w - z * v, z * u - x * w, x * v - y * u], a.fig || b.fig); },
    norm: (a: any) => m.hypot(...vec(a, 'norm').c),
    len: (a: any) => a instanceof Vec ? m.hypot(...a.c) : (Array.isArray(a) || typeof a === 'string') ? a.length : num(a, 'len'),
    normalize: (a: any) => { const l = m.hypot(...vec(a, 'normalize').c) || 1; return new Vec(a.c.map((x: number) => x / l), a.fig); },
    range: (a: any, b?: any, s = 1) => {
      num(a, 'range start'); if (b === undefined) { b = a; a = 0; } const r: number[] = [];
      for (let x = a; s > 0 ? x < b - 1e-12 : x > b + 1e-12; x += s) { r.push(x); if (r.length > 1e5) throw new Error('range too large'); }
      return r;
    },
    linspace: (a: any, b: any, n = 50) => { num(a, 'a'); num(b, 'b'); n = m.max(2, m.floor(num(n, 'n'))); return Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1)); },
    map: (list: any, f: any) => { if (!Array.isArray(list)) throw new Error('map: first argument must be a list'); return list.map((x, i) => ctx.call(f, [x, i])); },
    sum: (list: any) => { if (!Array.isArray(list)) throw new Error('sum needs a list'); return list.length ? list.reduce((a, b) => binop('+', a, b)) : 0; },
    prod: (list: any) => { if (!Array.isArray(list)) throw new Error('prod needs a list'); return list.reduce((a, b) => binop('*', a, b), 1); },
    str: (v: any) => show(v),
    fmt: (x: any, d = 2) => { const v = num(x, 'fmt'); const s = v.toFixed(m.max(0, m.min(10, d))); return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s; },
    print: (...a: any[]) => { ctx.out.push({ line: ctx.line, text: a.map(show).join(' ') }); return null; },
    rgb: fn(((r, g, b) => `rgb(${m.round(r)}, ${m.round(g)}, ${m.round(b)})`) as any),
    hsl: fn(((h, s, l) => `hsl(${h}, ${s}%, ${l}%)`) as any),
    // ---- matrices & transforms
    mat: (...rows: any[]) => {
      const r = rows.map((v, i) => vec(v, 'matrix row ' + (i + 1)).c);
      const n = r.length; if (n < 2 || n > 3) throw new Error('mat needs 2 or 3 rows');
      const M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M[i][j] = r[i][j] ?? 0;
      return new Mat(M);
    },
    ident: () => new Mat([[1, 0, 0], [0, 1, 0], [0, 0, 1]]),
    det: (M: any) => { if (!(M instanceof Mat)) throw new Error('det needs a matrix'); const a = M.m; return a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]); },
    transpose: (M: any) => { if (!(M instanceof Mat)) throw new Error('transpose needs a matrix'); return new Mat([0, 1, 2].map(i => [0, 1, 2].map(j => M.m[j][i]))); },
    col: (M: any, j: any) => { if (!(M instanceof Mat)) throw new Error('col needs a matrix'); return new Vec([M.m[0][j], M.m[1][j], M.m[2][j]]); },
    rotx: fn(a => rotM.x(a) as any), roty: fn(a => rotM.y(a) as any), rotz: fn(a => rotM.z(a) as any),
    axo: (yaw = m.PI / 4, tilt = m.atan(1 / m.SQRT2)) => axoMat(num(yaw, 'axo yaw'), num(tilt, 'axo tilt')),
    iso: () => axoMat(m.PI / 4, m.atan(1 / m.SQRT2)),
    apply: (M: any, v: any) => { if (!(M instanceof Mat)) throw new Error('apply: first argument must be a matrix'); return M.mulV(vec(v, 'apply')); },
    onpage: (R: any, origin: any, scale = 10, lift = 0) => {
      if (!(R instanceof Mat)) throw new Error('onpage: first argument must be a rotation, e.g. axo(rad(38), rad(22))');
      const [ox, oy, oz] = vec(origin, 'onpage origin').v3(); num(scale, 'onpage scale'); num(lift, 'onpage lift');
      const fig = ++ctx.figs;
      // remembered so the Figure Explorer can open hand-drawn 3D figures and map points back to model space
      ctx.figMeta[fig] = { dim: 3, free: true, R: R.m.map((r: number[]) => [...r]), o: [ox, oy, oz + lift], s: scale, line: ctx.sites && ctx.sites.length ? ctx.sites[0] : ctx.line };
      return (p: any) => { const q = R.mulV(new Vec(vec(p, 'projected point').v3())).c; return new Vec([ox + scale * q[0], oy + scale * q[1], oz + lift + scale * q[2]], fig); };
    },
    // ---- document
    page: (size: any = 'A4', style: any = 'paper', opts: any = {}) => {
      if (isObj(style)) { opts = style; style = 'paper'; }
      let wh: number[];
      if (size instanceof Vec) wh = [size.x, size.y];
      else {
        const s = String(size); const land = /\s*(landscape|L)$/i.test(s) && !/^(letter|legal)$/i.test(s);
        const key = s.replace(/\s*(landscape|L)$/i, '').trim();
        const base = PAGES[key] || PAGES[key.toUpperCase()] || PAGES[key.toLowerCase()];
        if (!base) throw new Error(`unknown page size "${s}" (try A3, A4, A5, A6, letter, legal, square, slide or (w, h))`);
        wh = land ? [base[1], base[0]] : base;
      }
      if (!PAGE_STYLES[style]) throw new Error(`unknown page style "${style}" (${Object.keys(PAGE_STYLES).join(', ')})`);
      if (!isObj(opts)) throw new Error('page: the third argument holds options, e.g. {stage: "desk"}');
      const stage = opts.stage ?? 'studio';
      if (!STAGES[stage]) throw new Error(`unknown stage "${stage}" (${Object.keys(STAGES).join(', ')})`);
      if (!(wh[0] > 0 && wh[1] > 0 && wh[0] <= 5000 && wh[1] <= 5000)) throw new Error('page size must be between 0 and 5000 mm');
      ctx.page = { w: wh[0], h: wh[1], style, stage }; return null;
    },
    set: (o: any) => { if (!isObj(o)) throw new Error('set needs options like {color: "#333", width: 0.3, size: 11}'); Object.assign(ctx.defaults, o); return null; },
    duration: (s: any) => { ctx.duration = m.max(0.1, num(s, 'duration')); return null; },
    view: (yaw = 0, pitch = 0, zoom = 1) => { if (offSlide()) return null; ctx.cam = { yaw: num(yaw, 'yaw'), pitch: num(pitch, 'pitch'), zoom: num(zoom, 'zoom') }; return null; },
    // ---- marks
    line: (...a: any[]) => {
      const [r, o] = splitArgs(a); const pts = collectPts(r, 'line'); if (pts.length < 2) throw new Error('line needs at least two points');
      return add({ kind: 'line', pts, color: ink(o), width: W(o), dash: o.dash, closed: !!o.closed, opacity: o.opacity ?? 1 }, pts.fig);
    },
    arrow: (...a: any[]) => {
      const [r, o] = splitArgs(a); const pts = collectPts(r, 'arrow'); if (pts.length < 2) throw new Error('arrow needs two points');
      const w = W(o); return add({ kind: 'arrow', a: pts[0], b: pts[pts.length - 1], color: ink(o), width: w, head: o.head ?? (1.1 + 3.4 * w), both: !!o.both, dash: o.dash }, pts.fig);
    },
    poly: (...a: any[]) => {
      const [r, o] = splitArgs(a); const pts = collectPts(r, 'poly'); if (pts.length < 3) throw new Error('poly needs at least three points');
      if (o.fill !== undefined || o.stroke === undefined) add({ kind: 'poly', pts, fill: o.fill ?? ink(o), opacity: o.opacity ?? 1 }, pts.fig);
      if (o.stroke !== undefined) add({ kind: 'line', pts, color: o.stroke, width: W(o), closed: true, opacity: 1, dash: o.dash }, pts.fig);
      return null;
    },
    rect: (p: any, size: any, o: any = {}) => {
      const [x, y, z] = vec(p, 'rect corner').v3(); const [w, h] = vec(size, 'rect size').v3();
      const pts = [[x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z]];
      if (o.fill !== undefined) add({ kind: 'poly', pts, fill: o.fill, opacity: o.opacity ?? 1 }, p.fig);
      if (o.fill === undefined || o.stroke !== undefined) add({ kind: 'line', pts, color: o.stroke ?? ink(o), width: W(o), closed: true, dash: o.dash, opacity: 1 }, p.fig);
      return null;
    },
    circle: (c: any, r: any, o: any = {}) => B.arc(c, r, 0, m.PI * 2, o),
    arc: (c: any, r: any, a0: any, a1: any, o: any = {}) => {
      const [x, y, z] = vec(c, 'center').v3(); num(r, 'radius'); num(a0, 'start angle'); num(a1, 'end angle');
      const n = m.max(8, m.ceil(m.abs(a1 - a0) / (m.PI * 2) * 128)); const pts: number[][] = [];
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([x + r * m.cos(a), y + r * m.sin(a), z]); }
      if (o.fill !== undefined) add({ kind: 'poly', pts, fill: o.fill, opacity: o.opacity ?? 1 }, c.fig);
      if (o.fill === undefined || o.stroke !== undefined) add({ kind: 'line', pts, color: o.stroke ?? ink(o), width: W(o), dash: o.dash, opacity: 1 }, c.fig);
      return null;
    },
    // dot(a, b) with two vectors → dot product; dot(p, {r, color}) → a filled dot mark
    dot: (p: any, o: any = {}) => {
      if (p instanceof Vec && o instanceof Vec) { const [x, y, z] = p.v3(), [u, v, w] = o.v3(); return x * u + y * v + z * w; }
      return add({ kind: 'dot', p: vec(p, 'dot').v3(), r: o.r ?? 0.6, color: ink(o) }, p.fig);
    },
    curve: (f: any, a: any, b: any, o: any = {}) => {
      num(a, 'curve start'); num(b, 'curve end'); const n = m.max(2, m.min(5000, o.n ?? 120)); const pts: number[][] = [];
      let fig = 0;
      for (let i = 0; i <= n; i++) { const p = ctx.call(f, [a + (b - a) * i / n]); pts.push(vec(p, 'curve function result').v3()); fig ||= p.fig; }
      return add({ kind: 'line', pts, color: ink(o), width: W(o), dash: o.dash, opacity: o.opacity ?? 1 }, fig);
    },
    surface: (f: any, ur: any, vr: any, o: any = {}) => {
      vec(ur, 'u range'); vec(vr, 'v range'); const n = m.max(2, m.min(200, o.n ?? 32)); const nv = m.max(2, m.min(200, o.nv ?? n));
      const pos: number[] = []; let fig = 0;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= n; i++) {
        const u = ur.x + (ur.y - ur.x) * i / n, v = vr.x + (vr.y - vr.x) * j / nv;
        const q = vec(ctx.call(f, [u, v]), 'surface function result'); fig ||= q.fig; pos.push(...q.v3());
      }
      const idx: number[] = []; const Wd = n + 1;
      for (let j = 0; j < nv; j++) for (let i = 0; i < n; i++) { const a = j * Wd + i, b = a + 1, c = a + Wd, d = c + 1; idx.push(a, b, d, a, d, c); }
      add({ kind: 'trimesh', pos, idx, color: o.fill ?? '#8ab4e8', opacity: o.opacity ?? 1, lit: true }, fig);
      const wire = o.wire ?? 0;
      if (wire > 0) {
        const seg: number[] = []; const at = (i: number, j: number) => pos.slice(3 * (j * Wd + i), 3 * (j * Wd + i) + 3);
        for (let k = 0; k <= wire; k++) {
          const i = m.round(k * n / wire), j = m.round(k * nv / wire);
          for (let q = 0; q < nv; q++) seg.push(...at(i, q), ...at(i, q + 1));
          for (let q = 0; q < n; q++) seg.push(...at(q, j), ...at(q + 1, j));
        }
        add({ kind: 'segs', pos: seg, color: o.wireColor ?? 'rgba(0,0,0,.5)', width: o.wireWidth ?? 0.15, opacity: 1 }, fig);
      }
      return null;
    },
    tex: (s: any, p: any, o: any = {}) => {
      if (typeof s !== 'string') s = show(s);
      let size = num(o.size ?? ctx.defaults.size, 'size');
      if (o.maxw !== undefined && ctx.measure) {
        const wEm = ctx.measure(s);
        if (wEm && wEm * size * 0.352778 > o.maxw) size = m.max(4, o.maxw / (wEm * 0.352778));
      }
      return add({
        kind: 'tex', src: s, pos: vec(p, 'tex position').v3(), size, color: ink(o),
        anchor: o.anchor ?? 'c', face: o.face ?? 'auto', rot: o.rot ?? 0, opacity: o.opacity ?? 1, display: !!o.display,
      }, p.fig);
    },
    text: (s: any, p: any, o: any = {}) => B.tex('\\text{' + String(s).replace(/([{}%$#&_])/g, '\\$1') + '}', p, o),
  };
  B.arrowh = B.arrow; B.polyline = B.line; B.path = B.line;
  Object.assign(B, plotBuiltins(ctx, add, ink, W, B));
  Object.assign(B, extraBuiltins(ctx, add, ink, W, B));
  return B;
}
