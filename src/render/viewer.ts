// three.js page viewer: turns .bd primitives into a 3D scene with a paper sheet,
// orbit / ortho cameras, billboarded labels and click-to-source picking.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { getTex, anchorOffset } from './tex';
import { PAGE_STYLES } from '../lang/builtins';
import type { RunCtx } from '../lang/interp';
import { dynVisible } from './dyn';

const FOV = 30;
/** what the picker knows about one drawn mark */
export interface PickRec {
  line: number; inner: number; kind: 'stroke' | 'text' | 'dot' | 'area'; objs: THREE.Object3D[]; order: number; solid?: boolean;
  pts?: number[]; segs?: boolean;                     // stroke polyline (world xyz) or segment pairs
  group?: THREE.Object3D; bbox?: number[]; bb?: boolean; // text: inner group + em bbox [x0, x1, yBot, yTop]
  c?: number[]; r?: number;                           // dot
  prim?: any;
}
const ACCENT = new THREE.Color('#36b4ff');
export function parseColor(c: string): [THREE.Color, number] {
  const s = String(c);
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(s);
  const col = new THREE.Color();
  if (m) { col.setRGB(+m[1] / 255, +m[2] / 255, +m[3] / 255, THREE.SRGBColorSpace); return [col, +m[4]]; }
  try { col.set(s); } catch { col.set('#ff00ff'); }
  return [col, 1];
}

/** points of a primitive (for lifting figures off the paper) */
function forEachZ(p: any, f: (z: number) => number | void) {
  const arrs = p.kind === 'line' || p.kind === 'poly' ? p.pts : p.kind === 'arrow' ? [p.a, p.b] : p.kind === 'tex' ? [p.pos] : p.kind === 'dot' ? [p.p] : null;
  if (arrs) { for (const q of arrs) { const r = f(q[2]); if (typeof r === 'number') q[2] = r; } return; }
  if (p.kind === 'trimesh' || p.kind === 'segs') for (let i = 2; i < p.pos.length; i += 3) { if (!isFinite(p.pos[i])) continue; const r = f(p.pos[i]); if (typeof r === 'number') p.pos[i] = r; }
}

