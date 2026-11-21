// Figure Explorer: opens one figure of a page as a live, re-sampled 3D (or 2D) graph with
// probes, cross-sections, tangent planes, slices, pins, range editing and parameter sliders.
// It re-runs the page's code privately, so the page itself is never changed (unless the user
// clicks "write to code" on a parameter).
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { Viewer } from '../render/viewer';
import { runProgram, tweakables, RunCtx } from '../lang/interp';
import { Vec, isObj, truthy } from '../lang/values';
import { contourLines } from '../geom/marching';
import { injectExplorerCSS } from './explorer.css';

const HQ: Record<string, number> = { splot: 110, psurf: 110, isoplot: 48, pplot: 3000, fplot: 2400, cplot: 380, region: 320 };
const RANGE_CONSTS = /^[XYZTUV][01]$/;
const C = { red: '#d64545', green: '#2e9e5b', blue: '#1f6fd1', orange: '#e08a1e', purple: '#8a4fd6', grey: '#8a939d' };
export const fmtNum = (v: number) => (!isFinite(v) ? (Number.isNaN(v) ? 'undefined' : v > 0 ? '∞' : '−∞')
  : Math.abs(v) < 1e-12 ? '0' : (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3) ? v.toExponential(3) : String(+v.toPrecision(5)));
const sg = (v: number) => (v < 0 ? ' − ' : ' + ') + fmtNum(Math.abs(v));
const F3 = (p: number[]) => `(${p.map(fmtNum).join(', ')})`;

export interface ExplorerHost {
  source(): string;
  time(): number;
  measure?: (s: string) => number | null;
  writeBack?: (name: string, value: number, line: number) => void;
  snapshot?: (dataUrl: string, name: string) => void;
  title?: () => string;
}

/** throw-away 3D helpers drawn over the figure (probe markers, sections, arrows, labels) */
class Overlay {
  group = new THREE.Group(); labels: { el: HTMLElement; p: THREE.Vector3 }[] = [];
  constructor(private v: Viewer, private host: HTMLElement) { v.overlay.add(this.group); }
  clear() {
    this.group.traverse((o: any) => { o.geometry?.dispose?.(); if (o.material) { o.material.dispose?.(); const i = this.v.overlayMats.indexOf(o.material); if (i >= 0) this.v.overlayMats.splice(i, 1); } });
    this.group.clear();
    for (const l of this.labels) l.el.remove(); this.labels = [];
    this.v.dirty = true;
  }
  line(pts: number[][], color: string, px = 2.4, dashed = false) {
    const flat: number[] = []; for (const p of pts) if (p.every(isFinite)) flat.push(p[0], p[1], p[2]);
    if (flat.length < 6) return;
    const g = new LineGeometry(); g.setPositions(flat);
    const [w, h] = this.v.size();
    const m = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: px, worldUnits: false, transparent: true, dashed, dashSize: 2.2, gapSize: 1.6 });
    m.userData.px = px; m.resolution.set(w, h); this.v.overlayMats.push(m);
    const l = new Line2(g, m); if (dashed) l.computeLineDistances(); l.renderOrder = 300000;
    this.group.add(l);
  }
  /** polyline that breaks wherever a point is null / non-finite */
  path(pts: (number[] | null)[], color: string, px = 2.4, dashed = false) {
    let cur: number[][] = [];
    for (const p of pts) { if (p && p.every(isFinite)) cur.push(p); else { if (cur.length > 1) this.line(cur, color, px, dashed); cur = []; } }
    if (cur.length > 1) this.line(cur, color, px, dashed);
  }
  arrow(a: number[], b: number[], color: string, px = 2.6) {
    const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b); const d = Bv.clone().sub(A); const L = d.length(); if (!(L > 1e-6)) return;
    d.divideScalar(L); const head = Math.min(3.2, L * 0.35);
    const base = Bv.clone().addScaledVector(d, -head);
    this.line([a, base.toArray()], color, px);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(head * 0.38, head, 16), new THREE.MeshBasicMaterial({ color }));
    cone.geometry.translate(0, -head / 2, 0); cone.position.copy(Bv); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); cone.renderOrder = 300001;
    this.group.add(cone);
  }
  sphere(p: number[], r: number, color: string) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
    s.position.set(p[0], p[1], p[2]); s.renderOrder = 300002; this.group.add(s);
  }
  quad(c: number[][], color: string, opacity = 0.22) {
    const g = new THREE.BufferGeometry().setFromPoints(c.map(p => new THREE.Vector3(...p))); g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    m.renderOrder = 299999; this.group.add(m);
    this.line([...c, c[0]], color, 1.4);
  }
  label(p: number[], text: string, cls = '') {
    const el = document.createElement('div'); el.className = 'xp-lab ' + cls; el.textContent = text;
    this.host.appendChild(el); this.labels.push({ el, p: new THREE.Vector3(...p) });
  }
  position() {
    if (!this.labels.length) return;
    const cam = this.v.camera; const r = this.v.el.getBoundingClientRect(); const v = new THREE.Vector3();
    for (const l of this.labels) {
      v.copy(l.p).project(cam);
      const off = v.z > 1 || v.z < -1;
      l.el.style.display = off ? 'none' : '';
      l.el.style.left = ((v.x + 1) / 2 * r.width) + 'px'; l.el.style.top = ((1 - v.y) / 2 * r.height) + 'px';
    }
  }
}

export class Explorer {
  el: HTMLElement; gl!: HTMLElement; viewer: Viewer | null = null; ov!: Overlay; pins!: Overlay;
  idx = 0; ctx: RunCtx | null = null; EF: any = null; T: any = null; dim = 3; R: number[][] | null = null;
  ranges: number[] | null = null; equal: boolean | null = null; overrides: Record<string, number> = {};
  tools: Record<string, boolean> = { sections: true, plane: false, gradient: true, wire: true, box: true, normal: true, slice: true, tangent: true, velocity: true, guides: true };
  pinData: any[] = []; t = 0; playing = false; spin = false; isOpen = false; raf = 0; qTimer = 0; pending = false;
  lastMouse: { x: number; y: number } | null = null; probeQueued = false; lastProbe: any = null; usesT = false; duration = 6;
  private q = <T extends HTMLElement = HTMLElement>(s: string) => this.el.querySelector(s) as T;

