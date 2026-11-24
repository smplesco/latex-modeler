// The page as TikZ code, for LaTeX documents: the straight-on page view, 3D figures drawn back to front
// (the same painter's algorithm as the SVG export), labels as real LaTeX nodes so they use the document's fonts.
import { pageRules, PAGE_STYLES } from '../lang/pages';
import type { RunCtx } from '../lang/interp';
import type { Stroke } from './ink';
import { dynVisible } from './dyn';
import { col, f } from './export';

const rgb = (c: string) => { const [h, a] = col(c); const n = parseInt(h.slice(1), 16); return { c: `{rgb,255:red,${(n >> 16) & 255};green,${(n >> 8) & 255};blue,${n & 255}}`, a }; };
const P = (x: number, y: number) => `(${f(x)},${f(y)})`;
const ANCHOR: Record<string, string> = { c: 'center', n: 'north', s: 'south', e: 'east', w: 'west', ne: 'north east', nw: 'north west', se: 'south east', sw: 'south west' };

export interface TikzOpts { standalone?: boolean; paper?: boolean; ink?: Stroke[]; slide?: number }

export function exportTikZ(ctx: RunCtx, o: TikzOpts = {}): string {
  const { w, h, style } = ctx.page; const ps = PAGE_STYLES[style];
  type Item = { z: number; o: number; s: string };
  const flat: Item[] = [], solid: Item[] = [], top: Item[] = [];
  const push = (p: any, z: number, s: string) => (p.flat ? flat : solid).push({ z, o: p.order, s });
  const drawOpt = (c: string, wd: number, op = 1, dash?: any) => {
    const k = rgb(c); const a = k.a * op;
    const d = dash ? `,dash pattern=on ${typeof dash === 'number' ? f(dash) : 1}mm off ${typeof dash === 'number' ? f(dash * 0.8) : 0.8}mm` : '';
    return `[draw=${k.c},line width=${f(wd)}mm${a < 1 ? `,draw opacity=${f(a)}` : ''}${d}]`;
  };
  const fillOpt = (c: string, op = 1) => { const k = rgb(c); const a = k.a * op; return `[fill=${k.c}${a < 1 ? `,fill opacity=${f(a)}` : ''}]`; };
  const path = (pts: number[][], close = false) => pts.map(q => P(q[0], q[1])).join(' -- ') + (close ? ' -- cycle' : '');
  const L = [-0.4, 0.8, 1]; const Ln = Math.hypot(...L); const light = L.map(v => v / Ln);

  for (const p of ctx.prims) {
    if (p.dyn && !dynVisible(p.dyn, [0, 0, 1])) continue;
    switch (p.kind) {
      case 'line': {
        const pts = p.closed ? [...p.pts, p.pts[0]] : p.pts;
        if (p.flat) { push(p, 0, `\\path${drawOpt(p.color, p.width, p.opacity, p.dash)} ${path(pts)};`); break; }
        for (let i = 0; i < pts.length - 1; i += 6) {
          const chunk = pts.slice(i, i + 7); const z = chunk.reduce((s: number, q: number[]) => s + q[2], 0) / chunk.length;
          push(p, z, `\\path${drawOpt(p.color, p.width, p.opacity, p.dash)} ${path(chunk)};`);
        }
        break;
      }
      case 'segs': {
        for (let i = 0; i + 5 < p.pos.length; i += 6) push(p, p.flat ? 0 : (p.pos[i + 2] + p.pos[i + 5]) / 2, `\\path${drawOpt(p.color, p.width, p.opacity)} ${P(p.pos[i], p.pos[i + 1])} -- ${P(p.pos[i + 3], p.pos[i + 4])};`);
        break;
      }
      case 'poly': push(p, p.pts.reduce((s: number, q: number[]) => s + q[2], 0) / p.pts.length, `\\path${fillOpt(p.fill, p.opacity)} ${path(p.pts, true)};`); break;
      case 'trimesh': {
        const Pp = p.pos, I = p.idx; const base = rgb(p.color);
        const n0 = parseInt(col(p.color)[0].slice(1), 16); const bc = [(n0 >> 16 & 255) / 255, (n0 >> 8 & 255) / 255, (n0 & 255) / 255];
        for (let t = 0; t < I.length; t += 3) {
          const i0 = I[t] * 3, i1 = I[t + 1] * 3, i2 = I[t + 2] * 3;
          const A = [Pp[i0], Pp[i0 + 1], Pp[i0 + 2]], B = [Pp[i1], Pp[i1 + 1], Pp[i1 + 2]], C = [Pp[i2], Pp[i2 + 1], Pp[i2 + 2]];
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
          const [r, g, b] = c.map(x => Math.round(Math.max(0, Math.min(1, x * sh)) * 255));
          const cc = `{rgb,255:red,${r};green,${g};blue,${b}}`; const op = base.a * (p.opacity ?? 1);
          push(p, (A[2] + B[2] + C[2]) / 3, `\\path[fill=${cc},draw=${cc},line width=0.05mm${op < 1 ? `,opacity=${f(op)}` : ''}] ${P(A[0], A[1])} -- ${P(B[0], B[1])} -- ${P(C[0], C[1])} -- cycle;`);
        }
        break;
      }
      case 'arrow': {
        const a = p.a, b = p.b; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); const z = (a[2] + b[2]) / 2;
        const hc = rgb(p.color).c;
        if (l < 0.3) { push(p, z, `\\path[fill=${hc}] ${P(b[0], b[1])} circle (${f(p.head * 0.3)});`); break; }
        const ux = dx / l, uy = dy / l, head = Math.min(p.head, l * 0.6), hw = head * 0.36;
        const bx = b[0] - ux * head, by = b[1] - uy * head, sx = b[0] - ux * head * 0.85, sy = b[1] - uy * head * 0.85;
        push(p, z, `\\path${drawOpt(p.color, p.width, 1, p.dash)} ${P(a[0], a[1])} -- ${P(sx, sy)};\n\\path[fill=${hc}] ${P(b[0], b[1])} -- ${P(bx - uy * hw, by + ux * hw)} -- ${P(bx + ux * head * 0.18, by + uy * head * 0.18)} -- ${P(bx + uy * hw, by - ux * hw)} -- cycle;`);
        break;
      }
      case 'dot': push(p, p.p[2], `\\path${fillOpt(p.color)} ${P(p.p[0], p.p[1])} circle (${f(p.r)});`); break;
      case 'tex': {
        const k = rgb(p.color); const a = k.a * (p.opacity ?? 1);
        const bb = p.face === 'viewer' || (p.face === 'auto' && !p.flat);
        const rot = !bb && p.rot ? `,rotate=${f(p.rot * 180 / Math.PI)}` : '';
        const size = f(p.size), skip = f(p.size * 1.2);
        const body = p.display ? `$\\displaystyle ${p.src}$` : `$${p.src}$`;
        const s = `\\node[anchor=${ANCHOR[p.anchor] ?? 'center'},inner sep=0pt,text=${k.c}${a < 1 ? `,text opacity=${f(a)}` : ''}${rot},font=\\fontsize{${size}}{${skip}}\\selectfont] at ${P(p.pos[0], p.pos[1])} {${body}};`;
        if (bb) top.push({ z: 0, o: p.order, s }); else push(p, p.pos[2], s);
        break;
      }
    }
  }
  flat.sort((a, b) => a.o - b.o); solid.sort((a, b) => a.z - b.z || a.o - b.o); top.sort((a, b) => a.o - b.o);

  const out: string[] = [];
  if (o.paper !== false) {
    out.push(`% the sheet`, `\\path[fill=${rgb(ps.bg).c}] (0,0) rectangle ${P(w, h)};`);
    const rules = pageRules(ps, w, h);
    for (const g of rules.lines) {
      const segs: string[] = []; for (let i = 0; i < g.seg.length; i += 4) segs.push(`${P(g.seg[i], g.seg[i + 1])} -- ${P(g.seg[i + 2], g.seg[i + 3])}`);
      if (segs.length) out.push(`\\path[draw=${rgb(g.color).c},line width=${f(g.width)}mm] ${segs.join(' ')};`);
    }
    if (rules.dots.length) { const d: string[] = []; for (let i = 0; i < rules.dots.length; i += 2) d.push(`${P(rules.dots[i], rules.dots[i + 1])} circle (0.18)`); out.push(`\\path[fill=${rgb(rules.dotColor).c}] ${d.join(' ')};`); }
  } else out.push(`\\path[use as bounding box] (0,0) rectangle ${P(w, h)};`);
  out.push('% the page', ...flat.map(i => i.s), ...solid.map(i => i.s), ...top.map(i => i.s));
  const ink = (o.ink ?? []).filter(s => (s.slide ?? 0) === (o.slide ?? 0));
  if (ink.length) {
    out.push('% ink');
    for (const s of ink) {
      const pts: string[] = []; for (let i = 0; i < s.pts.length; i += 3) pts.push(P(s.pts[i], s.pts[i + 1]));
      if (pts.length === 1) pts.push(pts[0]);
      out.push(`\\path[draw=${rgb(s.color).c},line width=${f(s.w)}mm${s.tool === 'hl' ? ',draw opacity=0.38' : ''}] ${pts.join(' -- ')};`);
    }
  }
  const pic = `\\begin{tikzpicture}[x=1mm,y=1mm,line cap=round,line join=round]\n${out.join('\n')}\n\\end{tikzpicture}`;
  if (o.standalone === false) return pic + '\n';
  return `% Made with LaTeX Modeler (https://latexmodeler.app). Compile with pdflatex, or paste the tikzpicture
% into your own document (it needs \\usepackage{tikz} and \\usepackage{amsmath,amssymb}).
\\documentclass[tikz,border=0pt]{standalone}
\\usepackage{amsmath,amssymb}
\\begin{document}
${pic}
\\end{document}
`;
}
