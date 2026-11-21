// "⤢ Explore" buttons pinned to the corner of every figure on the page.
// Plot frames (frame2d / frame3d) and hand-drawn 3D figures (onpage projectors) both get one.
// The button sits on the figure's footprint on the paper, so it stays on the page however you orbit.
import * as THREE from 'three';
import type { Viewer } from '../render/viewer';
import type { RunCtx } from '../lang/interp';
import { injectExplorerCSS } from './explorer.css';

export type ExploreTarget = { frame: number } | { fig: number };
type Item = { target: ExploreTarget; box: THREE.Box3; el: HTMLElement; rect?: number[] };

export class FigureChips {
  private items: Item[] = [];
  constructor(private host: HTMLElement, private viewer: Viewer, private onOpen: (t: ExploreTarget) => void) {
    injectExplorerCSS();
    viewer.renderer.domElement.addEventListener('dblclick', e => { const t = this.figureAt(e.clientX, e.clientY); if (t) this.onOpen(t); });
  }
  /** call after every page build */
  update(ctx: RunCtx) {
    for (const it of this.items) it.el.remove();
    this.items = [];
    const add = (target: ExploreTarget, box: THREE.Box3 | undefined, dim: number, title: string) => {
      if (!box || box.isEmpty()) return;
      const sz = box.getSize(new THREE.Vector3()); if (Math.hypot(sz.x, sz.y) < 18) return; // tiny marks (axis triads…) get no button
      const el = document.createElement('button'); el.className = 'xp-chip';
      el.textContent = dim === 3 ? '⤢ Explore 3D' : '⤢ Explore';
      el.title = title + ' — or double-click the figure';
      el.onclick = (e) => { e.stopPropagation(); this.onOpen(target); };
      el.onpointerdown = (e) => e.stopPropagation();
      this.host.appendChild(el); this.items.push({ target, box, el });
    };
    const fb = this.viewer.frameBounds();
    ctx.frames.forEach((f, idx) => add({ frame: idx }, fb.get(f.id), f.dim, `Open figure ${idx + 1} (line ${f.line}) in the explorer`));
    const free = new Set<number>();
    for (const [k, m] of Object.entries(ctx.figMeta ?? {})) if (m.free) free.add(+k);
    if (free.size) {
      const counts = new Map<number, number>(); for (const p of ctx.prims) if (free.has(p.fig) && p.kind !== 'tex') counts.set(p.fig, (counts.get(p.fig) ?? 0) + 1);
      const gb = this.viewer.figBounds(free);
      for (const f of free) if ((counts.get(f) ?? 0) >= 2) add({ fig: f }, gb.get(f), 3, `Open this 3D drawing (line ${ctx.figMeta[f].line}) in the explorer`);
    }
    this.position();
  }
  /** call every frame (cheap) */
  position() {
    const cam = this.viewer.camera; const r = this.viewer.el.getBoundingClientRect(); const v = new THREE.Vector3();
    const zp = this.viewer.paperZ;
    const scr = (x: number, y: number, z: number) => { v.set(x, y, z).project(cam); return [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height]; };
    for (const it of this.items) {
      const b = it.box;
      // hit area: the whole figure as drawn plus its footprint
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const grow = (q: number[]) => { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); };
      for (let i = 0; i < 8; i++) grow(scr(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
      const foot = [scr(b.min.x, b.min.y, zp), scr(b.max.x, b.min.y, zp), scr(b.max.x, b.max.y, zp), scr(b.min.x, b.max.y, zp)];
      foot.forEach(grow);
      it.rect = [x0, y0, x1, y1];
      // the button goes on the footprint's top-right corner (on the paper)
      const [cx, cy] = foot[2];
      const fw = Math.max(...foot.map(q => q[0])) - Math.min(...foot.map(q => q[0])), fh = Math.max(...foot.map(q => q[1])) - Math.min(...foot.map(q => q[1]));
      const visible = cx > 40 && cy > -10 && cx < r.width + 40 && cy < r.height && fw > 50 && fh > 30;
      it.el.style.display = visible ? '' : 'none';
      it.el.style.left = Math.min(r.width - 6, Math.max(96, cx)) + 'px';
      it.el.style.top = Math.max(4, Math.min(r.height - 26, cy + 4)) + 'px';
    }
  }
  figureAt(cx: number, cy: number): ExploreTarget | null {
    const r = this.viewer.el.getBoundingClientRect(); const x = cx - r.left, y = cy - r.top;
    let best: { t: ExploreTarget; a: number } | null = null;
    for (const it of this.items) {
      if (!it.rect) continue; const [x0, y0, x1, y1] = it.rect;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) { const a = (x1 - x0) * (y1 - y0); if (!best || a < best.a) best = { t: it.target, a }; }
    }
    return best ? best.t : null;
  }
  get count() { return this.items.length; }
  /** the first explorable figure on the page (for the E shortcut / toolbar button) */
  first(): ExploreTarget | null { return this.items[0]?.target ?? null; }
}
