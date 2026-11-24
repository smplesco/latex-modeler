// Card pictures for the start screen: each page is built in a small offscreen viewer, seen at a slight angle,
// and kept as a JPEG (in memory, and in localStorage so the next start is instant).
import { Viewer } from '../render/viewer';
import { runProgram, type RunHooks } from '../lang/interp';
import { measureTex } from '../render/tex';

const VERSION = 'lm-thumb-4:';
const W = 480, H = 360;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length.toString(36); };

type Job = { src: string; resolve: (url: string | null) => void; hooks?: RunHooks; flat?: boolean };
export class Thumbs {
  private mem = new Map<string, string>();
  private queue: Job[] = []; private busy = false;
  private viewer: Viewer | null = null; private host: HTMLDivElement | null = null; private idleT = 0;

  /** a picture of the page this code draws (null if it fails to run) */
  get(src: string, priority = false): Promise<string | null> {
    const k = VERSION + hash(src);
    const hit = this.mem.get(k) ?? (() => { try { return localStorage.getItem(k); } catch { return null; } })();
    if (hit) { this.mem.set(k, hit); return Promise.resolve(hit); }
    return new Promise(resolve => {
      const job = { src, resolve: (u: string | null) => { if (u) { this.mem.set(k, u); this.store(k, u); } resolve(u); } };
      priority ? this.queue.unshift(job) : this.queue.push(job);
      this.pump();
    });
  }
  /** a slide as the audience sees it (straight on, with these slider values); kept in memory only */
  slide(src: string, hooks: RunHooks): Promise<string | null> {
    const k = 'slide:' + hash(src + JSON.stringify(hooks));
    const hit = this.mem.get(k); if (hit) return Promise.resolve(hit);
    return new Promise(resolve => {
      this.queue.unshift({ src, hooks, flat: true, resolve: (u: string | null) => { if (u) { if (this.mem.size > 300) this.mem.clear(); this.mem.set(k, u); } resolve(u); } });
      this.pump();
    });
  }
  cached(src: string): string | null { return this.mem.get(VERSION + hash(src)) ?? null; }

  private store(k: string, u: string) {
    try { localStorage.setItem(k, u); }
    catch {   // full: drop older pictures and try once more
      try { for (const key of Object.keys(localStorage)) if (key.startsWith('lm-thumb-')) localStorage.removeItem(key); localStorage.setItem(k, u); } catch { /* fine: memory only */ }
    }
  }
  private pump() {
    if (this.busy) return; this.busy = true; clearTimeout(this.idleT);
    const step = () => {
      const job = this.queue.shift();
      if (!job) { this.busy = false; this.idleT = window.setTimeout(() => this.release(), 4000); return; }
      let url: string | null = null;
      try { url = this.render(job.src, job.hooks, job.flat); } catch { url = null; }
      job.resolve(url);
      setTimeout(step, 16);   // let the page breathe between pictures
    };
    setTimeout(step, 30);
  }
  private render(src: string, hooks: RunHooks = {}, flat = false): string {
    if (!this.viewer) {
      this.host = document.createElement('div');
      Object.assign(this.host.style, { position: 'fixed', left: '-10000px', top: '0', width: W + 'px', height: H + 'px', pointerEvents: 'none' });
      document.body.appendChild(this.host);
      this.viewer = new Viewer(this.host);
      this.viewer.renderer.setPixelRatio(1); this.viewer.beginCapture(W, H); this.viewer.setOrtho(false);
    }
    const v = this.viewer;
    v.beginCapture(flat ? 640 : W, flat ? 360 : H);   // slides are pictured 16:9, cards 4:3
    let ctx = runProgram(src, 0, { ...hooks, measure: measureTex });
    if (ctx.usesT && !flat) ctx = runProgram(src, (ctx.duration ?? 6) * 0.35, { ...hooks, measure: measureTex });   // animated pages: mid-motion
    v.build(ctx, []);
    if (flat) { const c = ctx.cam ?? { yaw: 0, pitch: 0, zoom: 1 }; v.place(c.yaw, c.pitch, c.zoom); } else v.place(0.22, 0.15, 0.9);
    v.render();
    return v.renderer.domElement.toDataURL('image/jpeg', 0.84);
  }
  /** free the WebGL context once the queue is empty */
  private release() {
    if (this.busy || !this.viewer) return;
    try { this.viewer.renderer.dispose(); this.viewer.renderer.forceContextLoss(); } catch { /* ignore */ }
    this.host?.remove(); this.viewer = null; this.host = null;
  }
}
