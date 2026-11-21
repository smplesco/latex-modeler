// LaTeX → vector glyph geometry (via MathJax's SVG output), plus raw SVG for vector export.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

declare global { interface Window { MathJax: any } }

export interface TexEntry {
  groups: { geom: THREE.BufferGeometry; color: string | null }[];
  x0: number; x1: number; yTop: number; yBot: number;   // bounding box in em, y up, baseline at 0
  err: string | null;
  svgInner: string;                                      // MathJax <g> content (y down, 1/1000 em)
}

const loader = new SVGLoader();
const cache = new Map<string, TexEntry>();
const SENTINEL = '#010203';

export async function texReady() { await window.MathJax.startup.promise; }

function convert(src: string, display: boolean) {
  const node = window.MathJax.tex2svg(src, { display });
  return node.querySelector('svg') as SVGSVGElement;
}

export function getTex(src: string, display = false): TexEntry {
  const key = (display ? 'D:' : 'I:') + src;
  const hit = cache.get(key); if (hit) return hit;
  const svg = convert(src, display);
  const errNode = svg.querySelector('[data-mjx-error]');
  const err = errNode ? errNode.getAttribute('data-mjx-error') : null;
  const vb = (svg.getAttribute('viewBox') || '0 0 0 0').split(/[\s,]+/).map(Number);
  const str = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, SENTINEL);
  const data = loader.parse(str);
  const byColor = new Map<string, THREE.BufferGeometry[]>();
  for (const path of data.paths) {
    const fill = (path as any).userData?.style?.fill;
    if (!fill || fill === 'none' || fill === 'transparent') continue;
    for (const sh of SVGLoader.createShapes(path)) {
      const g = new THREE.ShapeGeometry(sh, 5);
      g.deleteAttribute('uv'); g.deleteAttribute('normal');
      if (!byColor.has(fill)) byColor.set(fill, []);
      byColor.get(fill)!.push(g);
    }
  }
  const groups: TexEntry['groups'] = [];
  for (const [fill, geoms] of byColor) {
    const g = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false)!;
    geoms.forEach(x => x !== g && x.dispose());
    g.scale(1 / 1000, -1 / 1000, 1);
    groups.push({ geom: g, color: fill.toLowerCase() === SENTINEL ? null : fill });
  }
  const inner = Array.from(svg.childNodes).map(n => new XMLSerializer().serializeToString(n)).join('');
  const entry: TexEntry = { groups, x0: vb[0] / 1000, x1: (vb[0] + vb[2]) / 1000, yTop: -vb[1] / 1000, yBot: -(vb[1] + vb[3]) / 1000, err, svgInner: inner };
  cache.set(key, entry);
  if (cache.size > 3000) { const first = cache.keys().next().value!; cache.get(first)!.groups.forEach(g => g.geom.dispose()); cache.delete(first); }
  return entry;
}

/** width of the typeset formula in em (used by tex(..., {maxw})) */
export function measureTex(src: string): number | null {
  try { const e = getTex(src); return e.x1 - e.x0; } catch { return null; }
}

/** a small inline SVG preview element for the auto-model bar */
export function previewSVG(src: string): { el: Element | null; err: string | null } {
  try {
    const node = window.MathJax.tex2svg(src, { display: false });
    const svg = node.querySelector('svg');
    const errNode = svg?.querySelector('[data-mjx-error]');
    return { el: node, err: errNode ? errNode.getAttribute('data-mjx-error') : null };
  } catch (e: any) { return { el: null, err: String(e.message || e) }; }
}

export function anchorOffset(e: { x0: number; x1: number; yTop: number; yBot: number }, a: string): [number, number] {
  const cx = (e.x0 + e.x1) / 2, cy = (e.yTop + e.yBot) / 2;
  const map: Record<string, [number, number]> = {
    c: [cx, cy], center: [cx, cy], n: [cx, e.yTop], s: [cx, e.yBot], e: [e.x1, cy], w: [e.x0, cy],
    ne: [e.x1, e.yTop], nw: [e.x0, e.yTop], se: [e.x1, e.yBot], sw: [e.x0, e.yBot], base: [e.x0, 0], basec: [cx, 0], basee: [e.x1, 0],
  };
  return map[a] || map.c;
}
