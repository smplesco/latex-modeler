// The sliders and toggles a page makes with slider() / toggle(): a small panel over the viewer.
// Used by the app and by exported HTML pages, so it brings its own styles.
import type { Control } from '../lang/interp';
import { previewSVG } from '../render/tex';

const CSS = `
.lmc{position:absolute;right:12px;bottom:12px;z-index:22;min-width:220px;max-width:min(360px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;
  background:rgba(24,25,29,.92);border:1px solid #393b41;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);color:#d9dde2;font:12px Inter,system-ui,'Segoe UI',sans-serif;backdrop-filter:blur(6px)}
.lmc .hd{display:flex;align-items:center;gap:6px;padding:6px 8px 6px 10px;cursor:pointer;user-select:none;color:#aeb6bf;font-weight:600;letter-spacing:.02em}
.lmc .hd span{flex:1}
.lmc .hd button{background:none;border:1px solid transparent;color:#aeb6bf;border-radius:5px;font:inherit;padding:1px 6px;cursor:pointer}
.lmc .hd button:hover{border-color:#4a4d55;color:#fff}
.lmc .bd{padding:2px 10px 9px}
.lmc.closed .bd{display:none}
.lmc .row{display:grid;grid-template-columns:minmax(40px,auto) 1fr 46px;align-items:center;gap:8px;min-height:26px}
.lmc .lb{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;color:#e7eaee}
.lmc .lb svg{vertical-align:middle;max-height:18px}
.lmc .lb mjx-container{color:#e7eaee}
.lmc input[type=range]{width:100%;accent-color:#36b4ff;margin:0}
.lmc .v{font:11px ui-monospace,Consolas,monospace;text-align:right;color:#9fd8ff}
.lmc .tg{display:flex;align-items:center;gap:8px;min-height:26px;cursor:pointer}
.lmc .tg input{accent-color:#36b4ff;margin:0}
@media (max-width:700px){.lmc{right:6px;bottom:6px;min-width:0;width:calc(100% - 12px);max-height:42%}}
`;
let styled = false;

export class ControlPanel {
  el: HTMLDivElement;
  private body: HTMLDivElement;
  private sig = '';
  private rows = new Map<string, { input: HTMLInputElement; val?: HTMLElement; c: Control }>();
  /** a control moved: name → new value (null: reset all) */
  onChange: ((name: string | null, value: number) => void) | null = null;

  constructor(host: HTMLElement) {
    if (!styled) { styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
    this.el = document.createElement('div'); this.el.className = 'lmc'; this.el.style.display = 'none';
    this.el.innerHTML = '<div class="hd"><span>Sliders</span><button type="button" data-a="reset" title="Back to the values in the code">Reset</button><button type="button" data-a="fold" title="Hide or show">▾</button></div><div class="bd"></div>';
    this.body = this.el.querySelector('.bd')!;
    this.el.querySelector('.hd')!.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'reset') { this.onChange?.(null, 0); return; }
      this.el.classList.toggle('closed'); (this.el.querySelector('[data-a=fold]') as HTMLElement).textContent = this.el.classList.contains('closed') ? '▴' : '▾';
    });
    // keep drags inside the panel from orbiting the page underneath
    for (const ev of ['pointerdown', 'wheel', 'dblclick']) this.el.addEventListener(ev, e => e.stopPropagation());
    host.appendChild(this.el);
  }

  get count() { return this.rows.size; }

  /** show the controls of the latest run (rebuilt only when the set of controls changes, so a drag isn't interrupted) */
  update(list: Control[]) {
    const sig = JSON.stringify(list.map(c => [c.name, c.label, c.kind, c.min, c.max, c.step]));
    if (sig !== this.sig) { this.sig = sig; this.build(list); }
    for (const c of list) {
      const r = this.rows.get(c.name); if (!r) continue; r.c = c;
      if (c.kind === 'toggle') r.input.checked = !!c.value;
      else { if (document.activeElement !== r.input) r.input.value = String(c.value); r.val!.textContent = fmt(c.value, c); }
    }
    this.el.style.display = list.length ? '' : 'none';
  }

  private build(list: Control[]) {
    this.rows.clear(); this.body.innerHTML = '';
    for (const c of list) {
      const lb = document.createElement('span'); lb.className = 'lb'; lb.title = `${c.name} (line ${c.line}) · double-click to reset`;
      if (/[\\^_{}]/.test(c.label)) { const p = previewSVG(c.label); if (p.el && !p.err) lb.appendChild(p.el); else lb.textContent = c.label; } else lb.textContent = c.label;
      if (c.kind === 'toggle') {
        const row = document.createElement('label'); row.className = 'tg';
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!c.value;
        input.onchange = () => this.onChange?.(c.name, input.checked ? 1 : 0);
        row.append(input, lb); this.body.appendChild(row); this.rows.set(c.name, { input, c });
        continue;
      }
      const row = document.createElement('div'); row.className = 'row';
      const input = document.createElement('input'); input.type = 'range'; input.min = String(c.min); input.max = String(c.max);
      input.step = c.step > 0 ? String(c.step) : String((c.max - c.min) / 1000); input.value = String(c.value);
      input.setAttribute('aria-label', c.name);
      const val = document.createElement('span'); val.className = 'v'; val.textContent = fmt(c.value, c);
      input.oninput = () => { val.textContent = fmt(+input.value, c); this.onChange?.(c.name, +input.value); };
      lb.ondblclick = () => this.onChange?.(c.name, c.def);
      row.append(lb, input, val); this.body.appendChild(row); this.rows.set(c.name, { input, val, c });
    }
  }
}

function fmt(v: number, c: Control) {
  const span = Math.abs(c.max - c.min), d = c.step > 0 ? Math.max(0, Math.min(4, -Math.floor(Math.log10(c.step) + 1e-9))) : span >= 100 ? 0 : span >= 10 ? 1 : 2;
  return v.toFixed(d);
}