export class Viewer {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); content = new THREE.Group();
  persp = new THREE.PerspectiveCamera(FOV, 1, 1, 50000);
  ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -50000, 50000);
  camera: THREE.Camera; controls: OrbitControls;
  orthoH = 320; page = { w: 210, h: 297 }; billboards: THREE.Object3D[] = []; lineMats: LineMaterial[] = [];
  disposables: { dispose(): void }[] = []; dirty = true; shadowTex: THREE.Texture | null = null;
  onUserCamera: () => void = () => {};
  picks: PickRec[] = []; private cur: PickRec | null = null; private lit = new Map<any, THREE.Color>();
  dynObjs: { o: THREE.Object3D; dyn: any }[] = []; private lastDyn = '';

  /** probes and helpers drawn by the Figure Explorer; never cleared by build() */
  overlay = new THREE.Group(); overlayMats: LineMaterial[] = [];
  readonly mode: 'page' | 'explore';
  constructor(public el: HTMLElement, opts: { mode?: 'page' | 'explore' } = {}) {
    this.mode = opts.mode ?? 'page';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: this.mode === 'explore' });
    // render at ≥1.5× even on standard screens: smoother glyph edges and hairlines
    this.renderer.setPixelRatio(Math.min(2, Math.max(1.5, window.devicePixelRatio || 1)));
    Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });
    el.prepend(this.renderer.domElement);
    this.scene.background = new THREE.Color(this.mode === 'explore' ? '#fbfcfd' : '#202124');
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(-0.4, 0.8, 1); this.scene.add(sun);
    const sun2 = new THREE.DirectionalLight(0xffffff, 0.55); sun2.position.set(0.6, -0.3, -0.6); this.scene.add(sun2);
    this.scene.add(this.content); this.scene.add(this.overlay);
    this.camera = this.ortho;
    this.controls = this.makeControls();
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
  }
  private makeControls() {
    const c = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(c, { enableDamping: true, dampingFactor: 0.12, screenSpacePanning: true, zoomSpeed: 1.1, rotateSpeed: 0.8 });
    c.addEventListener('change', () => (this.dirty = true));
    c.addEventListener('start', () => { this.el.classList.add('dragging'); this.onUserCamera(); });
    c.addEventListener('end', () => this.el.classList.remove('dragging'));
    return c;
  }
  /** turntable around `up` (the explorer orbits around a figure's own z-axis) */
  setUp(up: THREE.Vector3) {
    const t = this.controls.target.clone(), en = this.controls.enabled, rot = this.controls.enableRotate;
    this.controls.dispose();
    this.persp.up.copy(up); this.ortho.up.copy(up);
    this.controls = this.makeControls(); this.controls.target.copy(t); this.controls.enabled = en; this.controls.enableRotate = rot;
    this.controls.update(); this.dirty = true;
  }
  /** look at the centre from direction `dir` with `up` pointing up; zoom = 1 fits */
  placeDir(dir: THREE.Vector3, up: THREE.Vector3, zoom = 1) {
    const fh = this.fitHeight(), target = this.center(); const d = dir.clone().normalize();
    this.controls.target.copy(target);
    for (const cam of [this.ortho, this.persp]) cam.up.copy(up);
    if (this.isOrtho) { this.orthoH = fh; this.updateOrtho(); this.ortho.position.copy(target).addScaledVector(d, 3000); this.ortho.zoom = zoom; this.ortho.updateProjectionMatrix(); }
    else this.persp.position.copy(target).addScaledVector(d, (fh / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / zoom);
    this.camera.lookAt(target); this.controls.update(); this.dirty = true;
  }
  get isOrtho() { return this.camera === this.ortho; }
  size(): [number, number] { const r = this.el.getBoundingClientRect(); return [Math.max(1, r.width), Math.max(1, r.height)]; }
  fitHeight() { const [w, h] = this.size(); return Math.max(this.page.h, this.page.w / (w / h)) * 1.08; }
  updateOrtho() { const [w, h] = this.size(); const a = w / h; Object.assign(this.ortho, { left: -this.orthoH * a / 2, right: this.orthoH * a / 2, top: this.orthoH / 2, bottom: -this.orthoH / 2 }); this.ortho.updateProjectionMatrix(); }
  resize() {
    const [w, h] = this.size();
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    this.updateOrtho();
    for (const m of [...this.lineMats, ...this.overlayMats]) m.resolution.set(w, h);
    this.dirty = true;
  }
  center() { return new THREE.Vector3(this.page.w / 2, this.page.h / 2, 0); }
  /** yaw/pitch in radians around the page centre; zoom = 1 fits the page */
  place(yaw: number, pitch: number, zoom: number) {
    const fh = this.fitHeight(), target = this.center();
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.controls.target.copy(target);
    if (this.isOrtho) {
      this.orthoH = fh; this.updateOrtho();
      this.ortho.position.copy(target).addScaledVector(dir, 3000); this.ortho.zoom = zoom; this.ortho.up.set(0, 1, 0); this.ortho.updateProjectionMatrix();
    } else {
      const d = (fh / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / zoom;
      this.persp.position.copy(target).addScaledVector(dir, d); this.persp.up.set(0, 1, 0);
    }
    this.camera.lookAt(target); this.controls.update(); this.dirty = true;
  }
  setOrtho(on: boolean) {
    if (this.isOrtho === on) return;
    const target = this.controls.target.clone(), dir = this.camera.position.clone().sub(target).normalize();
    const tanH = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    if (on) {
      const dist = this.persp.position.distanceTo(target);
      this.orthoH = this.fitHeight(); this.updateOrtho();
      this.ortho.zoom = this.orthoH / (2 * dist * tanH);
      this.ortho.position.copy(target).addScaledVector(dir, 3000);
      this.ortho.quaternion.copy(this.persp.quaternion); this.ortho.up.copy(this.persp.up); this.ortho.updateProjectionMatrix();
      this.camera = this.ortho;
    } else {
      const dist = (this.orthoH / this.ortho.zoom) / (2 * tanH);
      this.persp.position.copy(target).addScaledVector(dir, dist);
      this.persp.quaternion.copy(this.ortho.quaternion); this.persp.up.copy(this.ortho.up);
      this.camera = this.persp;
    }
    (this.controls as any).object = this.camera; this.controls.update(); this.dirty = true;
  }
  /** pixels per millimetre at the focus point, for hairline widths */
  pxPerMm() {
    const [, h] = this.size();
    if (this.isOrtho) return h * this.ortho.zoom / this.orthoH;
    const d = this.persp.position.distanceTo(this.controls.target);
    return h / (2 * d * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
  }
  /** line widths are millimetres; never draw thinner than 1 px — fade instead (hairline rendering) */
  updateLines(pxPerMm: number) {
    for (const m of this.lineMats) {
      const px = m.userData.wmm * pxPerMm, op = m.userData.op;
      if (px >= 1) { m.linewidth = px; m.opacity = op; } else { m.linewidth = 1; m.opacity = op * Math.max(0.3, px); }
    }
    for (const m of this.overlayMats) m.linewidth = m.userData.px ?? 2;
  }
  updateDyn(cam: THREE.Camera = this.camera) {
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion);
    const key = v.toArray().map(x => x.toFixed(3)).join();
    if (key === this.lastDyn) return; this.lastDyn = key;
    const t = v.toArray();
    for (const d of this.dynObjs) d.o.visible = !d.o.userData.hide && dynVisible(d.dyn, t);
  }
  /** apply userData.hide flags (explorer layer toggles) */
  applyHidden() {
    const dyn = new Set(this.dynObjs.map(d => d.o));
    this.content.traverse(o => { if (o === this.content || dyn.has(o)) return; if (o.userData.line !== undefined) o.visible = !o.userData.hide; });
    this.lastDyn = ''; this.dirty = true;
  }
  /** world-space bounds of every figure (frame) on the page, for the Explore buttons */
  frameBounds(): Map<number, THREE.Box3> {
    const out = new Map<number, THREE.Box3>(); this.content.updateMatrixWorld(true);
    for (const r of this.picks) {
      const f = r.prim?.frame; if (!f || (r.prim.role !== 'deco' && r.prim.role !== 'plot')) continue;
      if (r.kind === 'text') continue;
      let b = out.get(f); if (!b) { b = new THREE.Box3(); out.set(f, b); }
      for (const o of r.objs) { try { b.expandByObject(o); } catch { /* ignore */ } }
    }
    return out;
  }
  render() {
    this.updateDyn(); this.updateLines(this.pxPerMm());
    for (const b of this.billboards) { b.quaternion.copy(this.camera.quaternion); if (b.userData.rot) b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), b.userData.rot)); }
    this.renderer.render(this.scene, this.camera); this.dirty = false;
  }
  tick() { this.controls.update(); if (this.dirty) this.render(); }

  /** Find the mark under a client point. Strokes, text and dots are matched by on-screen distance
   *  (so thin lines and gaps between letters still hit); filled areas by ray casting; marks hidden behind
   *  a surface are ignored. Returns the record (with its source lines) or null. */
  pickAt(clientX: number, clientY: number): PickRec | null {
    if (!this.picks.length) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top, W = rect.width, H = rect.height;
    const cam = this.camera; cam.updateMatrixWorld(); this.content.updateMatrixWorld(true);
    for (const b of this.billboards) { b.quaternion.copy(cam.quaternion); if (b.userData.rot) b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), b.userData.rot)); b.updateMatrixWorld(true); }
    const view = cam.matrixWorldInverse;
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const scr = (x: number, y: number, z: number) => { v.set(x, y, z).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H, v.z]; };
    const depth = (x: number, y: number, z: number) => -w.set(x, y, z).applyMatrix4(view).z;
    // nearest filled area under the cursor (occluder)
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(mx / W * 2 - 1, -(my / H) * 2 + 1), cam);
    const shown = (p: PickRec) => p.objs.some(o => o.visible);
    const areaObjs = this.picks.filter(p => p.kind === 'area' && shown(p)).flatMap(p => p.objs);
    let areaHit: { rec: PickRec; d: number } | null = null; let occluder = Infinity;
    try {
      const hits = ray.intersectObjects(areaObjs, false);
      const solidHit = hits.find(h => this.picks.find(p => p.objs.includes(h.object))?.solid);
      if (solidHit) occluder = depth(solidHit.point.x, solidHit.point.y, solidHit.point.z);
      if (hits.length) {
        const d0 = hits[0].distance;
        const near = hits.filter(h => h.distance - d0 < 0.05).sort((a, b) => b.object.renderOrder - a.object.renderOrder)[0];
        const rec = this.picks.find(p => p.objs.includes(near.object))!;
        areaHit = { rec, d: depth(near.point.x, near.point.y, near.point.z) };
      }
    } catch { /* ignore */ }
    const occluded = (d: number) => d > occluder + 0.4;
    type Cand = { rec: PickRec; dist: number; prio: number; d: number };
    const cands: Cand[] = [];
    for (const p of this.picks) {
      if (!shown(p)) continue;
      if (p.kind === 'stroke' && p.pts && p.pts.length >= 6) {
        const P = p.pts, step = p.segs ? 6 : 3; let best = Infinity, bd = 0;
        for (let i = 0; i + 5 < P.length; i += step) {
          const a = scr(P[i], P[i + 1], P[i + 2]), b = scr(P[i + 3], P[i + 4], P[i + 5]);
          const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
          let t = L2 > 0 ? ((mx - a[0]) * dx + (my - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(mx - (a[0] + dx * t), my - (a[1] + dy * t));
          if (d < best) { best = d; bd = depth(P[i] + (P[i + 3] - P[i]) * t, P[i + 1] + (P[i + 4] - P[i + 1]) * t, P[i + 2] + (P[i + 5] - P[i + 2]) * t); }
        }
        if (best <= 7 && !occluded(bd)) cands.push({ rec: p, dist: best, prio: 2, d: bd });
      } else if (p.kind === 'text' && p.group && p.bbox) {
        const [x0, x1, y0, y1] = p.bbox;
        const q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => { const u = new THREE.Vector3(x, y, 0).applyMatrix4(p.group!.matrixWorld); return [...scr(u.x, u.y, u.z), depth(u.x, u.y, u.z)]; });
        let inside = true, edge = Infinity;
        for (let i = 0; i < 4; i++) {
          const a = q[i], b = q[(i + 1) % 4]; const cr = (b[0] - a[0]) * (my - a[1]) - (b[1] - a[1]) * (mx - a[0]);
          const sgn = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]);
          if (cr * sgn < 0) inside = false;
          const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let t = L2 > 0 ? ((mx - a[0]) * dx + (my - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
          edge = Math.min(edge, Math.hypot(mx - (a[0] + dx * t), my - (a[1] + dy * t)));
        }
        const dist = inside ? 1.2 : edge + 1.2, d = (q[0][3] + q[2][3]) / 2;
        if (dist <= 4.2 && !occluded(d)) cands.push({ rec: p, dist, prio: 0, d });
      } else if (p.kind === 'dot' && p.c) {
        const c = scr(p.c[0], p.c[1], p.c[2]);
        const e = scr(p.c[0] + p.r!, p.c[1], p.c[2]); const rp = Math.max(2, Math.hypot(e[0] - c[0], e[1] - c[1]));
        const dist = Math.max(0, Math.hypot(mx - c[0], my - c[1]) - rp), d = depth(p.c[0], p.c[1], p.c[2]);
        if (dist <= 5 && !occluded(d)) cands.push({ rec: p, dist, prio: 1, d });
      }
    }
    if (cands.length) {
      const best = Math.min(...cands.map(c => c.dist));
      const near = cands.filter(c => c.dist <= best + 0.75);
      near.sort((a, b) => (a.rec.bb ? 0 : 1) - (b.rec.bb ? 0 : 1) || b.rec.order - a.rec.order || a.d - b.d);
      return near[0].rec;
    }
    return areaHit ? areaHit.rec : null;
  }
  /** tint the given marks (hover / editor selection) */
  highlight(recs: PickRec[]) {
    for (const [m, c] of this.lit) m.color.copy(c);
    this.lit.clear();
    for (const r of recs) for (const o of r.objs) {
      const m: any = (o as any).material; if (!m || !m.color || m.vertexColors || this.lit.has(m)) continue;
      this.lit.set(m, m.color.clone());
      m.color.lerp(ACCENT, r.kind === 'area' ? 0.35 : 0.8);
    }
    this.dirty = true;
  }

  /** offscreen high-resolution render of the straight-on page view */
  snapshotPage(dpi = 200): string {
    const W = Math.round(this.page.w / 25.4 * dpi), H = Math.round(this.page.h / 25.4 * dpi);
    const cam = new THREE.OrthographicCamera(0, this.page.w, this.page.h, 0, -50000, 50000);
    cam.position.set(0, 0, 3000); cam.lookAt(0, 0, 0); cam.position.set(0, 0, 3000);
    cam.left = 0; cam.right = this.page.w; cam.top = this.page.h; cam.bottom = 0;
    cam.position.set(0, 0, 3000); cam.updateProjectionMatrix();
    const [vw, vh] = this.size(); const pr = this.renderer.getPixelRatio();
    const bg = this.scene.background; this.scene.background = null;
    this.renderer.setPixelRatio(1); this.renderer.setSize(W, H, false);
    for (const m of this.lineMats) m.resolution.set(W, H);
    for (const b of this.billboards) b.quaternion.copy(cam.quaternion);
    this.lastDyn = ''; this.updateDyn(cam); this.updateLines(W / this.page.w);
    this.renderer.render(this.scene, cam);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.background = bg; this.renderer.setPixelRatio(pr); this.renderer.setSize(vw, vh, false);
    for (const m of this.lineMats) m.resolution.set(vw, vh);
    this.lastDyn = ''; this.dirty = true; this.render();
    return url;
  }
  snapshotView(): string { this.render(); return this.renderer.domElement.toDataURL('image/png'); }

  // ---------------------------------------------------------------- scene building
  build(ctx: RunCtx, warnings: { line: number; msg: string }[]) {
    for (const d of this.disposables) d.dispose();
    this.disposables = []; this.billboards = []; this.lineMats = []; this.picks = []; this.lit.clear(); this.dynObjs = []; this.lastDyn = '';
    this.content.clear();
    const [vw, vh] = this.size();
    const pg = ctx.page, style = PAGE_STYLES[pg.style];
    this.page = { w: pg.w, h: pg.h };
    const D = <T extends { dispose(): void }>(x: T) => { this.disposables.push(x); return x; };

    // figures made through a projector are lifted as a unit so they float just above the paper
    const explore = this.mode === 'explore';
    const lifts = (f: number) => !!f && !explore && ctx.figMeta?.[f]?.dim !== 2;
    const figMin = new Map<number, number>();
    for (const p of ctx.prims) if (lifts(p.fig)) { let mz = figMin.get(p.fig) ?? 0; forEachZ(p, z => { mz = Math.min(mz, z - (p.kind === 'dot' ? p.r : p.kind === 'arrow' ? p.head * 0.4 : 0)); }); figMin.set(p.fig, mz); }
    let minZ = 0;
    for (const p of ctx.prims) {
      if (lifts(p.fig)) { const lift = 0.8 - figMin.get(p.fig)!; forEachZ(p, z => z + lift); p.flat = false; continue; }
      let flat = true; forEachZ(p, z => { if (Math.abs(z) > 1e-9) flat = false; });
      p.flat = flat;
      if (!flat) forEachZ(p, z => { minZ = Math.min(minZ, z); });
    }
    const pageZ = Math.min(-0.25, minZ - 1.2), flatZ = explore ? 0 : pageZ + 0.03;

    // paper with a soft shadow
    const thick = 0.5;
    if (!explore) {
    const top = D(new THREE.MeshBasicMaterial({ color: style.bg })), side = D(new THREE.MeshBasicMaterial({ color: new THREE.Color(style.bg).multiplyScalar(0.78) }));
    const paper = new THREE.Mesh(D(new THREE.BoxGeometry(pg.w, pg.h, thick)), [side, side, side, side, top, side]);
    paper.position.set(pg.w / 2, pg.h / 2, pageZ - thick / 2); this.content.add(paper);
    if (!this.shadowTex) {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128); this.shadowTex = new THREE.CanvasTexture(c); this.shadowTex.colorSpace = THREE.SRGBColorSpace;
    }
    const shadow = new THREE.Mesh(D(new THREE.PlaneGeometry(pg.w * 1.22, pg.h * 1.16)), D(new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false })));
    shadow.position.set(pg.w / 2 + 2, pg.h / 2 - 3, pageZ - thick - 3); this.content.add(shadow);
    if (style.grid || style.dots) {
      const s = style.grid || style.dots; const v: number[] = [];
      if (style.grid) {
        for (let x = s; x < pg.w - 1e-6; x += s) v.push(x, 0, flatZ - 0.01, x, pg.h, flatZ - 0.01);
        for (let y = s; y < pg.h - 1e-6; y += s) v.push(0, y, flatZ - 0.01, pg.w, y, flatZ - 0.01);
        const g = D(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        const ls = new THREE.LineSegments(g, D(new THREE.LineBasicMaterial({ color: style.dark ? '#3c6eaa' : '#cfe0f2', depthWrite: false }))); ls.renderOrder = 1; this.content.add(ls);
      } else {
        for (let x = s; x < pg.w; x += s) for (let y = s; y < pg.h; y += s) v.push(x, y, flatZ - 0.01);
        const g = D(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        const pts = new THREE.Points(g, D(new THREE.PointsMaterial({ color: '#b9c4d0', size: 2, sizeAttenuation: false, depthWrite: false }))); pts.renderOrder = 1; this.content.add(pts);
      }
    }
    }

    const flatO = (o: THREE.Object3D, p: any) => { o.renderOrder = 10 + p.order; };
    const solidO = (o: THREE.Object3D, p: any) => { o.renderOrder = 100000 + p.order; };
    let rec: PickRec = null as any;
    const tag = (o: THREE.Object3D, p: any) => { o.userData.line = p.line; rec?.objs.push(o); if (p.dyn) this.dynObjs.push({ o, dyn: p.dyn }); return o; };
    const Z = (p: any, z: number) => (p.flat ? flatZ : z);
    const lineMat = (p: any, flat: boolean) => {
      const [col, a] = parseColor(p.color); const op = a * (p.opacity ?? 1); const dash = p.dash;
      const m = D(new LineMaterial({
        color: col.getHex(), linewidth: 1, worldUnits: false, transparent: true, opacity: op, depthWrite: !flat,
        dashed: !!dash, dashSize: typeof dash === 'number' ? dash : (dash?.c?.[0] ?? 1), gapSize: typeof dash === 'number' ? dash * 0.8 : (dash?.c?.[1] ?? 0.8),
      }));
      (m as any).color = col; m.userData.wmm = p.width; m.userData.op = op; m.resolution.set(vw, vh); this.lineMats.push(m); return m;
    };
    const mkLine = (p: any, pts: number[][], closed: boolean) => {
      const arr: number[] = [];
      for (const q of pts) arr.push(q[0], q[1], Z(p, q[2]));
      if (closed) arr.push(arr[0], arr[1], arr[2]);
      if (arr.length < 6) return;
      const g = D(new LineGeometry()); g.setPositions(arr);
      const l = new Line2(g, lineMat(p, p.flat)); if (p.dash) l.computeLineDistances();
      if (rec && rec.kind === 'stroke') rec.pts = rec.pts ? [...rec.pts, ...arr] : arr;
      p.flat ? flatO(l, p) : solidO(l, p); this.content.add(tag(l, p));
    };
    const basic = (color: string, opacity: number, flat: boolean, extra: any = {}) => {
      const [col, a] = parseColor(color); const op = a * opacity;
      return D(new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: op < 1 || flat, opacity: op, depthWrite: !flat && op >= 1, ...extra }));
    };

    for (const p of ctx.prims) {
      const kind = p.kind === 'tex' ? 'text' : p.kind === 'dot' ? 'dot' : p.kind === 'poly' || p.kind === 'trimesh' ? 'area' : 'stroke';
      rec = { line: p.line, inner: p.inner ?? p.line, kind, objs: [], order: p.order ?? 0, solid: kind === 'area' && (p.opacity ?? 1) >= 1 && !p.flat, prim: p }; this.picks.push(rec);
      try {
        switch (p.kind) {
          case 'line': mkLine(p, p.pts, p.closed); break;
          case 'segs': {
            const arr = new Float32Array(p.pos.length); for (let i = 0; i < p.pos.length; i += 3) { arr[i] = p.pos[i]; arr[i + 1] = p.pos[i + 1]; arr[i + 2] = Z(p, p.pos[i + 2]); }
            if (arr.length < 6) break;
            const g = D(new LineSegmentsGeometry()); g.setPositions(arr);
            const l = new LineSegments2(g, lineMat(p, p.flat)); if (p.dash) l.computeLineDistances();
            rec.pts = Array.from(arr); rec.segs = true;
            p.flat ? flatO(l, p) : solidO(l, p); this.content.add(tag(l, p)); break;
          }
          case 'poly': {
            const pts = p.pts.map((q: number[]) => new THREE.Vector3(q[0], q[1], Z(p, q[2])));
            const n = new THREE.Vector3();
            for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
            if (n.lengthSq() < 1e-12) break;
            n.normalize();
            const u = new THREE.Vector3(1, 0, 0); if (Math.abs(n.dot(u)) > 0.9) u.set(0, 1, 0);
            u.sub(n.clone().multiplyScalar(n.dot(u))).normalize(); const v = new THREE.Vector3().crossVectors(n, u);
            const tris = THREE.ShapeUtils.triangulateShape(pts.map((q: THREE.Vector3) => new THREE.Vector2(q.dot(u), q.dot(v))), []);
            const g = D(new THREE.BufferGeometry().setFromPoints(pts)); g.setIndex(tris.flat());
            const m = basic(p.fill, p.opacity, p.flat, p.opacity < 1 ? { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } : {});
            if (!p.flat && p.opacity < 1) m.depthWrite = false;
            const mesh = new THREE.Mesh(g, m); p.flat ? flatO(mesh, p) : solidO(mesh, p); this.content.add(tag(mesh, p)); break;
          }
          case 'trimesh': {
            const pos = new Float32Array(p.pos.length);
            for (let i = 0; i < p.pos.length; i += 3) { const ok = isFinite(p.pos[i]); pos[i] = ok ? p.pos[i] : 0; pos[i + 1] = ok ? p.pos[i + 1] : 0; pos[i + 2] = ok ? Z(p, p.pos[i + 2]) : 0; }
            const g = D(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(p.idx);
            if (p.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
            if (p.colors) {
              const c = new Float32Array(p.colors.length); const tmp = new THREE.Color();
              for (let i = 0; i < c.length; i += 3) { tmp.setRGB(p.colors[i], p.colors[i + 1], p.colors[i + 2], THREE.SRGBColorSpace); c[i] = tmp.r; c[i + 1] = tmp.g; c[i + 2] = tmp.b; }
              g.setAttribute('color', new THREE.BufferAttribute(c, 3));
            }
            if (p.lit) g.computeVertexNormals();
            const [col, a] = parseColor(p.color); const op = a * (p.opacity ?? 1);
            const opts: any = { color: p.colors ? 0xffffff : col, vertexColors: !!p.colors, side: THREE.DoubleSide, transparent: op < 1 || p.flat, opacity: op, depthWrite: !p.flat && op >= 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
            const m = D(p.lit ? new THREE.MeshLambertMaterial(opts) : new THREE.MeshBasicMaterial(opts));
            const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false;
            p.flat ? flatO(mesh, p) : solidO(mesh, p); this.content.add(tag(mesh, p)); break;
          }
          case 'arrow': {
            const a = new THREE.Vector3(p.a[0], p.a[1], Z(p, p.a[2])), b = new THREE.Vector3(p.b[0], p.b[1], Z(p, p.b[2]));
            const d = b.clone().sub(a); const L = d.length(); if (L < 1e-9) break; d.divideScalar(L);
            const head = Math.min(p.head, L * 0.6), hw = head * 0.36;
            const tipBase = b.clone().addScaledVector(d, -head * 0.85);
            const start = p.both ? a.clone().addScaledVector(d, head * 0.85) : a;
            mkLine({ ...p, flat: false }, [[start.x, start.y, start.z], [tipBase.x, tipBase.y, tipBase.z]], false);
            const heads: [THREE.Vector3, THREE.Vector3][] = p.both ? [[b, d], [a, d.clone().negate()]] : [[b, d]];
            for (const [tip, dir] of heads) {
              const m = basic(p.color, 1, p.flat); let mesh: THREE.Mesh;
              if (p.flat) {
                const nrm = new THREE.Vector3(-dir.y, dir.x, 0), base = tip.clone().addScaledVector(dir, -head);
                const g = D(new THREE.BufferGeometry().setFromPoints([tip, base.clone().addScaledVector(nrm, hw), base.clone().addScaledVector(dir, head * 0.18), base.clone().addScaledVector(nrm, -hw)]));
                g.setIndex([0, 1, 2, 0, 2, 3]); mesh = new THREE.Mesh(g, m); flatO(mesh, p);
              } else {
                const g = D(new THREE.ConeGeometry(hw, head, 18)); g.translate(0, -head / 2, 0);
                mesh = new THREE.Mesh(g, m); mesh.position.copy(tip); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); solidO(mesh, p);
              }
              this.content.add(tag(mesh, p));
            }
            break;
          }
          case 'dot': {
            let mesh: THREE.Mesh;
            rec.c = [p.p[0], p.p[1], p.flat ? flatZ : p.p[2]]; rec.r = p.r;
            if (p.flat) { mesh = new THREE.Mesh(D(new THREE.CircleGeometry(p.r, 28)), basic(p.color, 1, true)); mesh.position.set(p.p[0], p.p[1], flatZ); flatO(mesh, p); }
            else { mesh = new THREE.Mesh(D(new THREE.SphereGeometry(p.r, 20, 14)), basic(p.color, 1, false)); mesh.position.set(p.p[0], p.p[1], p.p[2]); solidO(mesh, p); }
            this.content.add(tag(mesh, p)); break;
          }
          case 'tex': {
            const e = getTex(p.src, p.display);
            if (e.err) warnings.push({ line: p.line, msg: `TeX: ${e.err}` });
            const outer = new THREE.Group(), inner = new THREE.Group();
            const [ax, ay] = anchorOffset(e, p.anchor);
            inner.position.set(-ax, -ay, 0); outer.add(inner);
            const s = p.size * 0.352778; outer.scale.set(s, s, s);
            const bb = p.face === 'viewer' || (p.face === 'auto' && !p.flat);
            outer.position.set(p.pos[0], p.pos[1], Z(p, p.pos[2]) + (bb || p.flat ? 0 : 0.01));
            if (!bb) outer.rotation.z = p.rot;
            for (const grp of e.groups) {
              const mesh = new THREE.Mesh(grp.geom, basic(grp.color || p.color, p.opacity, p.flat || bb));   // labels hide behind the paper / solids
              if (bb) mesh.renderOrder = 200000 + p.order; else p.flat ? flatO(mesh, p) : solidO(mesh, p);
              inner.add(tag(mesh, p));
            }
            rec.group = inner; rec.bbox = [e.x0, e.x1, e.yBot, e.yTop]; rec.bb = bb;
            if (bb) { outer.userData.rot = p.rot; this.billboards.push(outer); }
            this.content.add(outer); break;
          }
        }
      } catch (err: any) { warnings.push({ line: p.line, msg: 'render: ' + err.message }); }
    }
    this.picks = this.picks.filter(r => r.objs.length);
    this.dirty = true;
  }
}
