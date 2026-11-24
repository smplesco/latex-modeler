// Presenting a deck: the viewer fills the screen, arrow keys move between slides, and a second window
// (the presenter view) shows your notes, the next slide and a timer. Ink and the laser work while presenting.

export interface PresentHost {
  slides(): { title: string; notes: string }[];
  current(): number;
  go(k: number): void;
  /** a picture of slide k for the presenter view */
  shot(k: number): Promise<string | null>;
  name(): string;
  /** the slide shown plays its animation (true when it uses t) */
  autoplay(): void;
  stopped(): void;
  /** the browser blocked the presenter window */
  blocked(): void;
}

const CSS = `
#app.presenting{grid-template-rows:1fr}
#app.presenting #top,#app.presenting #edpane,#app.presenting #split,#app.presenting #panel,#app.presenting #status,
#app.presenting #modelbar,#app.presenting #mprev,#app.presenting #vbar,#app.presenting #hint{display:none!important}
#app.presenting #main{grid-template-columns:1fr!important}
#app.presenting #viewpane{grid-column:1/-1}
#presBar{position:absolute;right:14px;bottom:14px;z-index:30;display:none;align-items:center;gap:6px;padding:5px 7px;border-radius:10px;
  background:rgba(20,21,24,.82);border:1px solid #3a3b40;color:#dfe3e8;font:12px Inter,system-ui,sans-serif;transition:opacity .35s}
#app.presenting #presBar{display:flex}
#presBar.idle{opacity:0}
#presBar button{background:#2a2b30;border:1px solid #3a3b40;color:#e6e9ec;border-radius:6px;padding:3px 10px;font:inherit;cursor:pointer}
#presBar button:hover{border-color:#5a5b61}
#presBar span{font-variant-numeric:tabular-nums;min-width:50px;text-align:center}
`;

const POP_CSS = `
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#15161a;color:#e7eaee;font:14px Inter,system-ui,'Segoe UI',sans-serif}
#w{display:grid;grid-template-rows:auto 1fr auto;height:100%}
header{display:flex;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid #2b2d33;background:#1b1c21}
header b{font-size:15px}header .sp{flex:1}
#timer{font:600 22px ui-monospace,Consolas,monospace;color:#9fd8ff}
#clock{color:#8d96a0;font:13px ui-monospace,monospace}
button{background:#2a2b31;border:1px solid #3b3d44;color:#e7eaee;border-radius:7px;padding:6px 14px;font:inherit;cursor:pointer}
button:hover{border-color:#36b4ff}button.p{background:#36b4ff;border-color:#36b4ff;color:#07131d;font-weight:600}
main{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:16px;padding:14px 16px;min-height:0}
.col{display:flex;flex-direction:column;gap:8px;min-height:0}
.lab{color:#8d96a0;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.shot{background:#0d0e11;border:1px solid #2b2d33;border-radius:8px;aspect-ratio:16/9;display:grid;place-items:center;overflow:hidden;color:#5f6770}
.shot img{width:100%;height:100%;object-fit:contain}
#next .shot{max-height:34vh}
#notes{flex:1;overflow:auto;white-space:pre-wrap;line-height:1.5;font-size:var(--fs,20px);background:#1b1c21;border:1px solid #2b2d33;border-radius:8px;padding:12px 14px;min-height:80px}
#notes:empty::before{content:'No notes for this slide. Add notes("…") after slide("…") in the code.';color:#6b737c;font-size:14px}
footer{display:flex;gap:8px;align-items:center;padding:10px 16px;border-top:1px solid #2b2d33}
footer .sp{flex:1}
`;

export class Presenter {
  private win: Window | null = null;
  private start = 0; private pausedAt = 0; private tick = 0; private idleT = 0;
  private bar: HTMLDivElement;
  active = false;

