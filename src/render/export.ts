// Vector export of the straight-on page view as SVG (painter's algorithm for 3D figures).
import { getTex, anchorOffset } from './tex';
import { PAGE_STYLES } from '../lang/builtins';
import type { RunCtx } from '../lang/interp';
import { dynVisible } from './dyn';

function col(c: string): [string, number] {
  const s = String(c).trim();
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(s);
  if (m) return ['#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join(''), +m[4]];
  if (/^#[0-9a-f]{3}$/i.test(s)) return ['#' + s.slice(1).split('').map(x => x + x).join(''), 1];
  if (/^#[0-9a-f]{6}$/i.test(s)) return [s, 1];
  // let the browser resolve named / hsl colours
  try { const cv = document.createElement('canvas').getContext('2d')!; cv.fillStyle = s; const r = cv.fillStyle as string; if (r.startsWith('#')) return [r, 1]; const mm = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(r); if (mm) return ['#' + [mm[1], mm[2], mm[3]].map(v => (+v).toString(16).padStart(2, '0')).join(''), mm[4] ? +mm[4] : 1]; } catch { /* node */ }
  return ['#000000', 1];
}
const f = (v: number) => +v.toFixed(3);
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');

export function exportSVG(ctx: RunCtx): string {
  const { w, h, style } = ctx.page; const ps = PAGE_STYLES[style];
  const Y = (y: number) => h - y;
  type Item = { z: number; o: number; s: string };
  const flat: Item[] = [], solid: Item[] = [], top: Item[] = [];
  const push = (p: any, z: number, s: string) => (p.flat ? flat : solid).push({ z, o: p.order, s });
  const stroke = (c: string, wd: number, op = 1, dash?: any) => { const [h0, a] = col(c); const d = dash ? ` stroke-dasharray="${typeof dash === 'number' ? `${dash} ${dash * 0.8}` : '1 0.8'}"` : ''; return `fill="none" stroke="${h0}" stroke-width="${f(wd)}" stroke-linecap="round" stroke-linejoin="round"${a * op < 1 ? ` stroke-opacity="${f(a * op)}"` : ''}${d}`; };
  const fill = (c: string, op = 1) => { const [h0, a] = col(c); return `fill="${h0}"${a * op < 1 ? ` fill-opacity="${f(a * op)}"` : ''}`; };
  const L = [-0.4, 0.8, 1]; const Ln = Math.hypot(...L); const light = L.map(v => v / Ln);

  for (const p of ctx.prims) {
    if (p.dyn && !dynVisible(p.dyn, [0, 0, 1])) continue;   // page view: only the panes/ticks that face the reader
    switch (p.kind) {
      case 'line': {
        const pts = p.closed ? [...p.pts, p.pts[0]] : p.pts;
        if (p.flat) { push(p, 0, `<polyline points="${pts.map((q: number[]) => `${f(q[0])},${f(Y(q[1]))}`).join(' ')}" ${stroke(p.color, p.width, p.opacity, p.dash)}/>`); break; }
        for (let i = 0; i < pts.length - 1; i += 6) {
          const chunk = pts.slice(i, i + 7); const z = chunk.reduce((s: number, q: number[]) => s + q[2], 0) / chunk.length;
          push(p, z, `<polyline points="${chunk.map((q: number[]) => `${f(q[0])},${f(Y(q[1]))}`).join(' ')}" ${stroke(p.color, p.width, p.opacity, p.dash)}/>`);
        }
        break;
      }
      case 'segs': {
        if (p.flat) { let d = ''; for (let i = 0; i + 5 < p.pos.length; i += 6) d += `M${f(p.pos[i])} ${f(Y(p.pos[i + 1]))}L${f(p.pos[i + 3])} ${f(Y(p.pos[i + 4]))}`; push(p, 0, `<path d="${d}" ${stroke(p.color, p.width, p.opacity)}/>`); break; }
        for (let i = 0; i + 5 < p.pos.length; i += 6) push(p, (p.pos[i + 2] + p.pos[i + 5]) / 2, `<line x1="${f(p.pos[i])}" y1="${f(Y(p.pos[i + 1]))}" x2="${f(p.pos[i + 3])}" y2="${f(Y(p.pos[i + 4]))}" ${stroke(p.color, p.width, p.opacity)}/>`);
        break;
      }
      case 'poly': push(p, p.pts.reduce((s: number, q: number[]) => s + q[2], 0) / p.pts.length, `<polygon points="${p.pts.map((q: number[]) => `${f(q[0])},${f(Y(q[1]))}`).join(' ')}" ${fill(p.fill, p.opacity)}/>`); break;
      case 'trimesh': {
        const P = p.pos, I = p.idx; const [base, a0] = col(p.color);
        const bc = [parseInt(base.slice(1, 3), 16) / 255, parseInt(base.slice(3, 5), 16) / 255, parseInt(base.slice(5, 7), 16) / 255];
        for (let t = 0; t < I.length; t += 3) {
          const i0 = I[t] * 3, i1 = I[t + 1] * 3, i2 = I[t + 2] * 3;
          const A = [P[i0], P[i0 + 1], P[i0 + 2]], B = [P[i1], P[i1 + 1], P[i1 + 2]], C = [P[i2], P[i2 + 1], P[i2 + 2]];
          if (![...A, ...B, ...C].every(isFinite)) continue;
          let c = bc;
          if (p.colors) c = [0, 1, 2].map(k => (p.colors[i0 + k] + p.colors[i1 + k] + p.colors[i2 + k]) / 3);
          let sh = 1;
          if (p.lit) {
            const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
            let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const nl = Math.hypot(...n) || 1; n = n.map(x => x / nl);
            if (n[2] < 0) n = n.map(x => -x);
            sh = 0.62 + 0.45 * Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
          }
          const color = hex(c[0] * sh, c[1] * sh, c[2] * sh); const op = a0 * (p.opacity ?? 1);
          push(p, (A[2] + B[2] + C[2]) / 3, `<polygon points="${f(A[0])},${f(Y(A[1]))} ${f(B[0])},${f(Y(B[1]))} ${f(C[0])},${f(Y(C[1]))}" fill="${color}" stroke="${color}" stroke-width="0.05"${op < 1 ? ` fill-opacity="${f(op)}" stroke-opacity="${f(op)}"` : ''}/>`);
        }
        break;
      }
      case 'arrow': {
        const a = p.a, b = p.b; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
        const [hc] = col(p.color); const z = (a[2] + b[2]) / 2;
        if (l < 0.3) { push(p, z, `<circle cx="${f(b[0])}" cy="${f(Y(b[1]))}" r="${f(p.head * 0.3)}" fill="${hc}"/>`); break; }
        const ux = dx / l, uy = dy / l, head = Math.min(p.head, l * 0.6), hw = head * 0.36;
        const bx = b[0] - ux * head, by = b[1] - uy * head;
        const sx = b[0] - ux * head * 0.85, sy = b[1] - uy * head * 0.85;
        let s = `<line x1="${f(a[0])}" y1="${f(Y(a[1]))}" x2="${f(sx)}" y2="${f(Y(sy))}" ${stroke(p.color, p.width, 1, p.dash)}/>`;
        s += `<polygon points="${f(b[0])},${f(Y(b[1]))} ${f(bx - uy * hw)},${f(Y(by + ux * hw))} ${f(bx + ux * head * 0.18)},${f(Y(by + uy * head * 0.18))} ${f(bx + uy * hw)},${f(Y(by - ux * hw))}" fill="${hc}"/>`;
        push(p, z, s); break;
      }
      case 'dot': push(p, p.p[2], `<circle cx="${f(p.p[0])}" cy="${f(Y(p.p[1]))}" r="${f(p.r)}" ${fill(p.color)}/>`); break;
      case 'tex': {
        const e = getTex(p.src, p.display); const [ax, ay] = anchorOffset(e, p.anchor); const em = p.size * 0.352778;
        const bx = p.pos[0] - ax * em, by = Y(p.pos[1] - ay * em);
        const bb = p.face === 'viewer' || (p.face === 'auto' && !p.flat);
        const rot = !bb && p.rot ? ` rotate(${f(-p.rot * 180 / Math.PI)} ${f(p.pos[0])} ${f(Y(p.pos[1]))})` : '';
        const [hc, a] = col(p.color);
        const body = e.svgInner.replace(/currentColor/g, hc);
        const s = `<g transform="${rot ? rot.trim() + ' ' : ''}translate(${f(bx)} ${f(by)}) scale(${+(em / 1000).toPrecision(6)})"${a * p.opacity < 1 ? ` opacity="${f(a * p.opacity)}"` : ''}>${body}</g>`;
        if (bb) top.push({ z: 0, o: p.order, s }); else push(p, p.pos[2], s);
        break;
      }
    }
  }
  flat.sort((a, b) => a.o - b.o);
  solid.sort((a, b) => a.z - b.z || a.o - b.o);
  top.sort((a, b) => a.o - b.o);
  let grid = '';
  if (ps.grid) { let d = ''; for (let x = ps.grid; x < w; x += ps.grid) d += `M${f(x)} 0V${f(h)}`; for (let y = ps.grid; y < h; y += ps.grid) d += `M0 ${f(Y(y))}H${f(w)}`; grid = `<path d="${d}" fill="none" stroke="${ps.dark ? '#3c6eaa' : '#cfe0f2'}" stroke-width="0.12"/>`; }
  if (ps.dots) { for (let x = ps.dots; x < w; x += ps.dots) for (let y = ps.dots; y < h; y += ps.dots) grid += `<circle cx="${f(x)}" cy="${f(y)}" r="0.18" fill="#b9c4d0"/>`; }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f(w)}mm" height="${f(h)}mm" viewBox="0 0 ${f(w)} ${f(h)}">
<rect width="${f(w)}" height="${f(h)}" fill="${ps.bg}"/>
${grid}
${flat.map(i => i.s).join('\n')}
${solid.map(i => i.s).join('\n')}
${top.map(i => i.s).join('\n')}
</svg>
`;
}
