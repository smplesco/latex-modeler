// Ink on a page: pen, highlighter and a fading laser pointer, drawn straight onto the 3D scene.
// A stroke follows what's under the pointer: the paper (it stays flat on the sheet as you orbit) or a 3D
// surface (it stays stuck to the surface). Strokes are kept with the document, not in its code.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Viewer } from './viewer';

export type InkTool = 'pen' | 'hl' | 'laser';
/** one stroke: points as x, y, z in page millimetres; z = NaN means "on the paper" (follows the sheet) */
export interface Stroke { tool: 'pen' | 'hl'; color: string; w: number; pts: number[] }

const LASER_HOLD = 900, LASER_FADE = 700;

export class Ink {
  strokes: Stroke[] = [];
  tool: InkTool = 'pen'; color = '#e5484d'; on = false;
  onChange: (() => void) | null = null;
  private drawing: { s: Stroke; line: Line2 | null; laser?: boolean } | null = null;
  private lasers: { line: Line2; mat: LineMaterial; t: number }[] = [];
  private ray = new THREE.Raycaster();
  private saved: any = null;

  constructor(private v: Viewer) {
    const el = v.renderer.domElement;
    // capture phase: while inking, a press draws instead of picking or orbiting
    el.addEventListener('pointerdown', e => this.down(e), { capture: true });
    el.addEventListener('pointermove', e => this.move(e), { capture: true });
    el.addEventListener('pointerup', e => this.up(e), { capture: true });
    el.addEventListener('pointercancel', e => this.up(e), { capture: true });
  }

  /** inking on: left button / one finger draws; right-drag still turns the page, wheel still zooms */
  setOn(on: boolean) {
    if (on === this.on) return; this.on = on;
    const c = this.v.controls as any;
    if (on) {
      this.saved = { mouse: { ...c.mouseButtons }, touches: { ...c.touches } };
      c.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
      c.touches = { ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE };
    } else if (this.saved) { c.mouseButtons = this.saved.mouse; c.touches = this.saved.touches; }
    this.v.renderer.domElement.style.cursor = on ? 'crosshair' : '';
  }

  /** replace all strokes (switching documents) */
  set(list: Stroke[] | undefined) {
    // saved copies come back through JSON, which writes NaN ("on the paper") as null
    const fix = (s: any) => (s && Array.isArray(s.pts) ? { ...s, pts: s.pts.map((x: any) => (x === null ? NaN : x)) } : s);
    this.strokes = (Array.isArray(list) ? list : []).map(fix).filter(okStroke);
    this.redraw();
  }
  undo() { if (this.strokes.pop()) { this.redraw(); this.onChange?.(); } }
  clear() { if (this.strokes.length) { this.strokes = []; this.redraw(); this.onChange?.(); } }

