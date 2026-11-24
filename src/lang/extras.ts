// Interactive and presentation built-ins: sliders and toggles the reader can drag, slides with speaker notes,
// and simulation helpers (ODE solving, springs, seeded random numbers).
import { Vec, binop, isObj, typeName } from './values';
import { num, vec } from './builtins';

export interface Control { name: string; label: string; kind: 'slider' | 'toggle'; min: number; max: number; step: number; value: number; def: number; line: number }
export interface Slide { title: string; notes: string; line: number }

export function extraBuiltins(ctx: any, add: (p: any, fig?: number) => any, ink: (o: any) => string, W: (o: any) => number, B: any): Record<string, any> {
  const m = Math;
  const line = () => (ctx.sites && ctx.sites.length ? ctx.sites[0] : ctx.line);
  const control = (c: Control) => {
    if (ctx.controls.some((x: Control) => x.name === c.name)) throw new Error(`there is already a control called "${c.name}"`);
    if (ctx.controls.length >= 40) throw new Error('a page can have at most 40 sliders and toggles');
    const want = ctx.controlValues?.[c.name];
    let v = c.def;
    if (typeof want === 'number' && isFinite(want)) v = c.kind === 'toggle' ? (want ? 1 : 0) : m.min(c.max, m.max(c.min, want));
    c.value = v; ctx.controls.push(c); return v;
  };

  // ---- numbers you can drag: slider("k", 1, 0, 5) is 1 until the reader moves it
  const slider = (name: any, def: any, min: any = 0, max: any = 1, o: any = {}) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('slider needs a name first, e.g. slider("k", 1, 0, 5)');
    if (isObj(min)) { o = min; min = 0; max = 1; } else if (isObj(max)) { o = max; max = 1; }
    num(def, 'slider value'); num(min, 'slider minimum'); num(max, 'slider maximum');
    if (!(max > min)) throw new Error(`slider "${name}": the maximum (${max}) must be larger than the minimum (${min})`);
    const step = o.step !== undefined ? m.abs(num(o.step, 'slider step')) : 0;
    return control({ name: name.slice(0, 40), label: typeof o.label === 'string' ? o.label.slice(0, 120) : name.slice(0, 40), kind: 'slider', min, max, step, def: m.min(max, m.max(min, def)), value: def, line: line() });
  };
  const toggle = (name: any, def: any = 0, o: any = {}) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('toggle needs a name first, e.g. toggle("grid", 1)');
    if (isObj(def)) { o = def; def = 0; }
    return control({ name: name.slice(0, 40), label: typeof o.label === 'string' ? o.label.slice(0, 120) : name.slice(0, 40), kind: 'toggle', min: 0, max: 1, step: 1, def: def ? 1 : 0, value: 0, line: line() });
  };

  // ---- slides: everything after slide(...) belongs to that slide, everything before the first one is on every slide
  const slide = (title: any = '', o: any = {}) => {
    if (isObj(title)) { o = title; title = ''; }
    if (ctx.slides.length >= 200) throw new Error('a deck can have at most 200 slides');
    ctx.slides.push({ title: String(title).slice(0, 200), notes: typeof o.notes === 'string' ? o.notes.slice(0, 5000) : '', line: line() });
    ctx.slideNo = ctx.slides.length - 1;
    return ctx.slideNo;
  };
  const notes = (s: any) => {
    if (!ctx.slides.length) throw new Error('notes() belongs to a slide: call slide("Title") first');
    const cur: Slide = ctx.slides[ctx.slides.length - 1];
    cur.notes = (cur.notes ? cur.notes + '\n' : '') + String(s).slice(0, 5000); return null;
  };

  // ---- simulation
  /** y' = f(t, y) by classic Runge–Kutta; y can be a number or a vector like (x, v) */
  const rk4 = (f: any, y: any, t0: number, t1: number, n: number) => {
    const h = (t1 - t0) / n; const out = [y]; let t = t0;
    const add2 = (a: any, b: any, s: number) => binop('+', a, binop('*', b, s));
    const check = (d: any) => { if (typeof d !== 'number' && !(d instanceof Vec)) throw new Error(`ode: the function must return a number or a vector, got ${typeName(d)}`); return d; };
    for (let i = 0; i < n; i++) {
      if (++ctx.steps > 8e6) throw new Error('execution limit reached (simulation too long?)');
      const k1 = check(ctx.call(f, [t, y]));
      const k2 = check(ctx.call(f, [t + h / 2, add2(y, k1, h / 2)]));
      const k3 = check(ctx.call(f, [t + h / 2, add2(y, k2, h / 2)]));
      const k4 = check(ctx.call(f, [t + h, add2(y, k3, h)]));
      y = add2(y, binop('+', binop('+', k1, binop('*', k2, 2)), binop('+', binop('*', k3, 2), k4)), h / 6);
      t += h; out.push(y);
    }
    return out;
  };
  const initial = (y0: any) => { if (typeof y0 !== 'number' && !(y0 instanceof Vec)) throw new Error('ode: the starting value must be a number or a vector like (x, v)'); return y0; };
  /** ode(f, y0, t1, {t0, n}) → list of n+1 states from t0 to t1 */
  const ode = (f: any, y0: any, t1: any, o: any = {}) => {
    const t0 = num(o.t0 ?? 0, 'ode start time'); num(t1, 'ode end time');
    const n = m.max(1, m.min(20000, m.round(num(o.n ?? 400, 'ode steps'))));
    return rk4(f, initial(y0), t0, t1, n);
  };
  /** odeat(f, y0, t) → the state at time t (handy with the timeline: odeat(f, y0, t)) */
  const odeat = (f: any, y0: any, t: any, o: any = {}) => {
    const t0 = num(o.t0 ?? 0, 'ode start time'); num(t, 'time');
    if (t === t0) return initial(y0);
    const dt = num(o.dt ?? 0.01, 'ode step'); const n = m.max(1, m.min(20000, m.ceil(m.abs(t - t0) / m.max(1e-6, dt))));
    const ys = rk4(f, initial(y0), t0, t, n); return ys[ys.length - 1];
  };
  /** a zig-zag spring between two points */
  const spring = (a: any, b: any, o: any = {}) => {
    const A = vec(a, 'spring start').v3(), Bp = vec(b, 'spring end').v3();
    const coils = m.max(1, m.min(60, m.round(o.coils ?? 8))), wid = o.r ?? 2.2;
    const d = [Bp[0] - A[0], Bp[1] - A[1], Bp[2] - A[2]], L = m.hypot(...d) || 1e-9;
    const u = d.map(x => x / L); const nrm = m.abs(u[2]) > 0.9 ? [1, 0, 0] : [-u[1], u[0], 0]; const nl = m.hypot(...nrm) || 1; const p = nrm.map(x => x / nl);
    const lead = m.min(L * 0.15, o.lead ?? 2.5), pts: number[][] = [A];
    const at = (s: number, off: number) => [0, 1, 2].map(k => A[k] + u[k] * s + p[k] * off);
    pts.push(at(lead, 0));
    const body = L - 2 * lead, nz = coils * 2;
    for (let i = 1; i <= nz; i++) pts.push(at(lead + body * (i - 0.5) / nz, (i % 2 ? 1 : -1) * wid));
    pts.push(at(L - lead, 0), Bp);
    return add({ kind: 'line', pts, color: ink(o), width: W(o), opacity: o.opacity ?? 1 }, a.fig || b.fig);
  };
  /** seeded random number in [0, 1): rand(i) is always the same for the same i (and seed) */
  const rand = (i: any = 0, seed: any = 0) => {
    let x = (m.imul(num(i, 'rand index') * 1000003 | 0, 0x9e3779b1) ^ m.imul(num(seed, 'rand seed') | 0, 0x85ebca6b)) >>> 0;
    x ^= x >>> 16; x = m.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = m.imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  };
  return { slider, toggle, slide, notes, ode, odeat, spring, rand };
}
