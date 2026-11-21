// Mathematical plotting built-ins: textbook-style frames, function graphs, implicit curves,
// regions, vector fields, slope fields, ODE solutions, surfaces and implicit surfaces.
// Everything is emitted as ordinary page primitives so it renders, orbits and exports like any other mark.
import { Vec, isObj, truthy } from './values';
import { num, vec, axoMat } from './builtins';
import { niceTicks, piTicks } from '../geom/ticks';
import { contourLines, isoSurface } from '../geom/marching';
import { cmap, cmapHex } from '../geom/colormap';

export function plotBuiltins(ctx: any, add: (p: any, fig?: number) => any, ink: (o: any) => string, _W: any, B: any): Record<string, any> {
  const m = Math;
  const callNum = (f: any, args: any[]) => { const r = ctx.call(f, args); return typeof r === 'number' ? r : NaN; };
  const callVec = (f: any, args: any[]): number[] | null => { const r = ctx.call(f, args); return r instanceof Vec ? r.v3() : null; };
  const r2 = (v: any, what: string): [number, number] => {
    if (!(v instanceof Vec) || v.c.length < 2) throw new Error(`${what} must be a range like (-2, 2)`);
    const a = v.c[0], b = v.c[1];
    if (!(b > a)) throw new Error(`${what}: the end (${b}) must be larger than the start (${a})`);
    return [a, b];
  };
  const frame = (F: any, what: string, dim?: number) => {
    if (!isObj(F) || typeof F._raw !== 'function') throw new Error(`${what}: first argument must be a frame made by frame2d() or frame3d()`);
    if (dim && F.dim !== dim) throw new Error(`${what} needs a ${dim}D frame (use frame${dim}d)`);
    return F;
  };
  const V = (a: number[], fig?: number) => new Vec(a, fig);
  const T = (s: string, p: Vec, o: any) => B.tex(s, p, o);
  const segs = (pos: number[], color: string, width: number, fig: number, opacity = 1) => { if (pos.length >= 6) add({ kind: 'segs', pos, color, width, opacity }, fig); };
  const polyline = (pts: number[][], o: any, fig: number, def: { color: string; width: number }) => {
    if (pts.length >= 2) add({ kind: 'line', pts, color: o.color ?? def.color, width: o.width ?? def.width, dash: o.dash, opacity: o.opacity ?? 1 }, fig);
  };
  const dark = () => !!ctx.pageStyle().dark;
  const pal = () => dark()
    ? { grid: '#344058', label: '#b9c3d6', pane: '#232a3a', paneGrid: '#3a4458', edge: '#6b7891', curve: '#6fb0ff' }
    : { grid: '#e3e8ef', label: '#4a4f57', pane: '#f3f5f8', paneGrid: '#dde3ea', edge: '#a4adb8', curve: '#1f6fd1' };

  /** clip a data-space polyline to y0..y1, interpolating the exits */
  function clipY(pts: number[][], y0: number, y1: number) {
    const out: number[][][] = []; let cur: number[][] = [];
    const at = (a: number[], b: number[], yb: number) => [a[0] + (b[0] - a[0]) * (yb - a[1]) / (b[1] - a[1]), yb];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[i - 1]; const pin = p[1] >= y0 && p[1] <= y1;
      if (!q) { if (pin) cur.push(p); continue; }
      const qin = q[1] >= y0 && q[1] <= y1;
      if (pin && qin) cur.push(p);
      else if (qin && !pin) { cur.push(at(q, p, p[1] > y1 ? y1 : y0)); if (cur.length > 1) out.push(cur); cur = []; }
      else if (!qin && pin) { cur = [at(q, p, q[1] > y1 ? y1 : y0), p]; }
    }
    if (cur.length > 1) out.push(cur);
    return out;
  }

  const P: Record<string, any> = {
    // ------------------------------------------------------------------ 2D frame
    frame2d: (origin: any, size: any, xr: any, yr: any, o: any = {}) => {
      let [ox, oy] = vec(origin, 'frame2d origin').v3(); let [w, h] = vec(size, 'frame2d size').v3();
      const [x0, x1] = r2(xr, 'x range'), [y0, y1] = r2(yr, 'y range');
      if (o.equal) {
        const s = m.min(w / (x1 - x0), h / (y1 - y0)); const nw = s * (x1 - x0), nh = s * (y1 - y0);
        ox += (w - nw) / 2; oy += (h - nh) / 2; w = nw; h = nh;
      }
      const sx = w / (x1 - x0), sy = h / (y1 - y0);
      const raw = (p: number[]) => [ox + (p[0] - x0) * sx, oy + (p[1] - y0) * sy, 0];
      const fig = ++ctx.figs; ctx.figMeta[fig] = { dim: 2 };
      const c = pal(); const axC = o.color ?? ink({}); const lblC = o.labelColor ?? c.label; const ls = o.labelSize ?? 8;
      const xt = o.piTicks || o.piX ? piTicks(x0, x1, m.max(3, m.floor(w / 15))) : niceTicks(x0, x1, m.max(3, m.round(w / 22)));
      const yt = o.piY ? piTicks(y0, y1, m.max(3, m.floor(h / 14))) : niceTicks(y0, y1, m.max(3, m.round(h / 16)));
      const F = { kind: 'frame2', dim: 2, x0, x1, y0, y1, origin: V([ox, oy]), size: V([w, h]), fig,
        map: (p: any) => V(raw(vec(p, 'map').v3()), fig), _raw: raw, _sx: sx, _sy: sy,
        _inv: (q: number[]) => [x0 + (q[0] - ox) / sx, y0 + (q[1] - oy) / sy, 0] };
      const inside = (x: number, y: number) => x >= x0 - 1e-12 && x <= x1 + 1e-12 && y >= y0 - 1e-12 && y <= y1 + 1e-12;
      if (o.grid !== false) {
        const g: number[] = [];
        if (o.polar) {
          const rmax = m.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([a, b]) => m.hypot(a, b)));
          const rt = niceTicks(0, rmax, 6);
          const addCurve = (pts: number[][]) => { for (let i = 1; i < pts.length; i++) if (inside(pts[i - 1][0], pts[i - 1][1]) && inside(pts[i][0], pts[i][1])) g.push(...raw(pts[i - 1]), ...raw(pts[i])); };
          for (const r of rt.vals) if (r > 0) addCurve(Array.from({ length: 241 }, (_, i) => [r * m.cos(i / 240 * 2 * m.PI), r * m.sin(i / 240 * 2 * m.PI)]));
          for (let a = 0; a < 12; a++) addCurve(Array.from({ length: 81 }, (_, i) => [rmax * i / 80 * m.cos(a * m.PI / 6), rmax * i / 80 * m.sin(a * m.PI / 6)]));
        } else {
          for (const v of xt.vals) g.push(...raw([v, y0]), ...raw([v, y1]));
          for (const v of yt.vals) g.push(...raw([x0, v]), ...raw([x1, v]));
        }
        segs(g, o.gridColor ?? c.grid, o.gridWidth ?? 0.15, 0);
      }
      if (o.box) add({ kind: 'line', pts: [raw([x0, y0]), raw([x1, y0]), raw([x1, y1]), raw([x0, y1])], closed: true, color: c.edge, width: 0.2, opacity: 1 }, 0);
      if (o.axes !== false) {
        const ay = (y0 <= 0 && 0 <= y1) ? 0 : y0, ax = (x0 <= 0 && 0 <= x1) ? 0 : x0, ext = 3.5;
        const a1 = raw([x0, ay]), a2 = raw([x1, ay]), b1 = raw([ax, y0]), b2 = raw([ax, y1]);
        B.arrow(V(a1), V([a2[0] + ext, a2[1]]), { color: axC, width: 0.25, head: 1.9 });
        B.arrow(V(b1), V([b2[0], b2[1] + ext]), { color: axC, width: 0.25, head: 1.9 });
        const cross = ax === 0 && ay === 0; const tk: number[] = [];
        xt.vals.forEach((v, i) => {
          const p = raw([v, ay]); tk.push(p[0], p[1] - 0.9, 0, p[0], p[1] + 0.9, 0);
          if (o.ticks === false || (cross && m.abs(v) < 1e-12)) return;
          T(xt.labels[i], V([p[0], p[1] - 1.8]), { size: ls, color: lblC, anchor: 'n' });
        });
        yt.vals.forEach((v, i) => {
          const p = raw([ax, v]); tk.push(p[0] - 0.9, p[1], 0, p[0] + 0.9, p[1], 0);
          if (o.ticks === false || (cross && m.abs(v) < 1e-12)) return;
          T(yt.labels[i], V([p[0] - 1.8, p[1]]), { size: ls, color: lblC, anchor: 'e' });
        });
        segs(tk, axC, 0.2, 0);
        if (cross && o.ticks !== false) { const q = raw([0, 0]); T('0', V([q[0] - 1.2, q[1] - 1.5]), { size: ls, color: lblC, anchor: 'ne' }); }
        T(o.xlabel ?? 'x', V([a2[0] + ext + 1.3, a2[1]]), { size: o.titleSize ?? 10, anchor: 'w', color: axC });
        T(o.ylabel ?? 'y', V([b2[0], b2[1] + ext + 1.3]), { size: o.titleSize ?? 10, anchor: 's', color: axC });
      }
      return F;
    },

    // ------------------------------------------------------------------ y = f(x)
    fplot: (F: any, f: any, o: any = {}) => {
      frame(F, 'fplot', 2);
      const n = m.min(8000, o.n ?? 1000), { x0, x1, y0, y1 } = F, yr = y1 - y0;
      const xa = o.from ?? x0, xb = o.to ?? x1;
      const polys: number[][][] = []; let cur: number[][] = [];
      const flush = () => { if (cur.length > 1) polys.push(cur); cur = []; };
      const at = (a: number[], b: number[], yb: number) => [a[0] + (b[0] - a[0]) * (yb - a[1]) / (b[1] - a[1]), yb];
      let prev: number[] | null = null;
      for (let i = 0; i <= n; i++) {
        const x = xa + (xb - xa) * i / n, y = callNum(f, [x]);
        if (!isFinite(y)) { flush(); prev = null; continue; }
        const p = [x, y];
        if (prev && m.abs(y - prev[1]) > 0.3 * yr) {          // discontinuity test (poles, jumps)
          const ym = callNum(f, [(x + prev[0]) / 2]);
          const lo = m.min(y, prev[1]), hi = m.max(y, prev[1]);
          if (!isFinite(ym) || ym < lo - 0.05 * yr || ym > hi + 0.05 * yr) { flush(); prev = null; }
        }
        const pin = (q: number[]) => q[1] >= y0 && q[1] <= y1;
        if (prev) {
          if (pin(prev) && pin(p)) cur.push(p);
          else if (pin(prev)) { cur.push(at(prev, p, p[1] > y1 ? y1 : y0)); flush(); }
          else if (pin(p)) { cur.push(at(prev, p, prev[1] > y1 ? y1 : y0), p); }
          else if ((prev[1] > y1 && p[1] < y0) || (prev[1] < y0 && p[1] > y1)) polys.push([at(prev, p, prev[1] > y1 ? y1 : y0), at(prev, p, p[1] > y1 ? y1 : y0)]);
        } else if (pin(p)) cur.push(p);
        prev = p;
      }
      flush();
      for (const poly of polys) polyline(poly.map(q => F._raw(q)), o, 0, { color: pal().curve, width: 0.45 });
      if (o.label && polys.length) {
        const last = polys.reduce((a, b) => (b[b.length - 1][0] > a[a.length - 1][0] ? b : a));
        const e = F._raw(last[last.length - 1]);
        T(o.label, V([e[0] + 1.2, e[1] + 1.2]), { size: o.labelSize ?? 9, color: o.color ?? pal().curve, anchor: 'sw' });
      }
      return null;
    },

    // ------------------------------------------------------------------ parametric curve (2D or 3D frame)
    pplot: (F: any, g: any, tr: any, o: any = {}) => {
      frame(F, 'pplot');
      const [t0, t1] = r2(tr, 'parameter range'); const n = m.min(10000, o.n ?? 1000);
      const d3 = F.dim === 3;
      const e = (a: number, b: number) => (b - a) * 1e-6;
      const inB = (q: number[]) => q[0] >= F.x0 - e(F.x0, F.x1) && q[0] <= F.x1 + e(F.x0, F.x1) && q[1] >= F.y0 - e(F.y0, F.y1) && q[1] <= F.y1 + e(F.y0, F.y1)
        && (!d3 || (q[2] >= F.z0 - e(F.z0, F.z1) && q[2] <= F.z1 + e(F.z0, F.z1)));
      const diag = d3 ? F._S * 3.5 : m.hypot(F.size.x, F.size.y);
      const polys: { pts: number[][]; tp: number[] }[] = []; let cur: number[][] = [], tps: number[] = []; let prev: number[] | null = null;
      const flush = () => { if (cur.length > 1) polys.push({ pts: cur, tp: tps }); cur = []; tps = []; prev = null; };
      for (let i = 0; i <= n; i++) {
        const tt = t0 + (t1 - t0) * i / n;
        const q = callVec(g, [tt]);
        if (!q || !q.every(isFinite) || !inB(q)) { flush(); continue; }
        const p = F._raw(q);
        if (prev && m.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) > 0.25 * diag) flush();
        cur.push(p); tps.push(tt); prev = p;
      }
      flush();
      for (const poly of polys) add({ kind: 'line', pts: poly.pts, tp: poly.tp, color: o.color ?? pal().curve, width: o.width ?? 0.45, dash: o.dash, opacity: o.opacity ?? 1 }, F.fig);
      return null;
    },

    // ------------------------------------------------------------------ implicit curve G(x, y) = level
    cplot: (F: any, G: any, o: any = {}) => {
      frame(F, 'cplot', 2);
      const nx = m.max(8, m.min(600, m.round(o.n ?? 240))), ny = m.max(8, m.round(nx * F.size.y / F.size.x));
      const lev = o.level ?? 0; const v = new Float64Array((nx + 1) * (ny + 1));
      const gx = (i: number) => F.x0 + (F.x1 - F.x0) * i / nx, gy = (j: number) => F.y0 + (F.y1 - F.y0) * j / ny;
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) v[j * (nx + 1) + i] = callNum(G, [gx(i), gy(j)]) - lev;
      const reject = (p: number[], q: number[]) => {     // drop false "crossings" across poles
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        const i = m.min(nx - 1, m.floor(mx)), j = m.min(ny - 1, m.floor(my)), k = j * (nx + 1) + i;
        const sc = m.max(m.abs(v[k]), m.abs(v[k + 1]), m.abs(v[k + nx + 1]), m.abs(v[k + nx + 2]));
        const val = callNum(G, [gx(mx), gy(my)]) - lev;
        return !isFinite(val) || m.abs(val) > sc + 1e-12;
      };
      for (const line of contourLines(v, nx, ny, reject)) polyline(line.map(p => F._raw([gx(p[0]), gy(p[1])])), o, 0, { color: pal().curve, width: 0.45 });
      return null;
    },

    // ------------------------------------------------------------------ shaded region { (x, y) : cond }
    region: (F: any, cond: any, o: any = {}) => {
      frame(F, 'region', 2);
      const nx = m.max(8, m.min(500, m.round(o.n ?? 200))), ny = m.max(8, m.round(nx * F.size.y / F.size.x));
      const cw = (F.x1 - F.x0) / nx, ch = (F.y1 - F.y0) / ny; const pos: number[] = [], idx: number[] = [];
      const quad = (i0: number, i1: number, j: number) => {
        const b = pos.length / 3;
        pos.push(...F._raw([F.x0 + i0 * cw, F.y0 + j * ch]), ...F._raw([F.x0 + i1 * cw, F.y0 + j * ch]), ...F._raw([F.x0 + i1 * cw, F.y0 + (j + 1) * ch]), ...F._raw([F.x0 + i0 * cw, F.y0 + (j + 1) * ch]));
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      };
      for (let j = 0; j < ny; j++) {
        let start = -1;
        for (let i = 0; i <= nx; i++) {
          const inside = i < nx && truthy(ctx.call(cond, [F.x0 + (i + 0.5) * cw, F.y0 + (j + 0.5) * ch]));
          if (inside && start < 0) start = i;
          if (!inside && start >= 0) { quad(start, i, j); start = -1; }
        }
      }
      if (idx.length) add({ kind: 'trimesh', pos, idx, color: o.fill ?? '#8fb8ec', opacity: o.opacity ?? 0.45, lit: false }, 0);
      return null;
    },

    // ------------------------------------------------------------------ vector field arrows (2D or 3D)
    quiver: (F: any, v: any, o: any = {}) => {
      frame(F, 'quiver');
      const d3 = F.dim === 3; const n = m.max(2, m.min(40, o.n ?? (d3 ? 6 : 17)));
      const items: { p: number[]; d: number[]; mag: number }[] = [];
      let cell: number;
      if (d3) {
        cell = 2 * F._S / n;
        for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const p = [F.x0 + (F.x1 - F.x0) * (i + 0.5) / n, F.y0 + (F.y1 - F.y0) * (j + 0.5) / n, F.z0 + (F.z1 - F.z0) * (k + 0.5) / n];
          const q = callVec(v, p); if (!q || !q.every(isFinite)) continue;
          const a = F._raw(p), b = F._raw([p[0] + q[0], p[1] + q[1], p[2] + q[2]]);
          items.push({ p: a, d: [b[0] - a[0], b[1] - a[1], b[2] - a[2]], mag: m.hypot(q[0], q[1], q[2]) });
        }
      } else {
        const nx = n, ny = m.max(2, m.round(n * F.size.y / F.size.x)); cell = m.min(F.size.x / nx, F.size.y / ny);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const p = [F.x0 + (F.x1 - F.x0) * (i + 0.5) / nx, F.y0 + (F.y1 - F.y0) * (j + 0.5) / ny];
          const q = callVec(v, p); if (!q || !isFinite(q[0]) || !isFinite(q[1])) continue;
          items.push({ p: F._raw(p), d: [q[0] * F._sx, q[1] * F._sy, 0], mag: m.hypot(q[0], q[1]) });
        }
      }
      const mx = m.max(1e-300, ...items.map(it => it.mag));
      const L = cell * 0.85 * (o.scale ?? 1);
      for (const it of items) {
        const dl = m.hypot(it.d[0], it.d[1], it.d[2]); if (!(dl > 0)) continue;
        const len = L * (0.25 + 0.75 * it.mag / mx), u = it.d.map(x => x / dl);
        const a = it.p.map((x, i) => x - u[i] * len / 2), b = it.p.map((x, i) => x + u[i] * len / 2);
        const color = o.color ?? (o.colormap === false ? ink({}) : cmapHex(it.mag / mx, o.colormap ?? 'viridis'));
        add({ kind: 'arrow', a, b, color, width: o.width ?? (d3 ? 0.3 : 0.25), head: o.head ?? m.min(len * 0.45, d3 ? 1.9 : 1.5), both: false }, F.fig);
      }
      return null;
    },

    // ------------------------------------------------------------------ slope field for dy/dx = f(x, y)
    slopefield: (F: any, f: any, o: any = {}) => {
      frame(F, 'slopefield', 2);
      const nx = m.max(3, m.min(60, o.n ?? 21)), ny = m.max(3, m.round(nx * F.size.y / F.size.x));
      const cell = m.min(F.size.x / nx, F.size.y / ny), L = cell * 0.62; const pos: number[] = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = F.x0 + (F.x1 - F.x0) * (i + 0.5) / nx, y = F.y0 + (F.y1 - F.y0) * (j + 0.5) / ny;
        const s = callNum(f, [x, y]); let d = isFinite(s) ? [F._sx, s * F._sy] : [0, 1];
        const l = m.hypot(d[0], d[1]); d = [d[0] / l, d[1] / l];
        const c = F._raw([x, y]);
        pos.push(c[0] - d[0] * L / 2, c[1] - d[1] * L / 2, 0, c[0] + d[0] * L / 2, c[1] + d[1] * L / 2, 0);
      }
      segs(pos, o.color ?? '#8196ad', o.width ?? 0.2, 0);
      return null;
    },

    // ------------------------------------------------------------------ RK4 solution through (x0, y0)
    solcurve: (F: any, f: any, p0: any, o: any = {}) => {
      frame(F, 'solcurve', 2);
      const [xs, ys] = vec(p0, 'initial point').v3(); const h = (F.x1 - F.x0) / (o.n ?? 600); const yr = F.y1 - F.y0;
      const step = (x: number, y: number, hh: number) => {
        const k1 = callNum(f, [x, y]), k2 = callNum(f, [x + hh / 2, y + hh * k1 / 2]), k3 = callNum(f, [x + hh / 2, y + hh * k2 / 2]), k4 = callNum(f, [x + hh, y + hh * k3]);
        return y + hh * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
      };
      const run = (dir: number) => {
        const pts = [[xs, ys]]; let x = xs, y = ys;
        for (let k = 0; k < 20000; k++) {
          if (dir > 0 ? x >= F.x1 : x <= F.x0) break;
          y = step(x, y, dir * h); x += dir * h;
          if (!isFinite(y) || y > F.y1 + 3 * yr || y < F.y0 - 3 * yr) break;
          pts.push([x, y]);
        }
        return pts;
      };
      const all = run(-1).reverse().concat(run(1).slice(1));
      for (const poly of clipY(all, F.y0, F.y1)) polyline(poly.map(q => F._raw(q)), o, 0, { color: '#d64545', width: 0.4 });
      if (o.dot !== false && ys >= F.y0 && ys <= F.y1) B.dot(V(F._raw([xs, ys])), { r: 0.65, color: o.color ?? '#d64545' });
      return null;
    },

    // ------------------------------------------------------------------ streamlines of a 2D field
    streamlines: (F: any, v: any, o: any = {}) => {
      frame(F, 'streamlines', 2);
      const n = m.max(2, m.min(30, o.n ?? 8)), ds = o.step ?? 0.7, maxLen = o.len ?? 40;
      const dir = (x: number, y: number) => {
        const q = callVec(v, [x, y]); if (!q) return null;
        const px = q[0] * F._sx, py = q[1] * F._sy, L = m.hypot(px, py);
        return L > 1e-12 && isFinite(L) ? [px / L, py / L] : null;
      };
      const inF = (x: number, y: number) => x >= F.x0 && x <= F.x1 && y >= F.y0 && y <= F.y1;
      const trace = (x: number, y: number, sgn: number) => {
        const pts: number[][] = []; let len = 0;
        for (let k = 0; k < 600 && len < maxLen; k++) {
          const d1 = dir(x, y); if (!d1) break;
          const xm = x + sgn * d1[0] * ds / 2 / F._sx, ym = y + sgn * d1[1] * ds / 2 / F._sy;
          const d2 = dir(xm, ym); if (!d2) break;
          x += sgn * d2[0] * ds / F._sx; y += sgn * d2[1] * ds / F._sy; len += ds;
          if (!inF(x, y)) break;
          pts.push([x, y]);
        }
        return pts;
      };
      const ny = m.max(2, m.round(n * F.size.y / F.size.x));
      const color = o.color ?? '#a3b5c9';
      for (let j = 0; j < ny; j++) for (let i = 0; i < n; i++) {
        const x = F.x0 + (F.x1 - F.x0) * (i + 0.5) / n, y = F.y0 + (F.y1 - F.y0) * (j + 0.5) / ny;
        const line = trace(x, y, -1).reverse().concat([[x, y]], trace(x, y, 1)).map(q => F._raw(q));
        if (line.length < 6) continue;
        add({ kind: 'line', pts: line, color, width: o.width ?? 0.25, opacity: 1 }, 0);
        const mid = m.floor(line.length / 2);
        if (mid >= 3) add({ kind: 'arrow', a: line[mid - 3], b: line[mid], color, width: o.width ?? 0.25, head: 1.5, both: false }, 0);
      }
      return null;
    },

    // ------------------------------------------------------------------ 3D frame
    frame3d: (origin: any, size: any, xr: any, yr: any, zr: any, o: any = {}) => {
      const [ox, oy] = vec(origin, 'frame3d origin').v3(); const S = num(size, 'frame3d size') / 2;
      const [x0, x1] = r2(xr, 'x range'), [y0, y1] = r2(yr, 'y range'), [z0, z1] = r2(zr, 'z range');
      const R = axoMat(o.yaw ?? 38 * m.PI / 180, o.tilt ?? 24 * m.PI / 180).m;
      const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], rg = [x1 - x0, y1 - y0, z1 - z0];
      let k: number[];
      if (o.equal) { const mx = m.max(...rg); k = [2 / mx, 2 / mx, 2 / mx]; }
      else { const zs = o.zscale ?? 0.8; k = [2 / rg[0], 2 / rg[1], 2 * zs / rg[2]]; }
      const raw = (p: number[]) => {
        const a = (p[0] - c[0]) * k[0], b = (p[1] - c[1]) * k[1], d = (p[2] - c[2]) * k[2];
        return [ox + S * (R[0][0] * a + R[0][1] * b + R[0][2] * d), oy + S * (R[1][0] * a + R[1][1] * b + R[1][2] * d), S * (R[2][0] * a + R[2][1] * b + R[2][2] * d)];
      };
      const fig = ++ctx.figs; ctx.figMeta[fig] = { dim: 3 };
      const view = [R[2][0], R[2][1], R[2][2]];                       // model-space direction toward the reader (page view)
      const bz = view[2] > 0 ? z0 : z1;
      const F = { kind: 'frame3', dim: 3, x0, x1, y0, y1, z0, z1, fig, floor: bz, map: (p: any) => new Vec(raw(vec(p, 'map').v3()), fig), _raw: raw, _S: S, _k: k, _R: R, _c: c,
        _inv: (q: number[]) => {
          const a = [(q[0] - ox) / S, (q[1] - oy) / S, q[2] / S];
          return [0, 1, 2].map(j => (R[0][j] * a[0] + R[1][j] * a[1] + R[2][j] * a[2]) / k[j] + c[j]);
        } };
      const pc = pal(); const lblC = o.labelColor ?? pc.label, ls = o.labelSize ?? 7.5, ts = o.titleSize ?? 10;
      const Pt = (x: number, y: number, z: number) => new Vec(raw([x, y, z]), fig);
      const tks = (a: number, b: number, pi: boolean) => (pi ? piTicks(a, b, 6) : niceTicks(a, b, o.ticks ?? 5));
      const xt = tks(x0, x1, !!o.piX), yt = tks(y0, y1, !!o.piY), zt = tks(z0, z1, !!o.piZ);
      const labels = o.labels ?? ['x', 'y', 'z'];
      const lo = [x0, y0, z0], hi = [x1, y1, z1], T3 = [xt, yt, zt];
      // outward normal of a box face, in page space (the renderer compares it with the camera direction)
      const nrm = (axis: number, side: number) => [R[0][axis] * side, R[1][axis] * side, R[2][axis] * side];
      const withDyn = (dyn: any, f: () => void) => { const prev = ctx.dyn; ctx.dyn = { ...dyn, fig }; try { f(); } finally { ctx.dyn = prev; } };
      if ((o.style ?? 'box') === 'box') {
        // panes, their grid and border: drawn on all six faces, shown only on the faces behind the figure
        for (let a = 0; a < 3; a++) for (const side of [-1, 1]) {
          const val = side < 0 ? lo[a] : hi[a];
          const u = (a + 1) % 3, w = (a + 2) % 3;
          const P = (pu: number, pw: number) => { const q = [0, 0, 0]; q[a] = val; q[u] = pu; q[w] = pw; return q; };
          withDyn({ kind: 'face', n: nrm(a, side) }, () => {
            const quad = [P(lo[u], lo[w]), P(hi[u], lo[w]), P(hi[u], hi[w]), P(lo[u], hi[w])];
            if (o.panes !== false) B.poly(quad.map(q => Pt(q[0], q[1], q[2])), { fill: o.pane ?? pc.pane });
            const g: number[] = [];
            for (const v of T3[u].vals) g.push(...raw(P(v, lo[w])), ...raw(P(v, hi[w])));
            for (const v of T3[w].vals) g.push(...raw(P(lo[u], v)), ...raw(P(hi[u], v)));
            segs(g, pc.paneGrid, 0.12, fig);
            B.line(quad.map(q => Pt(q[0], q[1], q[2])), { color: pc.edge, width: 0.18, closed: true });
          });
        }
        // tick marks + labels + axis title on every candidate edge; the renderer keeps the one facing the reader
        const axisEdges = [
          { a: 0, f1: 1, f2: 2 },   // x: edge where the y-face faces you and the z-face is behind (bottom-front)
          { a: 1, f1: 0, f2: 2 },   // y: x-face faces you, z-face behind
          { a: 2, f1: 0, f2: 1 },   // z: x-face faces you, y-face behind (a side edge)
        ];
        for (const { a, f1, f2 } of axisEdges) for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
          const e1 = s1 < 0 ? lo[f1] : hi[f1], e2 = s2 < 0 ? lo[f2] : hi[f2];
          const at = (v: number, d1 = 0, d2 = 0) => { const q = [0, 0, 0]; q[a] = v; q[f1] = e1 + s1 * d1 / k[f1]; q[f2] = e2 + s2 * d2 / k[f2]; return q; };
          withDyn({ kind: 'edge', n1: nrm(f1, s1), n2: nrm(f2, s2), ax: nrm(a, 1) }, () => {
            const tick: number[] = []; const tk = T3[a];
            const side = a === 2;                     // z labels sit diagonally outward from a vertical edge
            tk.vals.forEach((v, i) => {
              tick.push(...raw(at(v)), ...raw(side ? at(v, 0.05, 0.05) : at(v, 0.06, 0)));
              const lp = side ? at(v, 0.17, 0.17) : at(v, 0.2, 0);
              T(tk.labels[i], Pt(lp[0], lp[1], lp[2]), { size: ls, color: lblC, face: 'viewer' });
            });
            segs(tick, pc.edge, 0.18, fig);
            const tp = side ? at(c[2], 0.36, 0.36) : at(c[a], 0.46, 0);
            T(labels[a], Pt(tp[0], tp[1], tp[2]), { size: ts, face: 'viewer' });
          });
        }
      } else {
        // textbook axes through the origin
        const o3 = [m.min(x1, m.max(x0, 0)), m.min(y1, m.max(y0, 0)), m.min(z1, m.max(z0, 0))];
        const axC = o.color ?? ink({});
        const ends = [[x0, x1], [y0, y1], [z0, z1]];
        for (let a = 0; a < 3; a++) {
          const l0 = [...o3], h0 = [...o3]; l0[a] = ends[a][0]; h0[a] = ends[a][1] + 0.12 / k[a];
          B.arrow(Pt(l0[0], l0[1], l0[2]), Pt(h0[0], h0[1], h0[2]), { color: axC, width: 0.25 });
          const lp = [...o3]; lp[a] = ends[a][1] + 0.28 / k[a];
          T(labels[a], Pt(lp[0], lp[1], lp[2]), { size: ts, face: 'viewer' });
        }
      }
      return F;
    },

    // ------------------------------------------------------------------ explicit surface z = f(x, y)
    splot: (F: any, f: any, o: any = {}) => {
      frame(F, 'splot', 3);
      const n = m.max(4, m.min(220, o.n ?? 64)), Wd = n + 1;
      const { x0, x1, y0, y1, z0, z1 } = F, zr = z1 - z0, tol = zr * 1e-9;
      const gx = (i: number) => x0 + (x1 - x0) * i / n, gy = (j: number) => y0 + (y1 - y0) * j / n;
      const Z = new Float64Array(Wd * Wd);
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        let z = callNum(f, [gx(i), gy(j)]);
        if (o.clip !== false && (z < z0 - tol || z > z1 + tol)) z = NaN;
        Z[j * Wd + i] = z;
      }
      const cm = o.colormap ?? 'viridis';
      const pos: number[] = [], cols: number[] = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const z = Z[j * Wd + i];
        if (!isFinite(z)) { pos.push(NaN, NaN, NaN); cols.push(0, 0, 0); continue; }
        pos.push(...F._raw([gx(i), gy(j), z])); cols.push(...cmap((z - z0) / zr, cm));
      }
      const idx = gridIndex(Z, n, n);
      add({ kind: 'trimesh', pos, idx, colors: o.fill ? undefined : cols, color: o.fill ?? '#7fb3e6', opacity: o.opacity ?? 1, lit: true }, F.fig);
      const wire = o.wire ?? 12;
      if (wire > 0) segs(gridWire(pos, Z, n, n, wire), o.wireColor ?? 'rgba(20,28,45,0.38)', o.wireWidth ?? 0.12, F.fig);
      if (o.floor !== false) {
        for (const lev of niceTicks(z0, z1, o.levels ?? 9).vals) {
          if (lev <= z0 + tol || lev >= z1 - tol) continue;
          const vals = Z.map(z => z - lev);
          const col = cmapHex((lev - z0) / zr, cm);
          for (const line of contourLines(vals, n, n)) polyline(line.map(p => F._raw([gx(p[0]), gy(p[1]), F.floor])), { color: col, width: 0.22 }, F.fig, { color: col, width: 0.22 });
        }
      }
      return null;
    },

    // ------------------------------------------------------------------ parametric surface r(u, v)
    psurf: (F: any, g: any, ur: any, vr: any, o: any = {}) => {
      frame(F, 'psurf', 3);
      const [u0, u1] = r2(ur, 'u range'), [v0, v1] = r2(vr, 'v range');
      const n = m.max(4, m.min(220, o.n ?? 72)), nv = m.max(4, m.min(220, o.nv ?? n)), Wd = n + 1;
      const Z = new Float64Array(Wd * (nv + 1)); const pos: number[] = [], cols: number[] = [], uv: number[] = [];
      const cm = o.colormap ?? 'viridis', byV = o.colorBy === 'v', byU = o.colorBy === 'u';
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= n; i++) {
        const q = callVec(g, [u0 + (u1 - u0) * i / n, v0 + (v1 - v0) * j / nv]);
        uv.push(i / n, j / nv);
        if (!q || !q.every(isFinite)) { Z[j * Wd + i] = NaN; pos.push(NaN, NaN, NaN); cols.push(0, 0, 0); continue; }
        Z[j * Wd + i] = q[2];
        pos.push(...F._raw(q));
        cols.push(...cmap(byV ? j / nv : byU ? i / n : (q[2] - F.z0) / (F.z1 - F.z0), cm));
      }
      add({ kind: 'trimesh', pos, idx: gridIndex(Z, n, nv), uv, uvRange: [u0, u1, v0, v1], colors: o.fill ? undefined : cols, color: o.fill ?? '#7fb3e6', opacity: o.opacity ?? 1, lit: true }, F.fig);
      const wire = o.wire ?? 14;
      if (wire > 0) segs(gridWire(pos, Z, n, nv, wire), o.wireColor ?? 'rgba(20,28,45,0.35)', o.wireWidth ?? 0.12, F.fig);
      return null;
    },

    // ------------------------------------------------------------------ implicit surface G(x, y, z) = level
    isoplot: (F: any, G: any, o: any = {}) => {
      frame(F, 'isoplot', 3);
      const n = m.max(6, m.min(64, o.n ?? 34)); const ext = [(F.x1 - F.x0) * F._k[0], (F.y1 - F.y0) * F._k[1], (F.z1 - F.z0) * F._k[2]];
      const me = m.max(...ext); const [nx, ny, nz] = ext.map(e => m.max(6, m.round(n * e / me)));
      const lev = o.level ?? 0; const W1 = nx + 1, A = W1 * (ny + 1);
      const gx = (i: number) => F.x0 + (F.x1 - F.x0) * i / nx, gy = (j: number) => F.y0 + (F.y1 - F.y0) * j / ny, gz = (k: number) => F.z0 + (F.z1 - F.z0) * k / nz;
      const v = new Float64Array(A * (nz + 1));
      for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) v[k * A + j * W1 + i] = callNum(G, [gx(i), gy(j), gz(k)]) - lev;
      const { verts, index } = isoSurface(v, nx, ny, nz);
      if (!index.length) return null;
      const pos: number[] = [], cols: number[] = []; const cm = o.colormap ?? 'viridis';
      for (let q = 0; q < verts.length; q += 3) {
        const p = [gx(verts[q]), gy(verts[q + 1]), gz(verts[q + 2])];
        pos.push(...F._raw(p)); cols.push(...cmap((p[2] - F.z0) / (F.z1 - F.z0), cm));
      }
      add({ kind: 'trimesh', pos, idx: index, colors: o.fill ? undefined : cols, color: o.fill ?? '#e9a23b', opacity: o.opacity ?? 1, lit: true }, F.fig);
      return null;
    },
  };

  function gridIndex(Z: Float64Array, n: number, nv: number) {
    const idx: number[] = []; const Wd = n + 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < n; i++) {
      const a = j * Wd + i, b = a + 1, c = a + Wd, d = c + 1;
      const fa = isFinite(Z[a]), fb = isFinite(Z[b]), fc = isFinite(Z[c]), fd = isFinite(Z[d]);
      if (fa && fb && fd) idx.push(a, b, d);
      if (fa && fd && fc) idx.push(a, d, c);
      if (!fa && fb && fc && fd) idx.push(b, d, c);
      if (!fd && fa && fb && fc) idx.push(a, b, c);
    }
    return idx;
  }
  function gridWire(pos: number[], Z: Float64Array, n: number, nv: number, wire: number) {
    const seg: number[] = []; const Wd = n + 1;
    const at = (i: number, j: number) => [pos[3 * (j * Wd + i)], pos[3 * (j * Wd + i) + 1], pos[3 * (j * Wd + i) + 2]];
    const ok = (i: number, j: number) => isFinite(Z[j * Wd + i]);
    const si = m.max(1, m.round(n / wire)), sj = m.max(1, m.round(nv / wire));
    for (let i = 0; i <= n; i += si) for (let j = 0; j < nv; j++) if (ok(i, j) && ok(i, j + 1)) seg.push(...at(i, j), ...at(i, j + 1));
    for (let j = 0; j <= nv; j += sj) for (let i = 0; i < n; i++) if (ok(i, j) && ok(i + 1, j)) seg.push(...at(i, j), ...at(i + 1, j));
    return seg;
  }
  // ---- bookkeeping for the Figure Explorer: remember each frame and every plot drawn into it
  const site = () => (ctx.sites && ctx.sites.length ? ctx.sites[0] : ctx.line);
  for (const [name, dim] of [['frame2d', 2], ['frame3d', 3]] as const) {
    const impl = P[name];
    P[name] = (...args: any[]) => {
      const id = ++ctx.frameSeq; const prev = ctx.role; ctx.role = { frame: id, role: 'deco' };
      try { const F = impl(...args); F.id = id; if (!ctx.noHooks) ctx.frames.push({ id, dim, fig: F.fig, args, line: site(), F }); return F; }
      finally { ctx.role = prev; }
    };
  }
  for (const name of ['fplot', 'pplot', 'cplot', 'region', 'quiver', 'slopefield', 'solcurve', 'streamlines', 'splot', 'psurf', 'isoplot']) {
    const impl = P[name];
    P[name] = (F: any, ...rest: any[]) => {
      frame(F, name);
      const idx = ctx.noHooks ? ctx.curHook : ctx.hooks.push({ name, frame: F.id, args: rest, line: site() }) - 1;
      const prevR = ctx.role, prevH = ctx.curHook; ctx.role = { frame: F.id, role: 'plot' }; ctx.curHook = idx;
      try { return impl(F, ...rest); } finally { ctx.role = prevR; ctx.curHook = prevH; }
    };
  }
  return P;
}