  constructor(parent: HTMLElement, private host: ExplorerHost) {
    injectExplorerCSS();
    this.el = document.createElement('div'); this.el.className = 'xp';
    this.el.innerHTML = `
      <div class="xp-bar">
        <span class="xp-title">Figure explorer</span><span class="xp-sub"></span>
        <span class="d3"><button class="xp-b" data-a="iso" title="Page view">Iso</button>
        <button class="xp-b" data-a="top" title="Look down the z-axis">Top</button>
        <button class="xp-b" data-a="front" title="Look along y">Front</button>
        <button class="xp-b" data-a="side" title="Look along x">Side</button></span>
        <span class="xp-sep d3"></span>
        <button class="xp-b d3" data-a="persp" title="Perspective / orthographic">Persp</button>
        <button class="xp-b d3" data-a="spin" title="Turntable rotation">Spin</button>
        <span class="xp-tt" style="display:none;align-items:center;gap:5px"><button class="xp-b" data-a="play" title="Play the page's time t">▶</button>
        <input type="range" class="xp-t" min="0" max="6" step="0.01" value="0" style="width:110px;accent-color:#36b4ff"><span class="xp-tv" style="font:11px monospace;min-width:52px"></span></span>
        <span class="xp-sep"></span>
        <button class="xp-b" data-a="reset" title="Original ranges and view">Reset</button>
        <button class="xp-b" data-a="snap" title="Save an image of this view">Snapshot</button>
        <button class="xp-b" data-a="max" title="Fill the window">⤢</button>
        <button class="xp-b" data-a="close" title="Back to the page (Esc)">✕ Close</button>
      </div>
      <div class="xp-main">
        <div class="xp-gl"><div class="xp-labels"></div><div class="xp-hint"></div></div>
        <aside class="xp-side">
          <h5>Readout</h5><pre class="xp-read"></pre>
          <h5>Show</h5><div class="xp-tools"></div>
          <h5>Range</h5><div class="xp-range"></div>
          <h5 class="xp-ph">Parameters</h5><div class="xp-params"></div>
          <h5>Pins <span style="text-transform:none;letter-spacing:0;font-weight:400">— click the figure to pin a point</span></h5>
          <div class="xp-pins"><span class="xp-empty">no pins yet</span></div>
          <div class="xp-row"><button class="xp-b" data-a="copypins">Copy</button><button class="xp-b" data-a="clearpins">Clear</button></div>
        </aside>
      </div>`;
    parent.appendChild(this.el);
    this.gl = this.q('.xp-gl');
    this.el.querySelectorAll<HTMLElement>('[data-a]').forEach(b => (b.onclick = () => this.act(b.dataset.a!)));
    const ts = this.q<HTMLInputElement>('.xp-t');
    ts.oninput = () => { this.t = +ts.value; this.updT(); this.schedule(); };
    window.addEventListener('keydown', e => { if (this.isOpen && e.key === 'Escape') { e.stopPropagation(); this.close(); } }, true);
  }

  // ---------------------------------------------------------------- lifecycle
  open(index: number) {
    this.idx = index; this.ranges = null; this.equal = null; this.overrides = {}; this.pinData = []; this.lastProbe = null;
    this.t = this.host.time(); this.playing = false;
    this.el.classList.add('show'); this.isOpen = true;
    if (!this.viewer) this.initViewer();
    this.viewer!.resize();
    this.rebuild(true, true);
    this.buildParams();
    cancelAnimationFrame(this.raf); let last = performance.now();
    const loop = (now: number) => {
      if (!this.isOpen) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (this.playing) { this.t = (this.t + dt) % this.duration; this.updT(); this.schedule(true); }
      const v = this.viewer!; v.controls.autoRotate = this.spin; v.tick(); this.ov.position(); this.pins.position();
    };
    this.raf = requestAnimationFrame(loop);
  }
  close() { this.isOpen = false; this.el.classList.remove('show', 'max'); cancelAnimationFrame(this.raf); this.ov?.clear(); }

