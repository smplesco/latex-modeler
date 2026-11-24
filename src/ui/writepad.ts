// A pad to write an equation by hand (finger, pen or mouse). It's read as you write, on this device,
// and the LaTeX can be fixed before it's used.
import { previewSVG } from '../render/tex';

const CSS = `
#wpad{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}
#wpad .box{width:min(760px,calc(100% - 20px));background:#1d1e22;border:1px solid #393b41;border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.5);color:#e3e6ea;font:13px Inter,system-ui,sans-serif;padding:14px}
#wpad h3{margin:0 0 2px;font-size:15px}
#wpad .sub{color:#9aa3ad;margin:0 0 10px;font-size:12px}
#wpad canvas{display:block;width:100%;height:min(46vh,320px);background:#fbfbf8;border-radius:8px;touch-action:none;cursor:crosshair}
#wpad .out{display:flex;gap:8px;align-items:center;margin-top:10px}
#wpad input{flex:1;min-width:0;font:12px ui-monospace,Consolas,monospace;background:#151618;color:#e3e6ea;border:1px solid #3a3c42;border-radius:6px;padding:7px}
#wpad .pv{min-height:44px;margin-top:8px;background:#fbfbf8;color:#111;border-radius:8px;padding:4px;display:flex;align-items:center;justify-content:center;overflow:auto;color:#e8ebee}
#wpad .pv svg{max-height:52px}
#wpad .row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap}
#wpad button{background:#2a2b31;border:1px solid #3b3d44;color:#e3e6ea;border-radius:7px;padding:6px 14px;font:inherit;cursor:pointer}
#wpad button:hover{border-color:#5a5c63}
#wpad button.p{background:#36b4ff;border-color:#36b4ff;color:#07131d;font-weight:600}
#wpad .sp{flex:1}
`;

export function openWritePad(opts: { title?: string; action: string; onUse: (tex: string) => void }) {
  if (document.getElementById('wpad')) return;
  const el = document.createElement('div'); el.id = 'wpad';
  el.innerHTML = `<style>${CSS}</style><div class="box" role="dialog" aria-label="Write an equation">
    <h3>${opts.title ?? 'Write an equation'}</h3><p class="sub">Write it the way you would on paper. It's read as you go, right here on this device. Fix anything it gets wrong in the box underneath.</p>
    <canvas></canvas>
    <div class="out"><input id="wpTex" spellcheck="false" autocomplete="off" placeholder="the LaTeX appears here"></div>
    <div class="pv" id="wpPrev"></div>
    <div class="row"><button data-a="undo">Undo</button><button data-a="clear">Clear</button><span class="sp"></span><button data-a="cancel">Cancel</button><button class="p" data-a="use">${opts.action}</button></div></div>`;
  document.body.appendChild(el);
  const cv = el.querySelector('canvas')!, g = cv.getContext('2d')!, inp = el.querySelector<HTMLInputElement>('#wpTex')!, prev = el.querySelector<HTMLElement>('#wpPrev')!;
  const strokes: [number, number][][] = []; let cur: [number, number][] | null = null; let edited = false;
  const size = () => { const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1; cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); g.setTransform(d, 0, 0, d, 0, 0); draw(); };
  const draw = () => {
    const r = cv.getBoundingClientRect(); g.clearRect(0, 0, r.width, r.height);
    g.strokeStyle = '#e4e2da'; g.lineWidth = 1; g.beginPath(); g.moveTo(16, r.height * 0.62); g.lineTo(r.width - 16, r.height * 0.62); g.stroke();
    g.strokeStyle = '#1b2430'; g.lineWidth = 2.6; g.lineCap = g.lineJoin = 'round';
    for (const s of strokes) { g.beginPath(); s.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); if (s.length === 1) g.lineTo(s[0][0] + 0.1, s[0][1]); g.stroke(); }
  };
  const showTex = (t: string) => {
    prev.innerHTML = ''; if (!t.trim()) return;
    const p = previewSVG(t); if (p.el && !p.err) prev.appendChild(p.el); else prev.textContent = "That LaTeX has a mistake in it.";
  };
  let tok = 0;
  const read = async () => {
    if (edited) return; const my = ++tok;
    if (!strokes.length) { inp.value = ''; showTex(''); return; }
    const { toLatex } = await import('../hand/recognize');
    const t = toLatex(strokes); if (my !== tok || edited) return;
    inp.value = t; showTex(t);
  };
  const pt = (e: PointerEvent): [number, number] => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); cur = [pt(e)]; strokes.push(cur); edited = false; draw(); });
  cv.addEventListener('pointermove', e => { if (!cur) return; const q = pt(e), l = cur[cur.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= 1.5) { cur.push(q); draw(); } });
  const up = () => { if (!cur) return; cur = null; read(); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  inp.addEventListener('input', () => { edited = true; showTex(inp.value); });
  const close = () => { el.remove(); removeEventListener('resize', size); removeEventListener('keydown', key, true); };
  const use = () => { const t = inp.value.trim(); if (!t) { inp.focus(); return; } close(); opts.onUse(t); };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && document.activeElement !== inp) { e.preventDefault(); e.stopPropagation(); strokes.pop(); edited = false; draw(); read(); }
    else if (e.key === 'Enter' && document.activeElement === inp) { e.preventDefault(); use(); }
  };
  addEventListener('keydown', key, true); addEventListener('resize', size);
  el.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'undo') { strokes.pop(); edited = false; draw(); read(); }
    else if (a === 'clear') { strokes.length = 0; edited = false; draw(); read(); }
    else if (a === 'cancel') close();
    else if (a === 'use') use();
    else if (e.target === el) close();
  });
  requestAnimationFrame(size);
}