  /** rebuild every stroke's line (after a page rebuild the paper may sit at a slightly different depth) */
  redraw() {
    const v = this.v;
    for (const c of [...v.ink.children]) { if (!this.lasers.some(l => l.line === c)) { v.ink.remove(c); this.disposeLine(c as Line2); } }
    for (const s of this.strokes) v.ink.add(this.lineFor(s));
    v.dirty = true;
  }
  /** keep the laser fading: true while something is still animating */
  tick(now = performance.now()): boolean {
    if (!this.lasers.length) return false;
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const L = this.lasers[i], age = now - L.t;
      if (age > LASER_HOLD + LASER_FADE) { this.v.ink.remove(L.line); this.disposeLine(L.line); this.lasers.splice(i, 1); this.v.inkMats = this.v.inkMats.filter(m => m !== L.mat); continue; }
      L.mat.opacity = age < LASER_HOLD ? 0.9 : 0.9 * (1 - (age - LASER_HOLD) / LASER_FADE);
    }
    this.v.dirty = true; return true;
  }

  private z0() { return this.v.paperZ + 0.08; }
  private positions(s: Stroke): number[] {
    const out: number[] = [], z0 = this.z0();
    for (let i = 0; i < s.pts.length; i += 3) out.push(s.pts[i], s.pts[i + 1], Number.isNaN(s.pts[i + 2]) ? z0 + (s.tool === 'hl' ? -0.02 : 0) : s.pts[i + 2]);
    if (out.length === 3) out.push(out[0] + 0.01, out[1], out[2]);   // a dot
    return out;
  }
  private lineFor(s: Stroke, laser = false): Line2 {
    const g = new LineGeometry(); g.setPositions(this.positions(s));
    const [w, h] = this.v.size();
    const m = new LineMaterial({ color: new THREE.Color(s.color).getHex(), linewidth: 2, transparent: true, opacity: s.tool === 'hl' ? 0.38 : laser ? 0.9 : 1, depthWrite: false });
    m.userData.wmm = s.w; m.resolution.set(w, h); this.v.inkMats.push(m);
    const l = new Line2(g, m); l.renderOrder = s.tool === 'hl' ? 199990 : 200000; l.computeLineDistances();
    return l;
  }
  private disposeLine(l: Line2) { l.geometry.dispose(); const m = l.material as LineMaterial; this.v.inkMats = this.v.inkMats.filter(x => x !== m); m.dispose(); }

  /** the point under the pointer: on a surface if one is hit, otherwise on the paper's plane */
  private pointAt(e: PointerEvent): number[] | null {
    const v = this.v, r = v.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, v.camera as THREE.PerspectiveCamera);
    const meshes: THREE.Object3D[] = [];
    v.content.traverse(o => { if ((o as THREE.Mesh).isMesh && o.visible && !(o as any).isLine2 && !o.userData.billboard) meshes.push(o); });
    const hit = this.ray.intersectObjects(meshes, false).find(h => !(h.object as any).material?.transparent || (h.object as any).material?.opacity > 0.3);
    if (hit && !hit.object.userData.paper) {
      // lift the ink a hair towards the viewer so it isn't swallowed by the surface it's drawn on
      const p = hit.point.clone().addScaledVector(this.ray.ray.direction, -0.35);
      return [p.x, p.y, p.z];
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -v.paperZ), p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(plane, p)) return null;
    return [p.x, p.y, NaN];
  }

  private down(e: PointerEvent) {
    if (!this.on || e.button !== 0) return;
    e.stopImmediatePropagation(); e.preventDefault();
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = this.pointAt(e); if (!p) return;
    const laser = this.tool === 'laser';
    const s: Stroke = { tool: this.tool === 'hl' ? 'hl' : 'pen', color: laser ? '#ff3b30' : this.color, w: this.tool === 'hl' ? 4.5 : laser ? 1.1 : 0.6, pts: p };
    this.drawing = { s, line: null, laser };
  }
  private move(e: PointerEvent) {
    if (!this.on || !this.drawing) return;
    e.stopImmediatePropagation();
    const p = this.pointAt(e); if (!p) return;
    const s = this.drawing.s, n = s.pts.length;
    const dx = p[0] - s.pts[n - 3], dy = p[1] - s.pts[n - 2];
    if (dx * dx + dy * dy < 0.04) return;   // ignore jitter under 0.2 mm
    s.pts.push(...p);
    if (this.drawing.line) { this.v.ink.remove(this.drawing.line); this.disposeLine(this.drawing.line); }
    this.drawing.line = this.lineFor(s, this.drawing.laser); this.v.ink.add(this.drawing.line); this.v.dirty = true;
  }
  private up(e: PointerEvent) {
    if (!this.drawing) return;
    e.stopImmediatePropagation();
    const d = this.drawing; this.drawing = null;
    if (d.laser) {
      if (!d.line) { d.line = this.lineFor(d.s, true); this.v.ink.add(d.line); }
      this.lasers.push({ line: d.line, mat: d.line.material as LineMaterial, t: performance.now() });
      return;
    }
    if (!d.line) { d.line = this.lineFor(d.s); this.v.ink.add(d.line); }
    this.strokes.push(d.s); this.onChange?.(); this.v.dirty = true;
  }
}

const okStroke = (s: any): s is Stroke => !!s && (s.tool === 'pen' || s.tool === 'hl') && typeof s.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.color)
  && typeof s.w === 'number' && s.w > 0 && s.w < 50 && Array.isArray(s.pts) && s.pts.length >= 3 && s.pts.length % 3 === 0 && s.pts.length < 60000
  && s.pts.every((x: any) => typeof x === 'number' && (Number.isFinite(x) || Number.isNaN(x)));