  private initViewer() {
    const v = new Viewer(this.gl, { mode: 'explore' }); this.viewer = v;
    const labels = this.q('.xp-labels');
    this.ov = new Overlay(v, labels); this.pins = new Overlay(v, labels);
    const cv = v.renderer.domElement;
    let down: { x: number; y: number; t: number; rx?: number[] } | null = null;
    cv.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), rx: this.ranges ? [...this.ranges] : this.curRanges() };
      if (this.dim === 2) { cv.setPointerCapture(e.pointerId); this.gl.classList.add('dragging'); }
    });
    cv.addEventListener('pointermove', e => {
      this.lastMouse = { x: e.clientX, y: e.clientY };
      if (this.dim === 2 && down && e.buttons) {                 // pan the data window
        const r = cv.getBoundingClientRect(); const w = this.screenToWorld(e.clientX, e.clientY), w0 = this.screenToWorld(down.x, down.y);
        const dx = (w.x - w0.x) / this.EF._sx, dy = (w.y - w0.y) / this.EF._sy; void r;
        const b = down.rx!; this.ranges = [b[0] - dx, b[1] - dx, b[2] - dy, b[3] - dy];
        this.schedule(); return;
      }
      if (e.buttons) return;
      this.queueProbe();
    });
    cv.addEventListener('pointerup', e => {
      this.gl.classList.remove('dragging');
      if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const dt = performance.now() - down.t; down = null;
      if (moved < 5 && dt < 600) this.pin(e.clientX, e.clientY);
      else if (this.dim === 2) this.schedule();
    });
    cv.addEventListener('pointerleave', () => { this.ov.clear(); this.read(this.idleText()); });
    cv.addEventListener('wheel', e => {
      if (this.dim !== 2) return;
      e.preventDefault();
      const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0012)));
      const d = this.EF._inv(this.screenToWorld(e.clientX, e.clientY).toArray());
      const r = this.ranges ?? this.curRanges();
      this.ranges = [d[0] + (r[0] - d[0]) * f, d[0] + (r[1] - d[0]) * f, d[1] + (r[2] - d[1]) * f, d[1] + (r[3] - d[1]) * f];
      this.schedule();
    }, { passive: false });
  }

  // ---------------------------------------------------------------- building
  private curRanges(): number[] {
    const F = this.EF ?? this.T?.F; if (!F) return [-1, 1, -1, 1, -1, 1];
    return this.dim === 3 ? [F.x0, F.x1, F.y0, F.y1, F.z0, F.z1] : [F.x0, F.x1, F.y0, F.y1];
  }
  /** fast rebuild now, full-quality rebuild when things settle */
  schedule(fastOnly = false) {
    if (this.pending) return; this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false; this.rebuild(false);
      clearTimeout(this.qTimer); if (!fastOnly) this.qTimer = window.setTimeout(() => this.rebuild(true), 320);
    });
  }
  rebuild(hq: boolean, resetCam = false) {
    const v = this.viewer!; const src = this.host.source();
    let ctx: RunCtx;
    try { ctx = runProgram(src, this.t, { measure: this.host.measure, overrides: this.overrides }); }
    catch (e: any) { this.read(`The page has an error, fix it first:\n${e.message}${e.line ? ` (line ${e.line})` : ''}`); return; }
    const T = ctx.frames[this.idx];
    if (!T) { this.read('This figure no longer exists on the page.'); return; }
    const firstTime = !this.T || this.T.dim !== T.dim || resetCam;
    this.T = T; this.dim = T.dim; this.ctx = ctx; this.usesT = ctx.usesT; this.duration = ctx.duration ?? 6;
    const PF = T.F; const opts0 = (T.args[T.dim === 2 ? 4 : 5] ?? {}) as any;
    const B = ctx.B!; const pagePrims = ctx.prims;
    ctx.prims = []; ctx.noHooks = true;
    const def = T.dim === 3 ? [PF.x0, PF.x1, PF.y0, PF.y1, PF.z0, PF.z1] : [PF.x0, PF.x1, PF.y0, PF.y1];
    const r = this.ranges ?? def;
    const o = { ...(isObj(opts0) ? opts0 : {}), ...(this.equal !== null ? { equal: this.equal } : {}) };
    const V = (a: number[]) => new Vec(a);
    let EF: any;
    try {
      EF = T.dim === 3 ? B.frame3d(V([100, 80]), 112, V([r[0], r[1]]), V([r[2], r[3]]), V([r[4], r[5]]), o)
        : B.frame2d(V([16, 12]), V([170, 136]), V([r[0], r[1]]), V([r[2], r[3]]), o);
    } catch (e: any) { this.read('Range error: ' + e.message); ctx.prims = pagePrims; return; }
    const errs: string[] = [];
    ctx.hooks.forEach((h, i) => {
      if (h.frame !== T.id) return;
      const args = [...h.args]; const last = args[args.length - 1];
      const want = hq ? HQ[h.name] : undefined;
      if (want) { if (isObj(last)) args[args.length - 1] = { ...last, n: Math.max(last.n ?? 0, want) }; else args.push({ n: want }); }
      ctx.curHook = i;
      try { B[h.name](EF, ...args); } catch (e: any) { errs.push(`${h.name} (line ${h.line}): ${e.message}`); }
      ctx.curHook = undefined;
    });
    // carry the page's annotations (critical points, labels, moving points…) into explorer space
    const conv = (q: number[]) => EF._raw(PF._inv(q));
    for (const p0 of pagePrims) {
      if (p0.fig !== T.fig || p0.role) continue;
      const p = JSON.parse(JSON.stringify(p0));
      const mapPts = (a: number[][]) => a.map(conv);
      if (p.pts) p.pts = mapPts(p.pts);
      if (p.a) { p.a = conv(p.a); p.b = conv(p.b); }
      if (p.kind === 'dot') p.p = conv(p.p);
      if (p.kind === 'tex') p.pos = conv(p.pos);
      if (p.pos && (p.kind === 'segs' || p.kind === 'trimesh')) { const out: number[] = []; for (let i = 0; i < p.pos.length; i += 3) out.push(...conv([p.pos[i], p.pos[i + 1], p.pos[i + 2]])); p.pos = out; }
      p.fig = EF.fig; ctx.prims.push(p);
    }
    const prims = ctx.prims; ctx.prims = pagePrims; ctx.noHooks = false;
    this.EF = EF; this.R = EF._R ?? null;
    v.build({ ...ctx, prims, page: { w: 200, h: 160, style: 'paper' } } as any, []);
    this.applyLayers();
    if (firstTime) this.resetCamera();
    // title / tools / ranges
    const kinds = [...new Set(ctx.hooks.filter(h => h.frame === T.id).map(h => h.name))];
    this.q('.xp-sub').textContent = `${this.host.title?.() ?? ''} · figure ${this.idx + 1} (line ${T.line}) · ${kinds.join(', ') || 'no plots'}`;
    this.el.querySelectorAll<HTMLElement>('.d3').forEach(e => (e.style.display = T.dim === 3 ? '' : 'none'));
    (this.q('.xp-tt') as HTMLElement).style.display = this.usesT ? 'flex' : 'none';
    this.q<HTMLInputElement>('.xp-t').max = String(this.duration); this.updT();
    this.gl.classList.toggle('flat', T.dim === 2);
    this.q('.xp-hint').innerHTML = T.dim === 3
      ? 'drag to turn · right-drag to pan · scroll to zoom<br>hover the figure to probe it · click to pin a point'
      : 'drag to pan · scroll to zoom (curves are re-computed)<br>hover to read values · click to pin' + (kinds.includes('slopefield') ? ' (or draw a solution)' : '');
    if (firstTime) { this.buildTools(kinds); }
    this.fillRanges(r);
    this.refreshPins();
    if (errs.length) this.read('Some plots failed:\n' + errs.join('\n'));
    else if (this.lastMouse && !this.probeQueued) this.queueProbe(); else if (!this.lastProbe) this.read(this.idleText());
  }
  private applyLayers() {
    const v = this.viewer!;
    v.content.traverse(o => {
      const rec = v.picks.find(r => r.objs.includes(o)); const p = rec?.prim; if (!p) return;
      o.userData.hide = (!this.tools.wire && p.kind === 'segs' && p.role === 'plot') || (!this.tools.box && p.role === 'deco');
    });
    v.applyHidden();
  }
  private resetCamera() {
    const v = this.viewer!;
    if (this.dim === 3) {
      const R = this.R!; const up = new THREE.Vector3(R[0][2], R[1][2], R[2][2]);
      v.controls.enabled = true; v.setUp(up); v.placeDir(new THREE.Vector3(0, 0, 1), up, 1);
    } else {
      if (!v.isOrtho) v.setOrtho(true);
      v.setUp(new THREE.Vector3(0, 1, 0)); v.placeDir(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 1);
      v.controls.enabled = false;
    }
  }
  private view(name: string) {
    if (this.dim !== 3 || !this.R) return; const R = this.R; const v = this.viewer!;
    const col = (j: number, s = 1) => new THREE.Vector3(R[0][j] * s, R[1][j] * s, R[2][j] * s);
    const up = col(2);
    if (name === 'iso') v.placeDir(new THREE.Vector3(0, 0, 1), up, 1);
    if (name === 'top') v.placeDir(col(2), col(1), 1);
    if (name === 'front') v.placeDir(col(1, -1), up, 1);
    if (name === 'side') v.placeDir(col(0), up, 1);
  }

  // ---------------------------------------------------------------- sidebar
  private act(a: string) {
    const v = this.viewer;
    switch (a) {
      case 'close': this.close(); break;
      case 'max': this.el.classList.toggle('max'); setTimeout(() => v?.resize(), 30); break;
      case 'iso': case 'top': case 'front': case 'side': this.view(a); break;
      case 'persp': v!.setOrtho(!v!.isOrtho); this.btn('persp', !v!.isOrtho); break;
      case 'spin': this.spin = !this.spin; this.btn('spin', this.spin); break;
      case 'play': this.playing = !this.playing; this.q('[data-a=play]').textContent = this.playing ? '❚❚' : '▶'; if (!this.playing) this.schedule(); break;
      case 'reset': this.ranges = null; this.equal = null; this.overrides = {}; this.buildParams(); this.rebuild(true, true); break;
      case 'snap': { const url = v!.snapshotView(); if (this.host.snapshot) this.host.snapshot(url, 'figure-' + (this.idx + 1) + '.png'); else window.open(url); break; }
      case 'clearpins': this.pinData = []; this.refreshPins(); break;
      case 'copypins': navigator.clipboard?.writeText(this.pinText()).catch(() => {}); break;
    }
  }
  private btn(a: string, on: boolean) { this.q(`[data-a=${a}]`).classList.toggle('on', on); }
  private updT() { this.q('.xp-tv').textContent = 't = ' + this.t.toFixed(2); this.q<HTMLInputElement>('.xp-t').value = String(this.t); }
  private read(s: string) { this.q('.xp-read').textContent = s; }
  private idleText() {
    if (!this.ctx || !this.T) return '';
    return this.dim === 3 ? 'Hover a surface or curve to probe it.' : 'Hover the graph to read values.';
  }
  private buildTools(kinds: string[]) {
    const opts: [string, string][] = [];
    if (kinds.includes('splot')) opts.push(['sections', 'Cross-sections and their slopes'], ['plane', 'Tangent plane'], ['gradient', 'Gradient on the floor']);
    if (kinds.includes('psurf') || kinds.includes('isoplot')) opts.push(['normal', 'Normal / tangent vectors']);
    if (kinds.includes('isoplot')) opts.push(['slice', 'Horizontal slice at the probe']);
    if (kinds.includes('pplot')) opts.push(['velocity', 'Velocity vector on curves']);
    if (kinds.includes('fplot')) opts.push(['tangent', 'Tangent line']);
    if (this.dim === 2) opts.push(['guides', 'Guide lines']);
    if (kinds.some(k => k === 'splot' || k === 'psurf')) opts.push(['wire', 'Wireframe']);
    opts.push(['box', this.dim === 3 ? 'Box, panes and ticks' : 'Axes and grid']);
    const host = this.q('.xp-tools'); host.innerHTML = '';
    for (const [k, label] of opts) {
      const l = document.createElement('label');
      l.innerHTML = `<input type="checkbox" ${this.tools[k] ? 'checked' : ''}> ${label}`;
      (l.querySelector('input') as HTMLInputElement).onchange = (e) => {
        this.tools[k] = (e.target as HTMLInputElement).checked;
        if (k === 'wire' || k === 'box') this.applyLayers(); else this.queueProbe();
      };
      host.appendChild(l);
    }
  }
  private fillRanges(r: number[]) {
    const host = this.q('.xp-range');
    if (host.contains(document.activeElement)) return;
    const names = this.dim === 3 ? ['x', 'y', 'z'] : ['x', 'y'];
    const eq = this.equal ?? !!(this.T?.args[this.dim === 2 ? 4 : 5]?.equal);
    host.innerHTML = `<div class="xp-grid">${names.map((n, i) => `<b>${n}</b><input data-i="${2 * i}" value="${fmtNum(r[2 * i])}"><input data-i="${2 * i + 1}" value="${fmtNum(r[2 * i + 1])}">`).join('')}</div>
      <div class="xp-row"><label style="display:flex;gap:5px;align-items:center"><input type="checkbox" class="xp-eq" ${eq ? 'checked' : ''}> equal scale</label>
      <button class="xp-b xp-apply">Apply</button><button class="xp-b xp-orig">Original</button></div>`;
    const apply = () => {
      const vals = [...host.querySelectorAll<HTMLInputElement>('.xp-grid input')].map(i => parseFloat(i.value));
      if (vals.some(x => !isFinite(x)) || vals.some((x, i) => i % 2 === 1 && x <= vals[i - 1])) { this.read('Each range needs a smaller first number, e.g. -2 and 2.'); return; }
      this.ranges = vals; (document.activeElement as HTMLElement)?.blur?.(); this.rebuild(true);
    };
    (host.querySelector('.xp-apply') as HTMLElement).onclick = apply;
    host.querySelectorAll<HTMLInputElement>('.xp-grid input').forEach(i => (i.onkeydown = (e) => { if (e.key === 'Enter') apply(); }));
    (host.querySelector('.xp-orig') as HTMLElement).onclick = () => { this.ranges = null; this.rebuild(true); };
    (host.querySelector('.xp-eq') as HTMLInputElement).onchange = (e) => { this.equal = (e.target as HTMLInputElement).checked; this.rebuild(true); };
  }
  private buildParams() {
    const host = this.q('.xp-params'); host.innerHTML = '';
    const list = tweakables(this.host.source()).filter(p => !RANGE_CONSTS.test(p.name));
    (this.q('.xp-ph') as HTMLElement).style.display = list.length ? '' : 'none';
    for (const p of list) {
      const span = Math.max(1, Math.abs(p.value) * 2), lo = p.value - span, hi = p.value + span;
      const d = document.createElement('div'); d.className = 'xp-param';
      d.innerHTML = `<div class="top"><span>${p.name} = <b class="val">${fmtNum(p.value)}</b></span>${this.host.writeBack ? '<button class="xp-b wb" title="Put this value into the page code">write to code</button>' : ''}</div>
        <input type="range" min="${lo}" max="${hi}" step="${span / 200}" value="${p.value}">`;
      const inp = d.querySelector('input') as HTMLInputElement, val = d.querySelector('.val') as HTMLElement;
      inp.oninput = () => { const x = +(+inp.value).toPrecision(4); this.overrides[p.name] = x; val.textContent = fmtNum(x); this.schedule(); };
      const wb = d.querySelector('.wb') as HTMLElement | null;
      if (wb) wb.onclick = () => { const x = this.overrides[p.name] ?? p.value; this.host.writeBack!(p.name, x, p.line); };
      host.appendChild(d);
    }
  }

  // ---------------------------------------------------------------- probing
  private call(f: any, args: any[]) { try { return this.ctx!.call(f, args); } catch { return NaN; } }
  private num(f: any, args: number[]) { const r = this.call(f, args); return typeof r === 'number' ? r : NaN; }
  private vec(f: any, args: number[]): number[] | null { const r = this.call(f, args); return r instanceof Vec ? r.v3() : null; }
  private screenToWorld(cx: number, cy: number) {
    const r = this.viewer!.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector3((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0).unproject(this.viewer!.camera);
  }
  private rayHit(objs: THREE.Object3D[], cx: number, cy: number) {
    const v = this.viewer!; const r = v.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), v.camera);
    return ray.intersectObjects(objs, false)[0] ?? null;
  }
  private queueProbe() {
    if (this.probeQueued) return; this.probeQueued = true;
    setTimeout(() => { this.probeQueued = false; if (this.lastMouse && this.isOpen) this.probe(this.lastMouse.x, this.lastMouse.y); }, 30);
  }
  private span(i: number) { const r = this.curRanges(); return r[2 * i + 1] - r[2 * i]; }
  private hooksOf(name: string) { return this.ctx!.hooks.map((h, i) => ({ ...h, i })).filter(h => h.frame === this.T.id && h.name === name); }

  private probe(cx: number, cy: number) {
    if (!this.viewer || !this.ctx || !this.EF) return;
    this.ov.clear(); this.lastProbe = null;
    const v = this.viewer;
    let rec = v.pickAt(cx, cy);
    const hook = rec?.prim?.hook != null ? this.ctx.hooks[rec.prim.hook] : null;
    // wireframe lines sit on the surface: probe the surface underneath them
    if (rec && hook && rec.kind !== 'area' && ['splot', 'psurf', 'isoplot'].includes(hook.name)) {
      const hk = rec.prim.hook; const areas = v.picks.filter(r => r.kind === 'area' && r.prim?.hook === hk);
      const objs = areas.flatMap(a => a.objs); const hit0 = this.rayHit(objs, cx, cy);
      if (hit0) rec = areas.find(a => a.objs.includes(hit0.object)) ?? rec;
    }
    if (hook && hook.name === 'pplot' && rec!.kind === 'stroke') return this.probeCurve(rec!, hook, cx, cy);
    if (this.dim === 2) return this.probe2D(cx, cy);
    if (!hook || rec!.kind !== 'area') {
      // a page annotation (critical point, label, …): show where it is
      const c = rec?.kind === 'dot' ? rec.c : rec?.kind === 'text' && rec.group ? new THREE.Vector3().setFromMatrixPosition(rec.group.matrixWorld).toArray() : null;
      if (c && rec) {
        const p = this.EF._inv(c).slice(0, this.dim); const P = this.EF._raw(this.EF._inv(c));
        this.ov.sphere(P, 1.1, C.red); this.ov.label(P, F3(p));
        this.lastProbe = { p: this.EF._inv(c), text: `point ${F3(p)} (page line ${rec.line})` };
        this.read(`point = ${F3(p)}\n\ndrawn by line ${rec.line} of the page`);
      } else this.read(this.idleText());
      return;
    }
    const hit = this.rayHit(rec!.objs, cx, cy); if (!hit) return;
    if (hook.name === 'splot') return this.probeSurface(hook, hit);
    if (hook.name === 'psurf') return this.probePsurf(hook, hit, rec!.prim);
    if (hook.name === 'isoplot') return this.probeIso(hook, hit);
  }

  private probeSurface(h: any, hit: THREE.Intersection) {
    const EF = this.EF, f = h.args[0], ov = this.ov;
    const F = (x: number, y: number) => this.num(f, [x, y]);
    const [x, y] = EF._inv(hit.point.toArray()); const z = F(x, y);
    const sx = this.span(0), sy = this.span(1), r = this.curRanges();
    const hx = sx * 1e-4, hy = sy * 1e-4;
    const fx = (F(x + hx, y) - F(x - hx, y)) / (2 * hx), fy = (F(x, y + hy) - F(x, y - hy)) / (2 * hy);
    const inZ = (zz: number) => zz >= r[4] - 1e-9 && zz <= r[5] + 1e-9;
    const P = EF._raw([x, y, z]);
    if (this.tools.sections) {
      const N = 140;
      ov.path(Array.from({ length: N + 1 }, (_, i) => { const yy = r[2] + sy * i / N, zz = F(x, yy); return inZ(zz) ? EF._raw([x, yy, zz]) : null; }), C.red, 2.4);
      ov.path(Array.from({ length: N + 1 }, (_, i) => { const xx = r[0] + sx * i / N, zz = F(xx, y); return inZ(zz) ? EF._raw([xx, y, zz]) : null; }), C.green, 2.4);
      const Ly = sy * 0.2, Lx = sx * 0.2;
      ov.line([EF._raw([x, y - Ly, z - fy * Ly]), EF._raw([x, y + Ly, z + fy * Ly])], C.red, 1.8, true);
      ov.line([EF._raw([x - Lx, y, z - fx * Lx]), EF._raw([x + Lx, y, z + fx * Lx])], C.green, 1.8, true);
    }
    if (this.tools.plane) {
      const Lx = sx * 0.16, Ly = sy * 0.16;
      ov.quad([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => EF._raw([x + a * Lx, y + b * Ly, z + fx * a * Lx + fy * b * Ly])), C.blue, 0.25);
    }
    if (this.tools.gradient) {
      const g = Math.hypot(fx, fy), fl = EF.floor;
      ov.line([P, EF._raw([x, y, fl])], C.orange, 1.4, true);
      if (g > 1e-12) ov.arrow(EF._raw([x, y, fl]), EF._raw([x + fx / g * sx * 0.16, y + fy / g * sy * 0.16, fl]), C.orange);
    }
    ov.sphere(P, 1.1, C.red);
    ov.label(P, `(${fmtNum(x)}, ${fmtNum(y)}, ${fmtNum(z)})`);
    this.lastProbe = { p: [x, y, z], text: `f${F3([x, y])} = ${fmtNum(z)}` };
    this.read([
      `x = ${fmtNum(x)}    y = ${fmtNum(y)}`,
      `z = f(x, y) = ${fmtNum(z)}`, '',
      `∂f/∂x = ${fmtNum(fx)}   (green slice)`,
      `∂f/∂y = ${fmtNum(fy)}   (red slice)`,
      `|∇f|  = ${fmtNum(Math.hypot(fx, fy))}`, '',
      'tangent plane:',
      `z ≈ ${fmtNum(z)}${sg(fx)}(x${sg(-x)})`,
      `      ${sg(fy).trim()}(y${sg(-y)})`,
    ].join('\n'));
  }
  private probePsurf(h: any, hit: THREE.Intersection, prim: any) {
    const EF = this.EF, g = h.args[0], ov = this.ov;
    const [u0, u1, v0, v1] = prim.uvRange; const uv = hit.uv; if (!uv) return;
    const u = u0 + (u1 - u0) * uv.x, w = v0 + (v1 - v0) * uv.y;
    const S = (a: number, b: number) => this.vec(g, [a, b]);
    const p = S(u, w); if (!p) return;
    const du = (u1 - u0) * 1e-4, dv = (v1 - v0) * 1e-4;
    const Su = S(u + du, w)!.map((x, i) => (x - S(u - du, w)![i]) / (2 * du)), Sv = S(u, w + dv)!.map((x, i) => (x - S(u, w - dv)![i]) / (2 * dv));
    const n = [Su[1] * Sv[2] - Su[2] * Sv[1], Su[2] * Sv[0] - Su[0] * Sv[2], Su[0] * Sv[1] - Su[1] * Sv[0]];
    const L = Math.max(this.span(0), this.span(1), this.span(2)) * 0.16;
    const tip = (d: number[]) => { const l = Math.hypot(...d) || 1; return EF._raw(p.map((x, i) => x + d[i] / l * L)); };
    const P = EF._raw(p);
    if (this.tools.normal) { ov.arrow(P, tip(Su), C.red); ov.arrow(P, tip(Sv), C.green); ov.arrow(P, tip(n), C.purple); }
    ov.sphere(P, 1.1, C.red); ov.label(P, F3(p));
    this.lastProbe = { p, text: `S(${fmtNum(u)}, ${fmtNum(w)}) = ${F3(p)}` };
    this.read([`u = ${fmtNum(u)}    v = ${fmtNum(w)}`, `point = ${F3(p)}`, '', `S_u = ${F3(Su)}   (red)`, `S_v = ${F3(Sv)}   (green)`, `normal S_u × S_v   (purple)`, `|S_u × S_v| = ${fmtNum(Math.hypot(...n))}   (area element)`].join('\n'));
  }
  private probeIso(h: any, hit: THREE.Intersection) {
    const EF = this.EF, G = h.args[0], ov = this.ov; const lev = (isObj(h.args[1]) && h.args[1].level) || 0;
    const g3 = (p: number[]) => this.num(G, p) - lev;
    let p = EF._inv(hit.point.toArray());
    const e = Math.max(this.span(0), this.span(1), this.span(2)) * 1e-4;
    const grad = (q: number[]) => [0, 1, 2].map(i => { const a = [...q], b = [...q]; a[i] += e; b[i] -= e; return (g3(a) - g3(b)) / (2 * e); });
    for (let k = 0; k < 4; k++) { const gv = grad(p), val = g3(p), gg = gv.reduce((s, x) => s + x * x, 0); if (!(gg > 0)) break; p = p.map((x, i) => x - val * gv[i] / gg); }
    const gv = grad(p), gl = Math.hypot(...gv); const P = EF._raw(p);
    if (this.tools.slice) {
      const r = this.curRanges(), n = 90; const vals = new Float64Array((n + 1) * (n + 1));
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) vals[j * (n + 1) + i] = g3([r[0] + (r[1] - r[0]) * i / n, r[2] + (r[3] - r[2]) * j / n, p[2]]);
      for (const line of contourLines(vals, n, n)) ov.line(line.map(q => EF._raw([r[0] + (r[1] - r[0]) * q[0] / n, r[2] + (r[3] - r[2]) * q[1] / n, p[2]])), C.orange, 2.4);
      ov.quad([[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]].map(([a, b]) => EF._raw([a, b, p[2]])), C.orange, 0.1);
    }
    if (this.tools.normal && gl > 0) { const L = Math.max(this.span(0), this.span(1), this.span(2)) * 0.18; ov.arrow(P, EF._raw(p.map((x, i) => x + gv[i] / gl * L)), C.purple); }
    ov.sphere(P, 1.1, C.red); ov.label(P, F3(p));
    this.lastProbe = { p, text: `point ${F3(p)}` };
    this.read([`point = ${F3(p)}`, `G(x, y, z) = ${fmtNum(g3(p) + lev)}`, '', `∇G = ${F3(gv)}   (purple normal)`, `|∇G| = ${fmtNum(gl)}`, this.tools.slice ? `\nslice z = ${fmtNum(p[2])}   (orange)` : ''].join('\n'));
  }
  private probeCurve(rec: any, h: any, cx: number, cy: number) {
    const EF = this.EF, g = h.args[0], ov = this.ov, v = this.viewer!;
    const P0 = rec.pts as number[], tp = rec.prim.tp as number[]; if (!tp) return;
    const r = v.renderer.domElement.getBoundingClientRect(); const tmp = new THREE.Vector3();
    let best = 0, bd = Infinity;
    for (let i = 0; i < tp.length; i++) {
      tmp.set(P0[3 * i], P0[3 * i + 1], P0[3 * i + 2]).project(v.camera);
      const d = Math.hypot(r.left + (tmp.x + 1) / 2 * r.width - cx, r.top + (1 - tmp.y) / 2 * r.height - cy);
      if (d < bd) { bd = d; best = i; }
    }
    const t = tp[best]; const p = this.vec(g, [t]); if (!p) return;
    const span = Math.abs((tp[tp.length - 1] - tp[0])) || 1, dt = span * 1e-5;
    const a = this.vec(g, [t - dt])!, b = this.vec(g, [t + dt])!;
    const d1 = b.map((x, i) => (x - a[i]) / (2 * dt)), d2 = b.map((x, i) => (x - 2 * p[i] + a[i]) / (dt * dt));
    const sp = Math.hypot(...d1); const cr = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
    const kappa = sp > 0 ? Math.hypot(...cr) / sp ** 3 : NaN;
    const P = EF._raw(p);
    if (this.tools.velocity && sp > 0) { const L = Math.max(this.span(0), this.span(1)) * 0.16; ov.arrow(P, EF._raw(p.map((x, i) => x + d1[i] / sp * L)), C.red); }
    ov.sphere(P, 1.1, C.red); ov.label(P, `t = ${fmtNum(t)}`);
    this.lastProbe = { p, text: `r(${fmtNum(t)}) = ${F3(this.dim === 3 ? p : p.slice(0, 2))}` };
    this.read([`t = ${fmtNum(t)}`, `r(t)  = ${F3(this.dim === 3 ? p : p.slice(0, 2))}`, `r'(t) = ${F3(this.dim === 3 ? d1 : d1.slice(0, 2))}`, `speed |r'| = ${fmtNum(sp)}`, `curvature κ = ${fmtNum(kappa)}`].join('\n'));
  }
  private probe2D(cx: number, cy: number) {
    const EF = this.EF, ov = this.ov, v = this.viewer!; const r = this.curRanges();
    const [x, y] = EF._inv(this.screenToWorld(cx, cy).toArray());
    if (x < r[0] || x > r[1] || y < r[2] || y > r[3]) { this.read(this.idleText()); return; }
    const lines = [`x = ${fmtNum(x)}    y = ${fmtNum(y)}`];
    if (this.tools.guides) { ov.line([EF._raw([x, r[2]]), EF._raw([x, r[3]])], '#b8c0ca', 1, true); ov.line([EF._raw([r[0], y]), EF._raw([r[1], y])], '#b8c0ca', 1, true); }
    const rect = v.renderer.domElement.getBoundingClientRect(); const tmp = new THREE.Vector3();
    const toScreenY = (yy: number) => { const w = EF._raw([x, yy]); tmp.set(w[0], w[1], 0).project(v.camera); return rect.top + (1 - tmp.y) / 2 * rect.height; };
    // graphs y = f(x)
    const fp = this.hooksOf('fplot');
    if (fp.length) {
      let best: any = null;
      fp.forEach((h, k) => {
        const fy = this.num(h.args[0], [x]);
        if (isFinite(fy) && fy >= r[2] && fy <= r[3]) { const d = Math.abs(toScreenY(fy) - cy); if (!best || d < best.d) best = { h, fy, d, k }; }
        if (fp.length > 1) lines.push(`f${k + 1}(x) = ${fmtNum(fy)}`);
      });
      if (best) {
        const f = best.h.args[0], e = (r[1] - r[0]) * 1e-5;
        const m = (this.num(f, [x + e]) - this.num(f, [x - e])) / (2 * e);
        const m2 = (this.num(f, [x + e * 10]) - 2 * best.fy + this.num(f, [x - e * 10])) / (100 * e * e);
        const P = EF._raw([x, best.fy]);
        if (this.tools.tangent && isFinite(m)) { const L = (r[1] - r[0]) * 0.14; ov.line([EF._raw([x - L, best.fy - m * L]), EF._raw([x + L, best.fy + m * L])], C.red, 2); }
        ov.line([P, EF._raw([x, Math.min(r[3], Math.max(r[2], 0))])], C.red, 1.2, true);
        ov.sphere(P, 1.1, C.red); ov.label(P, `(${fmtNum(x)}, ${fmtNum(best.fy)})`);
        lines.push('', `f(x)   = ${fmtNum(best.fy)}`, `f'(x)  = ${fmtNum(m)}`, `f''(x) ≈ ${fmtNum(m2)}`);
        this.lastProbe = { p: [x, best.fy, 0], text: `f(${fmtNum(x)}) = ${fmtNum(best.fy)}, f' = ${fmtNum(m)}` };
      }
    }
    for (const h of this.hooksOf('cplot')) lines.push(`G(x, y) = ${fmtNum(this.num(h.args[0], [x, y]) - ((isObj(h.args[1]) && h.args[1].level) || 0))}`);
    for (const h of this.hooksOf('region')) lines.push(`inside the region: ${truthy(this.call(h.args[0], [x, y])) ? 'yes' : 'no'}`);
    for (const h of [...this.hooksOf('quiver'), ...this.hooksOf('streamlines')].slice(0, 1)) {
      const vv = this.vec(h.args[0], [x, y]);
      if (vv) {
        lines.push(`F(x, y) = (${fmtNum(vv[0])}, ${fmtNum(vv[1])})`, `|F| = ${fmtNum(Math.hypot(vv[0], vv[1]))}`);
        const l = Math.hypot(vv[0], vv[1]); if (l > 0) { const L = Math.min(r[1] - r[0], r[3] - r[2]) * 0.1; ov.arrow(EF._raw([x, y]), EF._raw([x + vv[0] / l * L * (r[1] - r[0]) / (r[1] - r[0]), y + vv[1] / l * L]), C.red); }
      }
    }
    for (const h of this.hooksOf('slopefield').slice(0, 1)) {
      const s = this.num(h.args[0], [x, y]); lines.push(`dy/dx = f(x, y) = ${fmtNum(s)}`, '(click to draw the solution through here)');
      const L = (r[1] - r[0]) * 0.05; ov.line([EF._raw([x - L, y - s * L]), EF._raw([x + L, y + s * L])], C.red, 2.4);
    }
    if (!this.lastProbe) this.lastProbe = { p: [x, y, 0], text: `(${fmtNum(x)}, ${fmtNum(y)})` };
    this.read(lines.join('\n'));
  }

  // ---------------------------------------------------------------- pins
  private pin(cx: number, cy: number) {
    if (!this.EF) return;
    if (this.dim === 2) {
      const sf = this.hooksOf('slopefield')[0];
      const [x, y] = this.EF._inv(this.screenToWorld(cx, cy).toArray());
      if (sf) { this.pinData.push({ kind: 'sol', f: sf.args[0], x, y, text: `solution through (${fmtNum(x)}, ${fmtNum(y)})` }); this.refreshPins(); return; }
    }
    this.probe(cx, cy);
    if (!this.lastProbe) return;
    this.pinData.push({ kind: 'pt', p: this.lastProbe.p, text: this.lastProbe.text });
    this.refreshPins();
  }
  private refreshPins() {
    if (!this.pins || !this.EF) return;
    this.pins.clear(); const EF = this.EF; const r = this.curRanges();
    this.pinData.forEach((pd, i) => {
      if (pd.kind === 'pt') { const P = EF._raw(this.dim === 3 ? pd.p : [pd.p[0], pd.p[1]]); this.pins.sphere(P, 1.2, '#b0282c'); this.pins.label(P, `#${i + 1}`, 'pin'); }
      else {
        const f = (x: number, y: number) => this.num(pd.f, [x, y]); const h = (r[1] - r[0]) / 500;
        const run = (dir: number) => { const out: (number[] | null)[] = []; let x = pd.x, y = pd.y; for (let k = 0; k < 2000; k++) { const k1 = f(x, y), k2 = f(x + dir * h / 2, y + dir * h * k1 / 2), k3 = f(x + dir * h / 2, y + dir * h * k2 / 2), k4 = f(x + dir * h, y + dir * h * k3); y += dir * h * (k1 + 2 * k2 + 2 * k3 + k4) / 6; x += dir * h; if (!isFinite(y) || x < r[0] || x > r[1]) break; out.push(y >= r[2] && y <= r[3] ? EF._raw([x, y]) : null); } return out; };
        this.pins.path([...run(-1).reverse(), EF._raw([pd.x, pd.y]), ...run(1)], '#b0282c', 2.4);
        this.pins.sphere(EF._raw([pd.x, pd.y]), 1.1, '#b0282c'); this.pins.label(EF._raw([pd.x, pd.y]), `#${i + 1}`, 'pin');
      }
    });
    const box = this.q('.xp-pins');
    box.innerHTML = this.pinData.length ? '' : '<span class="xp-empty">no pins yet</span>';
    if (this.pinData.length) box.textContent = this.pinText();
  }
  private pinText() { return this.pinData.map((p, i) => `#${i + 1}  ${p.text}`).join('\n'); }
}
