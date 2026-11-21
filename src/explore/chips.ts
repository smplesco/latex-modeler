// "⤢ Explore" buttons pinned to the corner of every figure on the page.
import * as THREE from 'three';
import type { Viewer } from '../render/viewer';
import type { RunCtx } from '../lang/interp';
import { injectExplorerCSS } from './explorer.css';

export class FigureChips {
  private items: { idx: number; box: THREE.Box3; el: HTMLElement; rect?: number[] }[] = [];
  constructor(private host: HTMLElement, private viewer: Viewer, private onOpen: (idx: number) => void) {
    injectExplorerCSS();
    viewer.renderer.domElement.addEventListener('dblclick', e => { const i = this.figureAt(e.clientX, e.clientY); if (i !== null) this.onOpen(i); });
  }
  /** call after every page build */
  update(ctx: RunCtx) {
    for (const it of this.items) it.el.remove();
    this.items = [];
    const bounds = this.viewer.frameBounds();
    ctx.frames.forEach((f, idx) => {
      const box = bounds.get(f.id); if (!box || box.isEmpty()) return;
      const el = document.createElement('button'); el.className = 'xp-chip';
      el.textContent = f.dim === 3 ? '⤢ Explore 3D' : '⤢ Explore';
      el.title = `Open figure ${idx + 1} (line ${f.line}) in the explorer — or double-click the figure`;
      el.onclick = (e) => { e.stopPropagation(); this.onOpen(idx); };
      el.onpointerdown = (e) => e.stopPropagation();
      this.host.appendChild(el); this.items.push({ idx, box, el });
    });
    this.position();
  }
  /** call every frame (cheap) */
  position() {
    const cam = this.viewer.camera; const r = this.viewer.el.getBoundingClientRect(); const v = new THREE.Vector3();
    for (const it of this.items) {
      const b = it.box; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(cam);
        const sx = (v.x + 1) / 2 * r.width, sy = (1 - v.y) / 2 * r.height;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      it.rect = [x0, y0, x1, y1];
      const visible = x1 > 0 && y1 > 0 && x0 < r.width && y0 < r.height && x1 - x0 > 50 && y1 - y0 > 40;
      it.el.style.display = visible ? '' : 'none';
      it.el.style.left = Math.min(r.width - 6, Math.max(90, x1)) + 'px';
      it.el.style.top = Math.max(4, Math.min(r.height - 26, y0 + 2)) + 'px';
    }
  }
  figureAt(cx: number, cy: number): number | null {
    const r = this.viewer.el.getBoundingClientRect(); const x = cx - r.left, y = cy - r.top;
    let best: { idx: number; a: number } | null = null;
    for (const it of this.items) {
      if (!it.rect) continue; const [x0, y0, x1, y1] = it.rect;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) { const a = (x1 - x0) * (y1 - y0); if (!best || a < best.a) best = { idx: it.idx, a }; }
    }
    return best ? best.idx : null;
  }
  get count() { return this.items.length; }
}
