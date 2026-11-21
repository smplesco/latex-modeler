// Iso-contour extraction: marching squares (2D) and marching tetrahedra (3D).

/** Zero-level contour of a grid of values `v[j*(nx+1)+i]`.
 *  Returns polylines in fractional grid coordinates [i, j]. Cells containing NaN are skipped.
 *  `reject(a, b)` may veto a segment (used to drop false crossings at poles). */
export function contourLines(v: Float64Array | number[], nx: number, ny: number, reject?: (p: number[], q: number[]) => boolean): number[][][] {
  const W = nx + 1;
  const pos = new Map<number, number[]>();
  // edge ids: horizontal edge (i,j)-(i+1,j) = 2*(j*W+i); vertical (i,j)-(i,j+1) = 2*(j*W+i)+1
  const edgePt = (id: number) => {
    let p = pos.get(id); if (p) return p;
    const base = id >> 1, i = base % W, j = (base - i) / W;
    const a = v[base], b = (id & 1) ? v[base + W] : v[base + 1];
    const s = a / (a - b);
    p = (id & 1) ? [i, j + s] : [i + s, j];
    pos.set(id, p); return p;
  };
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const pa = edgePt(a), pb = edgePt(b);
    if (reject && reject(pa, pb)) return;
    (adj.get(a) || adj.set(a, []).get(a)!).push(b);
    (adj.get(b) || adj.set(b, []).get(b)!).push(a);
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * W + i;
    const a = v[k], b = v[k + 1], c = v[k + W + 1], d = v[k + W];
    if (!(isFinite(a) && isFinite(b) && isFinite(c) && isFinite(d))) continue;
    const idx = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const eB = 2 * k, eR = 2 * (k + 1) + 1, eT = 2 * (k + W), eL = 2 * k + 1;
    switch (idx) {
      case 1: case 14: link(eL, eB); break;
      case 2: case 13: link(eB, eR); break;
      case 3: case 12: link(eL, eR); break;
      case 4: case 11: link(eR, eT); break;
      case 6: case 9: link(eB, eT); break;
      case 7: case 8: link(eL, eT); break;
      case 5: case 10: {
        const center = (a + b + c + d) / 4;
        if ((center > 0) === (idx === 5)) { link(eL, eT); link(eB, eR); } else { link(eL, eB); link(eR, eT); }
        break;
      }
    }
  }
  // chain edges into polylines
  const used = new Set<string>();
  const key = (a: number, b: number) => a < b ? a + ':' + b : b + ':' + a;
  const lines: number[][][] = [];
  const walk = (start: number) => {
    const line = [start]; let cur = start;
    for (;;) {
      const nb = (adj.get(cur) || []).find(n => !used.has(key(cur, n)));
      if (nb === undefined) break;
      used.add(key(cur, nb)); line.push(nb); cur = nb;
    }
    return line;
  };
  // start at endpoints first (degree 1), then loops
  for (const [id, nbs] of adj) if (nbs.length === 1 && nbs.some(n => !used.has(key(id, n)))) { const l = walk(id); if (l.length > 1) lines.push(l.map(e => pos.get(e)!)); }
  for (const [id, nbs] of adj) if (nbs.some(n => !used.has(key(id, n)))) { const l = walk(id); if (l.length > 1) lines.push(l.map(e => pos.get(e)!)); }
  return lines;
}

const CUBE = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const TETS = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];

/** Marching tetrahedra over a grid of values v[(k*(ny+1)+j)*(nx+1)+i].
 *  Returns vertex positions in grid coords, triangle indices (consistently oriented so the
 *  face normal points toward positive values), shared between adjacent triangles. */
export function isoSurface(v: Float64Array, nx: number, ny: number, nz: number) {
  const W = nx + 1, A = W * (ny + 1);
  const verts: number[] = []; const index: number[] = [];
  const vmap = new Map<number, number>();
  const total = A * (nz + 1);
  const gid = (i: number, j: number, k: number) => k * A + j * W + i;
  const gpos = (g: number) => { const k = Math.floor(g / A), r = g - k * A, j = Math.floor(r / W), i = r - j * W; return [i, j, k]; };
  const vert = (ga: number, gb: number) => {
    const key = ga < gb ? ga * total + gb : gb * total + ga;
    let id = vmap.get(key); if (id !== undefined) return id;
    const a = v[ga], b = v[gb], s = a / (a - b);
    const pa = gpos(ga), pb = gpos(gb);
    id = verts.length / 3;
    verts.push(pa[0] + (pb[0] - pa[0]) * s, pa[1] + (pb[1] - pa[1]) * s, pa[2] + (pb[2] - pa[2]) * s);
    vmap.set(key, id); return id;
  };
  const tri = (a: number, b: number, c: number, towards: number[]) => {
    // orient so that normal points toward `towards` (centroid of positive corners)
    const P = (n: number) => [verts[3 * n], verts[3 * n + 1], verts[3 * n + 2]];
    const p = P(a), q = P(b), r = P(c);
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const d = [towards[0] - p[0], towards[1] - p[1], towards[2] - p[2]];
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0) index.push(a, c, b); else index.push(a, b, c);
  };
  const corner = new Array(8);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let bad = false;
    for (let c = 0; c < 8; c++) { const g = gid(i + CUBE[c][0], j + CUBE[c][1], k + CUBE[c][2]); corner[c] = g; if (!isFinite(v[g])) bad = true; }
    if (bad) continue;
    for (const T of TETS) {
      const g = T.map(c => corner[c]);
      const pos = g.filter(x => v[x] > 0), neg = g.filter(x => v[x] <= 0);
      if (pos.length === 0 || pos.length === 4) continue;
      const cen = [0, 0, 0]; for (const x of pos) { const p = gpos(x); cen[0] += p[0] / pos.length; cen[1] += p[1] / pos.length; cen[2] += p[2] / pos.length; }
      if (pos.length === 1 || pos.length === 3) {
        const lone = pos.length === 1 ? pos[0] : neg[0], others = pos.length === 1 ? neg : pos;
        tri(vert(lone, others[0]), vert(lone, others[1]), vert(lone, others[2]), cen);
      } else {
        const [a, b] = pos, [c, d] = neg;
        const ac = vert(a, c), ad = vert(a, d), bc = vert(b, c), bd = vert(b, d);
        tri(ac, ad, bd, cen); tri(ac, bd, bc, cen);
      }
    }
  }
  return { verts, index };
}
