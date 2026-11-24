// The figure host: a small page that board mode (./board/, same site) puts in an iframe to show a LaTeX Modeler
// page or a single 3D figure on a board. Board mode calls window.LMFigure directly (same origin, no messages):
// auto-model an equation, render it with a see-through background, let the person orbit it, and take a picture.
import * as THREE from 'three';
import { runProgram, RunCtx } from './lang/interp';
import { Viewer } from './render/viewer';
import { texReady, measureTex } from './render/tex';
import { explorerScene } from './explore/explorer';
import { shareFragment } from './share';
import { TEMPLATES, EXAMPLES } from './library';
import { registerOffline } from './offline';
registerOffline();   // so boards can draw figures offline too

/** what a board keeps for a model object */
export interface ModelSpec {
  src: string;
  /** 'figure': only one figure of the page, on its own · 'page': the whole page as a sheet */
  mode: 'figure' | 'page';
  /** which figure of the page (figure mode) */
  fig?: number;
  /** time on the page's timeline */
  t?: number;
  /** paper to draw the figure as if it sat on: 'paper' for light boards, 'chalk' or 'dark' for dark ones */
  style?: string;
  /** saved camera: position, target, up */
  cam?: number[];
}

const host = document.getElementById('gl')!;
let viewer: Viewer | null = null, kind: 'page' | 'explore' | null = null;
let current: ModelSpec | null = null, ctxNow: RunCtx | null = null, onChange: (() => void) | null = null;

function viewerFor(k: 'page' | 'explore') {
  if (viewer && kind === k) return viewer;
  if (viewer) { try { viewer.renderer.dispose(); viewer.renderer.forceContextLoss(); } catch { /* ignore */ } viewer.renderer.domElement.remove(); }
  viewer = new Viewer(host, { mode: k, transparent: true }); kind = k;
  viewer.renderer.setClearColor(0x000000, 0);
  viewer.setOrtho(false);
  return viewer;
}

const run = (src: string, t: number, style?: string) => runProgram(src, t, { measure: measureTex, style });

/** the figures a page has, for picking one */
function inspect(src: string): { error?: string; title?: string; usesT?: boolean; duration?: number; frames: { idx: number; dim: number; line: number }[] } {
  try {
    const ctx = run(src, 0);
    const title = /^\/\/\s*(.+?)\s+—/.exec(src)?.[1];
    return { title, usesT: ctx.usesT, duration: ctx.duration ?? undefined, frames: ctx.frames.map((f: any, idx: number) => ({ idx, dim: f.dim, line: f.line })) };
  } catch (e: any) { return { error: `${e.message}${e.line ? ` (line ${e.line})` : ''}`, frames: [] }; }
}

/** draw a model; the view keeps its saved camera, or starts from the figure's own textbook angle */
/** while playing, each frame is rebuilt at a new time: keep the camera where the person left it */
let keepCam: number[] | null = null;
function showAt(t: number) { if (!current || !viewer) return; keepCam = getCam(); show({ ...current, t }, true); }

function show(spec: ModelSpec, fast = false): { ok: boolean; error?: string } {
  current = spec;
  let ctx: RunCtx;
  try { ctx = run(spec.src, spec.t ?? 0, spec.mode === 'figure' ? spec.style : undefined); }
  catch (e: any) { return { ok: false, error: `${e.message}${e.line ? ` (line ${e.line})` : ''}` }; }
  ctxNow = ctx;
  if (spec.mode === 'figure') {
    const idx = Math.min(spec.fig ?? 0, Math.max(0, ctx.frames.length - 1));
    if (!ctx.frames.length) return { ok: false, error: 'This page has no figure to show on its own.' };
    const sc = explorerScene(ctx, idx, null, null, !fast);
    if ('error' in sc) return { ok: false, error: sc.error };
    const v = viewerFor('explore');
    v.build({ ...ctx, prims: sc.prims, page: { w: 200, h: 160, style: spec.style || 'paper' } } as any, []);
    const R = sc.EF._R as number[][] | undefined;
    if (ctx.frames[idx].dim === 3 && R) {
      const up = new THREE.Vector3(R[0][2], R[1][2], R[2][2]);
      v.controls.enabled = true; v.setUp(up); v.placeDir(new THREE.Vector3(0, 0, 1), up, 0.92);
    } else {
      v.setUp(new THREE.Vector3(0, 1, 0)); v.placeDir(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 0.95);
    }
  } else {
    const v = viewerFor('page');
    v.build(ctx, []);
    v.place(0, 0, 1);
  }
  if (keepCam) { setCam(keepCam); keepCam = null; }
  else if (spec.cam && spec.cam.length === 9 && spec.cam.every(Number.isFinite)) setCam(spec.cam);
  listen(); viewer!.controls.enabled = host.classList.contains('live');
  viewer!.dirty = true; viewer!.render();
  return { ok: true };
}