  constructor(private host: PresentHost, private app: HTMLElement, viewArea: HTMLElement) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.bar = document.createElement('div'); this.bar.id = 'presBar';
    this.bar.innerHTML = '<button data-a="prev" title="Previous (←)">‹</button><span id="presNum"></span><button data-a="next" title="Next (→ or Space)">›</button><button data-a="notes" title="Open the presenter window: notes, next slide, timer">Notes</button><button data-a="end" title="Stop presenting (Esc)">End</button>';
    this.bar.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'prev') this.step(-1); else if (a === 'next') this.step(1); else if (a === 'notes') this.openWindow(); else if (a === 'end') this.stop();
    });
    this.bar.addEventListener('pointerdown', e => e.stopPropagation());
    viewArea.appendChild(this.bar);
    document.addEventListener('fullscreenchange', () => { if (this.active && !document.fullscreenElement && this.wentFull) this.stop(); });
    window.addEventListener('keydown', e => this.key(e), true);
    viewArea.addEventListener('pointermove', () => this.wake());
  }
  private wentFull = false;

  async begin() {
    if (this.active) return;
    this.active = true; this.app.classList.add('presenting');
    this.start = Date.now(); this.pausedAt = 0;
    this.wentFull = false;
    try { await document.documentElement.requestFullscreen?.(); this.wentFull = !!document.fullscreenElement; } catch { /* fine: presents in the window */ }
    window.dispatchEvent(new Event('resize'));
    this.openWindow();
    this.update(); this.host.autoplay(); this.wake();
    clearInterval(this.tick); this.tick = window.setInterval(() => this.clock(), 500);
  }
  stop() {
    if (!this.active) return;
    this.active = false; this.app.classList.remove('presenting');
    clearInterval(this.tick);
    try { this.win?.close(); } catch { /* ignore */ }
    this.win = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    window.dispatchEvent(new Event('resize'));
    this.host.stopped();
  }
  step(d: number) { const n = this.host.slides().length; const k = Math.max(0, Math.min(n - 1, this.host.current() + d)); if (k !== this.host.current()) { this.host.go(k); this.host.autoplay(); } }

  private key(e: KeyboardEvent) {
    if (!this.active) return;
    const t = e.target as HTMLElement; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key), prev = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key);
    if (next || prev) { e.preventDefault(); e.stopImmediatePropagation(); this.step(next ? 1 : -1); return; }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopImmediatePropagation(); this.host.go(e.key === 'Home' ? 0 : this.host.slides().length - 1); return; }
    if (e.key === 'Escape' && !this.wentFull) { e.preventDefault(); this.stop(); }
  }
  private wake() {
    this.bar.classList.remove('idle'); clearTimeout(this.idleT);
    this.idleT = window.setTimeout(() => this.bar.classList.add('idle'), 2200);
  }

  /** the slide changed (or the deck was edited): refresh the bar and the presenter window */
  update() {
    if (!this.active) return;
    const slides = this.host.slides(), k = this.host.current(), n = slides.length;
    if (!n) { this.stop(); return; }
    (this.bar.querySelector('#presNum') as HTMLElement).textContent = `${k + 1} / ${n}`;
    const w = this.win; if (!w || w.closed) return;
    const $ = (id: string) => w.document.getElementById(id)!;
    $('title').textContent = `${k + 1} / ${n} · ${slides[k].title || 'Untitled slide'}`;
    $('notes').textContent = slides[k].notes;
    $('nextT').textContent = k + 1 < n ? (slides[k + 1].title || `Slide ${k + 2}`) : 'End of the deck';
    const put = (id: string, i: number) => {
      const box = $(id); if (i >= n) { box.innerHTML = '—'; return; }
      box.dataset.want = String(i);
      this.host.shot(i).then(u => { if (box.dataset.want === String(i)) box.innerHTML = u ? `<img alt="" src="${u}">` : '…'; });
    };
    put('nowS', k); put('nextS', k + 1);
  }

  private clock() {
    const w = this.win; if (!w || w.closed) return;
    const ms = (this.pausedAt || Date.now()) - this.start, s = Math.floor(ms / 1000);
    w.document.getElementById('timer')!.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    w.document.getElementById('clock')!.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  openWindow() {
    if (this.win && !this.win.closed) { this.win.focus(); return; }
    const w = window.open('', 'lm-presenter', 'popup,width=1000,height=640');
    if (!w) { this.host.blocked(); return; }
    this.win = w;
    const d = w.document;
    d.open(); d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Presenter view</title></head><body></body></html>'); d.close();
    const st = d.createElement('style'); st.textContent = POP_CSS; d.head.appendChild(st);
    d.body.innerHTML = `<div id="w"><header><b id="title"></b><span class="sp"></span><span id="clock"></span><span id="timer">00:00</span><button id="tp">Pause</button><button id="tr">Reset</button></header>
      <main><div class="col"><div class="lab">Now</div><div class="shot" id="nowS"></div><div class="lab">Notes <button id="aMinus" style="padding:1px 8px">A−</button> <button id="aPlus" style="padding:1px 8px">A+</button></div><div id="notes"></div></div>
      <div class="col" id="next"><div class="lab">Next · <span id="nextT"></span></div><div class="shot" id="nextS"></div></div></main>
      <footer><button id="pv">‹ Previous</button><button class="p" id="nx">Next ›</button><span class="sp"></span><span style="color:#8d96a0">← → or Space move the slides in either window</span><button id="en">End show</button></footer></div>`;
    let fs = 20;
    const on = (id: string, f: () => void) => { d.getElementById(id)!.onclick = f; };
    on('pv', () => this.step(-1)); on('nx', () => this.step(1)); on('en', () => this.stop());
    on('tr', () => { this.start = Date.now(); if (this.pausedAt) this.pausedAt = this.start; this.clock(); });
    on('tp', () => {
      if (this.pausedAt) { this.start += Date.now() - this.pausedAt; this.pausedAt = 0; d.getElementById('tp')!.textContent = 'Pause'; }
      else { this.pausedAt = Date.now(); d.getElementById('tp')!.textContent = 'Resume'; }
    });
    on('aPlus', () => { fs = Math.min(48, fs + 2); d.getElementById('notes')!.style.setProperty('--fs', fs + 'px'); });
    on('aMinus', () => { fs = Math.max(12, fs - 2); d.getElementById('notes')!.style.setProperty('--fs', fs + 'px'); });
    w.addEventListener('keydown', e => {
      const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key), prev = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
      if (next || prev) { e.preventDefault(); this.step(next ? 1 : -1); } else if (e.key === 'Escape') this.stop();
    });
    this.update(); this.clock();
  }
}
