// LaTeX Modeler player: the viewer half of the app, packed into one script for exported .html pages.
// It reads the page code embedded in the file, renders the page in 3D, plays the timeline and opens
// any figure in the Figure Explorer. No editor, no file access, works offline.
import { runProgram, RunCtx } from './lang/interp';
import { Viewer } from './render/viewer';
import { texReady, measureTex } from './render/tex';
import { Explorer } from './explore/explorer';
import { FigureChips } from './explore/chips';

declare global { interface Window { __LATEX_MODELER_DOC?: { name: string; source: string; exported?: string } } }

const CSS = `
html,body{margin:0;height:100%;background:#202124;color:#d7dde4;font:13px Inter,system-ui,'Segoe UI',sans-serif;overflow:hidden}
#bp{position:fixed;inset:0;display:flex;flex-direction:column}
#bpBar{display:flex;align-items:center;gap:8px;padding:7px 12px;background:#17181b;border-bottom:1px solid #2c2e33;flex-wrap:wrap}
#bpBar b{color:#fff;font-weight:600;margin-right:6px}
#bpBar .sp{flex:1}
#bpBar small{color:#7f8994}
.bb{background:#2a2d33;color:#d7dde4;border:1px solid #3a3e46;border-radius:5px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}
.bb:hover{border-color:#36b4ff}.bb.on{background:#1d3a52;border-color:#36b4ff;color:#fff}
#bpT{display:flex;align-items:center;gap:7px}
#bpT input{width:min(260px,30vw);accent-color:#36b4ff}
#bpT span{font:11px ui-monospace,Consolas,monospace;min-width:56px}
#bpView{position:relative;flex:1;min-height:0}
#bpGl{position:absolute;inset:0}
#bpHint{position:absolute;left:12px;bottom:12px;background:rgba(17,24,32,.75);color:#b9c3cd;padding:6px 10px;border-radius:6px;font-size:11.5px;line-height:1.5;pointer-events:none}
#bpErr{position:absolute;inset:0;display:none;place-items:center;color:#ff9b9b;font:13px ui-monospace,monospace;white-space:pre-wrap;padding:30px}
#bpLoad{position:absolute;inset:0;display:grid;place-items:center;color:#8d97a2}
`;

async function main() {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const doc = window.__LATEX_MODELER_DOC ?? { name: 'page.bd', source: 'page("A4")\ntex("\\\\text{No page embedded}", (105, 200))' };
  const title = doc.name.replace(/\.bd$/, '');
  document.title = title + ' — LaTeX Modeler';
  document.body.innerHTML = `
  <div id="bp">
    <div id="bpBar">
      <b>${title.replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))}</b>
      <span id="bpT" style="display:none"><button class="bb" id="bpPlay" title="Play / pause (Space)">▶</button>
        <input type="range" id="bpSl" min="0" max="6" step="0.01" value="0"><span id="bpTv">t = 0.00</span></span>
      <button class="bb on" id="bpCam" title="Camera follows the page's animation">Camera</button>
      <button class="bb on" id="bpOrtho" title="Orthographic / perspective (O)">Ortho</button>
      <button class="bb" id="bpReset" title="Back to the flat page view (F)">Reset</button>
      <button class="bb" id="bpExp" title="Open the first figure in the explorer (E)">Explore figures</button>
      <span class="sp"></span><small>made with LaTeX Modeler${doc.exported ? ' · ' + doc.exported : ''}</small>
    </div>
    <div id="bpView"><div id="bpGl"></div>
      <div id="bpHint">drag to orbit · right-drag to pan · scroll to zoom<br>double-click a figure (or its ⤢ button) to explore it in 3D</div>
      <div id="bpErr"></div><div id="bpLoad">Loading…</div></div>
  </div>`;
  const $ = (id: string) => document.getElementById(id)!;
  if (matchMedia('(pointer: coarse)').matches) $('bpHint').innerHTML = 'drag to orbit · pinch to zoom · two-finger drag to pan<br>tap a figure\'s ⤢ button to explore it in 3D';
  await texReady();
  const viewer = new Viewer($('bpGl'));
  let t = 0, duration = 6, usesT = false, playing = false, follow = true, ctx: RunCtx | null = null, first = true;
  const explorer = new Explorer($('bpView'), {
    source: () => doc.source, time: () => t, measure: measureTex, title: () => doc.name,
    snapshot: (url, name) => { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); },
  });
  const chips = new FigureChips($('bpGl'), viewer, t => explorer.openTarget(t));
  const tour = () => ctx?.cam ?? (() => { const ph = duration > 0 ? t / duration : 0; return { yaw: 0.85 * Math.sin(2 * Math.PI * ph), pitch: 0.5 * Math.sin(Math.PI * ph), zoom: 1 + 0.3 * Math.sin(Math.PI * ph) }; })();
  const applyCam = () => { const c = tour(); viewer.place(c.yaw, c.pitch, c.zoom); };
  const compile = () => {
    try { ctx = runProgram(doc.source, t, { measure: measureTex }); }
    catch (e: any) { $('bpErr').style.display = 'grid'; $('bpErr').textContent = 'This page has an error:\n' + e.message; return; }
    viewer.build(ctx, []); chips.update(ctx);
    usesT = ctx.usesT; duration = ctx.duration ?? 6;
    ($('bpSl') as HTMLInputElement).max = String(duration);
    $('bpT').style.display = usesT || ctx.cam ? 'flex' : 'none';
    $('bpExp').style.display = chips.count ? '' : 'none';
    if (first) { first = false; viewer.place(0, 0, 1); }
  };
  const setT = (v: number) => {
    t = Math.max(0, Math.min(duration, v)); ($('bpSl') as HTMLInputElement).value = String(t); $('bpTv').textContent = `t = ${t.toFixed(2)}`;
    if (usesT) compile(); if (follow) applyCam();
  };
  const setFollow = (f: boolean) => { follow = f; $('bpCam').classList.toggle('on', f); if (f) applyCam(); };
  const play = (p: boolean) => { playing = p; $('bpPlay').textContent = p ? '❚❚' : '▶'; if (p && t >= duration - 1e-6) t = 0; };
  $('bpSl').oninput = () => setT(+($('bpSl') as HTMLInputElement).value);
  $('bpPlay').onclick = () => play(!playing);
  $('bpCam').onclick = () => setFollow(!follow);
  $('bpOrtho').onclick = () => { viewer.setOrtho(!viewer.isOrtho); $('bpOrtho').classList.toggle('on', viewer.isOrtho); };
  $('bpReset').onclick = () => { setFollow(false); viewer.place(0, 0, 1); };
  $('bpExp').onclick = () => { const f = chips.first(); if (f) explorer.openTarget(f); };
  viewer.renderer.domElement.addEventListener('pointerdown', () => { if (follow && !playing) setFollow(false); });
  window.addEventListener('keydown', e => {
    if (explorer.isOpen || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); play(!playing); }
    else if (e.key === 'f' || e.key === 'F') $('bpReset').click();
    else if (e.key === 'o' || e.key === 'O') $('bpOrtho').click();
    else if (e.key === 'e' || e.key === 'E') $('bpExp').click();
  });
  compile(); $('bpLoad').remove();
  let last = performance.now();
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (explorer.isOpen) return;
    if (playing) { let nt = t + dt; if (nt >= duration) nt %= duration; setT(nt); viewer.dirty = true; }
    viewer.tick(); chips.position();
  };
  requestAnimationFrame(loop);
}
main().catch(e => { document.body.textContent = 'LaTeX Modeler failed to start: ' + (e?.message || e); });