/** setUp() makes new orbit controls, so the change listener is attached again after every (re)build */
let listened: unknown = null;
function listen() { const c = viewer!.controls; if (listened === c) return; listened = c; c.addEventListener('change', () => onChange?.()); }

function getCam(): number[] {
  const v = viewer!; const c = v.camera, t = v.controls.target;
  return [c.position.x, c.position.y, c.position.z, t.x, t.y, t.z, c.up.x, c.up.y, c.up.z].map(n => +n.toFixed(4));
}
function setCam(a: number[]) {
  const v = viewer!; if (v.isOrtho) v.setOrtho(false);
  const up = new THREE.Vector3(a[6], a[7], a[8]);
  v.setUp(up); listen();
  v.persp.position.set(a[0], a[1], a[2]); v.controls.target.set(a[3], a[4], a[5]);
  v.persp.lookAt(v.controls.target); v.controls.update(); v.dirty = true;
}

/** a picture of the current view at w×h pixels, see-through where nothing is drawn */
function snapshot(w: number, h: number): string {
  const v = viewer!;
  v.beginCapture(Math.max(16, Math.round(w)), Math.max(16, Math.round(h)));
  v.render();
  // WebP keeps the see-through edges at a fraction of PNG's size (browsers without it fall back to PNG)
  const url = v.renderer.domElement.toDataURL('image/webp', 0.9);
  v.endCapture(); v.dirty = true;
  return url;
}

/** pages open in LaTeX Modeler in this browser (its session is kept on this same site) */
function openPages(): { name: string; text: string }[] {
  try {
    const s = JSON.parse(localStorage.getItem('lm.session.v3') || 'null');
    return Array.isArray(s?.docs) ? s.docs.filter((d: any) => d && typeof d.name === 'string' && typeof d.text === 'string').map((d: any) => ({ name: d.name, text: d.text })) : [];
  } catch { return []; }
}

let frame = 0;
function loop() { frame = requestAnimationFrame(loop); viewer?.tick(); }

const api = {
  ready: texReady(),
  inspect,
  show,
  showAt,
  duration: () => ctxNow?.duration ?? 6,
  /** turn on orbiting; onChange fires whenever the view moves */
  live(on: boolean, changed?: () => void) {
    onChange = on ? (changed ?? null) : null;
    host.classList.toggle('live', on);
    if (viewer) viewer.controls.enabled = on;
    cancelAnimationFrame(frame); if (on) loop();
  },
  resize() { viewer?.resize(); if (viewer) { viewer.dirty = true; viewer.render(); } },
  camera: () => (viewer ? getCam() : null),
  snapshot,
  spec: () => current,
  usesTime: () => !!ctxNow?.usesT,
  /** turn an equation into a page with the auto-modeller */
  async model(tex: string): Promise<{ ok: true; src: string; title: string; detected: string } | { ok: false; error: string }> {
    const m = await import('./model/generate');
    const r = m.autoModel(tex);
    return r.ok ? { ok: true, src: r.code!, title: r.title!, detected: r.detected! } : { ok: false, error: r.error || "That equation couldn't be modelled." };
  },
  /** handwritten strokes (each a list of [x, y], y pointing down) → LaTeX */
  async handwriting(strokes: [number, number][][]): Promise<string> {
    if (!Array.isArray(strokes) || strokes.length > 400) return '';
    const clean = strokes.filter(Array.isArray).map(s => s.slice(0, 4000).filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).map(p => [+p[0], +p[1]] as [number, number])).filter(s => s.length);
    const { toLatex } = await import('./hand/recognize');
    return toLatex(clean);
  },
  library: () => [...TEMPLATES, ...EXAMPLES].map(e => ({ key: e.key, kind: e.kind, folder: e.folder, title: e.title, about: e.about, format: e.format, src: e.src })),
  openPages,
  /** the address that opens this page as a new document in LaTeX Modeler */
  async openLink(name: string, src: string) { return new URL('./', location.href).href + '#' + await shareFragment(name, src); },
};
declare global { interface Window { LMFigure: typeof api } }
window.LMFigure = api;
